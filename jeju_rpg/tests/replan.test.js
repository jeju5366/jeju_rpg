import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkReplanLimits, replanAdventure } from '../api/_lib/agent/replan.js'
import { validateQuests } from '../api/_lib/agent/quests.js'
import { fakeDb } from './helpers/fakeDb.js'

const MIN = 60 * 1000
const NOW = Date.UTC(2026, 10, 3, 6, 0, 0) // KST 15:00 → 종료 희망 20:00 까지 300분
const USER = { id: 'u1' }

const P = (placeId, name, contentTypeId, lat, lng) => ({ placeId, name, contentTypeId, category: contentTypeId === 12 ? '관광지' : contentTypeId === 14 ? '문화시설' : '음식점', area: '제주시', address: '제주', lat, lng })
const PLACES = [P('p-a', 'A 해변', 12, 33.5, 126.5), P('p-b', 'B 오름', 12, 33.51, 126.52), P('p-c', 'C 박물관', 14, 33.52, 126.54)]
const GATHERED = [P('p-d', 'D 식당', 39, 33.505, 126.505), P('p-e', 'E 전망대', 12, 33.54, 126.58), P('p-f', 'F 전시관', 14, 33.502, 126.502), P('p-g', 'G 카페', 39, 33.506, 126.51)]

const quest = (id, chapterId, type, place, seq, over = {}) => ({
  id, user_id: 'u1', adventure_id: 'adv1', chapter_id: chapterId, quest_type: type, title: `${id} 찾아서 찍어봐`, description: '설명', difficulty: 'normal', category_primary: 'explore', category_secondary: null,
  verification_type: 'gps', place_id: place?.placeId ?? null, place_name: place?.name ?? null, place_lat: place?.lat ?? null, place_lng: place?.lng ?? null, is_hidden: false, seq, data: {}, replaced_at: null, ...over,
})

// c0(완료) / c1(진행 중, A) / c2(B) / c3(C)
function setup({ c1 = 'active', completedOptionalInC1 = false, mode = 'quest', failInsert = [], failUpdate = [], requests = [] } = {}) {
  const chapters = [
    { id: 'c0', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'completed', data: {}, activated_at: new Date(NOW - 300 * MIN).toISOString(), closed_at: new Date(NOW - 200 * MIN).toISOString() },
    { id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 2, status: c1, data: {}, activated_at: new Date(NOW - 100 * MIN).toISOString(), closed_at: null },
    { id: 'c2', user_id: 'u1', adventure_id: 'adv1', seq: 3, status: 'locked', data: {} },
    { id: 'c3', user_id: 'u1', adventure_id: 'adv1', seq: 4, status: 'locked', data: {} },
  ]
  const quests = [
    quest('qm', null, 'main', null, 1, { verification_type: 'self' }),
    quest('q0', 'c0', 'core', P('p-z', 'Z 이미 다녀온 곳', 12, 33.4, 126.4), 1),
    quest('q1', 'c1', 'core', PLACES[0], 1),
    quest('q1o1', 'c1', 'optional', PLACES[0], 2, { verification_type: 'self' }),
    quest('q1o2', 'c1', 'optional', PLACES[0], 3, { verification_type: 'self' }),
    quest('q2', 'c2', 'core', PLACES[1], 1),
    quest('q2o1', 'c2', 'optional', PLACES[1], 2, { verification_type: 'self' }),
    quest('q3', 'c3', 'core', PLACES[2], 1),
  ]
  const progress = [
    { id: 'pg0', user_id: 'u1', quest_id: 'q0', status: 'completed', verification_method: 'gps' },
    ...(c1 === 'core_completed' ? [{ id: 'pg1', user_id: 'u1', quest_id: 'q1', status: 'completed', verification_method: 'gps' }] : []),
    ...(completedOptionalInC1 ? [{ id: 'pg1o', user_id: 'u1', quest_id: 'q1o1', status: 'completed', verification_method: 'self' }] : []),
  ]
  return fakeDb(
    {
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: 't1', status: 'active', title: '모험', summary: '요약', adventure_date: '2026-11-03', travel_range: 'normal', data: { places: PLACES } }],
      jeju_trips: [{ id: 't1', user_id: 'u1', travel_mode: mode, transport: 'rental_car' }],
      jeju_chapters: chapters,
      jeju_quests: quests,
      jeju_quest_progress: progress,
      jeju_agent_requests: requests,
      jeju_place_visits: [{ user_id: 'u1', place_id: 'p-z' }],
      jeju_exp_logs: [{ user_id: 'u1', source_key: 'quest:q0:completion', amount: 27 }],
    },
    {
      failInsert,
      failUpdate,
      unique: {
        jeju_chapters: (a, b) => a.adventure_id === b.adventure_id && a.seq === b.seq,
        jeju_agent_requests: (a, b) => a.user_id === b.user_id && a.request_key === b.request_key,
      },
    },
  )
}

