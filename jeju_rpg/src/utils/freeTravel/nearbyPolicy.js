import {
  NEARBY_FAILURE_COOLDOWN_MS,
  NEARBY_MIN_INTERVAL_MS,
  NEARBY_REFETCH_DISTANCE_METERS,
  NEARBY_REFETCH_TTL_MS,
} from '../../constants/locationRules.js'
import { haversineMeters } from '../geo.js'

// 주변 장소를 "지금 다시 가져와야 하는지" 판단한다. GPS 갱신마다 TourAPI 를 부르지 않기 위한 규칙.
// cache: { center: {lat,lng}, fetchedAt, failedAt, fetching } | null
export function shouldFetchNearby(cache, position, now) {
  if (!cache) return true
  if (cache.fetching) return false
  if (cache.failedAt && now - cache.failedAt < NEARBY_FAILURE_COOLDOWN_MS) return false
  if (cache.fetchedAt && now - cache.fetchedAt < NEARBY_MIN_INTERVAL_MS) return false
  if (!cache.center || !cache.fetchedAt) return true
  return haversineMeters(cache.center, position) >= NEARBY_REFETCH_DISTANCE_METERS || now - cache.fetchedAt >= NEARBY_REFETCH_TTL_MS
}
