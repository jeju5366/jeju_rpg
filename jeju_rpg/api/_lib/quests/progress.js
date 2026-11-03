import { QUEST_RULES } from '../../../src/constants/gameBalance.js'
import { DISCOVERY_ALLOWED_METHODS } from '../../../src/constants/gameBalance.js'
import { diffLevels } from '../../../src/utils/level.js'
import { HttpError } from '../http.js'
import {
  awardAdventureCompletion,
  awardChapterCompletion,
  awardQuestCompletion,
  getExpSnapshot,
  grantPlaceDiscovery,
  levelUpsFromLedger,
  lookupLandmark,
  recordQuestVisit,
} from '../progression/exp.js'
import { checkTitleUnlocks } from '../progression/titles.js'
import { getAdmin } from '../supabaseAdmin.js'
import { resolveVerification } from './verification.js'

// 원장이 없을 때의 대비책: 지급 후 EXP 를 읽고, 이번에 지급한 양을 빼서 지급 전 EXP 를 구한다.
async function levelUpsByAfterSnapshot(db, userId, { questExp, discovery }) {
  const after = await getExpSnapshot(db, userId)
  const before = { ...after }
  if (questExp.awarded) for (const part of questExp.parts) if (part.category) before[part.category] -= part.amount
  if (discovery) before.discovery -= discovery.amount
  return diffLevels(before, after)
}

// 퀘스트/챕터 진행은 서버만 기록한다. (EXP 지급과 같은 경로라 클라이언트 직접 쓰기는 막혀 있다)
//
// 챕터 상태 흐름
//   locked ──(앞 챕터가 닫히면)──▶ active ──(핵심 퀘스트 완료)──▶ core_completed ──("다음 챕터로 진행")──▶ completed
//                                    └──("이 챕터 건너뛰기", 핵심 미완료)──────────────────────────────▶ skipped
//   · 핵심 퀘스트를 끝내도 챕터는 자동으로 넘어가지 않는다. 사용자가 선택 퀘스트를 더 할지, 다음으로 갈지 정한다.
//   · 챕터를 닫으면(completed / skipped) 남은 선택 퀘스트는 모두 종료(skipped)되고 다시 돌아갈 수 없다.
//   · completed 일 때만 챕터 완료 자유 EXP(+20). skipped 는 보너스 없음. 이미 얻은 퀘스트 보상은 유지된다.
//   · 마지막 챕터가 닫히면 메인 퀘스트와 모험이 자동 완료된다.

// 인증 확인은 ./verification.js 의 resolveVerification 한 곳에서 한다. (self 는 항상 가능, gps 는 위치 검증 후 인정)

async function one(query, notFound) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, notFound)
  return data
}

