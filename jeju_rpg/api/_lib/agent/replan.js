import { assertNoFinalQuest } from '../finalQuest/service.js'
import { QUEST_RULES } from '../../../src/constants/gameBalance.js'
import { JEJU_CITY } from '../../../src/constants/jeju.js'
import { INDOOR_CONTENT_TYPES, REPLAN_DAILY_LIMITS, REPLAN_REASONS_ENABLED, REPLAN_URGENT_REASONS, SCHEDULE_RULES } from '../../../src/constants/replanRules.js'
import { isLatLng } from '../../../src/utils/geo.js'
import { assessCoreFeasibility, classifyWeather, minutesToEndOfDay } from '../../../src/utils/schedule.js'
import { haversineMeters } from '../geo.js'
import { HttpError } from '../http.js'
import { getNearbyPlaces } from '../providers/tour.js'
import { getWeather } from '../providers/weather.js'
import { getAdmin } from '../supabaseAdmin.js'
import { gatherCandidates } from './candidates.js'
import { buildAgentContext, kstNow } from './context.js'
import { buildQuestRow } from './questRows.js'
import { askQuestAgent } from './quests.js'
import { claimAgentRequest, finishAgentRequest, logUsages } from './requests.js'
import { createTravelBudget, travelBetween } from './travelTime.js'
import { buildNearbyIndex } from './walkability.js'

// REPLAN_ADVENTURE: 사용자가 승인한 뒤에만 실행되는 "남은 하루 다시 설계".  (제안 → 사용자 승인 → 이 함수. REPLAN 1회 = 승인 1회)
//
// 절대 바꾸지 않는 것(immutable): 완료한 챕터/퀘스트, 지급한 EXP, 방문/발견 기록, 추억 사진, 칭호.
//   이 함수가 건드리는 것은 (1) 아직 열리지 않은 챕터(locked/available) (2) 진행 기록이 없는 현재 챕터 (3) 현재 챕터의 "미완료 선택 퀘스트" 뿐이다.
//   교체되는 것은 삭제하지 않고 표시만 한다. (chapters.status='replaced' / quests.replaced_at)
//
// 판단은 코드가, 설계는 Agent 가:
//   1) 코드가 현재 상황(위치/시간/날씨/이동시간/방문 기록)으로 현재 핵심 퀘스트의 수행 가능성을 판단한다. 수행 가능하면 무조건 유지.
//   2) 교체가 필요하면 TourAPI 실제 후보를 코드가 필터(거리/방문/실내 여부)해서 Agent 에 준다. Agent 는 그 안에서만 고른다(GENERATE_QUESTS 와 같은 검증).
//   3) 실제 후보가 없으면 만들어내지 않고 no_alternative 를 돌려준다. (화면이 기존 퀘스트 유지/챕터 건너뛰기/자유여행 3가지를 제안)
//   4) 사용자에게 이미 예고한 다음 챕터가 지금도 가능하면 keepOrder 로 보존하게 한다. (검증 코드가 강제)
//   5) 실패(오류/시간 초과/검증 실패)하면 기존 모험을 그대로 둔다. 아무것도 지우지 않는다.

const OPEN = ['locked', 'available']
const CURRENT = ['active', 'core_completed']

const defaultDeps = {
  buildContext: (args) => buildAgentContext(args),
  weather: async (origin) => (await getWeather(origin)).data,
  candidates: (args) => gatherCandidates(args),
  agent: (input) => askQuestAgent(input),
  travel: (args) => travelBetween(args),
  // 이용 불가는 "검증된 데이터"로만 확인한다: TourAPI 에서 행사 종료일이 지난 장소. (GPT 의 추정은 쓰지 않는다)
  unavailable: async (places, today) => {
    const out = new Set()
    for (const place of places) {
      try {
        const near = await getNearbyPlaces({ lat: place.lat, lng: place.lng, radius: 300, limit: 20 })
        const found = near.data.find((p) => p.placeId === place.placeId)
        if (found?.eventEndDate && found.eventEndDate < today) out.add(place.placeId)
      } catch {
        /* 확인하지 못하면 이용 불가로 보지 않는다 */
      }
    }
    return out
  },
}

const kstDayStart = (now) => {
  const kst = new Date(now + 9 * 3600 * 1000)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600 * 1000).toISOString()
}

