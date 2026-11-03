import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { _clearFinalQuestCache, evaluateFinalQuest } from '../api/_lib/finalQuest/service.js'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { fakeDb } from './helpers/fakeDb.js'

const MIN = 60 * 1000
const USER = { id: 'u1' }
const T = 't1'
const DEPARTURE = Date.UTC(2026, 10, 3, 9, 30)
const NOW = DEPARTURE - 90 * MIN - 30 * MIN + 10 * MIN

const deps = () => ({
  getFlightStatus: async () => ({ data: { found: true, flights: [{ flightNo: 'KE1406', scheduledDeparture: '2026-11-03 18:30', changedDeparture: '', delayed: false, cancelled: false, arrivalAirportCode: 'GMP' }] } }),
  getAirportCongestion: async () => ({ data: { current: { overall: { value: 2 } } } }),
  travelBetween: async () => ({ minutes: 30, source: 'estimate' }),
})
const quest = (id, over = {}) => ({ id, user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', difficulty: 'normal', verification_type: 'self', category_primary: 'explore', replaced_at: null, is_hidden: false, place_lat: null, place_lng: null, ...over })

function setup({ progress = [], opts = {} } = {}) {
  return fakeDb(
    {
      jeju_trips: [{ id: T, user_id: 'u1', start_date: '2026-11-01', end_date: '2026-11-03', transport: 'rental_car', departure_flight: 'KE1406', departure_datetime: new Date(DEPARTURE).toISOString(), status: 'active', travel_mode: 'quest', created_at: '2026-10-30T00:00:00.000Z' }],
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: T, status: 'active', adventure_date: '2026-11-03' }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'active' }],
      jeju_quests: [quest('q-core', { quest_type: 'core', place_lat: 33.45, place_lng: 126.5 }), quest('q-a'), quest('q-b'), quest('q-c'), quest('q-sur', { quest_type: 'surprise', surprise_status: 'accepted', chapter_id: null })],
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

const complete = (db, questId, user = USER) => completeQuest({ user, questId, payload: { method: 'self' }, db })
const activate = (db) => evaluateFinalQuest({ user: USER, tripId: T, db, deps: deps(), now: NOW })
const progressOf = (db, id) => db.tables.jeju_quest_progress.filter((p) => p.quest_id === id)
const expCount = (db, id) => db.tables.jeju_exp_logs.filter((l) => l.source_key === `quest:${id}:completion`).length
const failCommitFlag = () => {
  const flag = { on: true }
  return { flag, fail: [(table, values) => flag.on && table === 'jeju_quest_progress' && values.status === 'completed'] }
}

// ───────── Recovery Race ─────────
test('복구: claim → EXP → commit 중단 → Final Quest 활성화(모험 종료) → 같은 완료 재요청이 자신의 claim 만 completed 로 마무리, EXP 추가 지급 없음', async () => {
  const { flag, fail } = failCommitFlag()
  const db = setup({ opts: { failUpdate: fail } })
  await assert.rejects(() => complete(db, 'q-a')) // 1~3: claim, EXP 지급, completed commit 실패
  const claimId = progressOf(db, 'q-a')[0].id
  assert.equal(expCount(db, 'q-a'), 1)
  assert.deepEqual([progressOf(db, 'q-a')[0].status, progressOf(db, 'q-a')[0].verification_method], ['in_progress', 'self'])

  flag.on = false
  const state = await activate(db) // 4~5: Final Quest 활성화, 모험 종료
  assert.equal(db.tables.jeju_adventures[0].status, 'ended_early')
  assert.equal(progressOf(db, 'q-a')[0].status, 'in_progress') // claim 은 건드리지 않음
  assert.equal(state.endedCounts.optional, 2) // q-b, q-c (q-a 는 claim 이라 제외)

  const result = await complete(db, 'q-a') // 6: 같은 완료 재요청 — 모험이 종료됐어도 자신의 claim 은 마무리된다
  assert.equal(result.progress.status, 'completed')
  assert.equal(result.progress.id, claimId) // 같은 행(복구)
  assert.equal(result.rewards.quest.awarded, false) // 7: EXP 추가 지급 없음
  assert.equal(expCount(db, 'q-a'), 1)
  assert.equal(progressOf(db, 'q-a').length, 1)
  assert.equal(progressOf(db, 'q-a')[0].status, 'completed') // 8
  // 복구는 다른 퀘스트를 열어 주지 않는다
  await assert.rejects(() => complete(db, 'q-b'), (e) => e.status === 409)
  assert.equal(progressOf(db, 'q-b')[0].status, 'ended_by_final_quest')
  assert.equal(db.tables.jeju_adventures[0].status, 'ended_early')
})

test('복구: claim 과 EXP 지급 사이에서 끊겼다면(EXP 아직 없음) 복구 때 EXP 를 한 번만 지급', async () => {
  const db = setup({ progress: [{ id: 'p1', user_id: 'u1', quest_id: 'q-a', status: 'in_progress', verification_method: 'self' }] })
  await activate(db)
  const result = await complete(db, 'q-a')
  assert.deepEqual([result.progress.status, result.rewards.quest.awarded], ['completed', true])
  assert.equal(expCount(db, 'q-a'), 1)
  await assert.rejects(() => complete(db, 'q-a'), (e) => e.status === 409) // 이미 완료 + 모험 종료: 다시 완료할 수 없다
  assert.equal(expCount(db, 'q-a'), 1)
})

test('복구: 돌발 퀘스트와 gps 퀘스트도 재요청이 claim 한 방법으로 이어진다 (인증을 다시 요구하지 않음)', async () => {
  const db = setup({ progress: [{ id: 'p-s', user_id: 'u1', quest_id: 'q-sur', status: 'in_progress', verification_method: 'self' }] })
  await activate(db)
  assert.equal((await complete(db, 'q-sur')).progress.status, 'completed')
  const gpsDb = setup({ progress: [{ id: 'p-g', user_id: 'u1', quest_id: 'q-core', status: 'in_progress', verification_method: 'gps' }] })
  gpsDb.tables.jeju_quests.find((x) => x.id === 'q-core').verification_type = 'gps'
  await activate(gpsDb)
  const recovered = await completeQuest({ user: USER, questId: 'q-core', payload: {}, db: gpsDb }) // position 없이 재요청
  assert.equal(recovered.progress.verification_method, 'gps')
})

// ───────── Final-first 보호 ─────────
test('Final Quest 가 먼저 마감한 퀘스트에는 복구 예외가 적용되지 않는다 — 거절, EXP 없음, ended 유지', async () => {
  const db = setup()
  await activate(db)
  assert.equal(progressOf(db, 'q-a')[0].status, 'ended_by_final_quest')
  await assert.rejects(() => complete(db, 'q-a'), { message: 'adventure_not_active' })
  assert.equal(db.tables.jeju_exp_logs.length, 0)
  assert.equal(progressOf(db, 'q-a')[0].status, 'ended_by_final_quest')

  // 모험이 종료되고 마감 행에 verification_method 가 우연히 비어 있어도, 이미 ended 인 행은 completed 로 바뀌지 않는다
  await assert.rejects(() => complete(db, 'q-a'), (e) => e.status === 409)
  assert.equal(progressOf(db, 'q-a').length, 1)
})

test('복구 예외는 claim 하지 않은 in_progress(예: gps_photo 중간 상태)나 다른 사용자의 행에는 적용되지 않는다', async () => {
  const db = setup({ progress: [{ id: 'p-mid', user_id: 'u1', quest_id: 'q-b', status: 'in_progress', gps_verified_at: '2026-11-03T07:00:00Z' }, { id: 'p-other', user_id: 'u2', quest_id: 'q-c', status: 'in_progress', verification_method: 'self' }] })
  db.tables.jeju_adventures[0].status = 'ended_early' // 활성화 없이 종료된 모험
  await assert.rejects(() => complete(db, 'q-b'), { message: 'adventure_not_active' }) // 내 행이지만 claim 아님
  await assert.rejects(() => complete(db, 'q-c'), { message: 'adventure_not_active' }) // 내 행이 없음(다른 사용자의 claim 은 내 것이 아님)
  assert.equal(db.tables.jeju_exp_logs.length, 0)
  assert.equal(progressOf(db, 'q-c')[0].status, 'in_progress')
  assert.equal(progressOf(db, 'q-c')[0].user_id, 'u2')
})

// ───────── endedCounts 집계 ─────────
test('endedCounts: Final Quest 가 progress 를 읽은 직후 completion claim 이 끼어들어도 실제로 마감된 것만 센다', async () => {
  const db = setup()
  let raced = false
  const racing = {
    ...db,
    from: (table) => {
      const query = db.from(table)
      if (table === 'jeju_quest_progress') {
        const upsert = query.upsert.bind(query)
        query.upsert = (...args) => {
          raced = true
          // 읽은 뒤 ~ 마감 쓰기 전에 q-b 의 완료 claim 이 먼저 생긴다
          db.tables.jeju_quest_progress.push({ id: 'race-claim', user_id: 'u1', quest_id: 'q-b', status: 'in_progress', verification_method: 'self' })
          return upsert(...args)
        }
      }
      return query
    },
  }
  const state = await evaluateFinalQuest({ user: USER, tripId: T, db: racing, deps: deps(), now: NOW })
  assert.equal(raced, true)
  assert.equal(progressOf(db, 'q-b')[0].status, 'in_progress') // claim 유지
  assert.equal(progressOf(db, 'q-b')[0].verification_method, 'self')
  // q-core(core) / q-a, q-c(optional) / q-sur(surprise) 만 실제 마감 — q-b 는 시도했지만 마감되지 않았으므로 제외
  assert.deepEqual(state.endedCounts, { core: 1, optional: 2, surprise: 1, done: true })
  const ended = db.tables.jeju_quest_progress.filter((p) => p.status === 'ended_by_final_quest').map((p) => p.quest_id).sort()
  assert.deepEqual(ended, ['q-a', 'q-c', 'q-core', 'q-sur'])
})

test('endedCounts: claimed / completed 는 제외, 실제 ended 만 core·optional·surprise 별로 정확, 다시 평가해도 같은 값', async () => {
  const db = setup({ progress: [{ id: 'p1', user_id: 'u1', quest_id: 'q-a', status: 'completed', verification_method: 'self' }, { id: 'p2', user_id: 'u1', quest_id: 'q-b', status: 'in_progress', verification_method: 'self' }] })
  const first = await activate(db)
  assert.deepEqual(first.endedCounts, { core: 1, optional: 1, surprise: 1, done: true }) // q-core, q-c, q-sur
  const second = await evaluateFinalQuest({ user: USER, tripId: T, db, deps: deps(), now: NOW + 5 * MIN })
  assert.deepEqual(second.endedCounts, first.endedCounts)
  assert.equal(progressOf(db, 'q-a')[0].status, 'completed')
  assert.equal(db.tables.jeju_exp_logs.length, 0) // 마감은 EXP 에 영향 없음
})
