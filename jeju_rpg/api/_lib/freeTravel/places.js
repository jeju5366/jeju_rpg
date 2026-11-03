import { haversineMeters } from '../geo.js'
import { getNearbyPlaces } from '../providers/tour.js'

// 방문 확정 요청의 장소를 서버가 다시 확인한다.
// 클라이언트가 보낸 placeId/좌표를 그대로 믿으면 아무 장소나 만들어서 발견 EXP 를 받을 수 있으므로,
// 그 좌표 주변 TourAPI 조회 결과에 같은 placeId 가 있을 때만 인정하고, 이름/좌표/유형은 조회 결과 값을 쓴다.
const VERIFY_RADIUS_METERS = 500

export async function verifyPlaces(requested) {
  const entries = await Promise.all(
    requested.map(async (visit) => {
      try {
        const result = await getNearbyPlaces({ lat: visit.lat, lng: visit.lng, radius: VERIFY_RADIUS_METERS, limit: 50 })
        const found = result.data.find((place) => place.placeId === visit.placeId)
        return [visit.placeId, found && haversineMeters(visit, found) <= VERIFY_RADIUS_METERS ? found : null]
      } catch (error) {
        console.error('[free-travel] 장소 확인 실패', visit.placeId, error.message)
        return [visit.placeId, null]
      }
    }),
  )
  return new Map(entries)
}
