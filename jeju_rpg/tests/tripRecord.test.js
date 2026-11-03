import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tripFeedbackAdjustments } from '../api/_lib/agent/context.js'
import { buildTripRecord, listPastTrips } from '../api/_lib/finalQuest/record.js'
import { saveTripFeedback } from '../api/_lib/finalQuest/service.js'
import { checkTitleUnlocks, tempTitleCodes } from '../api/_lib/progression/titles.js'
import { JEJU_AIRPORT } from '../src/constants/jeju.js'
import { convergeCandidates, distanceToAirport, fitToAirportReach, orderChaptersTowardAirport } from '../src/utils/lastDay.js'
import { fakeDb } from './helpers/fakeDb.js'

const USER = { id: 'u1' }
const T1 = 't1'
const T2 = 't2'

// ───────── 마지막 날 모험: 공항 수렴 ─────────
const place = (id, lat, lng) => ({ placeId: id, lat, lng })
const EAST = place('east', 33.45, 126.92) // 공항에서 멀다 (약 38km)
const MID = place('mid', 33.47, 126.7)
const NEAR = place('near', 33.5, 126.53)
const DEEP = place('deep', 33.25, 126.56) // 서귀포 남쪽 (공항에서 약 29km)

test('마지막 날 후보: 공항에 가까운 순으로 정렬', () => {
  const sorted = convergeCandidates([EAST, NEAR, MID], { minCount: 3 })
  assert.deepEqual(sorted.map((p) => p.placeId), ['near', 'mid', 'east'])
})

test('마지막 날 후보: 공항 반대 방향으로 깊이 들어가는 후보는 빠진다 (출발점보다 멀고 40km 초과)', () => {
  const far = place('far', 33.25, 126.95) // 공항에서 50km 이상
  const origin = NEAR // 공항 바로 근처에서 출발
  const result = convergeCandidates([far, MID, NEAR, DEEP], { origin, minCount: 3 })
  assert.ok(!result.some((p) => p.placeId === 'far'))
  assert.equal(result.length, 3)
})

test('마지막 날 후보: 필터 후 후보가 부족하면 필터 없이 돌려준다 (모험 생성이 막히지 않게)', () => {
  const far1 = place('f1', 33.2, 127.0)
  const far2 = place('f2', 33.2, 127.05)
  const result = convergeCandidates([far1, far2, NEAR], { origin: NEAR, minCount: 3 })
  assert.equal(result.length, 3)
})

test('챕터 순서: 갈수록 공항에 가까워진다 (먼 곳부터)', () => {
  const chapters = [{ id: 1, corePlaceId: 'near' }, { id: 2, corePlaceId: 'east' }, { id: 3, corePlaceId: 'mid' }]
  const byId = new Map([EAST, MID, NEAR].map((p) => [p.placeId, p]))
  const ordered = orderChaptersTowardAirport(chapters, (c) => byId.get(c.corePlaceId))
  assert.deepEqual(ordered.map((c) => c.id), [2, 3, 1])
  const distances = ordered.map((c) => distanceToAirport(byId.get(c.corePlaceId)))
  assert.deepEqual(distances, [...distances].sort((a, b) => b - a))
  assert.ok(distanceToAirport(JEJU_AIRPORT) === 0)
})

test('마지막 챕터 → 공항 60분 이하면 그대로, 넘으면 최소 챕터 수까지 일정 단축', () => {
  const chapters = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  assert.deepEqual(fitToAirportReach(chapters, { lastTravelMinutes: 45 }), { chapters, shortened: false, lastTravelMinutes: 45 })
  assert.equal(fitToAirportReach(chapters, { lastTravelMinutes: 60 }).shortened, false) // 60분은 허용
  const cut = fitToAirportReach(chapters, { lastTravelMinutes: 75, minChapters: 2 })
  assert.deepEqual([cut.shortened, cut.chapters.map((c) => c.id)], [true, [3, 4]]) // 공항 쪽 챕터만 남김
  assert.equal(fitToAirportReach(chapters, { lastTravelMinutes: null }).shortened, false) // 이동시간을 모르면 그대로 (추측 안 함)
  assert.equal(fitToAirportReach([{ id: 1 }, { id: 2 }], { lastTravelMinutes: 90, minChapters: 2 }).shortened, false)
})

