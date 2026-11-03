import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { evaluateSurprise } from '../api/_lib/agent/surprise.js'
import { replanAdventure } from '../api/_lib/agent/replan.js'
import { startFreeTravel } from '../api/_lib/freeTravel/service.js'
import { computeExpChanges, computeTripStats } from '../api/_lib/finalQuest/record.js'
import { _clearFinalQuestCache, arriveFinalQuest, assertNoFinalQuest, evaluateFinalQuest, finishTrip, startFinalQuestMove } from '../api/_lib/finalQuest/service.js'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { AIRPORT_ARRIVAL_RADIUS_M } from '../src/constants/finalQuestRules.js'
import { JEJU_AIRPORT } from '../src/constants/jeju.js'
import { computeSafeTimes, congestionBufferMinutes, finalQuestPhase, interpretFlight, isInternationalFlight, normalQuestsUnsafe, parseKst } from '../src/utils/finalQuest.js'
import { fakeDb } from './helpers/fakeDb.js'

const MIN = 60 * 1000
const USER = { id: 'u1' }
const DEPARTURE = Date.UTC(2026, 10, 3, 9, 30) // KST 18:30 (2026-11-03)
// 국내선: 도착 목표 17:00, 이동 30분, 혼잡 보정 0 → latestSafeDeparture KST 16:30
const LATEST = DEPARTURE - 90 * MIN - 30 * MIN
const NOW = LATEST + 10 * MIN // 16:40 → Final Quest 시작 시각
const T = 't1'

const flightResult = (over = {}) => ({ data: { found: true, flights: [{ flightNo: 'KE1406', scheduledDeparture: '2026-11-03 18:30', changedDeparture: '', delayed: false, cancelled: false, arrivalAirportCode: 'GMP', status: '출발', ...over }] } })
const makeDeps = (over = {}) => ({
  getFlightStatus: async () => flightResult(),
  getAirportCongestion: async () => ({ data: { current: { overall: { value: 2 } } } }),
  travelBetween: async () => ({ minutes: 30, source: 'estimate' }),
  ...over,
})