// ───────── 하루 한도 / cooldown / 중복 ─────────
// 실행(승인 후)만 센다. 실패/후보 없음으로 끝난 요청(status=failed)은 한도를 쓰지 않는다.
export async function checkReplanLimits(db, { userId, reason, now }) {
  const trigger = reason === 'USER_REQUEST' ? 'manual' : 'system'
  const urgent = REPLAN_URGENT_REASONS.includes(reason)
  const limits = REPLAN_DAILY_LIMITS
  const { data, error } = await db
    .from('jeju_agent_requests')
    .select('status, request_payload, created_at')
    .eq('user_id', userId)
    .eq('request_type', 'REPLAN_ADVENTURE')
    .gte('created_at', kstDayStart(now))
  if (error) throw error
  const used = (data ?? []).filter((r) => r.status !== 'failed')
  const total = used.length
  const sameTrigger = used.filter((r) => r.request_payload?.trigger === trigger)

  if (total >= limits.hardMaxPerDay) throw new HttpError(429, 'replan_daily_limit')
  // 방금 실행한 직후에는 한도 메시지보다 "잠시 후"를 먼저 알려준다. (system 약 30분 / manual 약 15분)
  const cooldownMin = trigger === 'manual' ? limits.manualCooldownMinutes : limits.systemCooldownMinutes
  const last = sameTrigger.map((r) => new Date(r.created_at).getTime()).sort((x, y) => y - x)[0]
  if (last && now - last < cooldownMin * 60000) {
    throw new HttpError(429, 'replan_cooldown', { retryAfterMinutes: Math.ceil((cooldownMin * 60000 - (now - last)) / 60000) })
  }
  if (!urgent) {
    if (total >= limits.normalTotalPerDay) throw new HttpError(429, 'replan_daily_limit')
    if (trigger === 'manual' && sameTrigger.length >= limits.manualExecutionsPerDay) throw new HttpError(429, 'replan_manual_limit')
    if (trigger === 'system' && sameTrigger.length >= limits.systemExecutionsPerDay) throw new HttpError(429, 'replan_system_limit')
  }
  return { trigger, urgent }
}

// ───────── 판 읽기 (교체된 것은 제외) ─────────
async function loadBoard(db, { userId, adventureId }) {
  const [chaptersRes, questsRes] = await Promise.all([
    db.from('jeju_chapters').select('*').eq('adventure_id', adventureId).eq('user_id', userId),
    db.from('jeju_quests').select('*').eq('adventure_id', adventureId).eq('user_id', userId),
  ])
  if (chaptersRes.error) throw chaptersRes.error
  if (questsRes.error) throw questsRes.error
  const chapters = chaptersRes.data.filter((c) => c.status !== 'replaced').sort((a, b) => a.seq - b.seq)
  const quests = questsRes.data.filter((q) => !q.replaced_at)
  const progressRes = await db.from('jeju_quest_progress').select('*').eq('user_id', userId)
  if (progressRes.error) throw progressRes.error
  const completed = new Set(progressRes.data.filter((p) => p.status === 'completed').map((p) => p.quest_id))
  return { allChapters: chaptersRes.data, chapters, quests, completed }
}

const placeOf = (quest) => (quest?.place_id && Number.isFinite(quest.place_lat) ? { placeId: quest.place_id, name: quest.place_name, lat: quest.place_lat, lng: quest.place_lng } : null)

