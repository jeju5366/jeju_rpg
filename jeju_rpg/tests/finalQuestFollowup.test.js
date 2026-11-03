import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { buildTripRecord, resolveExpRange } from '../api/_lib/finalQuest/record.js'
import { _clearFinalQuestCache, arriveFinalQuest, evaluateFinalQuest, finishTrip, usablePosition } from '../api/_lib/finalQuest/service.js'
import { JEJU_AIRPORT } from '../src/constants/jeju.js'
import { flightKind, isInternationalFlight, treatAsInternational } from '../src/utils/finalQuest.js'
import { recentPosition, resolveEvalPosition } from '../src/utils/finalQuestPosition.js'
import { convergeCandidates, orderChaptersTowardAirport } from '../src/utils/lastDay.js'
import { fakeDb } from './helpers/fakeDb.js'

const MIN = 60 * 1000
const USER = { id: 'u1' }
const T = 't1'
const DEPARTURE = Date.UTC(2026, 10, 3, 9, 30) // KST 18:30
const LATEST = DEPARTURE - 90 * MIN - 30 * MIN
const NOW = LATEST + 10 * MIN

const flight = (arrivalAirportCode = 'GMP') => ({ data: { found: true, flights: [{ flightNo: 'KE1406', scheduledDeparture: '2026-11-03 18:30', changedDeparture: '', delayed: false, cancelled: false, arrivalAirportCode }] } })
function makeDeps(over = {}) {
  const calls = []
  return {
    calls,
    getFlightStatus: async () => flight(),
    getAirportCongestion: async () => ({ data: { current: { overall: { value: 2 } } } }),
    travelBetween: async ({ from }) => {
      calls.push(from)
      return { minutes: 30, source: 'estimate' }
    },
    ...over,
  }
}

function setup({ withAnchor = true, tripOver = {} } = {}) {
  return fakeDb(
    {
      jeju_trips: [{ id: T, user_id: 'u1', start_date: '2026-11-01', end_date: '2026-11-03', transport: 'rental_car', departure_flight: 'KE1406', departure_datetime: new Date(DEPARTURE).toISOString(), status: 'active', travel_mode: 'quest', created_at: '2026-10-30T00:00:00.000Z', ...tripOver }],
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: T, status: withAnchor ? 'active' : 'proposed', adventure_date: '2026-11-03' }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'active' }],
      jeju_quests: [
        { id: 'q-core', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'core', replaced_at: null, is_hidden: false, place_lat: 33.45, place_lng: 126.5 },
        { id: 'q-a', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', replaced_at: null, is_hidden: false },
        { id: 'q-b', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', replaced_at: null, is_hidden: false },
        { id: 'q-c', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', replaced_at: null, is_hidden: false },
      ],
      jeju_quest_progress: [],
    },
    { unique: { jeju_final_quests: (a, b) => a.trip_id === b.trip_id, jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id, jeju_agent_requests: (a, b) => a.user_id === b.user_id && a.request_key === b.request_key } },
  )
}
const evaluate = (db, deps, over = {}) => evaluateFinalQuest({ user: USER, tripId: T, db, deps, now: over.now ?? NOW, position: over.position ?? null })

beforeEach(() => _clearFinalQuestCache())

// ───────── A-1: 현재 위치 우선순위 ─────────
const gps = (now, ageMs = 30 * 1000) => ({ lat: 33.3, lng: 126.6, accuracy: 20, timestamp: now - ageMs })

test('A-1: 최근 GPS 가 있으면 챕터 위치보다 GPS 가 이동시간 출발지로 우선', async () => {
  const deps = makeDeps()
  const result = await evaluate(setup(), deps, { position: gps(NOW) })
  assert.deepEqual(deps.calls[0], { lat: 33.3, lng: 126.6 })
  assert.equal(result.safe.travelOrigin, 'gps')
})