// ───────── 칭호 ─────────
test('임시 칭호 조건: 첫 여행은 항상, 나머지는 통계 임계값', () => {
  assert.deepEqual(tempTitleCodes({}), ['trip_first_complete'])
  assert.deepEqual(tempTitleCodes({ completedQuests: 10, discoveries: 3, categoryQuests: { explore: 3, food: 3 } }).sort(), ['trip_discoverer', 'trip_explorer', 'trip_first_complete', 'trip_foodie', 'trip_quest_master'])
  assert.deepEqual(tempTitleCodes({ completedQuests: 9, discoveries: 2, categoryQuests: { explore: 2, food: 2 } }), ['trip_first_complete'])
})

test('칭호 해금: 새로 얻은 칭호만 반환, 이미 가진 건 다시 주지 않음, 자동 장착 없음', async () => {
  const db = fakeDb({ jeju_titles: [{ id: 'a', code: 'trip_first_complete', name: '제주 첫 모험 완료' }, { id: 'b', code: 'trip_foodie', name: '미식 여행자' }], jeju_user_titles: [] })
  const stats = { completedQuests: 1, categoryQuests: { food: 3 } }
  const first = await checkTitleUnlocks(db, { userId: 'u1', trigger: 'trip_completed', data: { tripId: T1, stats } })
  assert.deepEqual(first.map((t) => t.code).sort(), ['trip_first_complete', 'trip_foodie'])
  assert.equal(db.tables.jeju_user_titles.length, 2)
  assert.equal(db.tables.jeju_user_titles[0].trip_id, T1)
  assert.deepEqual(await checkTitleUnlocks(db, { userId: 'u1', trigger: 'trip_completed', data: { tripId: T2, stats } }), [])
  assert.deepEqual(await checkTitleUnlocks(db, { userId: 'u1', trigger: 'level_reached', data: {} }), []) // 다른 trigger 는 아직 해금 없음
  assert.equal(db.tables.jeju_profiles[0].current_title, undefined)
})

// ───────── 피드백 ─────────
function feedbackDb() {
  return fakeDb(
    { jeju_trips: [{ id: T1, user_id: 'u1' }], jeju_feedback: [] },
    { unique: { jeju_feedback: (a, b) => a.user_id === b.user_id && a.trip_id === b.trip_id && !a.quest_id && !a.adventure_id && !b.quest_id && !b.adventure_id } },
  )
}

test('여행 피드백 저장: 별점/밀도/장소/난이도/한 줄 코멘트, 다시 저장하면 한 건을 덮어쓴다', async () => {
  const db = feedbackDb()
  const { feedback } = await saveTripFeedback({ user: USER, tripId: T1, rating: 4, density: 'tight', placesRating: 'good', difficulty: 'hard', comment: '  재밌었어요  ', db })
  assert.deepEqual([feedback.rating, feedback.density, feedback.places_rating, feedback.difficulty, feedback.comment], [4, 'tight', 'good', 'hard', '재밌었어요'])
  await saveTripFeedback({ user: USER, tripId: T1, rating: 5, density: 'fair', db })
  assert.equal(db.tables.jeju_feedback.length, 1)
  assert.equal(db.tables.jeju_feedback[0].rating, 5)
  assert.equal(db.tables.jeju_feedback[0].density, 'fair')
})

