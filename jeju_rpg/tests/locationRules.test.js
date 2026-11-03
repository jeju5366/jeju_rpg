import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FREE_VISIT_DWELL_MINUTES,
  GPS_MAX_ACCURACY_METERS,
  MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS,
  ROUTE_MIN_INTERVAL_MS,
} from '../src/constants/locationRules.js'
import { evaluateGpsProof } from '../src/utils/gps.js'
import { judgeCandidateVisit, judgeManualVisit } from '../src/utils/freeTravel/routeAnalysis.js'
import { collectRemainingPlan, evaluateReturn } from '../src/utils/freeTravel/returnCheck.js'
import { shouldFetchNearby } from '../src/utils/freeTravel/nearbyPolicy.js'
import { applyTick, createTracking } from '../src/utils/freeTravel/tracker.js'

const MIN = 60 * 1000
const NOW = Date.UTC(2026, 10, 3, 3, 0, 0) // KST 12:00
// 위도 1도 ≈ 111.2km → 0.001도 ≈ 111m
const at = (lat, lng) => ({ lat, lng })
const SEHWA = { placeId: 'p-sehwa', name: '세화해변', contentTypeId: 12, lat: 33.5240, lng: 126.8600 }
const DONGMUN = { placeId: 'p-dongmun', name: '동문시장', contentTypeId: 38, lat: 33.5122, lng: 126.5278 }

// ───────── GPS 퀘스트 인증 ─────────
test('GPS: 반경 안 + 정확도 충분 → 성공', () => {
  const r = evaluateGpsProof({ position: { ...at(33.5001, 126.5301), accuracy: 20, timestamp: NOW - 5000 }, target: at(33.5, 126.53), now: NOW })
  assert.equal(r.ok, true)
  assert.ok(r.distanceMeters < 150)
})

test('GPS: 반경 밖 → gps_too_far', () => {
  const r = evaluateGpsProof({ position: { ...at(33.505, 126.53), accuracy: 20, timestamp: NOW }, target: at(33.5, 126.53), now: NOW })
  assert.deepEqual([r.ok, r.code], [false, 'gps_too_far'])
})

test('GPS: 정확도가 낮으면 실패가 아니라 다시 확인(gps_accuracy_low)', () => {
  const r = evaluateGpsProof({ position: { ...at(33.5, 126.53), accuracy: GPS_MAX_ACCURACY_METERS + 1, timestamp: NOW }, target: at(33.5, 126.53), now: NOW })
  assert.deepEqual([r.ok, r.code], [false, 'gps_accuracy_low'])
})

test('GPS: 오래된 위치/잘못된 값은 거절', () => {
  const old = evaluateGpsProof({ position: { ...at(33.5, 126.53), accuracy: 10, timestamp: NOW - 10 * MIN }, target: at(33.5, 126.53), now: NOW })
  assert.equal(old.code, 'gps_position_stale')
  const bad = evaluateGpsProof({ position: { lat: 'x', lng: 1 }, target: at(33.5, 126.53), now: NOW })
  assert.equal(bad.code, 'gps_position_invalid')
})

// ───────── 방문 후보 감지 ─────────
function drive(ticks, places) {
  let tracking = createTracking()
  const found = []
  for (const tick of ticks) {
    const result = applyTick(tracking, { accuracy: 15, ...tick }, places)
    tracking = result.tracking
    found.push(...result.newCandidates)
  }
  return { tracking, found }
}

test('후보: 장소 근처에서 5분 이상 머물면 방문 후보 1건', () => {
  const ticks = []
  for (let m = 0; m <= FREE_VISIT_DWELL_MINUTES + 1; m += 1) ticks.push({ ...at(33.5241, 126.8601), timestamp: NOW + m * MIN })
  const { found, tracking } = drive(ticks, [SEHWA])
  assert.equal(found.length, 1)
  assert.equal(found[0].placeId, 'p-sehwa')
  assert.equal(Object.keys(tracking.candidates).length, 1)
})