test('A-1: 오래된 GPS 는 현재 위치로 쓰지 않고 챕터 핵심 장소로 대체', async () => {
  const deps = makeDeps()
  const result = await evaluate(setup(), deps, { position: gps(NOW, 10 * MIN) })
  assert.deepEqual(deps.calls[0], { lat: 33.45, lng: 126.5 })
  assert.equal(result.safe.travelOrigin, 'anchor')
  assert.equal(usablePosition({ lat: 33.3, lng: 126.6, timestamp: NOW - 10 * MIN }, NOW), null)
  assert.equal(usablePosition({ lat: 33.3, lng: 126.6 }, NOW), null) // 시각 없는 위치도 현재 위치가 아니다
  assert.equal(usablePosition({ lat: 33.3, lng: 126.6, timestamp: NOW + 10 * MIN }, NOW), null)
  assert.deepEqual(usablePosition(gps(NOW), NOW), { lat: 33.3, lng: 126.6 })
})

test('A-1: GPS 없음 → 챕터 anchor, anchor 도 없으면 60분 기본값', async () => {
  const deps = makeDeps()
  const withAnchor = await evaluate(setup(), deps)
  assert.equal(withAnchor.safe.travelOrigin, 'anchor')
  _clearFinalQuestCache()
  const noDeps = makeDeps()
  const none = await evaluate(setup({ withAnchor: false }), noDeps)
  assert.equal(noDeps.calls.length, 0) // 이동시간 계산을 아예 부르지 않는다
  assert.equal(none.safe.travelOrigin, 'fallback')
  assert.equal(none.safe.travelMinutes, 60)
})

test('A-1 클라이언트: 최신 위치는 그대로, 오래되면 권한이 이미 허용된 경우에만 한 번 새로 받고, 실패하면 null', async () => {
  const now = 1_000_000_000
  const fresh = { lat: 1, lng: 1, accuracy: 10, timestamp: now - 60 * 1000 }
  const stale = { lat: 1, lng: 1, accuracy: 10, timestamp: now - 10 * MIN }
  let asked = 0
  const common = { now, getPermission: async () => 'granted', getPosition: async () => (asked++, { lat: 2, lng: 2, accuracy: 10, timestamp: Date.now() }) }
  assert.equal(await resolveEvalPosition({ ...common, stored: fresh }), fresh)
  assert.equal(asked, 0) // 최신이면 GPS 를 다시 요청하지 않는다
  assert.equal(recentPosition(stale, now), null)
  assert.equal((await resolveEvalPosition({ ...common, stored: stale })).lat, 2)
  assert.equal(asked, 1)
  assert.equal(await resolveEvalPosition({ ...common, stored: stale, getPermission: async () => 'prompt' }), null) // 권한 창을 띄우지 않는다
  assert.equal(await resolveEvalPosition({ ...common, stored: null, getPosition: async () => { throw new Error('denied') } }), null)
})

// ───────── A-2: 항공편 종류 ─────────
test('A-2: 확실한 국내선 90분 / 국제선 150분 / 알 수 없으면 150분', async () => {
  assert.deepEqual([flightKind('GMP'), flightKind('NRT'), flightKind(null), flightKind('')], ['domestic', 'international', 'unknown', 'unknown'])
  assert.deepEqual([treatAsInternational('domestic'), treatAsInternational('international'), treatAsInternational('unknown')], [false, true, true])
  assert.equal(isInternationalFlight(null), true)
  assert.equal(flightKind(null, 'domestic'), 'domestic') // 사용자가 직접 고르면 그 값 (확장 자리)

  const domestic = await evaluate(setup(), makeDeps())
  assert.equal(domestic.safe.arriveBeforeMinutes, 90)
  _clearFinalQuestCache()
  const intl = await evaluate(setup(), makeDeps({ getFlightStatus: async () => flight('NRT') }))
  assert.equal(intl.safe.arriveBeforeMinutes, 150)
  _clearFinalQuestCache()
  const unknown = await evaluate(setup(), makeDeps({ getFlightStatus: async () => { throw new Error('API down') } }))
  assert.equal(unknown.safe.arriveBeforeMinutes, 150)
  assert.equal(unknown.safe.flightKind, 'unknown')
})

