import {
  FREE_VISIT_DWELL_MINUTES,
  FREE_VISIT_DWELL_TOLERANCE_MINUTES,
  FREE_VISIT_RADIUS_METERS,
  MANUAL_VISIT_MIN_ROUTE_POINTS,
  MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS,
  TRACK_MAX_GAP_MS,
} from '../../constants/locationRules.js'
import { haversineMeters, isLatLng } from '../geo.js'

// 자유여행 이동 경로 분석. 서버(방문 확정)와 화면이 같은 규칙을 쓴다.
// route: [{ lat, lng, t(ms) }] 시간순. 경로는 DB 에 저장하지 않고 방문 검증이 필요할 때 한 번만 전달된다.

// 경로 정리: 좌표/시간이 올바른 점만 남기고 시간순으로 정렬한다.
export function cleanRoute(route) {
  if (!Array.isArray(route)) return []
  return route
    .filter((p) => isLatLng(p) && Number.isFinite(p.t))
    .map((p) => ({ lat: p.lat, lng: p.lng, t: p.t }))
    .sort((a, b) => a.t - b.t)
}

// 장소에서 경로의 어느 점까지든 가장 가까운 거리(미터). 경로가 비어 있으면 null.
export function minDistanceToRoute(place, route) {
  let best = null
  for (const point of route) {
    const d = haversineMeters(place, point)
    if (best === null || d < best) best = d
  }
  return best
}

// 수동 방문 기록 판정.
//  - 경로가 충분하고(>= MANUAL_VISIT_MIN_ROUTE_POINTS) 장소가 경로 근처(<= 허용 거리) → { ok:true, evidence:'route' }
//  - 경로가 충분한데 터무니없이 멂 → { ok:false, code:'too_far_from_route' }
//  - 경로가 부족함(GPS 근거 없음) → { ok:true, evidence:'none' }  방문은 저장하되 발견 EXP 는 주지 않는다.
export function judgeManualVisit(place, route) {
  const points = cleanRoute(route)
  if (points.length < MANUAL_VISIT_MIN_ROUTE_POINTS) return { ok: true, evidence: 'none', distanceMeters: null }
  const distanceMeters = minDistanceToRoute(place, points)
  if (distanceMeters > MANUAL_VISIT_ROUTE_MAX_DISTANCE_METERS) return { ok: false, code: 'too_far_from_route', distanceMeters }
  return { ok: true, evidence: 'route', distanceMeters }
}

// 경로에서 장소 주변(반경 안)에 연속으로 머문 가장 긴 시간(ms). 위치 갱신이 TRACK_MAX_GAP_MS 넘게 끊기면 이어 붙이지 않는다.
export function longestDwellMs(place, route, radius = FREE_VISIT_RADIUS_METERS) {
  const points = cleanRoute(route)
  let best = 0
  let runStart = null
  let runEnd = null
  for (const point of points) {
    const inside = haversineMeters(place, point) <= radius
    if (!inside) {
      runStart = null
      runEnd = null
      continue
    }
    if (runStart !== null && point.t - runEnd > TRACK_MAX_GAP_MS) runStart = point.t
    if (runStart === null) runStart = point.t
    runEnd = point.t
    best = Math.max(best, runEnd - runStart)
  }
  return best
}

// 자유여행 중 감지된 "방문 후보"를 서버가 경로로 다시 확인한다.
// 경로 포인트는 일정 간격으로만 쌓이므로 간격만큼의 오차(FREE_VISIT_DWELL_TOLERANCE_MINUTES)를 허용한다.
export function judgeCandidateVisit(place, route) {
  const dwellMs = longestDwellMs(place, route)
  const needMs = (FREE_VISIT_DWELL_MINUTES - FREE_VISIT_DWELL_TOLERANCE_MINUTES) * 60 * 1000
  return dwellMs >= needMs ? { ok: true, evidence: 'gps', dwellMinutes: Math.floor(dwellMs / 60000) } : { ok: false, code: 'dwell_not_confirmed', dwellMinutes: Math.floor(dwellMs / 60000) }
}
