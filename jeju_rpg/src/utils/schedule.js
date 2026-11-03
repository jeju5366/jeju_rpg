import {
  ACCOMMODATION_RISK_LATE_MINUTES,
  RAIN_TYPES,
  SCHEDULE_RULES,
  SURPRISE_RULES,
  WEATHER_RULES,
} from '../constants/replanRules.js'
import { haversineMeters, isLatLng } from './geo.js'

// 11단계 판단 로직(순수 함수). "상황을 판단"하는 일은 전부 코드가 한다. GPT 는 판단된 상황에서 남은 일정을 다시 설계할 뿐이다.
//   · evaluateSchedule  : 일정 지연(REPLAN 후보) / 앞당김(Bonus Opportunity)
//   · assessWeather     : 날씨가 "큰 변화"인지
//   · evaluateSurpriseGate : 돌발 퀘스트를 지금 띄워도 되는 안정적인 시점인지

const minutesBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000
const toMinutes = (hhmm) => {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':')
  return Number.isFinite(Number(h)) ? Number(h) * 60 + Number(m || 0) : null
}
const kstMinutesOfDay = (ms) => {
  const kst = new Date(ms + 9 * 3600 * 1000)
  return kst.getUTCHours() * 60 + kst.getUTCMinutes()
}

// ───────── 일정 지연 / 앞당김 ─────────
// 챕터 하나의 예상 소요 = 활동(expectedChapterMinutes) + 그 챕터까지의 이동시간(chapter.data.travelMinutes, 없으면 기본값).
// 실제 소요 = 챕터를 연 시각(activated_at) ~ 닫은 시각(closed_at). 진행 중인 챕터는 지금까지 걸린 시간이 예상을 넘은 만큼만 "지연"으로 센다.
// 누적 차이 = Σ(실제 − 예상). 양수면 지연, 음수면 앞당김. (건너뛴 챕터는 "빨리 끝낸 것"으로 세지 않는다)
export function evaluateSchedule({ now = Date.now(), chapters = [], desiredEndTime = null, nextTravelMinutes = null }) {
  const rules = SCHEDULE_RULES
  const expectedOf = (chapter) => rules.expectedChapterMinutes + (chapter.data?.travelMinutes ?? rules.defaultTravelMinutes)
  let cumulative = 0
  for (const chapter of chapters) {
    if ((chapter.status === 'completed' || chapter.status === 'skipped') && chapter.activated_at && chapter.closed_at) {
      const delta = minutesBetween(chapter.activated_at, chapter.closed_at) - expectedOf(chapter)
      cumulative += chapter.status === 'skipped' ? Math.max(0, delta) : delta
    } else if ((chapter.status === 'active' || chapter.status === 'core_completed') && chapter.activated_at) {
      cumulative += Math.max(0, minutesBetween(chapter.activated_at, now) - expectedOf(chapter))
    }
  }
  const delayMinutes = Math.max(0, Math.round(cumulative))
  const aheadMinutes = Math.max(0, Math.round(-cumulative))

  const open = chapters.filter((c) => ['active', 'core_completed', 'locked', 'available'].includes(c.status))
  const remainingChapters = open.length
  // 남은 일정을 그대로 했을 때의 예상 종료 vs 종료 희망 시간
  const endMin = toMinutes(desiredEndTime)
  const nowMin = kstMinutesOfDay(now)
  const needMinutes = remainingChapters * rules.perChapterMinutes + (nextTravelMinutes ?? rules.defaultTravelMinutes) * Math.max(0, remainingChapters - 1)
  const overrunMinutes = endMin === null ? null : Math.round(nowMin + needMinutes - (endMin - rules.endBufferMinutes))

  const level = delayMinutes >= rules.strongFromMinutes ? 'strong' : delayMinutes >= rules.suggestFromMinutes ? 'suggest' : delayMinutes >= rules.checkFromMinutes ? 'check' : delayMinutes >= rules.ignoreBelowMinutes ? 'minor' : 'ignore'
  // 사용자에게 제안하는 조건: 30분 이상 늦었고, 남은 일정이 있고, (종료 희망 시간을 넘길 것 같거나 60분 이상 늦음). 단순 시간차만으로는 제안하지 않는다.
  const candidate = remainingChapters > 0 && (level === 'strong' || (level === 'suggest' && overrunMinutes !== null && overrunMinutes > 0))
  return {
    delayMinutes,
    aheadMinutes,
    level,
    candidate,
    strong: level === 'strong',
    remainingChapters,
    overrunMinutes,
    // 일정이 빨라졌다 → 전체 REPLAN 이 아니라 추가 콘텐츠 제안(Bonus Opportunity)
    ahead: aheadMinutes >= rules.aheadFromMinutes && remainingChapters > 0,
  }
}

