import {
  AIRPORT_ARRIVE_BEFORE_MIN,
  CONGESTION_BUFFER_MIN,
  DEFAULT_CONGESTION_BUFFER_MIN,
  DOMESTIC_AIRPORT_CODES,
  FALLBACK_TRAVEL_TO_AIRPORT_MIN,
  NOTICE_BEFORE_MIN,
} from '../constants/finalQuestRules.js'

// Final Quest 안전 시간 계산 (순수 함수). 서버/화면/테스트가 같은 계산을 쓴다. 외부 API 는 부르지 않는다.
//   latestSafeDeparture = 공항 도착 목표 시각 − (현재 위치 → 제주공항 이동시간 + 혼잡도 보정)
//   공항 도착 목표 시각 = 비행기 출발 − (국내선 90분 / 국제선 150분)
// GPT/Agent 는 이 값을 바꾸거나 늦출 수 없다. 값은 항상 이 함수에서 나온다.

const MIN = 60 * 1000

// 혼잡도 종합 단계(1~4) → 보정 분. 없음/이상한 값이면 기본(0).
export function congestionBufferMinutes(level) {
  const n = Number(level)
  return Number.isFinite(n) && n in CONGESTION_BUFFER_MIN ? CONGESTION_BUFFER_MIN[n] : DEFAULT_CONGESTION_BUFFER_MIN
}

// 항공편 종류: 'domestic'(확실한 국내선) | 'international'(확실한 국제선) | 'unknown'(알 수 없음)
//   override: 사용자가 직접 고른 값('domestic' | 'international')이 있으면 그대로 쓴다. (직접 선택 기능을 붙일 때를 위한 자리)
//   도착 공항 IATA 가 국내 목록에 있으면 국내선, 없으면 국제선, 코드를 모르면 unknown.
export function flightKind(arrivalAirportCode, override = null) {
  if (override === 'domestic' || override === 'international') return override
  const code = String(arrivalAirportCode ?? '').trim().toUpperCase()
  if (!code) return 'unknown'
  return DOMESTIC_AIRPORT_CODES.includes(code) ? 'domestic' : 'international'
}

// 안전 계산에 쓰는 국제선 여부. 확실한 국내선만 90분이고, 국제선과 unknown 은 보수적으로 150분이다.
export const treatAsInternational = (kind) => kind !== 'domestic'

// (호환) 도착 공항 코드로 "국제선 기준을 써야 하는가". unknown 도 true.
export const isInternationalFlight = (arrivalAirportCode, override = null) => treatAsInternational(flightKind(arrivalAirportCode, override))

// → { departureAt, arriveBy, arriveBeforeMinutes, travelMinutes, congestionBufferMinutes, latestSafeDeparture, international }  (시각은 모두 ms)
// 비행기 출발 시각(departureAtMs)이 없거나 숫자가 아니면 null (계산 불가 — 호출한 쪽이 "항공편 정보 필요"로 처리)
export function computeSafeTimes({ departureAtMs, international = false, congestionLevel = null, travelMinutes = null }) {
  if (!Number.isFinite(departureAtMs)) return null
  const arriveBeforeMinutes = international ? AIRPORT_ARRIVE_BEFORE_MIN.international : AIRPORT_ARRIVE_BEFORE_MIN.domestic
  const travel = Number.isFinite(travelMinutes) && travelMinutes >= 0 ? Math.ceil(travelMinutes) : FALLBACK_TRAVEL_TO_AIRPORT_MIN
  const buffer = congestionBufferMinutes(congestionLevel)
  const arriveBy = departureAtMs - arriveBeforeMinutes * MIN
  return {
    departureAt: departureAtMs,
    arriveBy,
    arriveBeforeMinutes,
    travelMinutes: travel,
    congestionBufferMinutes: buffer,
    latestSafeDeparture: arriveBy - (travel + buffer) * MIN,
    international,
  }
}

// 지금 단계: 'none'(여유) | 'notice'(곧 공항 이동 준비) | 'activate'(Final Quest 시작)
export function finalQuestPhase({ nowMs, latestSafeDeparture, noticeMinutes = NOTICE_BEFORE_MIN }) {
  if (!Number.isFinite(latestSafeDeparture)) return 'none'
  if (nowMs >= latestSafeDeparture) return 'activate'
  if (nowMs >= latestSafeDeparture - noticeMinutes * MIN) return 'notice'
  return 'none'
}

// 일반 퀘스트를 더 하면 안전하지 않은지 코드로 판단한다. 지금 위치 기준 공항 이동 + 혼잡 보정을 더해도 도착 목표를 넘기면 true.
// (latestSafeDeparture 와 같은 기준이라 phase 가 'activate' 인 것과 같다. 일정 지연/이동 중 위치 변화로 지금 값이 바뀌면 그때 다시 평가한다.)
export function normalQuestsUnsafe({ nowMs, safe }) {
  return Boolean(safe) && nowMs >= safe.latestSafeDeparture
}

// 항공편 API 응답(getFlightStatus 결과) → { state, departureAtMs, arrivalAirportCode, source }
//   · 해당 편을 찾으면 변경 시각(changedDeparture) 우선, 없으면 예정 시각. 결항이면 state 'cancelled'. 지연이면 'delayed'.
//   · 못 찾거나 응답이 없으면 setup 에 입력한 출발 시각(fallbackDepartureMs)을 쓰고 state 는 'unknown'. API 실패가 Final Quest 를 막지 않는다.
export function interpretFlight(result, { flightNo = null, fallbackDepartureMs = null } = {}) {
  const normalized = String(flightNo ?? '').replace(/\s+/g, '').toUpperCase()
  const flight = result?.flights?.find((f) => !normalized || String(f.flightNo ?? '').replace(/\s+/g, '').toUpperCase() === normalized) ?? result?.flights?.[0] ?? null
  if (!result?.found || !flight) {
    return { state: 'unknown', departureAtMs: Number.isFinite(fallbackDepartureMs) ? fallbackDepartureMs : null, arrivalAirportCode: null, source: 'setup' }
  }
  const scheduled = parseKst(flight.scheduledDeparture)
  const changed = parseKst(flight.changedDeparture)
  const departureAtMs = changed ?? scheduled ?? (Number.isFinite(fallbackDepartureMs) ? fallbackDepartureMs : null)
  const delayed = Boolean(flight.delayed) || (changed != null && scheduled != null && changed > scheduled)
  const state = flight.cancelled ? 'cancelled' : delayed ? 'delayed' : 'normal'
  return { state, departureAtMs, arrivalAirportCode: flight.arrivalAirportCode ?? null, source: 'api', status: flight.status ?? null, delayMinutes: changed != null && scheduled != null ? Math.round((changed - scheduled) / MIN) : null }
}

// 'YYYY-MM-DD HH:MM' (한국 시간) → ms. 형식이 다르면 null.
export function parseKst(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(text ?? ''))
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5])
}