// 자유여행 중에는 모험이 멈춰 있다. 현재 챕터/완료한 퀘스트/진행 정보는 그대로 두고, 진행(퀘스트 완료·챕터 이동)만 막는다.
// (adventure.status 는 active 로 유지하고 trips.travel_mode 만 free 로 바뀐다)
async function assertNotFreeTravel(db, { userId, tripId }) {
  const { data, error } = await db.from('jeju_trips').select('travel_mode').eq('id', tripId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (data?.travel_mode === 'free') throw new HttpError(409, 'free_travel_active')
}

// 퀘스트 인증/완료 요청이 공통으로 확인하는 것: 퀘스트/모험/챕터 상태, 자유여행 여부, 이미 끝난 퀘스트인지.
// 반환: { quest, adventure, chapter, existing(quest_progress 행 | null) } — 규칙에 맞지 않으면 HttpError.
// 사진 인증(quests-photo-verify)도 같은 확인을 쓴다.
export async function loadQuestForVerification(db, { userId, questId }) {
  const quest = await one(db.from('jeju_quests').select('*').eq('id', questId).eq('user_id', userId), 'quest_not_found')
  if (quest.quest_type === 'main') throw new HttpError(400, 'main_not_completable') // 메인은 마지막 챕터가 닫히면 자동 완료
  if (quest.quest_type !== 'core' && quest.quest_type !== 'optional' && quest.quest_type !== 'surprise') throw new HttpError(400, 'quest_type_not_supported')
  if (quest.replaced_at) throw new HttpError(409, 'quest_closed') // REPLAN 으로 교체된 퀘스트
  if (quest.is_hidden) throw new HttpError(409, 'quest_hidden')

  // 돌발 퀘스트는 챕터에 속하지 않는다. 사용자가 "도전하기"를 누른(accepted) 것만 인증/완료할 수 있다.
  const isSurprise = quest.quest_type === 'surprise'

  // 서로 의존하지 않는 읽기(모험→여행 / 챕터 / 진행 기록)를 동시에 보낸다. 왕복 5번 → 3번.
  // 결과는 "기존 순서대로" 확인해서 오류 우선순위(adventure → free travel → surprise → chapter → 진행 상태)를 그대로 유지한다.
  const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }))
  const unwrap = (result) => {
    if (result.error) throw result.error
    return result.value
  }
  const adventureAndTrip = settle(
    (async () => {
      const adventure = await one(db.from('jeju_adventures').select('*').eq('id', quest.adventure_id).eq('user_id', userId), 'adventure_not_found')
      const { data: trip, error: tripError } = await db.from('jeju_trips').select('travel_mode').eq('id', adventure.trip_id).eq('user_id', userId).maybeSingle()
      return { adventure, trip, tripError }
    })(),
  )
  const chapterRead = settle(isSurprise ? Promise.resolve(null) : one(db.from('jeju_chapters').select('*').eq('id', quest.chapter_id).eq('user_id', userId), 'chapter_not_found'))
  const progressRead = settle(db.from('jeju_quest_progress').select('*').eq('user_id', userId).eq('quest_id', questId).maybeSingle())

  const { adventure, trip, tripError } = unwrap(await adventureAndTrip)
  // 복구: 이 사용자가 Final Quest 이전에 이미 확보한 완료 claim(in_progress + verification_method)이 있으면, Final Quest 로 모험이 종료된(ended_early) 뒤에도
  // 그 claim 을 마무리(completed)할 수 있다. 다른 사용자의 행/ended_by_final_quest/아직 claim 하지 않은 퀘스트에는 적용되지 않는다. (progress 조회는 user_id 로 걸러진다)
  const claimProgress = unwrap(await progressRead)
  if (claimProgress.error) throw claimProgress.error
  const recovering = isOwnClaim(claimProgress.data) && adventure.status === 'ended_early'
  if (adventure.status !== 'active' && !recovering) throw new HttpError(409, 'adventure_not_active')
  // 자유여행 중에는 모험이 멈춰 있다. (adventure.status 는 active 로 유지하고 trips.travel_mode 만 free 로 바뀐다)
  if (tripError) throw tripError
  if (trip?.travel_mode === 'free') throw new HttpError(409, 'free_travel_active')
  if (isSurprise && quest.surprise_status !== 'accepted') throw new HttpError(409, 'surprise_not_accepted')
  const chapter = unwrap(await chapterRead)
  const progressResult = unwrap(await progressRead)
  if (progressResult.error) throw progressResult.error
  const existing = progressResult.data

  if (existing?.status === 'completed') {
    // 이전 요청이 챕터 상태 갱신 전에 끊겼다면 여기서 바로잡는다.
    if (quest.quest_type === 'core' && chapter?.status === 'active') {
      await db.from('jeju_chapters').update({ status: 'core_completed' }).eq('id', chapter.id).eq('status', 'active')
    }
    throw new HttpError(409, 'already_completed')
  }
  if (existing?.status === 'skipped' || existing?.status === 'ended_by_final_quest') throw new HttpError(409, 'quest_closed')
  if (recovering) return { quest, adventure, chapter, existing, recovering: true } // 챕터는 Final Quest 로 닫혀 있다. claim 마무리에는 챕터 상태를 다시 보지 않는다.
  if (chapter && (chapter.status === 'locked' || chapter.status === 'available')) throw new HttpError(409, 'chapter_locked')
  if (chapter && (chapter.status === 'completed' || chapter.status === 'skipped' || chapter.status === 'replaced' || chapter.status === 'ended_by_final_quest')) throw new HttpError(409, 'chapter_closed') // 닫힌 챕터로는 돌아갈 수 없다
  // 핵심 퀘스트는 active 챕터에서만. 선택 퀘스트는 active / core_completed 에서 모두 수행할 수 있다(택1 아님).
  if (quest.quest_type === 'core' && chapter.status !== 'active') throw new HttpError(409, 'chapter_not_active')
  return { quest, adventure, chapter, existing }
}

