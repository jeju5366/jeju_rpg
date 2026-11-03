import {
  ADVENTURE_BONUS_REQUIRES_NO_SKIPPED_CHAPTER,
  DISCOVERY_ALLOWED_METHODS,
  DISCOVERY_EXP,
  FREE_EXP,
  FREE_EXP_INVEST_CATEGORIES,
} from '../../../src/constants/gameBalance.js'
import { calcQuestExp, splitExp } from '../../../src/utils/exp.js'
import { diffLevels, EXP_CATEGORY_KEYS } from '../../../src/utils/level.js'
import { HttpError } from '../http.js'

// EXP 지급의 중앙 경로. 페이지/엔드포인트가 profile.exp_* 를 직접 바꾸지 않고 반드시 여기를 거친다.
//   지급 요청 → (DB 함수 안에서) 중복 지급 확인 → exp_logs 생성 → profile EXP 업데이트 → 지급 전/후 EXP 반환
//   → 호출하는 쪽이 snapshot 전/후로 diffLevels 를 돌려 레벨업 여부를 판단한다.
// 중복 지급 방지: source_key (quest:{id}:completion, discovery:{placeId}, chapter:{id}:completion, adventure:{id}:completion, invest:{grantId})
//   가 DB 의 UNIQUE 인덱스로 보장된다. 같은 key 로 다시 호출하면 awarded=false 이고 아무것도 바뀌지 않는다.

const PROFILE_COLUMNS = ['exp_explore', 'exp_culture', 'exp_food', 'exp_relax', 'exp_social', 'exp_discovery', 'unspent_exp']

// 현재 EXP 스냅샷: { explore, ..., discovery, unspent }
export async function getExpSnapshot(db, userId) {
  const { data, error } = await db.from('jeju_profiles').select(PROFILE_COLUMNS.join(',')).eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'profile_not_found')
  return {
    ...Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, data[`exp_${key}`]])),
    unspent: data.unspent_exp,
  }
}

// before 스냅샷 대비 지금까지 오른 레벨들. → [{ category: 'overall' | 'food' ..., from, to }]
export async function levelUpsSince(db, userId, before) {
  return diffLevels(before, await getExpSnapshot(db, userId))
}

// DB 함수가 raise exception 으로 돌려주는 짧은 코드는 그대로 오류 코드로 쓰고, 그 외는 서버 오류로 처리한다.
const RPC_ERRORS = { grant_not_found: 404, invalid_category: 400, insufficient_unspent: 409, profile_not_found: 404, invalid_amount: 400 }

async function callRpc(db, name, args) {
  const { data, error } = await db.rpc(name, args)
  if (error) {
    const status = RPC_ERRORS[error.message]
    if (status) throw new HttpError(status, error.message)
    throw error
  }
  return data
}

// parts: [{ category: 'explore'..'discovery' | null(자유 EXP), amount }]
export async function awardExp(db, { userId, sourceType, sourceId, sourceKey, parts }) {
  const data = await callRpc(db, 'jeju_apply_exp', {
    p_user: userId,
    p_source_type: sourceType,
    p_source_id: String(sourceId),
    p_source_key: sourceKey,
    p_parts: parts,
  })
  // 원장(ledger): DB 함수가 같은 트랜잭션(profile row 잠금) 안에서 계산해 돌려주는 지급 전 EXP 와 이번에 실제로 더한 EXP.
  // 레벨업 계산에 쓰이며, 별도의 EXP 스냅샷 조회를 대신한다. (levelUpsFromLedger)
  const ledger = data.before && data.added ? { before: data.before, added: data.added } : null
  return { awarded: data.awarded, parts, ledger }
}

// ───────── 퀘스트 완료 EXP ─────────
// method: 실제로 완료한 인증 방식(지금은 self). 복합 카테고리는 두 카테고리에 나눠 지급한다.
export async function awardQuestCompletion(db, { userId, quest, method, timeLimitSuccess = false }) {
  const exp = calcQuestExp({ difficulty: quest.difficulty, questType: quest.quest_type, verificationMethod: method, timeLimitSuccess })
  const parts = splitExp(exp.total, quest.category_primary ?? 'explore', quest.category_secondary)
  const result = await awardExp(db, {
    userId,
    sourceType: 'quest',
    sourceId: quest.id,
    sourceKey: `quest:${quest.id}:completion`,
    parts,
  })
  return { awarded: result.awarded, total: exp.total, parts, breakdown: exp, ledger: result.ledger }
}

// ───────── 자유 EXP (unspent_exp 에 쌓이고 사용자가 카테고리 하나에 통째로 투자) ─────────
export async function awardChapterCompletion(db, { userId, chapterId }) {
  const result = await awardExp(db, {
    userId,
    sourceType: 'chapter_complete',
    sourceId: chapterId,
    sourceKey: `chapter:${chapterId}:completion`,
    parts: [{ category: null, amount: FREE_EXP.chapterComplete }],
  })
  return { awarded: result.awarded, amount: FREE_EXP.chapterComplete }
}

// 모험 완주 +50. 챕터를 건너뛴 모험에는 주지 않는다. (ADVENTURE_BONUS_REQUIRES_NO_SKIPPED_CHAPTER)
export async function awardAdventureCompletion(db, { userId, adventureId, skippedChapters }) {
  if (ADVENTURE_BONUS_REQUIRES_NO_SKIPPED_CHAPTER && skippedChapters > 0) return { awarded: false, amount: 0, reason: 'skipped_chapter' }
  const result = await awardExp(db, {
    userId,
    sourceType: 'adventure_complete',
    sourceId: adventureId,
    sourceKey: `adventure:${adventureId}:completion`,
    parts: [{ category: null, amount: FREE_EXP.adventureComplete }],
  })
  return { awarded: result.awarded, amount: FREE_EXP.adventureComplete }
}