// ACCOMMODATION_RISK: 남은 일정을 그대로 하면 숙소 도착이 종료 희망 시간보다 많이 늦어지는지.
// returnMinutes: 마지막 장소 → 숙소 이동시간 (모르면 기본값)
export function evaluateAccommodationRisk({ now = Date.now(), desiredEndTime, remainingChapters, returnMinutes = SCHEDULE_RULES.defaultTravelMinutes, travelBetweenMinutes = SCHEDULE_RULES.defaultTravelMinutes }) {
  const endMin = toMinutes(desiredEndTime)
  if (endMin === null || !remainingChapters) return { risk: false, lateMinutes: 0 }
  const arrival = kstMinutesOfDay(now) + remainingChapters * SCHEDULE_RULES.perChapterMinutes + travelBetweenMinutes * Math.max(0, remainingChapters - 1) + returnMinutes
  const lateMinutes = Math.round(arrival - endMin)
  return { risk: lateMinutes >= ACCOMMODATION_RISK_LATE_MINUTES, lateMinutes }
}

// ───────── 날씨: 큰 변화 판정 ─────────
// 작은 온도/하늘 변화는 무시한다. 강한 비, 강풍, 폭염, 강한 추위(바람 포함)처럼 "야외 일정이 현실적으로 어려워지는" 상태만 major 로 본다.
// weather: /api/weather 의 data { temperatureC, precipitation: { type, amountMm }, windSpeedMs, hourlyForecast }
// → { class: 'ok'|'heavy_rain'|'strong_wind'|'heat'|'cold', reasons, outdoorHard }
export function classifyWeather(weather) {
  if (!weather) return { class: 'unknown', reasons: [] }
  const rules = WEATHER_RULES
  const temp = weather.temperatureC
  const wind = weather.windSpeedMs ?? 0
  const type = weather.precipitation?.type ?? 'none'
  const amount = weather.precipitation?.amountMm ?? 0
  const soon = (weather.hourlyForecast ?? []).slice(0, 3)
  const maxProb = Math.max(0, ...soon.map((h) => h.precipitationProbability ?? 0))
  const raining = RAIN_TYPES.includes(type)
  const reasons = []
  if (wind >= rules.strongWindMs) reasons.push('strong_wind')
  if (raining && (amount >= rules.heavyRainMmPerHour || (maxProb >= rules.rainProbability && amount > 0))) reasons.push('heavy_rain')
  if (temp >= rules.heatC) reasons.push('heat')
  // 체감온도(바람 냉각): 13.12 + 0.6215T − 11.37V^0.16 + 0.3965TV^0.16 (V: km/h)
  const v = wind * 3.6
  const feels = v >= 4.8 ? 13.12 + 0.6215 * temp - 11.37 * v ** 0.16 + 0.3965 * temp * v ** 0.16 : temp
  if (feels <= rules.coldFeelsLikeC && wind >= rules.coldWindMs) reasons.push('cold')
  const order = ['strong_wind', 'heavy_rain', 'heat', 'cold']
  return { class: order.find((r) => reasons.includes(r)) ?? 'ok', reasons, outdoorHard: reasons.length > 0, temperatureC: temp }
}

// baseline(이전에 확인한 날씨 분류)과 지금을 비교한다. 이미 같은 상태였다면 "변화"가 아니다.
// → { major, now, was } — major 일 때만 WEATHER_CHANGE 후보
export function assessWeatherChange({ current, baseline = null }) {
  const now = classifyWeather(current)
  if (now.class === 'unknown') return { major: false, now, was: null }
  const was = baseline ? classifyWeather(baseline) : null
  const changedClass = !was || was.class === 'unknown' || was.class !== now.class
  // 기온만 조금 달라진 경우는 무시한다.
  const smallTempOnly = was && now.class === 'ok' && Math.abs((now.temperatureC ?? 0) - (was.temperatureC ?? 0)) < WEATHER_RULES.minTempChangeC
  return { major: now.outdoorHard && changedClass && !smallTempOnly, now, was }
}