const clearWx = { temperatureC: 20, windSpeedMs: 3, precipitation: { type: 'none', amountMm: 0 }, hourlyForecast: [{ precipitationProbability: 10 }] }
const rainWx = { temperatureC: 17, windSpeedMs: 6, precipitation: { type: 'rain', amountMm: 15 }, hourlyForecast: [{ precipitationProbability: 90 }] }

// 가짜 Agent: 실제 validateQuests 로 검증한다. (keepOrder / 후보 밖 장소 / 행동형 규칙까지 그대로 강제)
function makeAgent(onInput) {
  const agent = async (input) => {
    agent.calls += 1
    agent.last = input
    onInput?.(input)
    const { corePool, chapterRange, replan } = input
    const count = chapterRange.max
    const order = [...replan.keepOrder, ...corePool.map((p) => p.placeId).filter((id) => !replan.keepOrder.includes(id))].slice(0, count)
    const plan = {
      mainQuest: { title: '메인', description: '설명' },
      chapters: order.map((placeId, i) => ({
        title: `챕터 ${i + 1}`,
        summary: '요약',
        corePlaceId: placeId,
        optionalPlaceIds: [],
        coreQuest: { title: '찾아서 찍어봐', description: '대상을 찾아 사진으로 남겨봐', difficulty: 'normal', categoryPrimary: 'explore', categorySecondary: null, verificationType: 'gps', timeLimitMinutes: null },
        optionalQuests: [0, 1, 2, 3].map((j) => ({ title: `기록하기 ${j}`, description: '한 줄 기록해봐', difficulty: 'easy', categoryPrimary: 'explore', categorySecondary: null, verificationType: 'self', timeLimitMinutes: null, placeId })),
      })),
    }
    const errors = validateQuests(plan, input)
    if (errors.length) throw new Error(`검증 실패: ${errors.join(' / ')}`)
    return { quests: plan, usages: [{ model: 'test', inputTokens: 100, outputTokens: 50 }] }
  }
  agent.calls = 0
  return agent
}

function deps(over = {}) {
  const base = {
    buildContext: async () => ({ context: { transport: 'rental_car', desiredEndTime: '20:00', companion: 'friends' }, origin: { lat: 33.5, lng: 126.5 }, visits: { thisTripIds: new Set(['p-z']), pastIds: new Set() } }),
    weather: async () => clearWx,
    candidates: async () => ({ places: GATHERED, source: 'mock' }),
    travel: async () => ({ minutes: 15, meters: 8000, source: 'estimate', mode: 'car' }),
    agent: makeAgent(),
    unavailable: async () => new Set(),
  }
  return { ...base, ...over }
}

const run = (db, over = {}, args = {}) => replanAdventure({ user: USER, adventureId: 'adv1', reason: 'USER_REQUEST', db, deps: deps(over), now: NOW, ...args })
const chapter = (db, id) => db.tables.jeju_chapters.find((c) => c.id === id)
const questRow = (db, id) => db.tables.jeju_quests.find((q) => q.id === id)
const liveChapters = (db) => db.tables.jeju_chapters.filter((c) => c.status !== 'replaced').sort((a, b) => a.seq - b.seq)

// ───────── 기본 원칙 ─────────
test('SCHEDULE_AHEAD 는 REPLAN 으로 실행할 수 없음', async () => {
  const db = setup()
  await assert.rejects(() => run(db, {}, { reason: 'SCHEDULE_AHEAD' }), { message: 'reason_not_supported' })
})