function setup({ progress = [], extraQuests = [], trip = {}, finalQuests = [] } = {}) {
  return fakeDb(
    {
      jeju_trips: [{ id: T, user_id: 'u1', start_date: '2026-11-01', end_date: '2026-11-03', transport: 'rental_car', departure_flight: 'KE1406', departure_datetime: new Date(DEPARTURE).toISOString(), status: 'active', travel_mode: 'quest', created_at: '2026-10-30T00:00:00.000Z', ...trip }],
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: T, status: 'active', adventure_date: '2026-11-03' }],
      jeju_chapters: [
        { id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'core_completed' },
        { id: 'c2', user_id: 'u1', adventure_id: 'adv1', seq: 2, status: 'active' },
        { id: 'c3', user_id: 'u1', adventure_id: 'adv1', seq: 3, status: 'locked' },
      ],
      jeju_quests: [
        { id: 'q-main', user_id: 'u1', adventure_id: 'adv1', quest_type: 'main', replaced_at: null, is_hidden: false },
        { id: 'q-core1', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'core', replaced_at: null, is_hidden: false, category_primary: 'food', place_lat: 33.45, place_lng: 126.5 },
        { id: 'q-opt1', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', replaced_at: null, is_hidden: false, category_primary: 'explore' },
        { id: 'q-core2', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c2', quest_type: 'core', replaced_at: null, is_hidden: false, category_primary: 'culture', place_lat: 33.46, place_lng: 126.52 },
        { id: 'q-opt2', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c2', quest_type: 'optional', replaced_at: null, is_hidden: false, category_primary: 'explore' },
        { id: 'q-hidden', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c2', quest_type: 'optional', replaced_at: null, is_hidden: true },
        { id: 'q-replaced', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c2', quest_type: 'optional', replaced_at: '2026-11-03T01:00:00Z', is_hidden: false },
        { id: 'q-sur-acc', user_id: 'u1', adventure_id: 'adv1', quest_type: 'surprise', surprise_status: 'accepted', replaced_at: null, is_hidden: false },
        { id: 'q-sur-off', user_id: 'u1', adventure_id: 'adv1', quest_type: 'surprise', surprise_status: 'offered', replaced_at: null, is_hidden: false },
        ...extraQuests,
      ],
      jeju_quest_progress: [
        { id: 'p1', user_id: 'u1', quest_id: 'q-core1', status: 'completed', verification_method: 'self' },
        { id: 'p2', user_id: 'u1', quest_id: 'q-opt2', status: 'in_progress' },
        ...progress,
      ],
      jeju_final_quests: finalQuests,
      jeju_titles: [
        { id: 'ti1', code: 'trip_first_complete', name: '제주 첫 모험 완료' },
        { id: 'ti2', code: 'trip_foodie', name: '미식 여행자' },
      ],
      jeju_place_visits: [{ user_id: 'u1', trip_id: T, quest_id: 'q-core1', place_id: 'p-a', place_name: '맛집', visited_at: '2026-11-03T02:00:00Z' }],
      jeju_place_discoveries: [{ user_id: 'u1', place_id: 'p-a', place_name: '맛집', discovery_type: 'normal', discovered_at: '2026-11-03T02:00:00Z' }],
      jeju_travel_photos: [{ id: 'ph1', user_id: 'u1', trip_id: T, quest_id: 'q-core1', is_memory: true, storage_path: 'u1/a.jpg', caption: '맛있었다' }],
    },
    {
      unique: {
        jeju_final_quests: (a, b) => a.trip_id === b.trip_id,
        jeju_agent_requests: (a, b) => a.user_id === b.user_id && a.request_key === b.request_key,
        jeju_feedback: (a, b) => a.user_id === b.user_id && a.trip_id === b.trip_id && !a.quest_id && !a.adventure_id && !b.quest_id && !b.adventure_id,
      },
    },
  )
}

const status = (db, id) => db.tables.jeju_quest_progress.find((p) => p.quest_id === id)?.status ?? null
const evaluate = (db, over = {}) => evaluateFinalQuest({ user: USER, tripId: T, db, deps: makeDeps(over.deps), now: over.now ?? NOW, position: over.position ?? null, refresh: over.refresh })
const nearAirport = (meters, now = NOW) => ({ lat: JEJU_AIRPORT.lat + meters / 111320, lng: JEJU_AIRPORT.lng, accuracy: 20, timestamp: now })

beforeEach(() => _clearFinalQuestCache())

// ───────── 안전 시간 계산 (순수) ─────────
test('안전 시간: 국내선 90분 / 국제선 150분 전 공항 도착', () => {
  assert.equal(computeSafeTimes({ departureAtMs: DEPARTURE, travelMinutes: 0 }).arriveBy, DEPARTURE - 90 * MIN)
  assert.equal(computeSafeTimes({ departureAtMs: DEPARTURE, international: true, travelMinutes: 0 }).arriveBy, DEPARTURE - 150 * MIN)
  assert.equal(isInternationalFlight('NRT'), true)
  assert.equal(isInternationalFlight('GMP'), false)
  assert.equal(isInternationalFlight(null), true) // 모르면 보수적으로 국제선 기준(150분)
})

test('혼잡도 보정: 원활/보통 0, 혼잡 +30, 매우혼잡 +60, 조회 실패(없음)는 0', () => {
  assert.deepEqual([1, 2, 3, 4].map(congestionBufferMinutes), [0, 0, 30, 60])
  assert.equal(congestionBufferMinutes(null), 0)
  assert.equal(congestionBufferMinutes(undefined), 0)
  assert.equal(congestionBufferMinutes(9), 0)
})

test('latestSafeDeparture = 도착 목표 − (공항 이동시간 + 혼잡 보정)', () => {
  const safe = computeSafeTimes({ departureAtMs: DEPARTURE, congestionLevel: 4, travelMinutes: 40 })
  assert.equal(safe.latestSafeDeparture, DEPARTURE - 90 * MIN - (40 + 60) * MIN)
  assert.equal(safe.congestionBufferMinutes, 60)
  assert.equal(computeSafeTimes({ departureAtMs: DEPARTURE, congestionLevel: 3, travelMinutes: 40, international: true }).latestSafeDeparture, DEPARTURE - 150 * MIN - 70 * MIN)
})

test('이동시간을 모르면(Directions 실패/위치 없음) 보수적 기본값 60분, 출발 시각이 없으면 계산하지 않음', () => {
  assert.equal(computeSafeTimes({ departureAtMs: DEPARTURE, travelMinutes: null }).travelMinutes, 60)
  assert.equal(computeSafeTimes({ departureAtMs: null }), null)
  assert.equal(computeSafeTimes({ departureAtMs: NaN }), null)
})

test('단계: 60분 전 notice, latestSafeDeparture 도달 activate, normalQuestsUnsafe 는 같은 기준', () => {
  const safe = computeSafeTimes({ departureAtMs: DEPARTURE, travelMinutes: 30 })
  const phase = (nowMs) => finalQuestPhase({ nowMs, latestSafeDeparture: safe.latestSafeDeparture })
  assert.equal(phase(LATEST - 61 * MIN), 'none')
  assert.equal(phase(LATEST - 60 * MIN), 'notice')
  assert.equal(phase(LATEST - 1), 'notice')
  assert.equal(phase(LATEST), 'activate')
  assert.equal(normalQuestsUnsafe({ nowMs: LATEST - 1, safe }), false)
  assert.equal(normalQuestsUnsafe({ nowMs: LATEST, safe }), true)
})

test('항공편 해석: 정상 / 지연(변경 시각 우선) / 결항 / 못 찾음(setup 출발 시각으로 대체)', () => {
  assert.equal(interpretFlight(flightResult().data, { flightNo: 'KE1406' }).state, 'normal')
  const delayed = interpretFlight(flightResult({ changedDeparture: '2026-11-03 19:10', delayed: true }).data, { flightNo: 'KE1406' })
  assert.equal(delayed.state, 'delayed')
  assert.equal(delayed.departureAtMs, DEPARTURE + 40 * MIN)
  assert.equal(delayed.delayMinutes, 40)
  assert.equal(interpretFlight(flightResult({ cancelled: true }).data, { flightNo: 'KE1406' }).state, 'cancelled')
  const missing = interpretFlight({ found: false, flights: [] }, { flightNo: 'KE1406', fallbackDepartureMs: DEPARTURE })
  assert.deepEqual([missing.state, missing.departureAtMs, missing.source], ['unknown', DEPARTURE, 'setup'])
  assert.equal(parseKst('2026-11-03 18:30'), DEPARTURE)
  assert.equal(parseKst('이상한 값'), null)
})

// ───────── 평가 / 활성화 ─────────
test('마지막 날이 아니면 외부 조회 없이 none (행도 만들지 않음)', async () => {
  const db = setup()
  const boom = async () => {
    throw new Error('호출되면 안 돼')
  }
  const result = await evaluate(db, { now: Date.UTC(2026, 10, 2, 3, 0), deps: { getFlightStatus: boom, getAirportCongestion: boom, travelBetween: boom } })
  assert.deepEqual([result.status, result.lastDay, result.locked], ['none', false, false])
  assert.equal(db.tables.jeju_final_quests.length, 0)
})

test('공항 이동 준비(60분 전): notice 만 — 일반 모험은 그대로, 잠금 없음, 새 돌발 중단 표시', async () => {
  const db = setup()
  const result = await evaluate(db, { now: LATEST - 30 * MIN })
  assert.deepEqual([result.status, result.phase, result.noticeLock, result.locked], ['notice', 'notice', true, false])
  assert.equal(db.tables.jeju_final_quests.length, 0)
  assert.equal(db.tables.jeju_adventures[0].status, 'active')
  assert.equal(result.safe.latestSafeDeparture, new Date(LATEST).toISOString())
})

test('여유가 있으면(60분보다 먼) none', async () => {
  const result = await evaluate(setup(), { now: LATEST - 3 * 60 * MIN })
  assert.deepEqual([result.status, result.phase], ['none', 'none'])
})

test('Final Quest 시작: 미완료 퀘스트는 ended_by_final_quest(실패 아님), 완료한 퀘스트/숨김/교체/메인은 그대로, 모험·챕터 종료', async () => {
  const db = setup()
  const result = await evaluate(db)
  assert.deepEqual([result.status, result.locked, result.extrasAllowed], ['active', true, false])
  assert.equal(db.tables.jeju_final_quests.length, 1)

  assert.equal(status(db, 'q-core1'), 'completed') // 완료한 퀘스트는 유지
  assert.equal(status(db, 'q-core2'), 'ended_by_final_quest') // 진행 기록이 없던 핵심
  assert.equal(status(db, 'q-opt1'), 'ended_by_final_quest')
  assert.equal(status(db, 'q-opt2'), 'ended_by_final_quest') // 진행 중이던 선택
  assert.equal(status(db, 'q-sur-acc'), 'ended_by_final_quest') // 수락만 하고 못 한 돌발
  assert.equal(status(db, 'q-hidden'), null) // 아직 공개 안 된 퀘스트는 건드리지 않음
  assert.equal(status(db, 'q-replaced'), null)
  assert.equal(status(db, 'q-main'), null)
  assert.ok(!db.tables.jeju_quest_progress.some((p) => p.status === 'failed' || p.status === 'skipped'))

  assert.equal(db.tables.jeju_quests.find((q) => q.id === 'q-sur-off').surprise_status, 'declined') // 답 안 한 제안은 거절로 닫힘(불이익 없음)
  assert.equal(db.tables.jeju_adventures[0].status, 'ended_early')
  assert.deepEqual(db.tables.jeju_chapters.map((c) => c.status), ['ended_by_final_quest', 'ended_by_final_quest', 'ended_by_final_quest'])
  assert.deepEqual(result.endedCounts, { core: 1, optional: 2, surprise: 1, done: true })
})

test('다시 평가해도 활성화는 한 번뿐(행 1개, 마감 중복 없음)', async () => {
  const db = setup()
  const first = await evaluate(db)
  const progressRows = db.tables.jeju_quest_progress.length
  const second = await evaluate(db, { now: NOW + 5 * MIN })
  assert.equal(db.tables.jeju_final_quests.length, 1)
  assert.equal(second.finalQuestId, first.finalQuestId)
  assert.equal(db.tables.jeju_quest_progress.length, progressRows)
})

test('마감된 퀘스트 통계: 완료/실패에 섞이지 않고 endedByFinalQuest 로 따로 센다', async () => {
  const db = setup()
  await evaluate(db)
  const quests = db.tables.jeju_quests
  const stats = computeTripStats({ quests, progress: db.tables.jeju_quest_progress, visits: db.tables.jeju_place_visits, discoveries: db.tables.jeju_place_discoveries })
  assert.equal(stats.completedQuests, 1)
  assert.equal(stats.endedByFinalQuest, 4)
  assert.deepEqual(stats.categoryQuests, { food: 1 })
})

// ───────── 잠금 ─────────
test('활성화 뒤: 일반 완료/REPLAN/Surprise/자유여행/새 모험 잠금', async () => {
  const db = setup()
  await evaluate(db)
  await assert.rejects(() => assertNoFinalQuest(db, { userId: 'u1', tripId: T }), { message: 'final_quest_active' })
  await assert.rejects(() => completeQuest({ user: USER, questId: 'q-core2', db }), (e) => e.status === 409)
  await assert.rejects(() => replanAdventure({ user: USER, adventureId: 'adv1', reason: 'USER_REQUEST', db }), (e) => e.status === 409)
  await assert.rejects(() => evaluateSurprise({ user: USER, adventureId: 'adv1', trigger: 'anchor_dwell', db }), { message: 'final_quest_active' })
  await assert.rejects(() => startFreeTravel({ user: USER, adventureId: 'adv1', db }), (e) => e.status === 409)
})

test('공항 이동 준비 구간에는 새 돌발 퀘스트를 만들지 않는다 (활성화 전)', async () => {
  const db = setup()
  await assert.rejects(
    () => evaluateSurprise({ user: USER, adventureId: 'adv1', trigger: 'anchor_dwell', db, deps: makeDeps(), now: LATEST - 20 * MIN }),
    { message: 'final_quest_notice' },
  )
})

// ───────── 항공편 / API 실패 ─────────
test('항공편 지연: 안전 시간이 다시 계산되고, 이미 공항으로 이동 중이면 일반 모험으로 되돌리지 않는다', async () => {
  const db = setup()
  await evaluate(db)
  await startFinalQuestMove({ user: USER, tripId: T, db })
  const delayed = await evaluate(db, { now: NOW + MIN, deps: { getFlightStatus: async () => flightResult({ changedDeparture: '2026-11-03 20:30', delayed: true }) }, refresh: true })
  assert.equal(delayed.flight.state, 'delayed')
  assert.equal(delayed.status, 'moving') // 이동 중 상태 유지
  assert.equal(delayed.safe.latestSafeDeparture, new Date(LATEST + 120 * MIN).toISOString())
  assert.equal(db.tables.jeju_adventures[0].status, 'ended_early')
})

test('항공편 지연(Final Quest 전): 안전 시간이 늦어지고 아직 시작되지 않는다', async () => {
  const db = setup()
  const result = await evaluate(db, { deps: { getFlightStatus: async () => flightResult({ changedDeparture: '2026-11-03 20:30', delayed: true }) } })
  assert.equal(result.flight.state, 'delayed')
  assert.equal(result.status, 'none')
  assert.equal(db.tables.jeju_final_quests.length, 0)
})

test('항공편 결항(공식): 행이 없으면 flight_cancelled 상태만 — 강제 시작/자동 종료/잠금 없음', async () => {
  const db = setup()
  const result = await evaluate(db, { deps: { getFlightStatus: async () => flightResult({ cancelled: true }) } })
  assert.deepEqual([result.status, result.message, result.locked], ['flight_cancelled', 'flight_cancelled', false])
  assert.equal(db.tables.jeju_final_quests.length, 0)
  assert.equal(db.tables.jeju_adventures[0].status, 'active')
  assert.equal(db.tables.jeju_trips[0].status, 'active')
})

test('결항 후 항공편 정보를 고치면(다시 평가) 원래 흐름으로 돌아온다. 결항 중에는 도착/마무리 불가', async () => {
  const db = setup()
  await evaluate(db)
  const cancelled = await evaluate(db, { deps: { getFlightStatus: async () => flightResult({ cancelled: true }) }, refresh: true })
  assert.equal(cancelled.status, 'flight_cancelled')
  assert.equal(db.tables.jeju_final_quests[0].status, 'active') // 상태는 보존
  await assert.rejects(() => startFinalQuestMove({ user: USER, tripId: T, db }), { message: 'flight_cancelled' })
  await assert.rejects(() => arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(100), db, now: NOW }), { message: 'flight_cancelled' })
  await assert.rejects(() => finishTrip({ user: USER, tripId: T, db, now: NOW }), { message: 'flight_cancelled' })
  assert.equal(db.tables.jeju_trips[0].status, 'active')

  const back = await evaluate(db, { refresh: true })
  assert.equal(back.status, 'active')
})

test('API 실패: 항공편은 setup 출발 시각, 혼잡도는 보정 0, 이동시간은 보수적 기본값(60분)으로 대체하고 Final Quest 는 막히지 않는다', async () => {
  const boom = async () => {
    throw new Error('API down')
  }
  const db = setup()
  const result = await evaluate(db, { now: DEPARTURE - 90 * MIN - 60 * MIN + MIN, deps: { getFlightStatus: boom, getAirportCongestion: boom, travelBetween: boom } })
  assert.equal(result.status, 'active')
  assert.equal(result.flight.source, 'setup')
  assert.equal(result.safe.congestionBufferMinutes, 0)
  assert.equal(result.safe.travelMinutes, 60)
})

test('항공편 조회가 "못 찾음"이어도 setup 출발 시각으로 진행한다', async () => {
  const db = setup()
  const result = await evaluate(db, { deps: { getFlightStatus: async () => ({ data: { found: false, flights: [] } }) } })
  assert.equal(result.status, 'active')
  assert.equal(result.flight.state, 'unknown')
})

test('출발 시각 정보가 전혀 없으면 시작하지 않고 항공편 정보를 요청한다', async () => {
  const db = setup({ trip: { departure_flight: null, departure_datetime: null } })
  const result = await evaluate(db)
  assert.equal(result.status, 'needs_flight_info')
  assert.equal(db.tables.jeju_final_quests.length, 0)
})

test('혼잡도(매우혼잡)가 안전 시간에 반영되고, 국제선(도착 NRT)은 150분 기준', async () => {
  const crowded = await evaluate(setup(), { now: LATEST - 40 * MIN, deps: { getAirportCongestion: async () => ({ data: { current: { overall: { value: 4 } } } }) } })
  assert.equal(crowded.safe.congestionBufferMinutes, 60)
  assert.equal(crowded.safe.latestSafeDeparture, new Date(LATEST - 60 * MIN).toISOString())
  _clearFinalQuestCache()
  const intl = await evaluate(setup(), { now: LATEST - 100 * MIN, deps: { getFlightStatus: async () => flightResult({ arrivalAirportCode: 'NRT' }) } })
  assert.equal(intl.safe.international, true)
  assert.equal(intl.safe.arriveBeforeMinutes, 150)
})

test('외부 조회 TTL: 같은 항공편/혼잡도는 캐시를 재사용한다 (렌더/폴링마다 호출하지 않음)', async () => {
  const db = setup()
  let flights = 0
  let congestion = 0
  const deps = { getFlightStatus: async () => (flights++, flightResult()), getAirportCongestion: async () => (congestion++, { data: { current: { overall: { value: 2 } } } }) }
  await evaluate(db, { now: LATEST - 90 * MIN, deps })
  await evaluate(db, { now: LATEST - 88 * MIN, deps })
  await evaluate(db, { now: LATEST - 84 * MIN, deps })
  assert.deepEqual([flights, congestion], [1, 1])
})

// ───────── 이동 / 도착 / 마무리 ─────────
test('공항 도착: 500m 반경(150m 아님), 위치 근거 없으면 거절(self 대체 없음), 너무 멀면 거절', async () => {
  const db = setup()
  await evaluate(db)
  assert.equal(AIRPORT_ARRIVAL_RADIUS_M, 500)
  await assert.rejects(() => arriveFinalQuest({ user: USER, tripId: T, position: null, db, now: NOW }), { message: 'gps_position_invalid' })
  await assert.rejects(() => arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(800), db, now: NOW }), { message: 'gps_too_far' })
  await assert.rejects(() => arriveFinalQuest({ user: USER, tripId: T, position: { ...nearAirport(100), timestamp: NOW - 10 * 60 * MIN }, db, now: NOW }), { message: 'gps_position_stale' })
  assert.equal(db.tables.jeju_final_quests[0].status, 'active')
  assert.equal(db.tables.jeju_exp_logs.length, 0)
  const ok = await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(400), db, now: NOW }) // 150m 는 넘지만 500m 안
  assert.deepEqual([ok.status, ok.awarded, ok.amount], ['arrived', true, 100])
})