// ───────── A-3: 과거 여행 레벨 변화는 변하지 않는다 ─────────
const EXP0 = { explore: 0, culture: 0, food: 0, relax: 0, social: 0, discovery: 0 }

test('A-3: 마무리 때 EXP 스냅샷 저장 → 이후 다른 여행에서 EXP 를 얻어도 첫 여행 기록의 레벨 변화는 그대로', async () => {
  const db = setup()
  db.tables.jeju_profiles[0].exp_explore = 700
  db.tables.jeju_exp_logs.push({ user_id: 'u1', category: 'explore', amount: 500, created_at: '2026-11-02T00:00:00.000Z', source_key: 'x1' })
  await evaluate(db, makeDeps())
  await arriveFinalQuest({ user: USER, tripId: T, position: { lat: JEJU_AIRPORT.lat, lng: JEJU_AIRPORT.lng, accuracy: 10, timestamp: NOW }, db, now: NOW })
  const first = (await finishTrip({ user: USER, tripId: T, db, now: NOW, deps: { askRetrospective: async () => ({ text: '제주 여행을 잘 마쳤어요. 수고했어요!' }) } })).record
  const snapshot = db.tables.jeju_trips[0].exp_snapshot
  assert.deepEqual([snapshot.before.explore, snapshot.after.explore], [200, 700]) // 시작 전/종료 후 (현재 EXP − 이번 여행 몫)

  // 두 번째 여행에서 EXP 를 많이 얻는다 (프로필 누적 EXP 가 크게 올라감)
  db.tables.jeju_profiles[0].exp_explore = 900000
  db.tables.jeju_exp_logs.push({ user_id: 'u1', category: 'explore', amount: 899300, created_at: '2026-12-05T00:00:00.000Z', source_key: 'x2' })
  const again = await buildTripRecord(db, { userId: 'u1', tripId: T, now: NOW + 40 * 24 * 60 * MIN })
  assert.deepEqual(again.exp.levelChanges, first.exp.levelChanges)
  assert.equal(again.exp.levelChanges[0].to <= 50, true) // 현재 누적(90만)의 레벨이 아니라 종료 당시 레벨
})