test('REPLAN 승인: 현재 core 가 수행 가능하면 현재 챕터는 유지하고 남은 챕터만 다시 설계 (완료 데이터 불변)', async () => {
  const db = setup()
  const agent = makeAgent()
  const result = await run(db, { agent })
  assert.equal(result.status, 'replanned')
  assert.equal(result.kept.currentChapter, true)
  assert.equal(agent.calls, 1)

  // 현재 챕터(c1)와 core/선택 퀘스트는 그대로
  assert.equal(chapter(db, 'c1').status, 'active')
  assert.equal(questRow(db, 'q1').replaced_at, null)
  assert.equal(questRow(db, 'q1o1').replaced_at, null)
  // 이후 챕터 c2,c3 는 삭제되지 않고 replaced 로 표시, 새 챕터가 이어서 locked
  assert.equal(chapter(db, 'c2').status, 'replaced')
  assert.equal(chapter(db, 'c3').status, 'replaced')
  assert.ok(db.tables.jeju_quests.some((q) => q.id === 'q2'), '기존 퀘스트를 지우지 않는다')
  assert.ok(questRow(db, 'q2').replaced_at)
  const live = liveChapters(db)
  assert.deepEqual(live.slice(0, 2).map((c) => [c.id, c.status, c.seq]), [['c0', 'completed', 1], ['c1', 'active', 2]])
  assert.ok(live.length >= 3)
  assert.deepEqual(live.map((c) => c.seq), live.map((_, i) => i + 1)) // seq 가 1..N 으로 이어진다
  assert.ok(live.slice(2).every((c) => c.status === 'locked'))
  // immutable
  assert.equal(chapter(db, 'c0').status, 'completed')
  assert.equal(questRow(db, 'q0').replaced_at, null)
  assert.equal(db.tables.jeju_exp_logs.length, 1)
  assert.equal(db.tables.jeju_place_visits.length, 1)
  assert.equal(db.tables.jeju_quest_progress.length, 1)
})

test('이미 예고한 다음 챕터는 지금도 가능하면 보존(keepOrder) — 새 계획의 다음 챕터가 같은 장소', async () => {
  const db = setup()
  const agent = makeAgent()
  await run(db, { agent })
  assert.deepEqual(agent.last.replan.keepOrder, ['p-b'])
  assert.equal(agent.last.replan.constraints.alreadyAnnouncedNextChapterPlaceId, 'p-b')
  const next = liveChapters(db)[2]
  assert.equal(next.data.corePlaceId, 'p-b')
})

test('다음 챕터를 자유여행 중 이미 방문했으면 보존하지 않음(RETURN_FROM_FREE_TRAVEL)', async () => {
  const db = setup()
  const agent = makeAgent()
  await run(db, {
    agent,
    buildContext: async () => ({ context: { transport: 'rental_car', desiredEndTime: '20:00', companion: 'friends' }, origin: { lat: 33.5, lng: 126.5 }, visits: { thisTripIds: new Set(['p-z', 'p-b']), pastIds: new Set() } }),
  }, { reason: 'RETURN_FROM_FREE_TRAVEL', context: { sessionId: 's1' } })
  assert.deepEqual(agent.last.replan.keepOrder, [])
  assert.ok(!agent.last.corePool.some((p) => p.placeId === 'p-b'))
})

// ───────── core 판단 ─────────
test('현재 core 수행 불가(강한 비 + 야외) + 실내 실제 후보 있음 → 현재 챕터 교체, 실내 후보만 Agent 에 전달', async () => {
  const db = setup()
  const agent = makeAgent()
  const result = await run(db, { agent, weather: async () => rainWx }, { reason: 'WEATHER_CHANGE' })
  assert.equal(result.status, 'replanned')
  assert.deepEqual(result.problems, ['weather'])
  assert.ok(agent.last.corePool.every((p) => [14, 39].includes(p.contentTypeId)), '실내 후보만')
  assert.ok(agent.last.corePool.every((p) => GATHERED.some((g) => g.placeId === p.placeId) || ['p-c'].includes(p.placeId)))
  // 기존 c1 은 삭제되지 않고 replaced, 새 챕터가 같은 seq(2)에서 active
  assert.equal(chapter(db, 'c1').status, 'replaced')
  assert.ok(questRow(db, 'q1').replaced_at)
  const live = liveChapters(db)
  assert.deepEqual([live[1].seq, live[1].status], [2, 'active'])
  assert.ok(live[1].activated_at)
  assert.deepEqual(live.map((c) => c.seq), live.map((_, i) => i + 1))
})