// 완료 권한(claim) 확보. 반환: claim 된 progress 행(in_progress + verification_method). 이미 완료/마감된 퀘스트면 HttpError.
// 이 사용자가 이미 확보한 완료 claim 인가 (인증은 claim 전에 서버가 끝냈다)
const isOwnClaim = (row) => row?.status === 'in_progress' && Boolean(row.verification_method)

async function claimCompletion(db, { userId, questId, method, existing }) {
  let row = existing
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (row?.status === 'in_progress' && row.verification_method) return row // 이미 claim 됨 → 이어서
    if (!row) {
      const { data, error } = await db.from('jeju_quest_progress').insert({ user_id: userId, quest_id: questId, status: 'in_progress', verification_method: method }).select('*').single()
      if (!error) return data
      if (error.code !== '23505') throw error // unique 충돌 = 그 사이 다른 쪽이 행을 만들었다 → 다시 읽어서 판단
    } else {
      const { data, error } = await db
        .from('jeju_quest_progress')
        .update({ verification_method: method })
        .eq('id', row.id)
        .eq('status', 'in_progress')
        .is('verification_method', null)
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (data) return data
    }
    const { data: fresh, error: readError } = await db.from('jeju_quest_progress').select('*').eq('user_id', userId).eq('quest_id', questId).maybeSingle()
    if (readError) throw readError
    if (fresh?.status === 'completed') throw new HttpError(409, 'already_completed')
    if (fresh?.status === 'ended_by_final_quest' || fresh?.status === 'skipped') throw new HttpError(409, 'quest_closed') // Final Quest 가 먼저 마감함
    row = fresh
  }
  throw new HttpError(409, 'in_progress')
}

