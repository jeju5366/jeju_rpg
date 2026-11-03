import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REPLAN_REASONS_ENABLED, SURPRISE_RULES } from '../src/constants/replanRules.js'
import { assessWeatherChange, classifyWeather, evaluateAccommodationRisk, evaluateSchedule, evaluateSurpriseGate, minutesToEndOfDay } from '../src/utils/schedule.js'
import { describeTravel, estimateTravel } from '../src/utils/travel.js'

const MIN = 60 * 1000
const NOW = Date.UTC(2026, 10, 3, 6, 0, 0) // KST 15:00
const iso = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString()
// 챕터 예상 소요 = 60 + 20 = 80분
const closed = (seq, actualMinutes, status = 'completed') => ({ seq, status, activated_at: iso(actualMinutes + 100 - seq), closed_at: iso(100 - seq), data: {} })
const open = (seq, status = 'locked', elapsed = 0) => ({ seq, status, activated_at: status === 'locked' ? null : iso(elapsed), closed_at: null, data: {} })

// ───────── 일정 지연 ─────────
test('지연 10분 → 무시(제안 X)', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 90), open(2, 'active', 30), open(3)], desiredEndTime: '20:00' })
  assert.equal(r.delayMinutes, 10)
  assert.equal(r.level, 'ignore')
  assert.equal(r.candidate, false)
})

test('지연 20~30분 → 내부 확인만(제안 X)', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 105), open(2, 'active', 10), open(3)], desiredEndTime: '20:00' })
  assert.equal(r.delayMinutes, 25)
  assert.equal(r.level, 'check')
  assert.equal(r.candidate, false)
})

test('지연 30분+ 이지만 종료 희망 시간에 여유가 있으면 제안하지 않음(단순 시간차만 보지 않는다)', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 115), open(2, 'active', 10), open(3)], desiredEndTime: '23:00' })
  assert.equal(r.level, 'suggest')
  assert.equal(r.candidate, false)
})

test('지연 30분+ 이고 종료 희망 시간을 넘길 것 같으면 REPLAN candidate', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 115), open(2, 'active', 10), open(3), open(4)], desiredEndTime: '17:30' })
  assert.equal(r.level, 'suggest')
  assert.ok(r.overrunMinutes > 0)
  assert.equal(r.candidate, true)
  assert.equal(r.strong, false)
})

test('지연 60분+ → 강한 재조정 제안', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 150), open(2, 'active', 10), open(3)], desiredEndTime: '23:00' })
  assert.equal(r.delayMinutes, 70)
  assert.equal(r.strong, true)
  assert.equal(r.candidate, true)
})

test('진행 중인 챕터가 예상을 넘기면 그만큼 지연으로 센다 / 남은 챕터가 없으면 제안하지 않는다', () => {
  const lingering = evaluateSchedule({ now: NOW, chapters: [open(1, 'active', 120), open(2)], desiredEndTime: '17:00' })
  assert.equal(lingering.delayMinutes, 40)
  assert.equal(lingering.candidate, true)
  const done = evaluateSchedule({ now: NOW, chapters: [closed(1, 200)], desiredEndTime: '17:00' })
  assert.equal(done.candidate, false)
})

// ───────── 일정 앞당김 (Bonus Opportunity, REPLAN 아님) ─────────
test('30분+ 빠름 → ahead(추가 콘텐츠 제안), candidate(REPLAN) 는 아님', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 40), open(2, 'active', 5), open(3)], desiredEndTime: '20:00' })
  assert.equal(r.aheadMinutes, 40)
  assert.equal(r.ahead, true)
  assert.equal(r.candidate, false)
  assert.equal(r.delayMinutes, 0)
})

test('건너뛴 챕터는 "빨리 끝난 것"으로 세지 않음', () => {
  const r = evaluateSchedule({ now: NOW, chapters: [closed(1, 5, 'skipped'), open(2, 'active', 5)], desiredEndTime: '20:00' })
  assert.equal(r.aheadMinutes, 0)
  assert.equal(r.ahead, false)
})