// Final Quest 완료 +100 (Final Quest 는 12단계에서 연결)
export async function awardFinalCompletion(db, { userId, finalQuestId }) {
  const result = await awardExp(db, {
    userId,
    sourceType: 'final_complete',
    sourceId: finalQuestId,
    sourceKey: `final:${finalQuestId}:completion`,
    parts: [{ category: null, amount: FREE_EXP.finalComplete }],
  })
  return { awarded: result.awarded, amount: FREE_EXP.finalComplete }
}

// 자유 EXP 한 덩어리(지급 로그 1건)를 카테고리 하나에 전부 투자한다. 분할/중복 투자는 DB 함수가 막는다.
export async function investFreeExp(db, { userId, grantId, category }) {
  if (!FREE_EXP_INVEST_CATEGORIES.includes(category)) throw new HttpError(400, 'invalid_category')
  const before = await getExpSnapshot(db, userId)
  const data = await callRpc(db, 'jeju_invest_exp', { p_user: userId, p_grant_id: grantId, p_category: category })
  if (!data.invested) throw new HttpError(409, 'already_invested')
  return { amount: data.amount, category, levelUps: await levelUpsSince(db, userId, before) }
}

// ───────── 방문 / 발견 ─────────
// 방문(place_visits): 실제 방문 기록. 같은 장소도 다른 여행/다른 퀘스트에서 다시 기록될 수 있다.
// evidence: 위치 근거(gps | null). GPS 로 인증한 퀘스트 방문만 'gps' 로 남긴다.
export async function recordQuestVisit(db, { userId, tripId, quest, evidence = null }) {
  const { error } = await db.from('jeju_place_visits').insert({
    user_id: userId,
    trip_id: tripId,
    quest_id: quest.id,
    place_id: quest.place_id,
    place_name: quest.place_name,
    visit_source: 'quest',
    evidence,
    place_lat: quest.place_lat ?? null,
    place_lng: quest.place_lng ?? null,
  })
  // 같은 퀘스트의 방문은 1건만 (부분 UNIQUE 인덱스). 재시도/더블 클릭이면 조용히 무시한다.
  if (error && error.code !== '23505') throw error
}

// 발견(place_discoveries): 평생 최초 방문에만 기록하고 그때만 발견 EXP 를 준다. (재방문은 방문 기록만)
// 명소 여부는 DB whitelist(jeju_landmarks)로만 정한다. LLM 이나 퀘스트 데이터가 정하지 않는다.
export async function recordDiscovery(db, { userId, quest, method }) {
  if (!DISCOVERY_ALLOWED_METHODS.includes(method)) return null
  return recordPlaceDiscovery(db, { userId, placeId: quest.place_id, placeName: quest.place_name })
}

// 명소 여부(jeju_landmarks whitelist). 이 조회는 EXP 와 무관한 읽기라서 EXP 지급과 병렬로 미리 해 둘 수 있다.
export async function lookupLandmark(db, placeId) {
  const { data, error } = await db.from('jeju_landmarks').select('place_id').eq('place_id', placeId).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

// 발견 지급 + 원장. DB 함수(jeju_record_discovery)가 UNIQUE(user_id, place_id) 로 "평생 최초 1회"를 보장하고, 같은 트랜잭션에서 발견 EXP 를 지급한다.
// 이미 발견한 장소면 { discovery: null, ledger: null }. isLandmark 를 미리 알고 있으면(lookupLandmark) 조회를 건너뛴다.
export async function grantPlaceDiscovery(db, { userId, placeId, placeName, isLandmark }) {
  const landmark = isLandmark ?? (await lookupLandmark(db, placeId))
  const type = landmark ? 'landmark' : 'normal'
  const amount = DISCOVERY_EXP[type]

  const data = await callRpc(db, 'jeju_record_discovery', {
    p_user: userId,
    p_place_id: placeId,
    p_place_name: placeName,
    p_type: type,
    p_amount: amount,
  })
  if (!data.discovered) return { discovery: null, ledger: null }
  return { discovery: { type, amount, placeId, placeName }, ledger: data.before && data.added ? { before: data.before, added: data.added } : null }
}

// 퀘스트 없이 장소만으로 발견을 기록한다. (자유여행 방문 확정 — 호출하는 쪽이 위치 근거(evidence)를 먼저 확인한다)
// 퀘스트 발견과 같은 DB 함수/같은 source key(discovery:{placeId})를 쓰므로 평생 1회만 지급된다.
export async function recordPlaceDiscovery(db, { userId, placeId, placeName }) {
  return (await grantPlaceDiscovery(db, { userId, placeId, placeName })).discovery
}

// 원장(ledger)들로 이번 완료에서 오른 레벨을 계산한다. (퀘스트 EXP 원장 → 발견 EXP 원장 순서)
//   before = 첫 번째 지급 직전의 EXP(DB 가 돌려준 값), after = before + 이번에 실제로 더한 값들.
//   레벨 계산은 기존 progression 함수(diffLevels)를 그대로 쓴다. 별도의 EXP 스냅샷 조회(2회)가 필요 없다.
//   다른 요청이 사이에 끼어 EXP 를 바꿔도 "이번 완료로 오른 레벨"만 돌려준다.
export function levelUpsFromLedger(ledgers) {
  const list = ledgers.filter(Boolean)
  if (list.length === 0) return []
  const before = Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, Number(list[0].before[key]) || 0]))
  const after = { ...before }
  for (const ledger of list) for (const key of EXP_CATEGORY_KEYS) after[key] += Number(ledger.added[key]) || 0
  return diffLevels(before, after)
}