test('여행 피드백 검증: 범위 밖 값/남의 여행/긴 코멘트', async () => {
  const db = feedbackDb()
  await assert.rejects(() => saveTripFeedback({ user: USER, tripId: T1, rating: 6, db }), { message: 'rating_invalid' })
  await assert.rejects(() => saveTripFeedback({ user: USER, tripId: T1, rating: 0, db }), { message: 'rating_invalid' })
  await assert.rejects(() => saveTripFeedback({ user: USER, tripId: T1, density: 'crazy', db }), { message: 'density_invalid' })
  await assert.rejects(() => saveTripFeedback({ user: USER, tripId: T1, placesRating: 'meh', db }), { message: 'places_invalid' })
  await assert.rejects(() => saveTripFeedback({ user: USER, tripId: T1, difficulty: 'x', db }), { message: 'difficulty_invalid' })
  await assert.rejects(() => saveTripFeedback({ user: { id: 'other' }, tripId: T1, rating: 3, db }), { message: 'trip_not_found' })
  const long = await saveTripFeedback({ user: USER, tripId: T1, comment: 'ㅋ'.repeat(500), db })
  assert.equal(long.feedback.comment.length, 200)
})

test('다음 여행 Agent context: 빡빡했다/장소 별로/어려웠다 → 코드가 정한 조정 지시', () => {
  assert.deepEqual(tripFeedbackAdjustments(null), [])
  assert.deepEqual(tripFeedbackAdjustments({ density: 'fair', places_rating: 'ok', difficulty: 'fair' }), [])
  const adjustments = tripFeedbackAdjustments({ density: 'tight', places_rating: 'bad', difficulty: 'hard' })
  assert.equal(adjustments.length, 3)
  assert.match(adjustments[0], /밀도를 낮추고/)
  assert.match(adjustments[1], /장소/)
  assert.match(adjustments[2], /난이도를 낮춰/)
  assert.match(tripFeedbackAdjustments({ difficulty: 'easy' })[0], /올려도/)
})

// ───────── 기록 / 지난 여행 ─────────
function recordDb() {
  return fakeDb({
    jeju_trips: [
      { id: T1, user_id: 'u1', start_date: '2026-10-01', end_date: '2026-10-03', status: 'completed', completed_at: '2026-10-03T10:00:00Z', created_at: '2026-09-20T00:00:00Z', retrospective: '좋은 여행', retrospective_source: 'stats' },
      { id: T2, user_id: 'u1', start_date: '2026-11-01', end_date: '2026-11-03', status: 'completed', completed_at: '2026-11-03T10:00:00Z', created_at: '2026-10-20T00:00:00Z' },
      { id: 't3', user_id: 'u1', start_date: '2026-12-01', end_date: '2026-12-03', status: 'active', created_at: '2026-11-20T00:00:00Z' },
      { id: 'tx', user_id: 'other', start_date: '2026-11-01', end_date: '2026-11-03', status: 'completed', completed_at: '2026-11-03T10:00:00Z', created_at: '2026-10-20T00:00:00Z' },
    ],
    jeju_adventures: [{ id: 'a1', user_id: 'u1', trip_id: T1, status: 'completed' }, { id: 'a2', user_id: 'u1', trip_id: T2, status: 'ended_early' }],
    jeju_quests: [
      { id: 'k1', user_id: 'u1', adventure_id: 'a1', quest_type: 'core', replaced_at: null, category_primary: 'food' },
      { id: 'k2', user_id: 'u1', adventure_id: 'a2', quest_type: 'core', replaced_at: null, category_primary: 'explore' },
      { id: 'k3', user_id: 'u1', adventure_id: 'a2', quest_type: 'surprise', replaced_at: null, surprise_status: 'accepted', title: '돌발' },
      { id: 'k4', user_id: 'u1', adventure_id: 'a2', quest_type: 'surprise', replaced_at: null, surprise_status: 'declined', title: '돌발2' },
    ],
    jeju_quest_progress: [
      { user_id: 'u1', quest_id: 'k1', status: 'completed' },
      { user_id: 'u1', quest_id: 'k2', status: 'completed' },
      { user_id: 'u1', quest_id: 'k3', status: 'ended_by_final_quest' },
    ],
    jeju_place_visits: [
      { user_id: 'u1', trip_id: T1, place_id: 'p1', place_name: '첫 여행 장소', visited_at: '2026-10-01T01:00:00Z' },
      { user_id: 'u1', trip_id: T2, place_id: 'p2', place_name: '둘째 여행 장소', visited_at: '2026-11-01T01:00:00Z' },
    ],
    jeju_place_discoveries: [{ user_id: 'u1', place_id: 'p2', place_name: '둘째 여행 장소', discovery_type: 'normal', discovered_at: '2026-11-01T01:00:00Z' }, { user_id: 'u1', place_id: 'p1', place_name: '첫 여행 장소', discovery_type: 'normal', discovered_at: '2026-10-01T01:00:00Z' }],
    jeju_feedback: [{ id: 'f1', user_id: 'u1', trip_id: T2, rating: 4, density: 'tight', places_rating: 'good', difficulty: 'fair', comment: '굿' }],
    jeju_agent_requests: [{ user_id: 'u1', trip_id: T2, request_type: 'REPLAN_ADVENTURE', status: 'success', created_at: '2026-11-02T05:00:00Z', response_payload: { reason: 'SCHEDULE_DELAY' } }],
    jeju_exp_logs: [
      { user_id: 'u1', category: 'food', amount: 40, created_at: '2026-10-01T02:00:00Z' },
      { user_id: 'u1', category: 'explore', amount: 30, created_at: '2026-11-01T02:00:00Z' },
      { user_id: 'u1', category: null, amount: 100, created_at: '2026-11-03T09:00:00Z' },
    ],
  })
}