// ───────── 메인 ─────────
export async function replanAdventure({ user, adventureId, reason, context = {}, db = getAdmin(), deps = {}, now = Date.now() }) {
  const d = { ...defaultDeps, ...deps }
  const userId = user.id
  if (!REPLAN_REASONS_ENABLED.includes(reason)) throw new HttpError(400, 'reason_not_supported') // SCHEDULE_AHEAD 포함: 일정이 빨라진 경우는 REPLAN 이 아니다

  const { data: adventure, error } = await db.from('jeju_adventures').select('*').eq('id', adventureId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!adventure) throw new HttpError(404, 'adventure_not_found')
  if (adventure.status !== 'active') throw new HttpError(409, 'adventure_not_in_progress')
  const { data: trip, error: tripError } = await db.from('jeju_trips').select('*').eq('id', adventure.trip_id).eq('user_id', userId).maybeSingle()
  if (tripError) throw tripError
  if (!trip) throw new HttpError(404, 'trip_not_found')
  if (trip.travel_mode === 'free') throw new HttpError(409, 'free_travel_active') // 자유여행 중에는 먼저 종료해야 한다
  await assertNoFinalQuest(db, { userId, tripId: trip.id }) // Final Quest 가 시작되면 일반 REPLAN 은 막힌다

  const board = await loadBoard(db, { userId, adventureId })
  const current = board.chapters.find((c) => CURRENT.includes(c.status)) ?? null
  const future = board.chapters.filter((c) => OPEN.includes(c.status))
  if (!current && future.length === 0) throw new HttpError(409, 'nothing_to_replan')

  const { trigger } = await checkReplanLimits(db, { userId, reason, now })

  // request_key: 같은 상태(챕터 상태 + 완료 퀘스트 수) + 같은 reason 이면 같은 키 → 더블 클릭/재전송이 한 번만 실행된다. (상태가 바뀌면 새 키)
  const signature = `${board.chapters.map((c) => `${c.seq}${c.status[0]}`).join('')}:${board.completed.size}`
  const requestId = await claimAgentRequest(db, {
    userId,
    tripId: trip.id,
    adventureId,
    requestType: 'REPLAN_ADVENTURE',
    requestKey: `REPLAN_ADVENTURE:${adventureId}:${signature}:${reason}`,
    payload: { reason, trigger, signature },
  })

  try {
    const outcome = await run({ d, db, userId, user, adventure, trip, board, current, future, reason, context, now })
    // 후보 없음/변경 없음은 "실행"이 아니라서 한도를 쓰지 않는다. (failed 로 기록, 같은 키는 다시 시도 가능)
    const executed = outcome.status === 'replanned'
    await logUsages(db, { userId, requestId, usages: outcome.usages ?? [] })
    await finishAgentRequest(db, requestId, {
      status: executed ? 'success' : 'failed',
      response: { status: outcome.status, ...outcome.log },
      error: executed ? null : outcome.status,
    })
    const { usages: _usages, log: _log, ...result } = outcome
    return result
  } catch (caught) {
    await finishAgentRequest(db, requestId, { status: 'failed', error: caught.message })
    if (caught instanceof HttpError) throw caught
    console.error('[replan] 실패, 기존 모험 유지', caught.message)
    throw new HttpError(502, 'replan_failed') // 기존 모험은 그대로다
  }
}