// ───────── 돌발 퀘스트 gate ─────────
// "이동 중에 띄우지 않는다." 안정적인 시점 = anchor 근처 도착/체류, 핵심 퀘스트 완료 직후, 챕터 완료 후(다음 챕터 이동 전), 일정이 30분 이상 빨리 끝났을 때.
// 이 함수는 서버가 최종 검증에 쓰고, 화면은 같은 함수로 "물어볼지 말지"를 먼저 판단해서 불필요한 요청을 막는다.
// input: { trigger, adventureActive, freeTravel, replanNeeded, verificationOpen, transitioning, position?, speedMs?, anchor?, dwellMs?,
//          dayCount, lastOfferedAt(ms|null), now(ms), minutesToEnd(null|number) }
// → { ok, reason }
export function evaluateSurpriseGate(input) {
  const rules = SURPRISE_RULES
  const { trigger, now = Date.now() } = input
  if (!input.adventureActive) return { ok: false, reason: 'not_active' }
  if (input.freeTravel && trigger !== 'free_travel_dwell') return { ok: false, reason: 'free_travel' }
  if (input.replanNeeded) return { ok: false, reason: 'replan_pending' } // REPLAN 이 우선
  if (input.verificationOpen) return { ok: false, reason: 'verification_open' }
  if (input.transitioning) return { ok: false, reason: 'transitioning' }
  if ((input.dayCount ?? 0) >= rules.maxPerDay) return { ok: false, reason: 'daily_limit' }
  if (input.lastOfferedAt && now - input.lastOfferedAt < rules.cooldownMinutes * 60000) return { ok: false, reason: 'cooldown' }
  if (input.minutesToEnd !== null && input.minutesToEnd !== undefined && input.minutesToEnd < rules.minRemainingMinutes) return { ok: false, reason: 'time_short' }
  if (Number.isFinite(input.speedMs) && input.speedMs >= rules.movingSpeedMs) return { ok: false, reason: 'moving' }

  const hasPosition = isLatLng(input.position)
  const hasAnchor = isLatLng(input.anchor)
  if (hasPosition && hasAnchor && haversineMeters(input.position, input.anchor) > rules.maxDistanceMeters) return { ok: false, reason: 'far_from_anchor' }

  // 체류로 판단하는 트리거는 anchor 근처에서 일정 시간 머문 것을 요구한다. (이벤트 트리거는 그 장소에서 방금 일어난 일이라 그 자체가 안정적인 시점)
  if (trigger === 'anchor_dwell' || trigger === 'free_travel_dwell') {
    if (!hasPosition || !hasAnchor) return { ok: false, reason: 'no_stable_point' }
    if (haversineMeters(input.position, input.anchor) > rules.anchorRadiusMeters) return { ok: false, reason: 'no_stable_point' }
    if ((input.dwellMs ?? 0) < rules.dwellMinutes * 60000) return { ok: false, reason: 'no_stable_point' }
  }
  return { ok: true, reason: 'stable' }
}

export function minutesToEndOfDay({ now = Date.now(), desiredEndTime }) {
  const end = toMinutes(desiredEndTime)
  return end === null ? null : end - kstMinutesOfDay(now)
}

// ───────── 현재 챕터 핵심 퀘스트 수행 가능성 (REPLAN 에서 "무조건 교체하지 않기" 위한 판단) ─────────
// 코드가 실제 데이터로 판단한다. 현재 상황에서도 충분히 수행 가능하면 유지하고, 정말 어려워졌을 때만 교체 대상으로 허용한다.
//   core        : { placeId } 핵심 퀘스트 장소
//   outdoor     : 그 장소가 야외인지 (TourAPI contentTypeId 로 코드가 판단)
//   weather     : classifyWeather 결과 (outdoorHard 면 야외 일정이 어려움)
//   travelMinutes: 현재 위치 → 핵심 장소 이동시간
//   minutesToEnd: 종료 희망 시간까지 남은 시간 (모르면 null)
//   unavailable : 검증된 근거로 이용 불가가 확인된 placeId 집합 (GPT 추정으로는 채우지 않는다)
// → { feasible, problems: ('unavailable' | 'weather' | 'time')[] }
export function assessCoreFeasibility({ core, outdoor, weather, travelMinutes, minutesToEnd, unavailable = new Set() }) {
  const problems = []
  if (core?.placeId && unavailable.has(core.placeId)) problems.push('unavailable')
  if (outdoor && weather?.outdoorHard) problems.push('weather')
  // 종료 희망 시간 안에 도착해서 수행할 수 없다 (이동 + 한 챕터 분량)
  if (minutesToEnd !== null && minutesToEnd !== undefined && (travelMinutes ?? 0) + SCHEDULE_RULES.perChapterMinutes > minutesToEnd) problems.push('time')
  return { feasible: problems.length === 0, problems }
}