test('후보: 같은 장소는 계속 머물러도 후보가 반복 생성되지 않음(dedupe)', () => {
  const ticks = []
  for (let m = 0; m <= 30; m += 1) ticks.push({ ...at(33.5241, 126.8601), timestamp: NOW + m * MIN })
  assert.equal(drive(ticks, [SEHWA]).found.length, 1)
})

test('후보: 차로 지나가기만 한 장소는 후보 제외', () => {
  // 장소 앞을 30초 만에 통과 (반경 안에 머무는 시간 < 5분)
  const ticks = [
    { ...at(33.5200, 126.8600), timestamp: NOW },
    { ...at(33.5240, 126.8600), timestamp: NOW + 30 * 1000 },
    { ...at(33.5280, 126.8600), timestamp: NOW + 60 * 1000 },
    { ...at(33.5400, 126.8600), timestamp: NOW + 2 * MIN },
  ]
  assert.equal(drive(ticks, [SEHWA]).found.length, 0)
})

test('후보: 위치 갱신이 오래 끊기면 그 사이를 머문 것으로 보지 않음', () => {
  const ticks = [
    { ...at(33.5241, 126.8601), timestamp: NOW },
    { ...at(33.5241, 126.8601), timestamp: NOW + 40 * MIN }, // 40분 공백 후 재개
    { ...at(33.5241, 126.8601), timestamp: NOW + 41 * MIN },
  ]
  assert.equal(drive(ticks, [SEHWA]).found.length, 0)
})

test('후보: 정확도가 나쁜 위치는 무시, 의미 없는 장소 유형(숙박 등)은 후보 제외', () => {
  const noisy = applyTick(createTracking(), { ...at(33.5241, 126.8601), accuracy: 500, timestamp: NOW }, [SEHWA])
  assert.equal(noisy.ignored, true)
  assert.equal(noisy.tracking.route.length, 0)
  const lodging = { ...SEHWA, placeId: 'p-hotel', contentTypeId: 32 }
  const ticks = []
  for (let m = 0; m <= 8; m += 1) ticks.push({ ...at(33.5241, 126.8601), timestamp: NOW + m * MIN })
  assert.equal(drive(ticks, [lodging]).found.length, 0)
})

test('경로: 가만히 있으면 시간 간격으로만 포인트가 쌓이고, 이동하면 거리 기준으로 쌓임', () => {
  const still = []
  for (let s = 0; s < 120; s += 5) still.push({ ...at(33.5, 126.5), timestamp: NOW + s * 1000 }) // 2분 동안 5초마다
  const a = drive(still, [])
  assert.ok(a.tracking.route.length <= 3, `포인트 ${a.tracking.route.length}개`)
  const moving = []
  for (let i = 0; i < 10; i += 1) moving.push({ ...at(33.5 + i * 0.002, 126.5), timestamp: NOW + i * 5000 }) // ≈220m 씩
  assert.equal(drive(moving, []).tracking.route.length, 10)
  assert.ok(ROUTE_MIN_INTERVAL_MS >= 30000)
})

// ───────── 서버 방문 검증 (경로) ─────────
const routeNear = (center, minutes) => Array.from({ length: minutes + 1 }, (_, m) => ({ ...center, t: NOW + m * MIN }))

test('후보 검증: 경로상 5분 체류가 확인되면 gps 근거', () => {
  const r = judgeCandidateVisit(SEHWA, routeNear(at(33.5241, 126.8601), 6))
  assert.equal(r.ok, true)
  assert.equal(r.evidence, 'gps')
})

test('후보 검증: 경로에 체류 근거가 없으면 거절(위조 방지)', () => {
  const r = judgeCandidateVisit(SEHWA, routeNear(at(33.4, 126.3), 20))
  assert.equal(r.ok, false)
})