async function run({ d, db, userId, adventure, trip, board, current, future, reason, context, now }) {
  const { chapters, quests, completed } = board
  const budget = createTravelBudget()
  const date = kstNow().date

  const built = await d.buildContext({ db, userId, trip, adventureDate: adventure.adventure_date, travelRange: adventure.travel_range ?? 'normal' })
  const agentContext = built.context
  const visits = built.visits ?? { thisTripIds: new Set(), pastIds: new Set() }
  const transport = agentContext.transport ?? trip.transport
  const position = isLatLng(context?.position) ? { lat: context.position.lat, lng: context.position.lng } : (built.origin ?? JEJU_CITY)
  const minutesToEnd = minutesToEndOfDay({ now, desiredEndTime: agentContext.desiredEndTime })

  const advPlaces = new Map((adventure.data?.places ?? []).map((p) => [p.placeId, p]))
  const coreOf = (chapter) => quests.find((q) => q.chapter_id === chapter.id && q.quest_type === 'core')
  const infoOf = (placeId, quest) => advPlaces.get(placeId) ?? placeOf(quest)
  // 실내 여부는 TourAPI 유형(contentTypeId)으로 코드가 판단한다. 유형을 모르면 야외로 보수적으로 본다. (GPT 가 정하지 않는다)
  const isOutdoor = (place) => !(place?.contentTypeId && INDOOR_CONTENT_TYPES.includes(place.contentTypeId))
  const weatherRaw = await d.weather(position).catch(() => null) // 날씨를 못 읽으면 날씨 때문에 바꾸지 않는다
  const weather = classifyWeather(weatherRaw)

  // 이미 끝난 일정의 장소 + 이번 여행에서 이미 방문한 장소는 다시 쓰지 않는다
  const usedPlaceIds = new Set()
  for (const chapter of chapters) {
    if (chapter.status === 'completed' || chapter.status === 'skipped' || chapter.status === 'core_completed') {
      quests.filter((q) => q.chapter_id === chapter.id && q.place_id).forEach((q) => usedPlaceIds.add(q.place_id))
    }
  }
  const visited = (id) => visits.thisTripIds.has(id) || usedPlaceIds.has(id)

  // 이용 불가(PLACE_UNAVAILABLE)는 검증된 데이터로만 인정한다. 근거가 없으면 일정을 바꾸지 않는다.
  let unavailable = new Set()
  if (reason === 'PLACE_UNAVAILABLE') {
    const targets = [current && coreOf(current), future[0] && coreOf(future[0])].filter(Boolean).map(placeOf).filter(Boolean)
    unavailable = await d.unavailable(targets, date)
    if (unavailable.size === 0) return { status: 'unchanged', outcome: 'no_verified_unavailable', log: {} }
  }

  // ── 1) 현재 챕터 핵심 퀘스트 수행 가능성 (코드 판단)
  const currentCore = current ? coreOf(current) : null
  const currentCompletedCount = current ? quests.filter((q) => q.chapter_id === current.id && completed.has(q.id)).length : 0
  let keepCurrent = Boolean(current)
  let replaceCurrent = false
  let problems = []
  if (current?.status === 'active' && currentCore) {
    const place = infoOf(currentCore.place_id, currentCore)
    const travel = placeOf(currentCore) ? await d.travel({ from: position, to: placeOf(currentCore), transport, budget, now }) : null
    const feasibility = assessCoreFeasibility({
      core: { placeId: currentCore.place_id },
      outdoor: isOutdoor(place),
      weather,
      travelMinutes: travel?.minutes ?? null,
      minutesToEnd,
      unavailable,
    })
    problems = feasibility.problems
    // 자유여행 중 이미 다녀온 장소라면 예정 핵심 장소를 먼저 방문한 것이다. (RETURN_FROM_FREE_TRAVEL)
    if (visits.thisTripIds.has(currentCore.place_id)) problems = [...problems, 'visited']
    if (problems.length) {
      keepCurrent = false
      replaceCurrent = true
    }
  }
  // 진행 기록(완료한 퀘스트)이 있는 챕터는 통째로 교체하지 않는다. 사용자가 건너뛰기/자유여행/유지 중에서 고르게 한다.
  if (replaceCurrent && currentCompletedCount > 0) {
    return { status: 'no_alternative', outcome: 'chapter_has_progress', problems, options: ['keep', 'skip', 'free'], log: { problems } }
  }

  // ── 2) 실제 후보 수집 + 코드 필터 (Agent 는 이 목록 밖의 장소를 쓸 수 없다)
  const gathered = await d.candidates({ origin: position, radius: 12000, visits, limit: 15 })
  const weatherHard = weather.outdoorHard
  const eligible = (place) =>
    !visited(place.placeId) && !unavailable.has(place.placeId) && (!weatherHard || INDOOR_CONTENT_TYPES.includes(place.contentTypeId))
  const gatheredOk = gathered.places.filter(eligible)

  // 원래 계획의 다음 챕터들 중 지금도 가능한 장소 (보존 후보)
  const futurePlaces = []
  for (const chapter of future) {
    const core = coreOf(chapter)
    const place = core && infoOf(core.place_id, core)
    if (place && eligible(place) && Number.isFinite(place.lat)) futurePlaces.push({ ...place, chapterId: chapter.id })
  }
  // 이미 예고한 다음 챕터: 현재 조건에서 수행 가능하면 가급적 유지한다. (이동시간은 Directions/추정, 소수 후보에만)
  let preservedNext = null
  const next = futurePlaces.find((p) => p.chapterId === future[0]?.id)
  if (next) {
    const from = keepCurrent && currentCore && placeOf(currentCore) ? placeOf(currentCore) : position
    const travel = await d.travel({ from, to: next, transport, budget, now })
    const ok = assessCoreFeasibility({ core: { placeId: next.placeId }, outdoor: isOutdoor(next), weather, travelMinutes: travel.minutes, minutesToEnd: minutesToEnd === null ? null : minutesToEnd - SCHEDULE_RULES.perChapterMinutes, unavailable })
    if (ok.feasible) preservedNext = next
  }

  // 현재 챕터 교체 후보 (현재 위치 근처의 실제 장소, 가까운 순)
  let replacementAnchors = []
  if (replaceCurrent) {
    const cap = [...gatheredOk].sort((a, b) => haversineMeters(position, a) - haversineMeters(position, b)).slice(0, 4)
    for (const place of cap) {
      const travel = await d.travel({ from: position, to: place, transport, budget, now })
      if (minutesToEnd === null || travel.minutes + SCHEDULE_RULES.perChapterMinutes <= minutesToEnd) replacementAnchors.push({ ...place, travelMinutes: travel.minutes })
    }
    if (replacementAnchors.length === 0) {
      return { status: 'no_alternative', outcome: 'no_real_candidate', problems, options: ['keep', 'skip', 'free'], log: { problems, gathered: gathered.places.length } }
    }
  }

  // 현재 챕터의 미완료 선택 퀘스트: 날씨가 야외 활동을 어렵게 하면 실내 후보가 있을 때만 새로 짠다
  const refreshOptional = keepCurrent && current && reason === 'WEATHER_CHANGE' && weatherHard && currentCore && placeOf(currentCore) &&
    quests.some((q) => q.chapter_id === current.id && q.quest_type === 'optional' && !completed.has(q.id))

  // ── 3) Agent 에 전달할 pool
  const forcedFirst = replaceCurrent ? replacementAnchors[0] : refreshOptional ? { ...infoOf(currentCore.place_id, currentCore), placeId: currentCore.place_id } : null
  const keepOrder = [forcedFirst?.placeId, preservedNext && preservedNext.placeId !== forcedFirst?.placeId ? preservedNext.placeId : null].filter(Boolean)
  const seen = new Set()
  const corePool = [forcedFirst, preservedNext, ...replacementAnchors.slice(1), ...futurePlaces, ...gatheredOk]
    .filter((p) => p && Number.isFinite(p.lat) && !seen.has(p.placeId) && seen.add(p.placeId))
    .slice(0, 8)
    .map((p) => ({ placeId: p.placeId, name: p.name, contentTypeId: p.contentTypeId, category: p.category ?? '기타', area: p.area ?? '', address: p.address ?? '', lat: p.lat, lng: p.lng }))
  const corePoolIds = new Set(corePool.map((p) => p.placeId))
  const extraPool = gatheredOk.filter((p) => !corePoolIds.has(p.placeId)).slice(0, QUEST_RULES.extraPlaceCount)

  const futureCount = future.length
  // 계획 챕터 수 = (현재 챕터와 연결되는 첫 챕터) + 남은 원래 챕터 수. 시간이 부족하면 Agent 가 줄일 수 있다(최소 1).
  const maxChapters = Math.min(QUEST_RULES.chapters.max, (replaceCurrent || refreshOptional ? 1 : 0) + futureCount)
  if (maxChapters === 0 || corePool.length === 0) return { status: 'unchanged', outcome: 'nothing_to_replan', log: {} }
  const chapterRange = { min: Math.max(1, keepOrder.length), max: Math.max(1, Math.min(maxChapters, corePool.length)) }
  if (chapterRange.min > chapterRange.max) chapterRange.min = chapterRange.max

  const nearby = buildNearbyIndex(corePool, [...corePool, ...extraPool])
  const replan = {
    reason,
    keepOrder,
    constraints: {
      minutesToEndOfDay: minutesToEnd,
      weather: weather.class,
      indoorOnly: weatherHard,
      remainingOriginalChapters: futureCount,
      alreadyAnnouncedNextChapterPlaceId: preservedNext?.placeId ?? null,
    },
  }
  const agentInput = {
    context: { ...agentContext, currentLocation: { ...position, source: context?.position ? 'gps' : 'default' } },
    adventure: { title: adventure.title, summary: adventure.summary, data: adventure.data },
    corePool,
    extraPool,
    nearby,
    companion: agentContext.companion,
    chapterRange,
    replan,
  }
  const result = await d.agent(agentInput) // 검증 실패/오류면 throw → 기존 모험 유지
  const plan = result.quests

  // ── 4) 저장 (교체되는 것은 삭제하지 않고 표시만 한다. 실패하면 새로 넣은 것만 되돌린다)
  const placeById = new Map([...corePool, ...extraPool].map((p) => [p.placeId, p]))
  const saved = await applyPlan({ db, userId, adventure, board, current, future, plan, placeById, replaceCurrent, refreshOptional, now })
  return {
    status: 'replanned',
    reason,
    kept: { currentChapter: keepCurrent, nextChapter: Boolean(preservedNext) },
    problems,
    replaced: saved.replaced,
    added: saved.added,
    log: { reason, problems, keepOrder, replaced: saved.replaced, added: saved.added },
    usages: result.usages ?? [],
  }
}