// 퀘스트 완료. 모든 인증 방식(self / gps / 사진 / gps_photo)이 이 한 곳으로 모인다. EXP/방문/발견도 여기서만 지급한다.
//   payload   : 클라이언트가 보낸 인증 요청({ method, position }). resolveVerification 이 검증한다.
//   preverified: 서버가 이미 검증을 끝낸 인증 결과({ method }) — 사진 인증 API 만 넘긴다. (요청 body 에서는 받지 않는다)
// 반환: 최종 완료면 { progress, chapterStatus, rewards }, gps_photo 의 중간 단계면 { pending: 'photo', progress, chapterStatus, rewards: null } (EXP 없음)
export async function completeQuest({ user, questId, payload = {}, preverified = null, db = getAdmin() }) {
  const userId = user.id
  const { quest, adventure, chapter, existing } = await loadQuestForVerification(db, { userId, questId })

  // 이미 claim 된 재요청은 첫 시도에서 서버가 인증을 끝낸 것이므로 같은 방법으로 이어서 마무리한다. (GPS/사진 인증을 다시 요구하지 않는다. EXP 는 기존 source key 가 막는다)
  const verification = isOwnClaim(existing) ? { method: existing.verification_method } : (preverified ?? resolveVerification(quest, payload, existing))

  // gps_photo 의 GPS 단계: 완료가 아니다. 중간 상태만 남기고 보상은 사진까지 끝난 뒤 한 번만 준다.
  if (verification.pending) {
    const gpsVerifiedAt = new Date().toISOString()
    const write = existing
      ? db.from('jeju_quest_progress').update({ gps_verified_at: gpsVerifiedAt }).eq('id', existing.id).eq('status', 'in_progress')
      : db.from('jeju_quest_progress').insert({ user_id: userId, quest_id: questId, status: 'in_progress', gps_verified_at: gpsVerifiedAt })
    const { data: progress, error: pendingError } = await write.select('*').single()
    if (pendingError) throw pendingError
    return { pending: verification.pending, progress, chapterStatus: chapter?.status ?? null, rewards: null }
  }

  // 완료 claim: EXP 를 지급하기 전에 "이 퀘스트를 내가 완료하는 중"이라는 권한을 progress 행에 먼저 확정한다. (in_progress + verification_method)
  //   · Final Quest 활성화는 verification_method 가 비어 있는 in_progress 행만 ended_by_final_quest 로 마감하므로, claim 된 퀘스트는 건드리지 않는다. (완료 먼저)
  //   · 이미 Final Quest 가 마감했다면 claim 이 실패해서(quest_closed) EXP 를 지급하지 않는다. (Final Quest 먼저)
  //   · claim 된 행이 남아 있는 재요청(이전 시도가 중간에 끊김 / 같은 퀘스트 동시 요청)은 이어서 진행한다. EXP/방문/발견은 기존 중복 방지 키가 그대로 막는다.
  const claimed = await claimCompletion(db, { userId, questId, method: verification.method, existing })
  const method = claimed.verification_method // 이미 claim 된 방법이 있으면 그 방법으로 (EXP 지급 방법과 기록이 어긋나지 않게)

  // 보상 → 방문/발견 → 진행 기록(마지막 = 커밋 지점) 순서. 보상과 방문/발견은 모두 중복 지급이 막혀 있어서(EXP source key / UNIQUE(user, place))
  // 중간에 실패해도 같은 요청을 다시 보내면 안전하게 이어서 처리된다.
  // DB 왕복을 줄이기 위해, 서로 의존하지 않는 것만 같은 단계에서 동시에 보낸다:
  //   1단계: 퀘스트 EXP 지급  ∥  명소 여부 조회(읽기 전용)
  //   2단계: 방문 기록(place_visits)  ∥  발견 지급(place_discoveries + 발견 EXP)
  //   ※ 퀘스트 EXP RPC 와 발견 RPC 는 같은 profile row 를 잠그고 갱신하므로 절대 동시에 보내지 않는다. (순서가 "지급 전 EXP" 원장의 전제다)
  //   ※ 진행 기록(커밋 지점)과 챕터 상태 변경은 위가 모두 끝난 뒤 순서대로 한다.
  const discoveryAllowed = Boolean(quest.place_id) && DISCOVERY_ALLOWED_METHODS.includes(method)
  const [expResult, landmarkResult] = await Promise.allSettled([
    awardQuestCompletion(db, { userId, quest, method: method }),
    discoveryAllowed ? lookupLandmark(db, quest.place_id) : Promise.resolve(false),
  ])
  if (expResult.status === 'rejected') throw expResult.reason
  if (landmarkResult.status === 'rejected') throw landmarkResult.reason
  const { ledger: questLedger, ...questExp } = expResult.value // ledger 는 서버 내부 계산용이라 응답에 싣지 않는다

  let discovery = null
  let discoveryLedger = null
  if (quest.place_id) {
    // GPS 근거(gps / gps_photo)가 있는 방문만 evidence 를 남긴다. 발견 EXP 는 DISCOVERY_ALLOWED_METHODS 로 한 곳에서 정한다.
    const gpsEvidence = method === 'gps' || method === 'gps_photo'
    const [visitResult, discoveryResult] = await Promise.allSettled([
      recordQuestVisit(db, { userId, tripId: adventure.trip_id, quest, evidence: gpsEvidence ? 'gps' : null }), // 방문: 매번 기록 (같은 퀘스트는 1건)
      discoveryAllowed ? grantPlaceDiscovery(db, { userId, placeId: quest.place_id, placeName: quest.place_name, isLandmark: landmarkResult.value }) : Promise.resolve(null), // 발견: 평생 최초 1회만
    ])
    if (visitResult.status === 'rejected') throw visitResult.reason
    if (discoveryResult.status === 'rejected') throw discoveryResult.reason
    discovery = discoveryResult.value?.discovery ?? null
    discoveryLedger = discoveryResult.value?.ledger ?? null
  }

  // 진행 기록(커밋 지점): claim 한 행을 completed 로 바꾼다. 아직 in_progress 일 때만 바뀌므로 같은 퀘스트의 동시 요청은 한쪽만 성공하고 나머지는 already_completed 로 거절된다.
  // (보상은 위에서 이미 중복 지급이 막혀 있다)
  const completedFields = { status: 'completed', verification_method: method, completed_at: new Date().toISOString() }
  const { data: progress, error: progressError } = await db.from('jeju_quest_progress').update(completedFields).eq('id', claimed.id).eq('status', 'in_progress').select('*').maybeSingle()
  if (progressError) throw progressError
  if (!progress) throw new HttpError(409, 'already_completed')

  let chapterStatus = chapter?.status ?? null
  if (quest.quest_type === 'core') {
    // 핵심 퀘스트 완료 = core_completed. 다음 챕터로는 사용자가 직접 넘어간다.
    const { error: chapterError } = await db.from('jeju_chapters').update({ status: 'core_completed' }).eq('id', chapter.id).eq('status', 'active')
    if (chapterError) throw chapterError
    chapterStatus = 'core_completed'
  }

  // 레벨업: 지급 DB 함수가 돌려준 "지급 전 EXP + 이번에 더한 EXP"(원장)로 기존 diffLevels 를 호출한다. (지급 전/후 EXP 스냅샷 조회 2회가 필요 없다)
  // 원장이 없는 환경(구버전 DB 함수)에서만 예전처럼 지급 후 EXP 를 한 번 읽어 역산한다.
  const awardedAnything = questExp.awarded || discovery
  const levelUps =
    !awardedAnything || questLedger || discoveryLedger
      ? levelUpsFromLedger([questLedger, discoveryLedger])
      : await levelUpsByAfterSnapshot(db, userId, { questExp, discovery })
  const titles = await checkTitleUnlocks(db, { userId, trigger: 'level_reached', data: { levelUps } })
  return { progress, chapterStatus, rewards: { quest: questExp, discovery, levelUps, titles } }
}