test('이동 시작은 active → moving, 다시 눌러도 같은 결과', async () => {
  const db = setup()
  await evaluate(db)
  assert.equal((await startFinalQuestMove({ user: USER, tripId: T, db })).status, 'moving')
  assert.equal((await startFinalQuestMove({ user: USER, tripId: T, db })).status, 'moving')
  assert.ok(db.tables.jeju_final_quests[0].started_at)
})

test('Final Quest 완료 +100 EXP(자유 EXP)는 한 번만: 재전송/중복 요청에도 1건', async () => {
  const db = setup()
  await evaluate(db)
  const first = await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(50), db, now: NOW })
  const again = await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(50), db, now: NOW })
  assert.equal(first.awarded, true)
  assert.deepEqual([again.awarded, again.alreadyArrived], [false, true])
  const logs = db.tables.jeju_exp_logs.filter((l) => l.source_key === `final:${db.tables.jeju_final_quests[0].id}:completion`)
  assert.equal(logs.length, 1)
  assert.equal(db.tables.jeju_profiles[0].unspent_exp, 100)
})

test('공항 도착 ≠ 여행 종료: 도착 후에도 trips.status 는 그대로이고, 마무리 전에는 finish 불가', async () => {
  const db = setup()
  await evaluate(db)
  await assert.rejects(() => finishTrip({ user: USER, tripId: T, db, now: NOW }), { message: 'final_quest_not_completed' })
  await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(50), db, now: NOW })
  assert.equal(db.tables.jeju_trips[0].status, 'active')
  assert.equal(db.tables.jeju_final_quests[0].status, 'arrived')
})

