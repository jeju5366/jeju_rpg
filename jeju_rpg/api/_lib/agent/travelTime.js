import { TRAVEL_RULES } from '../../../src/constants/replanRules.js'
import { estimateTravel, travelModeOf } from '../../../src/utils/travel.js'
import { getDrivingRoute } from '../providers/directions.js'

// 이동시간 계산 (REPLAN / 다음 챕터 예고 / 일정 판단용).
//   자동차(rental_car/taxi): NAVER Directions 5 의 실제 distance/duration. 실제(live) 응답일 때만 "directions" 로 인정하고,
//                            mock/실패 대체값은 직선거리 추정으로 취급한다. (실제 경로인 척하지 않는다)
//   대중교통: 차량 경로를 쓰지 않고 보수적 추정. 도보/자전거: 직선거리 기반 임시 계산.
// 호출량 제한: 한 번의 요청에서 Directions 는 budget(기본 TRAVEL_RULES.maxDirectionsPerRequest)만큼만 부르고, 같은 구간은 캐시를 쓴다.
//   후보 50~100개 전부에 부르지 않는다. (TourAPI 수집 → 코드 필터 → 소수 후보 → 필요한 동선에만)
const cache = new Map() // key → { at, value }
const key = (a, b) => `${a.lat.toFixed(3)},${a.lng.toFixed(3)}>${b.lat.toFixed(3)},${b.lng.toFixed(3)}`

export function createTravelBudget(max = TRAVEL_RULES.maxDirectionsPerRequest) {
  return { left: max, used: 0 }
}

async function drivingCached(from, to, budget, now) {
  const k = key(from, to)
  const hit = cache.get(k)
  if (hit && now - hit.at < TRAVEL_RULES.cacheMinutes * 60000) return hit.value
  if (!budget || budget.left <= 0) return null
  budget.left -= 1
  budget.used += 1
  try {
    const result = await getDrivingRoute({ start: from, goal: to, option: 'traoptimal' })
    const value = result.source === 'live' ? { durationSeconds: result.data.durationSeconds, distanceMeters: result.data.distanceMeters } : null
    cache.set(k, { at: now, value })
    return value
  } catch (error) {
    console.warn('[travel] Directions 실패, 추정값 사용', error.message)
    return null
  }
}

// → { minutes, meters, source: 'directions' | 'estimate', mode }
export async function travelBetween({ from, to, transport, budget = null, now = Date.now() }) {
  const driving = travelModeOf(transport) === 'car' ? await drivingCached(from, to, budget, now) : null
  return estimateTravel({ from, to, transport, driving })
}

export const _clearTravelCache = () => cache.clear() // 테스트용
