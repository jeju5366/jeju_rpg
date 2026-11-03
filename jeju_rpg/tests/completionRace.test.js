import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, test } from 'node:test'
import { _clearFinalQuestCache, evaluateFinalQuest } from '../api/_lib/finalQuest/service.js'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { statusBody } from '../src/services/finalQuest/payload.js'
import { requestFinalQuestState } from '../src/utils/finalQuestPosition.js'
import { fakeDb } from './helpers/fakeDb.js'

const MIN = 60 * 1000
const USER = { id: 'u1' }
const T = 't1'
const DEPARTURE = Date.UTC(2026, 10, 3, 9, 30)
const NOW = DEPARTURE - 90 * MIN - 30 * MIN + 10 * MIN // Final Quest 시작 시각

const makeDeps = () => {
  const calls = []
  return {
    calls,
    getFlightStatus: async () => ({ data: { found: true, flights: [{ flightNo: 'KE1406', scheduledDeparture: '2026-11-03 18:30', changedDeparture: '', delayed: false, cancelled: false, arrivalAirportCode: 'GMP' }] } }),
    getAirportCongestion: async () => ({ data: { current: { overall: { value: 2 } } } }),
    travelBetween: async ({ from }) => (calls.push(from), { minutes: 30, source: 'estimate' }),
  }
}

const quest = (id, over = {}) => ({ id, user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', difficulty: 'normal', verification_type: 'self', category_primary: 'explore', replaced_at: null, is_hidden: false, place_lat: null, place_lng: null, ...over })

function setup({ progress = [], opts = {} } = {}) {
  return fakeDb(
    {
      jeju_trips: [{ id: T, user_id: 'u1', start_date: '2026-11-01', end_date: '2026-11-03', transport: 'rental_car', departure_flight: 'KE1406', departure_datetime: new Date(DEPARTURE).toISOString(), status: 'active', travel_mode: 'quest', created_at: '2026-10-30T00:00:00.000Z' }],
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: T, status: 'active', adventure_date: '2026-11-03' }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'active' }],
      jeju_quests: [quest('q-core', { quest_type: 'core', place_lat: 33.45, place_lng: 126.5 }), quest('q-a'), quest('q-b'), quest('q-c')],
      jeju_quest_progress: progress,
    },
    {
      unique: { jeju_final_quests: (a, b) => a.trip_id === b.trip_id, jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id, jeju_agent_requests: (a, b) => a.user_id === b.user_id && a.request_key === b.request_key },
      defaults: { jeju_quest_progress: { photo_attempts: 0, photo_errors: 0, gps_verified_at: null, photo_verified_at: null, photo_last: null, verification_method: null } },
      ...opts,
    },
  )
}

beforeEach(() => _clearFinalQuestCache())

const complete = (db, questId) => completeQuest({ user: USER, questId, payload: { method: 'self' }, db })
const activate = (db) => evaluateFinalQuest({ user: USER, tripId: T, db, deps: makeDeps(), now: NOW })
const progressOf = (db, id) => db.tables.jeju_quest_progress.filter((p) => p.quest_id === id)
const expCount = (db, id) => db.tables.jeju_exp_logs.filter((l) => l.source_key === `quest:${id}:completion`).length
// 절대 있어서는 안 되는 상태: EXP 가 지급됐는데 progress 가 ended_by_final_quest
const noPaidButEnded = (db) => {
  for (const log of db.tables.jeju_exp_logs) {
    const id = String(log.source_key).match(/^quest:(.+):completion$/)?.[1]
    if (id) assert.ok(!progressOf(db, id).some((p) => p.status === 'ended_by_final_quest'), `${id}: EXP 지급됨 + ended_by_final_quest`)
  }
}
// 특정 호출 직전에 한 번만 끼어드는 db 래퍼
const interceptRpc = (db, name, hook) => {
  let fired = false
  return { ...db, rpc: async (rpcName, args) => (rpcName === name && !fired ? ((fired = true), await hook(), db.rpc(rpcName, args)) : db.rpc(rpcName, args)) }
}

