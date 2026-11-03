import { LAST_DAY_AIRPORT_MAX_MIN, LAST_DAY_FAR_METERS } from '../constants/finalQuestRules.js'
import { JEJU_AIRPORT } from '../constants/jeju.js'
import { haversineMeters, isLatLng } from './geo.js'

// 마지막 날 모험: 공항 방향으로 수렴하는 동선 (순수 함수). Final Quest 는 이 일정과 별개로 마지막에 붙는 이벤트다.
// 규칙은 "마지막 날"에만 적용하고, 절대 규칙이 아니라 선호(가능하면 공항 쪽, 후보가 없으면 일정을 줄인다)로 다룬다.

// 좌표가 없으면 NaN 대신 null: "공항 거리 계산 불가". 0m(공항에 가장 가까움)로 취급하지 않는다.
export const distanceToAirport = (place, airport = JEJU_AIRPORT) => (isLatLng(place) ? haversineMeters(place, airport) : null)

// 후보 필터/정렬: 공항 반대 방향으로 깊게 들어가는 후보(출발점보다도 멀고 LAST_DAY_FAR_METERS 도 넘는 곳)를 뺀다.
// 남는 후보가 count 보다 적으면 필터 없이 공항에 가까운 순서로 돌려준다. (후보가 부족해서 모험이 못 만들어지면 안 된다)
export function convergeCandidates(candidates, { origin = null, airport = JEJU_AIRPORT, minCount = 3 } = {}) {
  // 좌표 없는 후보는 거리를 알 수 없으므로 정렬/필터에서 빼고, 좌표 있는 후보 뒤에 원래 순서대로 붙인다. (정상 후보보다 앞서지 않는다)
  const located = candidates.filter((place) => isLatLng(place))
  const unlocated = candidates.filter((place) => !isLatLng(place))
  const originDistance = origin ? distanceToAirport(origin, airport) : null
  const originLimit = originDistance == null ? LAST_DAY_FAR_METERS : Math.max(originDistance, LAST_DAY_FAR_METERS)
  const kept = located.filter((place) => distanceToAirport(place, airport) <= originLimit)
  const pool = kept.length + unlocated.length >= minCount ? kept : located
  return [...pool].sort((a, b) => distanceToAirport(a, airport) - distanceToAirport(b, airport)).concat(unlocated)
}

// 챕터 순서: 공항에서 먼 곳부터 → 가까운 곳으로 (챕터가 갈수록 공항에 가까워진다). corePlace(placeId) → 좌표는 placeOf 로 찾는다.
// 챕터 중 하나라도 좌표를 모르면 무리하게 재정렬하지 않고 원래 순서를 그대로 둔다. (좌표 없는 챕터를 공항 0m 로 취급하지 않는다)
export function orderChaptersTowardAirport(chapters, placeOf, airport = JEJU_AIRPORT) {
  const distances = chapters.map((chapter) => distanceToAirport(placeOf(chapter), airport))
  if (distances.some((d) => d == null)) return [...chapters]
  return chapters.map((chapter, index) => ({ chapter, index, d: distances[index] })).sort((a, b) => b.d - a.d || a.index - b.index).map((x) => x.chapter)
}

// 마지막 챕터 핵심 장소 → 공항 이동이 maxMinutes 이하여야 한다(강한 선호). 넘으면 일정을 최소 챕터 수까지 줄인다.
// chapters 는 이미 공항 방향 순서. → { chapters, shortened, lastTravelMinutes }
export function fitToAirportReach(chapters, { lastTravelMinutes, minChapters = 2, maxMinutes = LAST_DAY_AIRPORT_MAX_MIN }) {
  if (!Number.isFinite(lastTravelMinutes) || lastTravelMinutes <= maxMinutes || chapters.length <= minChapters) {
    return { chapters, shortened: false, lastTravelMinutes: lastTravelMinutes ?? null }
  }
  // 공항에 가까운 것부터 최소 개수만 남긴다 (일정 단축). 순서는 그대로 공항 방향.
  return { chapters: chapters.slice(chapters.length - minChapters), shortened: true, lastTravelMinutes }
}