test('수동 방문: 경로 근처 장소 → 등록 성공 + 발견 근거(route)', () => {
  // 제주시 → 애월 → 한림 경로, 협재해변(33.394, 126.2394)
  const route = [
    { lat: 33.5, lng: 126.53, t: NOW },
    { lat: 33.46, lng: 126.33, t: NOW + 20 * MIN },
    { lat: 33.41, lng: 126.26, t: NOW + 40 * MIN },
  ]
  const r = judgeManualVisit({ lat: 33.394, lng: 126.2394 }, route)
  assert.equal(r.ok, true)
  assert.equal(r.evidence, 'route')
  assert.ok(r.distanceMeters <= MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS)
})

test('수동 방문: 경로와 터무니없이 먼 장소(성산일출봉) → 등록 제한', () => {
  const route = [
    { lat: 33.5, lng: 126.53, t: NOW },
    { lat: 33.46, lng: 126.33, t: NOW + 20 * MIN },
    { lat: 33.41, lng: 126.26, t: NOW + 40 * MIN },
  ]
  const r = judgeManualVisit({ lat: 33.458, lng: 126.9425 }, route)
  assert.deepEqual([r.ok, r.code], [false, 'too_far_from_route'])
})

test('수동 방문: GPS 경로가 없으면 방문 저장은 허용하되 발견 근거 없음(none)', () => {
  const r = judgeManualVisit({ lat: 33.458, lng: 126.9425 }, [])
  assert.deepEqual([r.ok, r.evidence], [true, 'none'])
  const few = judgeManualVisit({ lat: 33.458, lng: 126.9425 }, [{ lat: 33.5, lng: 126.5, t: NOW }])
  assert.equal(few.evidence, 'none')
})

// ───────── 주변 장소 조회 정책 ─────────
test('주변 장소: 처음엔 조회, 가까운 이동/짧은 시간에는 재조회하지 않고, 멀리 이동하면 조회', () => {
  const center = at(33.5, 126.5)
  assert.equal(shouldFetchNearby(null, center, NOW), true)
  const cache = { center, fetchedAt: NOW }
  assert.equal(shouldFetchNearby(cache, at(33.501, 126.5), NOW + 10 * MIN), false) // 110m 이동, TTL 전
  assert.equal(shouldFetchNearby(cache, at(33.52, 126.5), NOW + 1 * MIN), false) // 멀리 가도 최소 간격 전엔 안 부른다
  assert.equal(shouldFetchNearby(cache, at(33.52, 126.5), NOW + 3 * MIN), true) // 2.2km 이동 + 간격 경과
  assert.equal(shouldFetchNearby(cache, center, NOW + 16 * MIN), true) // 캐시 만료
  assert.equal(shouldFetchNearby({ ...cache, fetching: true }, at(33.52, 126.5), NOW + 30 * MIN), false)
  assert.equal(shouldFetchNearby({ ...cache, failedAt: NOW + 29 * MIN }, at(33.52, 126.5), NOW + 30 * MIN), false) // 실패 직후엔 쉰다
})

// ───────── 복귀 판정 ─────────
const chapters = [
  { id: 'c1', seq: 1, status: 'active' },
  { id: 'c2', seq: 2, status: 'locked' },
]
const quests = [
  { chapter_id: 'c1', quest_type: 'core', place_id: 'p-a', place_name: 'A', place_lat: 33.5, place_lng: 126.5 },
  { chapter_id: 'c2', quest_type: 'core', place_id: 'p-b', place_name: 'B', place_lat: 33.51, place_lng: 126.52 },
]

test('복귀: 일정과 크게 어긋나지 않으면 GPT 없이 그대로 복귀(needsReplan=false)', () => {
  const plan = collectRemainingPlan({ chapters, quests })
  const r = evaluateReturn({ now: NOW, position: at(33.502, 126.505), desiredEndTime: '20:00:00', accommodation: at(33.5, 126.52), freeStartedAt: NOW - 40 * MIN, visitedPlaceIds: ['p-other'], ...plan })
  assert.equal(r.needsReplan, false, JSON.stringify(r))
})