// ───────── Race 1: 완료 claim 이 EXP 보다 먼저 → 그 사이 Final Quest 활성화 ─────────
test('Race 1: EXP 지급 직전에 Final Quest 가 활성화돼도 완료가 우선 — completed, EXP 1회, 해당 퀘스트는 마감 제외', async () => {
  const db = setup()
  let state = null
  const racing = interceptRpc(db, 'jeju_apply_exp', async () => {
    state = await activate(db) // claim 은 이미 끝났고 EXP 는 아직 지급 전
  })
  const result = await complete(racing, 'q-core')
  assert.equal(result.progress.status, 'completed')
  assert.equal(progressOf(db, 'q-core').length, 1)
  assert.equal(progressOf(db, 'q-core')[0].status, 'completed')
  assert.equal(expCount(db, 'q-core'), 1)
  assert.equal(state.status, 'active')
  assert.deepEqual([state.endedCounts.core, state.endedCounts.optional], [0, 3]) // 완료 중인 핵심은 제외하고 선택 3개만 마감
  for (const id of ['q-a', 'q-b', 'q-c']) assert.equal(progressOf(db, id)[0].status, 'ended_by_final_quest')
  noPaidButEnded(db)
})

// ───────── Race 2: Final Quest 가 먼저 ─────────
test('Race 2a: Final Quest 가 먼저 마감하면 일반 완료는 거절 — EXP 없음, ended 유지', async () => {
  const db = setup()
  await activate(db)
  await assert.rejects(() => complete(db, 'q-a'), (e) => e.status === 409)
  assert.equal(expCount(db, 'q-a'), 0)
  assert.equal(db.tables.jeju_exp_logs.length, 0)
  assert.equal(progressOf(db, 'q-a')[0].status, 'ended_by_final_quest')
})

test('Race 2b: 완료 요청이 progress 를 읽은 "뒤"에 Final Quest 가 마감해도(읽은 값은 오래됨) claim 이 막아서 EXP 없음, completed 로 덮어쓰지 않음', async () => {
  const db = setup()
  let fired = false
  const racing = {
    ...db,
    from: (table) => {
      const query = db.from(table)
      // 실제 DB 처럼 읽은 값은 "그 시점의 복사본"이다 (fake DB 는 행 참조를 돌려주므로 나중의 변경이 읽은 값에 비치지 않게 복사한다)
      const rawRead = query.maybeSingle.bind(query)
      query.maybeSingle = async () => {
        const result = await rawRead()
        return { ...result, data: result.data ? structuredClone(result.data) : result.data }
      }
      if (table === 'jeju_quest_progress') {
        const read = query.maybeSingle.bind(query)
        query.maybeSingle = async () => {
          const result = await read()
          if (!fired) {
            fired = true
            await activate(db) // 읽기 결과(진행 기록 없음)는 이미 정해졌다
          }
          return result
        }
      }
      return query
    },
  }
  await assert.rejects(() => complete(racing, 'q-a'), { message: 'quest_closed' })
  assert.equal(fired, true)
  assert.equal(db.tables.jeju_exp_logs.length, 0) // EXP 지급 없음
  assert.equal(progressOf(db, 'q-a').length, 1)
  assert.equal(progressOf(db, 'q-a')[0].status, 'ended_by_final_quest')
  noPaidButEnded(db)
})

// ───────── Race 3: EXP 지급 후 commit 전 (기존 위험 구간) ─────────
test('Race 3: EXP 는 지급됐지만 completed 저장 전에 끊긴 퀘스트는 Final Quest 가 마감하지 않는다 (EXP + ended_by_final_quest 불가)', async () => {
  let failCommit = true
  const db = setup({ opts: { failUpdate: [(table, values) => failCommit && table === 'jeju_quest_progress' && values.status === 'completed'] } })
  await assert.rejects(() => complete(db, 'q-a')) // claim → EXP 지급 → commit 실패
  assert.equal(expCount(db, 'q-a'), 1)
  assert.deepEqual([progressOf(db, 'q-a')[0].status, progressOf(db, 'q-a')[0].verification_method], ['in_progress', 'self']) // claim 만 남음

  failCommit = false
  const state = await activate(db) // 이 틈에 Final Quest 활성화
  assert.equal(progressOf(db, 'q-a')[0].status, 'in_progress') // 마감되지 않음
  assert.deepEqual([state.endedCounts.core, state.endedCounts.optional], [1, 2]) // 나머지 core + optional 2개만
  noPaidButEnded(db)
})