// ───────── 저장 ─────────
async function applyPlan({ db, userId, adventure, board, current, future, plan, placeById, replaceCurrent, refreshOptional, now }) {
  const base = { adventure_id: adventure.id, user_id: userId }
  const nowIso = new Date(now).toISOString()
  const maxSeq = Math.max(0, ...board.allChapters.map((c) => c.seq))
  const originalSeq = new Map(board.allChapters.map((c) => [c.id, c.seq])) // 표시 단계에서 seq 가 바뀌기 전의 값
  const planChapters = plan.chapters
  // 현재 챕터에 연결되는 첫 계획 챕터(교체/선택 퀘스트 갱신)와 새 미래 챕터
  const headChapter = replaceCurrent || refreshOptional ? planChapters[0] : null
  const newChapters = headChapter ? planChapters.slice(1) : planChapters
  const toReplaceChapters = [...future, ...(replaceCurrent && current ? [current] : [])]

  // 잡을 대상이 "완료되지 않은 것"인지 다시 확인한다. (immutable 보호)
  const immutableViolation = toReplaceChapters.some((c) => !OPEN.includes(c.status) && !(replaceCurrent && c.id === current?.id && c.status === 'active'))
  if (immutableViolation) throw new Error('immutable_violation')

  const insertedChapterIds = []
  const insertedQuestIds = []
  const moved = [] // 되돌리기용: { id, seq, status }
  const refreshedOptionalIds = [] // 되돌리기용: refreshOptional 로 replaced_at 을 기록한 "현재 챕터의 기존 미완료 선택 퀘스트"
  try {
    // (1) 새 챕터/퀘스트를 임시 seq 로 먼저 넣는다 (실패해도 기존 일정은 그대로)
    const tempBase = maxSeq + 500
    const chapterRows = newChapters.map((chapter, i) => ({
      ...base,
      seq: tempBase + i + (replaceCurrent ? 1 : 0),
      title: chapter.title.trim(),
      summary: chapter.summary.trim(),
      status: 'locked',
      data: { source: 'replan', corePlaceId: chapter.corePlaceId, optionalPlaceIds: chapter.optionalPlaceIds },
    }))
    let headRow = null
    if (replaceCurrent && headChapter) {
      headRow = { ...base, seq: tempBase, title: headChapter.title.trim(), summary: headChapter.summary.trim(), status: 'locked', data: { source: 'replan', corePlaceId: headChapter.corePlaceId, optionalPlaceIds: headChapter.optionalPlaceIds } }
    }
    const allChapterRows = [...(headRow ? [headRow] : []), ...chapterRows]
    let createdChapters = []
    if (allChapterRows.length) {
      const { data, error } = await db.from('jeju_chapters').insert(allChapterRows).select('*')
      if (error) throw error
      createdChapters = data
      insertedChapterIds.push(...data.map((c) => c.id))
    }
    const createdBySeq = new Map(createdChapters.map((c) => [c.seq, c]))
    const headCreated = headRow ? createdBySeq.get(headRow.seq) : null
    const futureCreated = chapterRows.map((r) => createdBySeq.get(r.seq))

    const questRows = []
    const pushChapterQuests = (chapterPlan, chapterRow, { withCore }) => {
      if (withCore) questRows.push(buildQuestRow({ base, quest: { ...chapterPlan.coreQuest, placeId: chapterPlan.corePlaceId }, chapter: chapterRow, type: 'core', seq: 1, hidden: false, placeById, source: 'replan' }))
      chapterPlan.optionalQuests.forEach((quest, j) => {
        questRows.push(buildQuestRow({ base, quest, chapter: chapterRow, type: 'optional', seq: j + 2, hidden: j >= QUEST_RULES.initialVisibleOptional, placeById, source: 'replan' }))
      })
    }
    if (headCreated) pushChapterQuests(headChapter, headCreated, { withCore: true })
    newChapters.forEach((chapterPlan, i) => pushChapterQuests(chapterPlan, futureCreated[i], { withCore: true }))
    // 현재 챕터는 유지하고 미완료 선택 퀘스트만 새로 짠다 (핵심 퀘스트/완료 퀘스트는 그대로)
    if (refreshOptional && headChapter && current) {
      const seqStart = Math.max(1, ...board.quests.filter((q) => q.chapter_id === current.id).map((q) => q.seq)) + 1
      headChapter.optionalQuests.forEach((quest, j) => {
        questRows.push(buildQuestRow({ base, quest, chapter: current, type: 'optional', seq: seqStart + j, hidden: j >= QUEST_RULES.initialVisibleOptional, placeById, source: 'replan' }))
      })
    }
    let createdQuests = []
    if (questRows.length) {
      const { data, error } = await db.from('jeju_quests').insert(questRows).select('*')
      if (error) throw error
      createdQuests = data
      insertedQuestIds.push(...data.map((q) => q.id))
    }

    // (2) 교체되는 기존 일정에 표시한다 (삭제 X). seq 는 비켜 둬서 새 챕터가 자리를 이어받게 한다.
    let replacedQuests = 0
    for (const [i, chapter] of toReplaceChapters.entries()) {
      moved.push({ id: chapter.id, seq: chapter.seq, status: chapter.status })
      const { error } = await db.from('jeju_chapters').update({ status: 'replaced', seq: maxSeq + 100 + i, closed_at: nowIso }).eq('id', chapter.id)
      if (error) throw error
      const { data, error: questError } = await db.from('jeju_quests').update({ replaced_at: nowIso }).eq('chapter_id', chapter.id).is('replaced_at', null).select('id')
      if (questError) throw questError
      replacedQuests += data?.length ?? 0
    }
    if (refreshOptional && current) {
      const oldOptional = board.quests.filter((q) => q.chapter_id === current.id && q.quest_type === 'optional' && !board.completed.has(q.id)).map((q) => q.id)
      const insertedSet = new Set(insertedQuestIds)
      for (const id of oldOptional.filter((id) => !insertedSet.has(id))) {
        refreshedOptionalIds.push(id) // 기록하기 전에 보관해서, 이 update 가 중간에 실패해도 복구 대상에 포함된다
        const { error } = await db.from('jeju_quests').update({ replaced_at: nowIso }).eq('id', id)
        if (error) throw error
        replacedQuests += 1
      }
    }

    // (3) 새 챕터에 최종 seq 를 준다. 마지막 진행 챕터 뒤로 이어지고, 현재 챕터를 교체했다면 그 자리가 active 가 된다.
    const keptSeqs = board.chapters.filter((c) => !toReplaceChapters.some((r) => r.id === c.id)).map((c) => originalSeq.get(c.id))
    let seq = Math.max(0, ...keptSeqs)
    const finals = [...(headCreated ? [headCreated] : []), ...futureCreated]
    for (const chapter of finals) {
      seq = headCreated && chapter.id === headCreated.id && current ? originalSeq.get(current.id) : seq + 1
      const isHead = headCreated && chapter.id === headCreated.id
      const { error } = await db.from('jeju_chapters').update({ seq, status: isHead ? 'active' : 'locked', ...(isHead ? { activated_at: nowIso } : {}) }).eq('id', chapter.id)
      if (error) throw error
    }
    return { replaced: { chapters: toReplaceChapters.length, quests: replacedQuests }, added: { chapters: finals.length, quests: createdQuests.length } }
  } catch (error) {
    // 되돌리기: 방금 새로 넣은 것만 지우고, 표시했던 기존 챕터는 원래대로 되돌린다. (기존 일정은 하나도 지우지 않는다)
    for (const m of moved) {
      await db.from('jeju_chapters').update({ status: m.status, seq: m.seq, closed_at: null }).eq('id', m.id)
      await db.from('jeju_quests').update({ replaced_at: null }).eq('chapter_id', m.id).eq('replaced_at', new Date(now).toISOString())
    }
    // 현재 챕터는 유지한 채 미완료 선택 퀘스트만 교체하던 경로: 우리가 replaced_at 을 기록한 퀘스트만 원래대로 복구한다. (완료한 퀘스트/대상이 아닌 퀘스트는 건드리지 않는다)
    for (const id of refreshedOptionalIds) await db.from('jeju_quests').update({ replaced_at: null }).eq('id', id)
    for (const id of insertedQuestIds) await db.from('jeju_quests').delete().eq('id', id)
    for (const id of insertedChapterIds) await db.from('jeju_chapters').delete().eq('id', id)
    throw error
  }
}