test('복귀: 다음 장소에서 크게 멀어지면 재계획 제안', () => {
  const plan = collectRemainingPlan({ chapters, quests })
  const r = evaluateReturn({ now: NOW, position: at(33.25, 126.56), desiredEndTime: '20:00:00', accommodation: null, freeStartedAt: NOW - 40 * MIN, ...plan })
  assert.ok(r.reasons.includes('far_from_plan'))
  assert.equal(r.needsReplan, true)
})

test('복귀: 예정 장소를 먼저 방문했거나 종료 시간에 안 맞으면 재계획 제안', () => {
  const plan = collectRemainingPlan({ chapters, quests })
  assert.ok(evaluateReturn({ now: NOW, position: at(33.5, 126.5), freeStartedAt: NOW - MIN, visitedPlaceIds: ['p-b'], ...plan }).reasons.includes('planned_place_visited'))
  assert.ok(evaluateReturn({ now: NOW, position: at(33.5, 126.5), desiredEndTime: '13:00', freeStartedAt: NOW - MIN, ...plan }).reasons.includes('end_time_conflict'))
})

test('복귀: 남은 챕터가 없으면 조정할 것이 없음', () => {
  const r = evaluateReturn({ now: NOW, position: at(33.1, 126.1), desiredEndTime: '13:00', remainingChapters: 0, stops: [], freeStartedAt: NOW - 500 * MIN })
  assert.equal(r.needsReplan, false)
})

test('복귀: 닫힌 챕터(completed/skipped)와 완료된 핵심 장소는 남은 일정에서 빠짐', () => {
  const plan = collectRemainingPlan({
    chapters: [{ id: 'c1', seq: 1, status: 'completed' }, { id: 'c2', seq: 2, status: 'skipped' }, { id: 'c3', seq: 3, status: 'core_completed' }, { id: 'c4', seq: 4, status: 'active' }],
    quests: [{ chapter_id: 'c4', quest_type: 'core', place_id: 'p-z', place_name: 'Z', place_lat: 33.4, place_lng: 126.4 }],
  })
  assert.equal(plan.remainingChapters, 2)
  assert.deepEqual(plan.stops.map((s) => s.placeId), ['p-z'])
})

test('상수: 요구사항 기본값', async () => {
  const rules = await import('../src/constants/locationRules.js')
  assert.equal(rules.GPS_QUEST_RADIUS_METERS, 150)
  assert.equal(rules.FREE_VISIT_RADIUS_METERS, 200)
  assert.equal(rules.FREE_VISIT_DWELL_MINUTES, 5)
  assert.equal(rules.MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS, 3000)
  void DONGMUN
})

// ───────── 11단계: 자유여행 복귀 시 기존 일정 보존 ─────────
test('복귀: 자유여행이 길었다는 이유만으로는 REPLAN 제안하지 않음(기존 다음 챕터 유지)', () => {
  const plan = collectRemainingPlan({ chapters, quests })
  const r = evaluateReturn({ now: NOW, position: at(33.502, 126.505), desiredEndTime: '23:00', freeStartedAt: NOW - 200 * MIN, ...plan })
  assert.equal(r.needsReplan, false)
  assert.deepEqual(r.reasons, [])
})

test('복귀: 큰 날씨 변화가 있으면 제안, 작은 변화는 무시', () => {
  const plan = collectRemainingPlan({ chapters, quests })
  const base = { now: NOW, position: at(33.502, 126.505), desiredEndTime: '23:00', freeStartedAt: NOW - 20 * MIN, ...plan }
  assert.ok(evaluateReturn({ ...base, weatherMajor: true }).reasons.includes('weather_changed'))
  assert.equal(evaluateReturn({ ...base, weatherMajor: false }).needsReplan, false)
})