test('여행 마무리: trips.status=completed, 기록 확정, 칭호 해금, 회고(AI 성공)', async () => {
  const db = setup()
  await evaluate(db)
  await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(50), db, now: NOW })
  const { record } = await finishTrip({ user: USER, tripId: T, db, now: NOW, deps: { askRetrospective: async () => ({ text: '제주에서 맛있는 하루를 보냈어요. 정말 수고했어요!' }) } })
  assert.equal(db.tables.jeju_trips[0].status, 'completed')
  assert.ok(db.tables.jeju_trips[0].completed_at)
  assert.equal(db.tables.jeju_final_quests[0].status, 'finished')
  assert.equal(record.trip.retrospectiveSource, 'ai')
  assert.equal(record.stats.completedQuests, 1)
  assert.equal(record.stats.endedByFinalQuest, 4)
  assert.deepEqual(record.titles.map((t) => t.code), ['trip_first_complete'])
  assert.equal(record.places[0].name, '맛집')
  assert.equal(record.discoveries.length, 1)
  assert.equal(record.photos.length, 1)
  assert.equal(record.finalQuest.status, 'finished')
})

test('회고 AI 실패/형식 오류면 코드 통계 문장으로 대체하고 마무리는 막히지 않는다', async () => {
  for (const ask of [async () => { throw new Error('OpenAI down') }, async () => ({ text: '짧' })]) {
    const db = setup()
    await evaluate(db)
    await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(50), db, now: NOW })
    const { record } = await finishTrip({ user: USER, tripId: T, db, now: NOW, deps: { askRetrospective: ask } })
    assert.equal(record.trip.status, 'completed')
    assert.equal(record.trip.retrospectiveSource, 'stats')
    assert.match(record.trip.retrospective, /퀘스트 1개/)
  }
})