test('현재 core 수행 불가인데 실제 대체 후보가 없음 → Agent 호출 없이 no_alternative(유지/건너뛰기/자유여행)', async () => {
  const db = setup()
  const agent = makeAgent()
  const result = await run(db, { agent, weather: async () => rainWx, candidates: async () => ({ places: GATHERED.filter((p) => p.contentTypeId === 12), source: 'mock' }) }, { reason: 'WEATHER_CHANGE' })
  assert.equal(result.status, 'no_alternative')
  assert.deepEqual(result.options, ['keep', 'skip', 'free'])
  assert.equal(agent.calls, 0)
  assert.equal(chapter(db, 'c1').status, 'active')
  assert.equal(liveChapters(db).length, 4) // 아무것도 바뀌지 않음
  // 한도를 쓰지 않는다
  assert.equal(db.tables.jeju_agent_requests[0].status, 'failed')
})

test('시간이 모자라 현재 core 를 못 하면 교체 후보 중 시간 안에 갈 수 있는 곳만 사용', async () => {
  const db = setup()
  const agent = makeAgent()
  // 종료까지 남은 시간이 아주 짧고 이동도 오래 걸림 → core 시간 문제, 후보도 모두 시간 초과 → no_alternative
  const result = await run(db, { agent, buildContext: async () => ({ context: { transport: 'rental_car', desiredEndTime: '16:00', companion: 'solo' }, origin: { lat: 33.5, lng: 126.5 }, visits: { thisTripIds: new Set(), pastIds: new Set() } }), travel: async () => ({ minutes: 50, meters: 30000, source: 'estimate', mode: 'car' }) })
  assert.equal(result.status, 'no_alternative')
  assert.equal(agent.calls, 0)
})

test('현재 core 가 수행 가능하면(USER_REQUEST) 교체하지 않음', async () => {
  const db = setup()
  const result = await run(db, { weather: async () => clearWx })
  assert.equal(result.kept.currentChapter, true)
  assert.deepEqual(result.problems, [])
  assert.equal(chapter(db, 'c1').status, 'active')
})

test('핵심 완료 + 비: 현재 챕터의 미완료 선택 퀘스트만 실내 후보 기준으로 교체, core/완료 퀘스트는 유지', async () => {
  const db = setup({ c1: 'core_completed', completedOptionalInC1: true })
  const agent = makeAgent()
  const result = await run(db, { agent, weather: async () => rainWx }, { reason: 'WEATHER_CHANGE' })
  assert.equal(result.status, 'replanned')
  assert.equal(chapter(db, 'c1').status, 'core_completed')
  assert.equal(questRow(db, 'q1').replaced_at, null) // 완료한 core
  assert.equal(questRow(db, 'q1o1').replaced_at, null) // 완료한 선택
  assert.ok(questRow(db, 'q1o2').replaced_at) // 미완료 선택은 교체(삭제 아님)
  const newOptional = db.tables.jeju_quests.filter((q) => q.chapter_id === 'c1' && q.quest_type === 'optional' && !q.replaced_at && q.data.source === 'replan')
  assert.ok(newOptional.length >= 3)
  assert.equal(db.tables.jeju_quest_progress.length, 3)
})

test('현재 챕터에 완료한 퀘스트가 있고 core 를 못 하는 경우: 챕터를 통째로 바꾸지 않고 선택지만 제안', async () => {
  const db = setup({ completedOptionalInC1: true })
  const result = await run(db, { weather: async () => rainWx }, { reason: 'WEATHER_CHANGE' })
  assert.equal(result.status, 'no_alternative')
  assert.equal(result.outcome, 'chapter_has_progress')
  assert.equal(chapter(db, 'c1').status, 'active')
})

test('PLACE_UNAVAILABLE: 검증된 근거가 없으면 일정을 바꾸지 않음(GPT 추정 금지)', async () => {
  const db = setup()
  const agent = makeAgent()
  const result = await run(db, { agent }, { reason: 'PLACE_UNAVAILABLE' })
  assert.equal(result.status, 'unchanged')
  assert.equal(agent.calls, 0)
  const verified = await run(setup(), { unavailable: async () => new Set(['p-a']) }, { reason: 'PLACE_UNAVAILABLE' })
  assert.equal(verified.status, 'replanned')
  assert.deepEqual(verified.problems, ['unavailable'])
})

