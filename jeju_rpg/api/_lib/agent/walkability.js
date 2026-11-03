import { QUEST_RULES } from '../../../src/constants/gameBalance.js'
import { haversineMeters } from '../geo.js'

// 챕터 안에서 "anchor(핵심 장소)에서 걸어서 갈 수 있는 곳"을 판단하는 지점.
// 지금은 직선거리(미터)로 대신한다. NAVER 도보 시간이 붙으면 walkAccess 가 minutes 를 채워 돌려주기만 하면 되고,
// isWalkable / buildNearbyIndex / 검증 코드는 그대로 쓴다.
//   access = { meters, minutes, method }  (minutes 는 도보 시간이 연결되면 숫자, 지금은 null)
export function walkAccess(from, to) {
  return { meters: haversineMeters(from, to), minutes: null, method: 'straight_line' }
}

export function isWalkable(access) {
  if (access.minutes != null) return access.minutes <= QUEST_RULES.walkMaxMinutes
  return access.meters <= QUEST_RULES.walkMaxMeters
}

// anchors 각각에 대해 pool 중 도보 범위 안의 장소를 가까운 순으로 돌려준다. → Map(anchorPlaceId → [{ place, access }])
export function buildNearbyIndex(anchors, pool) {
  const index = new Map()
  for (const anchor of anchors) {
    const near = pool
      .filter((place) => place.placeId !== anchor.placeId)
      .map((place) => ({ place, access: walkAccess(anchor, place) }))
      .filter(({ access }) => isWalkable(access))
      .sort((a, b) => a.access.meters - b.access.meters)
    index.set(anchor.placeId, near)
  }
  return index
}
