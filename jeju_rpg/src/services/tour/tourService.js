import { apiGet } from '../api/apiClient.js'

// 관광지/문화시설/음식점/행사 후보 + 위치 기반 주변 정보 (TourAPI)
// contentTypeId: 12 관광지, 14 문화시설, 15 행사·축제, 39 음식점 (생략하면 전체). radius 는 미터, limit 기본 20.
export function fetchNearbyPlaces({ lat, lng, radius, contentTypeId, limit }) {
  return apiGet('places', {
    lat,
    lng,
    ...(radius ? { radius } : {}),
    ...(contentTypeId ? { contentTypeId } : {}),
    ...(limit ? { limit } : {}),
  })
}