test('마무리를 다시 눌러도(재전송) 회고/칭호/완료 시각이 바뀌지 않는다. 끝난 여행은 다시 활성으로 열리지 않는다', async () => {
  const db = setup()
  await evaluate(db)
  await arriveFinalQuest({ user: USER, tripId: T, position: nearAirport(50), db, now: NOW })
  let asked = 0
  const deps = { askRetrospective: async () => (asked++, { text: '제주에서 맛있는 하루를 보냈어요. 정말 수고했어요!' }) }
  const first = await finishTrip({ user: USER, tripId: T, db, now: NOW, deps })
  const second = await finishTrip({ user: USER, tripId: T, db, now: NOW + 60 * MIN, deps })
  assert.equal(asked, 1)
  assert.equal(second.record.trip.completedAt, first.record.trip.completedAt)
  assert.equal(db.tables.jeju_user_titles.length, 1)

  const after = await evaluate(db, { now: NOW + 120 * MIN })
  assert.equal(after.status, 'trip_completed')
  assert.equal(db.tables.jeju_trips[0].status, 'completed')
  await assert.rejects(() => assertNoFinalQuest(db, { userId: 'u1', tripId: T }), { message: 'final_quest_active' }) // 새 모험/퀘스트 생성은 계속 막힘
})

test('EXP/레벨 변화: 여행 기간의 exp_logs 합계로 카테고리별 레벨 변화 계산', () => {
  const logs = [
    { category: 'food', amount: 300, created_at: 'x' },
    { category: 'explore', amount: 50, created_at: 'x' },
    { category: null, amount: 100, created_at: 'x' }, // 자유 EXP 는 총합에만
  ]
  const changes = computeExpChanges({ logs, before: { explore: 0, culture: 0, food: 0, relax: 0, social: 0, discovery: 0 }, after: { explore: 50, culture: 0, food: 300, relax: 0, social: 0, discovery: 0 } })
  assert.equal(changes.totalExp, 450)
  assert.deepEqual(changes.levelChanges.map((c) => c.category).sort(), ['explore', 'food'])
  const food = changes.levelChanges.find((c) => c.category === 'food')
  assert.ok(food.to >= food.from)
})