test('SCHEDULE_AHEAD 는 REPLAN reason 이 아님', () => {
  assert.equal(REPLAN_REASONS_ENABLED.includes('SCHEDULE_AHEAD'), false)
  assert.deepEqual(REPLAN_REASONS_ENABLED.slice().sort(), ['ACCOMMODATION_RISK', 'PLACE_UNAVAILABLE', 'RETURN_FROM_FREE_TRAVEL', 'SCHEDULE_DELAY', 'USER_REQUEST', 'WEATHER_CHANGE'])
})

test('숙소 복귀 위험: 종료 희망 시간보다 30분+ 늦게 도착하면 후보', () => {
  assert.equal(evaluateAccommodationRisk({ now: NOW, desiredEndTime: '18:00', remainingChapters: 3 }).risk, true)
  assert.equal(evaluateAccommodationRisk({ now: NOW, desiredEndTime: '23:00', remainingChapters: 3 }).risk, false)
  assert.equal(evaluateAccommodationRisk({ now: NOW, desiredEndTime: null, remainingChapters: 3 }).risk, false)
})

// ───────── 날씨 ─────────
const clear = { temperatureC: 20, windSpeedMs: 3, precipitation: { type: 'none', amountMm: 0 }, hourlyForecast: [{ precipitationProbability: 10 }] }
const heavyRain = { temperatureC: 17, windSpeedMs: 6, precipitation: { type: 'rain', amountMm: 15 }, hourlyForecast: [{ precipitationProbability: 90 }] }

test('날씨: 맑음 → 강한 비는 큰 변화(major)', () => {
  const r = assessWeatherChange({ current: heavyRain, baseline: clear })
  assert.equal(r.major, true)
  assert.equal(r.now.class, 'heavy_rain')
})

test('날씨: 작은 온도 변화/이미 같은 상태는 무시', () => {
  assert.equal(assessWeatherChange({ current: { ...clear, temperatureC: 24 }, baseline: clear }).major, false)
  assert.equal(assessWeatherChange({ current: heavyRain, baseline: heavyRain }).major, false)
  assert.equal(assessWeatherChange({ current: { ...clear, precipitation: { type: 'rain', amountMm: 0.5 }, hourlyForecast: [{ precipitationProbability: 30 }] }, baseline: clear }).major, false)
})

test('날씨: 강풍/폭염/바람 동반 강추위는 major, 단순 추위는 아님', () => {
  assert.equal(classifyWeather({ ...clear, windSpeedMs: 16 }).class, 'strong_wind')
  assert.equal(classifyWeather({ ...clear, temperatureC: 36 }).class, 'heat')
  assert.equal(classifyWeather({ ...clear, temperatureC: 0, windSpeedMs: 10 }).class, 'cold')
  assert.equal(classifyWeather({ ...clear, temperatureC: 3, windSpeedMs: 2 }).class, 'ok')
})

// ───────── 돌발 퀘스트 gate ─────────
const base = { trigger: 'core_completed', adventureActive: true, freeTravel: false, replanNeeded: false, verificationOpen: false, transitioning: false, dayCount: 0, lastOfferedAt: null, now: NOW, minutesToEnd: 240, anchor: { lat: 33.5, lng: 126.5 } }

test('Surprise: 이동 중이면 생성 X (GPS speed 가 있을 때만 참고)', () => {
  assert.deepEqual(evaluateSurpriseGate({ ...base, speedMs: 12, position: { lat: 33.5, lng: 126.5 } }), { ok: false, reason: 'moving' })
  assert.equal(evaluateSurpriseGate({ ...base, speedMs: undefined }).ok, true) // speed 를 모르면 이동 중이라고 단정하지 않는다
})

test('Surprise: 핵심 퀘스트 완료 직후는 gate 통과', () => {
  assert.deepEqual(evaluateSurpriseGate(base), { ok: true, reason: 'stable' })
  assert.equal(evaluateSurpriseGate({ ...base, trigger: 'chapter_completed' }).ok, true)
})

