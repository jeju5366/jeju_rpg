import {
  FREE_VISIT_CONTENT_TYPES,
  FREE_VISIT_DWELL_MINUTES,
  FREE_VISIT_EXIT_RADIUS_FACTOR,
  FREE_VISIT_RADIUS_METERS,
  ROUTE_MAX_POINTS,
  ROUTE_MIN_DISTANCE_METERS,
  ROUTE_MIN_INTERVAL_MS,
  TRACK_MAX_ACCURACY_METERS,
  TRACK_MAX_GAP_MS,
} from '../../constants/locationRules.js'
import { haversineMeters } from '../geo.js'

// 자유여행 위치 추적의 "계산" 부분. 브라우저 API/DB/네트워크를 전혀 쓰지 않는 순수 함수라 테스트하기 쉽다.
// 화면(훅)은 위치가 갱신될 때마다 applyTick 을 부르고, 결과 상태를 store 에 둔다. (DB/API 호출 없음)
//
// tracking = {
//   route:      [{ lat, lng, t }]            경로 포인트(거리/시간 조건을 넘을 때만 추가)
//   presence:   { [placeId]: { place, sinceT, lastT } }   지금 머무는 중인 장소(반경 안)
//   candidates: { [placeId]: candidate }     방문 후보(체류 시간을 채운 장소). 같은 장소는 세션 중 한 번만 생긴다.
//   lastTickT:  마지막으로 받은 위치 시각
// }

export function createTracking() {
  return { route: [], presence: {}, candidates: {}, lastTickT: null }
}

export const isMeaningfulPlace = (place) => FREE_VISIT_CONTENT_TYPES.includes(Number(place?.contentTypeId))

// 경로가 너무 길어지면 오래된 쪽을 절반으로 솎아 상한을 지킨다.
function thin(route) {
  if (route.length <= ROUTE_MAX_POINTS) return route
  const keepFrom = Math.floor(route.length / 2)
  const older = route.slice(0, keepFrom).filter((_, i) => i % 2 === 0)
  return [...older, ...route.slice(keepFrom)]
}

// tick: { lat, lng, accuracy, timestamp }   places: 주변 장소 캐시 [{ placeId, name, lat, lng, contentTypeId, address }]
// → { tracking, appended, ignored, gap, newCandidates }
export function applyTick(tracking, tick, places = []) {
  if (!(tick.accuracy <= TRACK_MAX_ACCURACY_METERS)) return { tracking, appended: false, ignored: true, gap: false, newCandidates: [] }

  const t = tick.timestamp
  const point = { lat: tick.lat, lng: tick.lng, t }
  let { route, presence } = tracking

  // 위치 갱신이 오래 끊겼다가 돌아오면(탭이 멈춤 등) 그 사이는 머문 것으로 보지 않는다.
  const gap = tracking.lastTickT !== null && t - tracking.lastTickT > TRACK_MAX_GAP_MS
  if (gap) presence = {}

  // 경로 포인트: 마지막 포인트에서 일정 거리 이동했거나 일정 시간이 지났을 때만 추가
  const last = route[route.length - 1]
  const appended = !last || haversineMeters(last, point) >= ROUTE_MIN_DISTANCE_METERS || t - last.t >= ROUTE_MIN_INTERVAL_MS
  if (appended) route = thin([...route, point])

  // 체류 판정: 의미 있는 장소 + 이미 머물고 있는 장소를 함께 본다
  const nextPresence = {}
  const exitRadius = FREE_VISIT_RADIUS_METERS * FREE_VISIT_EXIT_RADIUS_FACTOR
  const considered = new Map()
  for (const place of places) if (isMeaningfulPlace(place)) considered.set(place.placeId, place)
  for (const [placeId, entry] of Object.entries(presence)) if (!considered.has(placeId)) considered.set(placeId, entry.place)

  for (const [placeId, place] of considered) {
    const distance = haversineMeters(point, place)
    const current = presence[placeId]
    if (distance <= FREE_VISIT_RADIUS_METERS) nextPresence[placeId] = { place, sinceT: current?.sinceT ?? t, lastT: t }
    else if (current && distance <= exitRadius) nextPresence[placeId] = current // 경계 근처는 아직 머무는 중
  }

  const newCandidates = []
  const candidates = { ...tracking.candidates }
  const needMs = FREE_VISIT_DWELL_MINUTES * 60 * 1000
  for (const [placeId, entry] of Object.entries(nextPresence)) {
    if (candidates[placeId] || t - entry.sinceT < needMs) continue
    const candidate = {
      placeId,
      name: entry.place.name,
      lat: entry.place.lat,
      lng: entry.place.lng,
      contentTypeId: entry.place.contentTypeId ?? null,
      address: entry.place.address ?? '',
      sinceT: entry.sinceT,
      detectedAt: t,
      dwellMinutes: Math.floor((t - entry.sinceT) / 60000),
    }
    candidates[placeId] = candidate
    newCandidates.push(candidate)
  }

  return { tracking: { route, presence: nextPresence, candidates, lastTickT: t }, appended, ignored: false, gap, newCandidates }
}