test('지난 여행 목록: 완료된 여행만, 최근 순, 다른 사용자 여행/진행 중 여행 제외', async () => {
  const trips = await listPastTrips(recordDb(), { userId: 'u1' })
  assert.deepEqual(trips.map((t) => t.id), [T2, T1])
  assert.equal(trips[0].days, 3)
})

test('여행 상세 기록: 여행별로 분리되어 조립된다 (다른 여행 방문/발견/EXP 가 섞이지 않음)', async () => {
  const db = recordDb()
  const one = await buildTripRecord(db, { userId: 'u1', tripId: T1 })
  const two = await buildTripRecord(db, { userId: 'u1', tripId: T2 })
  assert.deepEqual(one.places.map((p) => p.name), ['첫 여행 장소'])
  assert.deepEqual(two.places.map((p) => p.name), ['둘째 여행 장소'])
  assert.equal(one.stats.totalExp, 40)
  assert.equal(two.stats.totalExp, 130) // 둘째 여행 기간 EXP: 30 + 자유 100
  assert.equal(one.trip.retrospective, '좋은 여행')
  assert.equal(one.feedback, null)
  assert.deepEqual(two.feedback, { rating: 4, density: 'tight', placesRating: 'good', difficulty: 'fair', comment: '굿' })
})

test('여행 상세 기록: 퀘스트 종류별 수 / 돌발 수락·거절 / REPLAN 기록 / 여행 종료로 마감된 퀘스트', async () => {
  const two = await buildTripRecord(recordDb(), { userId: 'u1', tripId: T2 })
  assert.deepEqual([two.stats.core, two.stats.optional, two.stats.surprise, two.stats.completedQuests], [1, 0, 0, 1])
  assert.equal(two.stats.endedByFinalQuest, 1)
  assert.deepEqual([two.surpriseLog.accepted, two.surpriseLog.declined], [1, 1])
  assert.equal(two.replanLog.length, 1)
  assert.equal(two.replanLog[0].reason, 'SCHEDULE_DELAY')
  assert.equal(two.stats.discoveries, 1)
  assert.deepEqual(two.exp.levelChanges.map((c) => c.category), ['explore'])
})

test('다른 사용자의 여행 기록은 읽을 수 없다', async () => {
  await assert.rejects(() => buildTripRecord(recordDb(), { userId: 'u1', tripId: 'tx' }), { message: 'trip_not_found' })
})