test('A-3: 스냅샷이 없는 옛 여행도 exp_logs 시각으로 종료 시점을 복원해서 값이 변하지 않는다', () => {
  const trip = { created_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-05T00:00:00Z' }
  const logs = [
    { category: 'explore', amount: 300, created_at: '2026-10-02T00:00:00Z' }, // 이 여행
    { category: 'explore', amount: 5000, created_at: '2026-11-10T00:00:00Z' }, // 이후 다른 여행
  ]
  const early = resolveExpRange({ allLogs: logs.slice(0, 1), trip, currentExps: { ...EXP0, explore: 800 } })
  const later = resolveExpRange({ allLogs: logs, trip, currentExps: { ...EXP0, explore: 5800 } })
  assert.deepEqual(early, later)
  assert.deepEqual([later.before.explore, later.after.explore, later.source], [500, 800, 'logs'])
  // 스냅샷이 있으면 스냅샷이 우선
  assert.equal(resolveExpRange({ snapshot: { before: EXP0, after: { ...EXP0, explore: 1 } }, allLogs: logs, trip, currentExps: EXP0 }).source, 'snapshot')
})

// ───────── A-4: Final Quest 활성화와 일반 완료 동시 요청 ─────────
test('A-4: 활성화 도중 한 퀘스트가 먼저 완료돼도 완료 기록은 보존되고 나머지는 모두 마감된다', async () => {
  const db = setup()
  let raced = false
  const racing = {
    ...db,
    from: (table) => {
      const query = db.from(table)
      if (table === 'jeju_quest_progress') {
        const upsert = query.upsert.bind(query)
        query.upsert = (...args) => {
          // 마감 쓰기 직전에 사용자의 일반 완료 요청이 q-b 의 progress 를 먼저 만든다 (읽은 시점에는 없었다)
          raced = true
          db.tables.jeju_quest_progress.push({ id: 'race', user_id: 'u1', quest_id: 'q-b', status: 'completed', verification_method: 'gps', completed_at: '2026-11-03T07:39:59Z' })
          return upsert(...args)
        }
      }
      return query
    },
  }
  const result = await evaluate(racing, makeDeps())
  assert.equal(raced, true)
  assert.equal(result.status, 'active') // 활성화는 정상 진행
  const byQuest = Object.fromEntries(db.tables.jeju_quest_progress.map((p) => [p.quest_id, p]))
  assert.deepEqual([byQuest['q-b'].status, byQuest['q-b'].verification_method], ['completed', 'gps']) // 덮어쓰지 않음
  for (const id of ['q-core', 'q-a', 'q-c']) assert.equal(byQuest[id].status, 'ended_by_final_quest')
  assert.equal(db.tables.jeju_quest_progress.filter((p) => p.quest_id === 'q-b').length, 1)
  assert.equal(db.tables.jeju_adventures[0].status, 'ended_early')
})

test('A-4: 이미 완료/진행 중인 progress 는 그대로, 진행 중만 마감 (재평가해도 안전)', async () => {
  const db = setup()
  db.tables.jeju_quest_progress.push({ id: 'p1', user_id: 'u1', quest_id: 'q-a', status: 'completed', verification_method: 'self' }, { id: 'p2', user_id: 'u1', quest_id: 'q-b', status: 'in_progress' })
  await evaluate(db, makeDeps())
  await evaluate(db, makeDeps(), { now: NOW + MIN })
  const status = (id) => db.tables.jeju_quest_progress.find((p) => p.quest_id === id).status
  assert.deepEqual(['q-a', 'q-b', 'q-c', 'q-core'].map(status), ['completed', 'ended_by_final_quest', 'ended_by_final_quest', 'ended_by_final_quest'])
})

// ───────── A-5: 좌표 없는 마지막 날 챕터/후보 ─────────
test('A-5: 좌표 없는 챕터는 공항 0m 로 취급하지 않고, 좌표가 부족하면 원래 순서를 유지', () => {
  const places = new Map([['far', { lat: 33.45, lng: 126.92 }], ['near', { lat: 33.5, lng: 126.53 }]])
  const chapters = [{ id: 1, corePlaceId: 'near' }, { id: 2, corePlaceId: 'missing' }, { id: 3, corePlaceId: 'far' }]
  const ordered = orderChaptersTowardAirport(chapters, (c) => places.get(c.corePlaceId) ?? null)
  assert.deepEqual(ordered.map((c) => c.id), [1, 2, 3]) // 재정렬하지 않음 (좌표 없는 챕터가 맨 끝=공항 쪽으로 가지 않는다)
  assert.deepEqual(orderChaptersTowardAirport(chapters, (c) => ({ lat: Number.NaN, lng: 126, id: c.id })).map((c) => c.id), [1, 2, 3])
  const ok = orderChaptersTowardAirport([chapters[0], chapters[2]], (c) => places.get(c.corePlaceId))
  assert.deepEqual(ok.map((c) => c.id), [3, 1]) // 좌표가 모두 있으면 기존대로 공항 방향 정렬
})

test('A-5: 좌표 없는 후보는 정상 좌표 후보보다 앞서지 않는다', () => {
  const sorted = convergeCandidates([{ placeId: 'nocoord' }, { placeId: 'mid', lat: 33.47, lng: 126.7 }, { placeId: 'near', lat: 33.5, lng: 126.53 }], { minCount: 2 })
  assert.deepEqual(sorted.map((p) => p.placeId), ['near', 'mid', 'nocoord'])
})
