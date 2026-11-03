import { CACHE_RULES } from '../../constants/replanRules.js'
import { estimateTravel, travelModeOf } from '../../utils/travel.js'
import { fetchDrivingRoute } from '../naver/directionsService.js'

// 다음 챕터 예고용 이동 정보. 자동차는 NAVER Directions 5 의 실제 distance/duration 을, 나머지는 보수적 추정을 쓴다.
// 같은 구간은 캐시를 쓰고(30분), 화면이 뜰 때마다 Directions 를 부르지 않는다. 실패하면 직선거리 추정으로 대신한다.
const cache = new Map() // key → { at, value }
const keyOf = (a, b, mode) => `${mode}:${a.lat.toFixed(3)},${a.lng.toFixed(3)}>${b.lat.toFixed(3)},${b.lng.toFixed(3)}`

export async function getTravelPreview({ from, to, transport }) {
  const mode = travelModeOf(transport)
  const key = keyOf(from, to, mode)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_RULES.travelPreviewStaleMs) return hit.value

  let driving = null
  if (mode === 'car') {
    try {
      const response = await fetchDrivingRoute({ start: from, goal: to })
      // mock/대체값(source !== 'live')은 실제 경로가 아니므로 "추정"으로 취급한다
      if (response.source === 'live') driving = { durationSeconds: response.data.durationSeconds, distanceMeters: response.data.distanceMeters }
    } catch {
      /* 추정으로 대체 */
    }
  }
  const value = estimateTravel({ from, to, transport, driving })
  cache.set(key, { at: Date.now(), value })
  return value
}

export const peekTravelPreview = ({ from, to, transport }) => cache.get(keyOf(from, to, travelModeOf(transport)))?.value ?? null