// 챕터 이동 버튼 하나가 상태에 따라 두 가지로 동작한다.
//   active(핵심 미완료)   → "이 챕터 건너뛰기"  : skipped, 챕터 보너스 없음
//   core_completed        → "다음 챕터로 진행"  : completed, 챕터 완료 자유 EXP +20
// 어느 쪽이든 남은 선택 퀘스트는 종료되고 다음 챕터가 열린다. 마지막 챕터면 모험이 끝난다.
// 이미 닫힌 챕터에 다시 요청이 오면(재전송) 아무것도 중복 지급하지 않고 다음 챕터 열기/모험 완료만 마저 확인한다.
export async function advanceChapter({ user, chapterId }) {
  const db = getAdmin()
  const userId = user.id

  const chapter = await one(db.from('jeju_chapters').select('*').eq('id', chapterId).eq('user_id', userId), 'chapter_not_found')
  const adventure = await one(db.from('jeju_adventures').select('*').eq('id', chapter.adventure_id).eq('user_id', userId), 'adventure_not_found')
  if (chapter.status === 'locked' || chapter.status === 'available') throw new HttpError(409, 'chapter_not_active')
  if (chapter.status === 'ended_by_final_quest') throw new HttpError(409, 'final_quest_active') // 여행 종료로 마감된 챕터는 다시 열 수 없다

  const rewards = { chapterBonus: 0, adventureBonus: 0 }
  let outcome = chapter.status
  let alreadyAdvanced = true

  if (chapter.status === 'active' || chapter.status === 'core_completed') {
    if (adventure.status !== 'active') throw new HttpError(409, 'adventure_not_active')
    await assertNotFreeTravel(db, { userId, tripId: adventure.trip_id })
    alreadyAdvanced = false
    const completing = chapter.status === 'core_completed'
    outcome = completing ? 'completed' : 'skipped'

    if (completing) {
      const bonus = await awardChapterCompletion(db, { userId, chapterId })
      if (bonus.awarded) rewards.chapterBonus = bonus.amount
    }
    const { error } = await db.from('jeju_chapters').update({ status: outcome, closed_at: new Date().toISOString() }).eq('id', chapterId).eq('status', chapter.status)
    if (error) throw error
    await closeOpenQuests(db, { userId, chapterId })
  }

  const next = await openNextOrFinish(db, { userId, adventure, chapter })
  rewards.adventureBonus = next.adventureBonus
  return {
    chapterStatus: outcome,
    alreadyAdvanced,
    nextChapterId: next.nextChapterId,
    adventureCompleted: next.adventureCompleted,
    rewards,
  }
}