test('Surprise: anchor 도착 + 체류가 있어야 anchor_dwell 통과', () => {
  const near = { lat: 33.5005, lng: 126.5005 }
  assert.equal(evaluateSurpriseGate({ ...base, trigger: 'anchor_dwell', position: near, dwellMs: 5 * MIN }).ok, true)
  assert.equal(evaluateSurpriseGate({ ...base, trigger: 'anchor_dwell', position: near, dwellMs: 1 * MIN }).reason, 'no_stable_point')
  assert.equal(evaluateSurpriseGate({ ...base, trigger: 'anchor_dwell', position: null, dwellMs: 9 * MIN }).reason, 'no_stable_point')
  assert.equal(evaluateSurpriseGate({ ...base, trigger: 'anchor_dwell', position: { lat: 33.51, lng: 126.5 }, dwellMs: 9 * MIN }).reason, 'far_from_anchor')
})

test('Surprise: REPLAN 필요/진행 중, 인증 모달, 챕터 전환, 자유여행(일반), 시간 부족이면 생성 X', () => {
  assert.equal(evaluateSurpriseGate({ ...base, replanNeeded: true }).reason, 'replan_pending')
  assert.equal(evaluateSurpriseGate({ ...base, verificationOpen: true }).reason, 'verification_open')
  assert.equal(evaluateSurpriseGate({ ...base, transitioning: true }).reason, 'transitioning')
  assert.equal(evaluateSurpriseGate({ ...base, freeTravel: true }).reason, 'free_travel')
  assert.equal(evaluateSurpriseGate({ ...base, minutesToEnd: 20 }).reason, 'time_short')
  assert.equal(evaluateSurpriseGate({ ...base, adventureActive: false }).reason, 'not_active')
})

test('Surprise: 하루 3개 제한 + 60분 cooldown', () => {
  assert.equal(SURPRISE_RULES.maxPerDay, 3)
  assert.equal(evaluateSurpriseGate({ ...base, dayCount: 3 }).reason, 'daily_limit')
  assert.equal(evaluateSurpriseGate({ ...base, dayCount: 2 }).ok, true)
  assert.equal(evaluateSurpriseGate({ ...base, lastOfferedAt: NOW - 30 * MIN }).reason, 'cooldown')
  assert.equal(evaluateSurpriseGate({ ...base, lastOfferedAt: NOW - 61 * MIN }).ok, true)
})

test('남은 시간 계산', () => {
  assert.equal(minutesToEndOfDay({ now: NOW, desiredEndTime: '19:00' }), 240)
  assert.equal(minutesToEndOfDay({ now: NOW, desiredEndTime: null }), null)
})

// ───────── 이동시간 ─────────
const A = { lat: 33.5, lng: 126.5 }
const B = { lat: 33.46, lng: 126.94 }

test('이동시간: 자동차는 Directions 값 우선, 없으면 추정', () => {
  const real = estimateTravel({ from: A, to: B, transport: 'rental_car', driving: { durationSeconds: 1500, distanceMeters: 42000 } })
  assert.deepEqual([real.minutes, real.source, real.mode], [25, 'directions', 'car'])
  assert.equal(describeTravel(real), '차량 약 25분')
  assert.equal(estimateTravel({ from: A, to: B, transport: 'taxi' }).source, 'estimate')
})

test('이동시간: 대중교통은 차량 Directions 를 쓰지 않고 보수적(더 오래) 추정', () => {
  const driving = { durationSeconds: 1500, distanceMeters: 42000 }
  const transit = estimateTravel({ from: A, to: B, transport: 'public_transit', driving })
  assert.equal(transit.source, 'estimate')
  assert.ok(transit.minutes > 25)
  assert.match(describeTravel(transit), /대중교통 약 \d+분 \(예상\)/)
  assert.equal(estimateTravel({ from: A, to: { lat: 33.5, lng: 126.505 }, transport: 'walk' }).mode, 'walk')
})