test('Race 3b: commit 전에 끊긴 뒤 Final Quest 활성화 전이라면 같은 요청을 다시 보내 이어서 완료 (EXP 이중 지급 없음)', async () => {
  let failCommit = true
  const db = setup({ opts: { failUpdate: [(table, values) => failCommit && table === 'jeju_quest_progress' && values.status === 'completed'] } })
  await assert.rejects(() => complete(db, 'q-a'))
  failCommit = false
  const retry = await complete(db, 'q-a')
  assert.equal(retry.progress.status, 'completed')
  assert.equal(expCount(db, 'q-a'), 1)
  assert.equal(retry.rewards.quest.awarded, false) // 이미 지급된 EXP 는 다시 지급하지 않는다
  assert.equal(progressOf(db, 'q-a').length, 1)
})

// ───────── Race 4: 같은 퀘스트 동시 완료 ─────────
test('Race 4: 같은 퀘스트 완료 요청 여러 개가 동시에 와도 EXP 1회, 완료 기록 1개', async () => {
  const db = setup()
  const results = await Promise.allSettled([complete(db, 'q-a'), complete(db, 'q-a'), complete(db, 'q-a')])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.message, 'already_completed')
  assert.equal(expCount(db, 'q-a'), 1)
  assert.equal(progressOf(db, 'q-a').length, 1)
  assert.equal(progressOf(db, 'q-a')[0].status, 'completed')
})

// ───────── Race 5: 활성화 배치 ─────────
test('Race 5: 활성화 배치에서 완료 claim 된 퀘스트만 제외하고 나머지는 모두 ended_by_final_quest', async () => {
  const db = setup({ progress: [{ id: 'p-claim', user_id: 'u1', quest_id: 'q-b', status: 'in_progress', verification_method: 'self' }, { id: 'p-done', user_id: 'u1', quest_id: 'q-c', status: 'completed', verification_method: 'self' }] })
  const state = await activate(db)
  assert.equal(state.status, 'active')
  assert.equal(progressOf(db, 'q-b')[0].status, 'in_progress') // 완료 진행 중
  assert.equal(progressOf(db, 'q-c')[0].status, 'completed') // 이미 완료
  for (const id of ['q-core', 'q-a']) assert.equal(progressOf(db, id)[0].status, 'ended_by_final_quest')
  assert.deepEqual([state.endedCounts.core, state.endedCounts.optional], [1, 1])
  assert.equal(db.tables.jeju_adventures[0].status, 'ended_early')
})

test('회귀: 평소 완료(핵심 → 챕터 core_completed, 선택, 재요청 거절)와 Final Quest 이후 상태가 그대로', async () => {
  const db = setup()
  const core = await complete(db, 'q-core')
  assert.deepEqual([core.progress.status, core.chapterStatus, core.rewards.quest.awarded], ['completed', 'core_completed', true])
  const optional = await complete(db, 'q-a')
  assert.equal(optional.progress.verification_method, 'self')
  await assert.rejects(() => complete(db, 'q-a'), { message: 'already_completed' })
  assert.equal(expCount(db, 'q-a'), 1)
  const state = await activate(db)
  assert.deepEqual([state.endedCounts.core, state.endedCounts.optional], [0, 2]) // 완료한 둘은 제외
  assert.equal(progressOf(db, 'q-core')[0].status, 'completed')
})

// ───────── Final Quest 현재 위치: 실제 호출 경로 ─────────
const GPS = (now, ageMs = 30 * 1000) => ({ lat: 33.3, lng: 126.6, accuracy: 20, timestamp: now - ageMs })