// ───────── 실패 / 롤백 ─────────
test('Agent 오류/검증 실패 → 기존 모험 그대로, 한도 미소모(replan_failed)', async () => {
  const db = setup()
  await assert.rejects(() => run(db, { agent: async () => { throw new Error('OpenAI HTTP 503') } }), { message: 'replan_failed' })
  assert.equal(liveChapters(db).length, 4)
  assert.equal(db.tables.jeju_quests.filter((q) => q.replaced_at).length, 0)
  assert.equal(db.tables.jeju_agent_requests[0].status, 'failed')
  // 다시 시도 가능
  assert.equal((await run(db)).status, 'replanned')

  const bad = setup()
  await assert.rejects(() => run(bad, { agent: async (input) => { const a = makeAgent(); const r = await a({ ...input, replan: { ...input.replan, keepOrder: [] } }); r.quests.chapters[0].corePlaceId = 'p-fake'; const errors = validateQuests(r.quests, input); throw new Error(`검증 실패: ${errors.join(' / ')}`) } }), { message: 'replan_failed' })
  assert.equal(liveChapters(bad).length, 4)
})

test('저장 중 오류가 나면 새로 넣은 것만 지우고 기존 일정은 그대로(삭제 금지)', async () => {
  const db = setup({ failInsert: ['jeju_quests'] })
  await assert.rejects(() => run(db), { message: 'replan_failed' })
  assert.equal(db.tables.jeju_chapters.length, 4) // 새 챕터는 정리되고 기존 챕터는 모두 남아 있다
  assert.deepEqual(db.tables.jeju_chapters.map((c) => c.status).sort(), ['active', 'completed', 'locked', 'locked'])
  assert.equal(db.tables.jeju_quests.length, 8)
})

test('자유여행 중에는 REPLAN 불가', async () => {
  await assert.rejects(() => run(setup({ mode: 'free' })), { message: 'free_travel_active' })
})

// ───────── 호출 제한 / cooldown / 중복 ─────────
const logged = (over) => ({ user_id: 'u1', request_type: 'REPLAN_ADVENTURE', status: 'success', created_at: new Date(NOW - 5 * MIN).toISOString(), request_payload: { trigger: 'manual' }, ...over })

test('cooldown: 수동 15분 / 시스템 30분', async () => {
  const manual = setup({ requests: [logged({})] })
  await assert.rejects(() => checkReplanLimits(manual, { userId: 'u1', reason: 'USER_REQUEST', now: NOW }), (e) => e.message === 'replan_cooldown' && e.details.retryAfterMinutes === 10)
  const system = setup({ requests: [logged({ request_payload: { trigger: 'system' }, created_at: new Date(NOW - 20 * MIN).toISOString() })] })
  await assert.rejects(() => checkReplanLimits(system, { userId: 'u1', reason: 'SCHEDULE_DELAY', now: NOW }), { message: 'replan_cooldown' })
  const later = setup({ requests: [logged({ request_payload: { trigger: 'system' }, created_at: new Date(NOW - 40 * MIN).toISOString() })] })
  await checkReplanLimits(later, { userId: 'u1', reason: 'SCHEDULE_DELAY', now: NOW }) // 통과
})

test('하루 한도: 수동 1회 / 시스템 2회 / 일반 합계 3회 / 긴급 예외 포함 최대 4회', async () => {
  const old = (m, trigger) => logged({ request_payload: { trigger }, created_at: new Date(NOW - m * MIN).toISOString() })
  const manualUsed = setup({ requests: [old(100, 'manual')] })
  await assert.rejects(() => checkReplanLimits(manualUsed, { userId: 'u1', reason: 'USER_REQUEST', now: NOW }), { message: 'replan_manual_limit' })
  const systemUsed = setup({ requests: [old(200, 'system'), old(100, 'system')] })
  await assert.rejects(() => checkReplanLimits(systemUsed, { userId: 'u1', reason: 'WEATHER_CHANGE', now: NOW }), { message: 'replan_system_limit' })
  const three = setup({ requests: [old(300, 'system'), old(200, 'system'), old(100, 'manual')] })
  await assert.rejects(() => checkReplanLimits(three, { userId: 'u1', reason: 'USER_REQUEST', now: NOW }), { message: 'replan_daily_limit' }) // 일반 합계 3회
  await assert.rejects(() => checkReplanLimits(three, { userId: 'u1', reason: 'SCHEDULE_DELAY', now: NOW }), { message: 'replan_daily_limit' })
  // 긴급(PLACE_UNAVAILABLE)은 일반 한도를 넘겨도 4번째까지 허용, 5번째는 hard max
  assert.equal((await checkReplanLimits(three, { userId: 'u1', reason: 'PLACE_UNAVAILABLE', now: NOW })).urgent, true)
  const four = setup({ requests: [old(400, 'system'), old(300, 'system'), old(200, 'manual'), old(100, 'system')] })
  await assert.rejects(() => checkReplanLimits(four, { userId: 'u1', reason: 'PLACE_UNAVAILABLE', now: NOW }), { message: 'replan_daily_limit' })
  // 실패한 요청은 한도를 쓰지 않는다
  const failedOnly = setup({ requests: [old(100, 'manual', 'x')].map((r) => ({ ...r, status: 'failed' })) })
  await checkReplanLimits(failedOnly, { userId: 'u1', reason: 'USER_REQUEST', now: NOW })
})