// 닫는 챕터의 미완료 퀘스트(공개된 것)를 종료(skipped)로 기록한다. 이미 완료한 퀘스트와 그 보상은 그대로 둔다.
async function closeOpenQuests(db, { userId, chapterId }) {
  const { data: quests, error } = await db.from('jeju_quests').select('id').eq('chapter_id', chapterId).eq('is_hidden', false)
  if (error) throw error
  if (!quests.length) return
  const { error: upsertError } = await db
    .from('jeju_quest_progress')
    .upsert(
      quests.map((q) => ({ user_id: userId, quest_id: q.id, status: 'skipped' })),
      { onConflict: 'user_id,quest_id', ignoreDuplicates: true },
    )
  if (upsertError) throw upsertError
}

async function openNextOrFinish(db, { userId, adventure, chapter }) {
  const { data: next, error } = await db
    .from('jeju_chapters')
    .select('id')
    .eq('adventure_id', adventure.id)
    .eq('seq', chapter.seq + 1)
    .maybeSingle()
  if (error) throw error

  if (next) {
    const { error: openError } = await db.from('jeju_chapters').update({ status: 'active', activated_at: new Date().toISOString() }).eq('id', next.id).eq('status', 'locked')
    if (openError) throw openError
    return { nextChapterId: next.id, adventureCompleted: false, adventureBonus: 0 }
  }
  const finished = await finishAdventure(db, { userId, adventure })
  return { nextChapterId: null, adventureCompleted: finished.completed, adventureBonus: finished.bonus }
}

// 마지막 챕터가 닫히면 메인 퀘스트 자동 완료 + 모험 완료 + 모험 완주 자유 EXP(+50, 챕터를 건너뛰었으면 없음)
async function finishAdventure(db, { userId, adventure }) {
  const { data: chapters, error } = await db.from('jeju_chapters').select('status').eq('adventure_id', adventure.id).neq('status', 'replaced') // REPLAN 으로 교체된 챕터는 진행 대상이 아니다
  if (error) throw error
  if (chapters.some((c) => c.status !== 'completed' && c.status !== 'skipped')) return { completed: false, bonus: 0 }

  const skippedChapters = chapters.filter((c) => c.status === 'skipped').length
  const bonus = await awardAdventureCompletion(db, { userId, adventureId: adventure.id, skippedChapters })

  const { data: main, error: mainError } = await db.from('jeju_quests').select('id').eq('adventure_id', adventure.id).eq('quest_type', 'main').maybeSingle()
  if (mainError) throw mainError
  if (main) {
    const { error: progressError } = await db
      .from('jeju_quest_progress')
      .upsert(
        { user_id: userId, quest_id: main.id, status: 'completed', verification_method: 'self', completed_at: new Date().toISOString() },
        { onConflict: 'user_id,quest_id', ignoreDuplicates: true },
      )
    if (progressError) throw progressError
  }
  const { error: updateError } = await db.from('jeju_adventures').update({ status: 'completed' }).eq('id', adventure.id).eq('status', 'active')
  if (updateError) throw updateError
  return { completed: true, bonus: bonus.awarded ? bonus.amount : 0 }
}

// "퀘스트 더 받기": 숨겨 둔 선택 퀘스트를 AI 재호출 없이 공개한다. 진행 중인 챕터(active / core_completed)에서만.
export async function revealQuests({ user, chapterId }) {
  const db = getAdmin()
  const chapter = await one(db.from('jeju_chapters').select('*').eq('id', chapterId).eq('user_id', user.id), 'chapter_not_found')
  if (chapter.status === 'locked' || chapter.status === 'available') throw new HttpError(409, 'chapter_locked')
  if (chapter.status === 'completed' || chapter.status === 'skipped' || chapter.status === 'ended_by_final_quest') throw new HttpError(409, 'chapter_closed')

  const { data: hidden, error } = await db
    .from('jeju_quests')
    .select('id')
    .eq('chapter_id', chapterId)
    .eq('user_id', user.id)
    .eq('quest_type', 'optional')
    .eq('is_hidden', true)
    .order('seq', { ascending: true })
  if (error) throw error
  if (!hidden.length) throw new HttpError(409, 'nothing_to_reveal')

  const ids = hidden.slice(0, QUEST_RULES.revealCount).map((q) => q.id)
  const { data: revealed, error: updateError } = await db.from('jeju_quests').update({ is_hidden: false }).in('id', ids).select('*')
  if (updateError) throw updateError
  return { revealed, remainingHidden: hidden.length - ids.length }
}