test('호출 경로: requestFinalQuestState → fetchState 인자에 최근 GPS position 이 실린다 (stale 이면 null, 실패해도 null)', async () => {
  const sent = []
  const fetchState = async (tripId, options) => (sent.push({ tripId, ...options }), { status: 'none' })
  const base = { tripId: T, fetchState, getPermission: async () => 'granted' }
  const nowMs = Date.now()
  let asked = 0
  const getPosition = async () => (asked++, GPS(Date.now(), 1000))

  await requestFinalQuestState({ ...base, stored: GPS(nowMs), getPosition, now: nowMs }) // 최신 → 그대로
  assert.deepEqual(sent[0].position, GPS(nowMs))
  assert.equal(asked, 0) // GPS 를 다시 요청하지 않았다

  await requestFinalQuestState({ ...base, stored: GPS(nowMs, 10 * MIN), getPosition, now: nowMs }) // stale → 새로 한 번
  assert.equal(asked, 1)
  assert.ok(sent[1].position && sent[1].position.timestamp > nowMs - 5000)

  await requestFinalQuestState({ ...base, stored: GPS(nowMs, 10 * MIN), getPosition, getPermission: async () => 'prompt', now: nowMs }) // 권한 창을 띄우지 않는다
  assert.equal(sent[2].position, null)
  assert.equal(asked, 1)

  await requestFinalQuestState({ ...base, stored: null, getPosition: async () => { throw new Error('denied') }, now: nowMs }) // 실패 → null
  assert.equal(sent[3].position, null)
})

test('실제 요청 body(JSON)에 position 이 들어가고, 서버가 그 위치로 이동시간을 계산해 safe.travelOrigin === gps', async () => {
  let body = null
  const fetchState = async (tripId, options) => {
    body = JSON.parse(JSON.stringify(statusBody(tripId, options))) // API 로 나가는 payload (JSON 직렬화 포함)
    return {}
  }
  await requestFinalQuestState({ tripId: T, stored: GPS(NOW), getPermission: async () => 'denied', getPosition: async () => null, fetchState, now: NOW })
  assert.deepEqual(body.position, GPS(NOW))
  assert.equal(body.action, 'status')

  // api/final-quest.js 와 같은 방식으로 body.position 을 서버 평가에 넘긴다
  const db = setup()
  const deps = makeDeps()
  const result = await evaluateFinalQuest({ user: USER, tripId: body.tripId, position: body.position ?? null, refresh: body.refresh === true, db, deps, now: NOW })
  assert.equal(result.safe.travelOrigin, 'gps')
  assert.deepEqual(deps.calls[0], { lat: 33.3, lng: 126.6 })
})

test('position 이 null 이면 챕터 anchor → 60분 fallback 으로 그대로 동작', async () => {
  const deps = makeDeps()
  const result = await evaluateFinalQuest({ user: USER, tripId: T, position: null, db: setup(), deps, now: NOW })
  assert.equal(result.safe.travelOrigin, 'anchor')
  _clearFinalQuestCache()
  const noAnchor = setup()
  noAnchor.tables.jeju_adventures[0].status = 'proposed'
  const fallback = await evaluateFinalQuest({ user: USER, tripId: T, position: null, db: noAnchor, deps: makeDeps(), now: NOW })
  assert.deepEqual([fallback.safe.travelOrigin, fallback.safe.travelMinutes], ['fallback', 60])
})

test('연결 확인: 훅이 requestFinalQuestState 로만 서버를 부르고, 서비스가 position body 를 보내며, API 가 position 을 평가에 넘긴다', () => {
  const read = (file) => readFileSync(file, 'utf8')
  const hook = read('src/components/finalQuest/useFinalQuest.js')
  assert.match(hook, /requestFinalQuestState\(\{[\s\S]*stored: useLocationStore\.getState\(\)\.position[\s\S]*fetchState: fetchFinalQuestState/)
  assert.doesNotMatch(hook, /await fetchFinalQuestState\(/) // 위치 없이 직접 부르는 경로가 없다
  const service = read('src/services/finalQuest/finalQuestService.js')
  assert.match(service, /apiPost\('final-quest', statusBody\(tripId, \{ refresh, position \}\)\)/)
  assert.match(read('api/final-quest.js'), /evaluateFinalQuest\(\{ \.\.\.common, position: body\.position \?\? null/)
})