test('중복 방지: 같은 상태에서 동시에 두 번 승인해도 한 번만 실행', async () => {
  const db = setup()
  const agent = makeAgent()
  const settled = await Promise.allSettled([run(db, { agent }), run(db, { agent })])
  assert.equal(settled.filter((s) => s.status === 'fulfilled' && s.value.status === 'replanned').length, 1)
  assert.equal(settled.filter((s) => s.status === 'rejected').length, 1)
  assert.equal(agent.calls, 1)
})

test('실행 기록: agent_requests 에 REPLAN_ADVENTURE 로 남고 사용량 로그에 연결', async () => {
  const db = setup()
  await run(db)
  const request = db.tables.jeju_agent_requests[0]
  assert.deepEqual([request.request_type, request.status, request.request_payload.reason, request.request_payload.trigger], ['REPLAN_ADVENTURE', 'success', 'USER_REQUEST', 'manual'])
  assert.equal(db.tables.jeju_api_usage_logs.length, 1)
})

// ───────── 실제 프롬프트 빌더 (가짜 Agent 가 건너뛰는 부분) ─────────
import { buildQuestPrompt } from '../api/_lib/agent/quests.js'

test('REPLAN 프롬프트: 지시/keepOrder/조건이 실제로 들어가고, 일반 생성 프롬프트에는 들어가지 않음', () => {
  const input = { context: { companion: 'friends' }, adventure: { title: 't', summary: 's', data: {} }, corePool: [{ placeId: 'p-a', name: 'A', category: '관광지', area: '제주시' }], nearby: new Map(), chapterRange: { min: 1, max: 2 }, replan: { reason: 'WEATHER_CHANGE', keepOrder: ['p-a'], constraints: { indoorOnly: true } } }
  const replanned = buildQuestPrompt(input)
  assert.match(replanned.user, /재계획 지시/)
  assert.match(replanned.user, /"keepOrder":\["p-a"\]/)
  assert.match(replanned.user, /1~2개/)
  assert.doesNotMatch(buildQuestPrompt({ ...input, replan: undefined }).user, /재계획 지시/)
  // 행동형/사진 다양성 규칙은 시스템 프롬프트에 항상 포함
  assert.match(replanned.system, /행동형 퀘스트/)
  assert.match(replanned.system, /직관형/)
  assert.match(replanned.system, /색깔 퀘스트를 반복하지 마/)
})

test('행동형 검증: 추상형 2개 / 사진 3개 / 색깔 사진 2개는 거절', async () => {
  const { checkActionable, checkColorRepeat } = await import('../api/_lib/agent/quests.js')
  const abstract = (t) => ({ title: t, description: '주변 분위기를 느껴봐.', verificationType: 'self' })
  assert.equal(checkActionable([abstract('a'), abstract('b')], '챕터').length, 1)
  assert.equal(checkActionable([abstract('a'), { title: '돌담 찾기', description: '돌담을 찾아 사진으로 남겨봐', verificationType: 'photo_ai' }], '챕터').length, 0)
  const photo = (t, d) => ({ title: t, description: d, verificationType: 'photo_ai' })
  assert.equal(checkActionable([photo('1', '풍경 찍어봐'), photo('2', '돌담 찍어봐'), photo('3', '꽃 찍어봐')], '챕터').length, 1)
  const color = (c) => ({ coreQuest: photo('색', `${c}색 물체를 찾아 찍어봐`), optionalQuests: [] })
  assert.equal(checkColorRepeat([color('보라'), color('파란')]).length, 1)
  assert.equal(checkColorRepeat([color('보라')]).length, 0)
})

// ───────── 회귀: refreshOptional 경로의 롤백 ─────────
test('refreshOptional 저장 중 오류 → 기존 미완료 선택 퀘스트의 replaced_at 도 원래대로 복구(다시 정상 노출)', async () => {
  // 현재 챕터 유지(core 완료) + 비 → 미완료 선택 퀘스트만 새로 짜는 경로. 마지막 단계(새 챕터 seq 확정)에서 오류가 난다.
  const step3 = (table, values) => table === 'jeju_chapters' && values.status === 'locked' && 'seq' in values && !('closed_at' in values)
  const db = setup({ c1: 'core_completed', completedOptionalInC1: true, failUpdate: [step3] })
  const before = JSON.stringify(db.tables.jeju_quests)
  // 실제 DB 에서는 closed_at 컬럼이 항상 있고 기본값이 null 이다. (테스트용 가짜 DB 는 없는 키를 null 과 같게 비교한다)
  const snapshot = (rows) => JSON.stringify(rows.map((c) => ({ ...c, closed_at: c.closed_at ?? null })))
  const beforeChapters = snapshot(db.tables.jeju_chapters)

  await assert.rejects(() => run(db, { weather: async () => rainWx }, { reason: 'WEATHER_CHANGE' }), { message: 'replan_failed' })

  // 기존 optional(q1o2)이 다시 보이고(replaced_at null), 모든 퀘스트/챕터가 REPLAN 전 상태 그대로다. 새로 넣은 것은 정리됐다.
  assert.equal(questRow(db, 'q1o2').replaced_at, null)
  assert.equal(JSON.stringify(db.tables.jeju_quests), before)
  assert.equal(snapshot(db.tables.jeju_chapters), beforeChapters)
  assert.equal(db.tables.jeju_quests.filter((q) => q.replaced_at).length, 0)
  assert.equal(db.tables.jeju_quest_progress.length, 3) // 완료 기록 불변
  assert.equal(db.tables.jeju_agent_requests[0].status, 'failed') // 한도 미소모

  // 실패가 풀리면 같은 요청이 정상적으로 다시 성공한다 (기존 성공 경로 동작)
  const okDb = setup({ c1: 'core_completed', completedOptionalInC1: true })
  const result = await run(okDb, { weather: async () => rainWx }, { reason: 'WEATHER_CHANGE' })
  assert.equal(result.status, 'replanned')
  assert.ok(questRow(okDb, 'q1o2').replaced_at) // 성공 경로에서는 교체 표시가 유지된다
  assert.equal(questRow(okDb, 'q1o1').replaced_at, null) // 완료한 선택 퀘스트는 그대로
})

test('refreshOptional 롤백은 완료한 퀘스트와 대상이 아닌 퀘스트를 건드리지 않음', async () => {
  const step3 = (table, values) => table === 'jeju_chapters' && values.status === 'locked' && 'seq' in values && !('closed_at' in values)
  const db = setup({ c1: 'core_completed', completedOptionalInC1: true, failUpdate: [step3] })
  // 다른 챕터/다른 시점에 이미 교체돼 있던 퀘스트(예전 REPLAN 의 흔적)는 롤백 후에도 그대로 교체 상태여야 한다
  const oldStamp = new Date(NOW - 500 * MIN).toISOString()
  db.tables.jeju_quests.push(quest('q-old', 'c1', 'optional', PLACES[0], 9, { replaced_at: oldStamp }))
  await assert.rejects(() => run(db, { weather: async () => rainWx }, { reason: 'WEATHER_CHANGE' }), { message: 'replan_failed' })
  assert.equal(questRow(db, 'q-old').replaced_at, oldStamp)
  assert.equal(questRow(db, 'q1o1').replaced_at, null) // 완료한 선택
  assert.equal(questRow(db, 'q1').replaced_at, null) // 완료한 core
  assert.equal(questRow(db, 'q1o2').replaced_at, null) // 복구된 미완료 선택
})
