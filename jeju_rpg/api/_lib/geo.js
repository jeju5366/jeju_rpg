// 좌표 표준은 항상 { lat, lng } (number).
// 거리 계산은 화면과 같은 구현을 쓴다. (GPS 인증/경로 검증을 서버와 화면이 같은 기준으로 하기 위해)
export { haversineMeters } from '../../src/utils/geo.js'

// API 마다 제각각인 좌표 표현을 { lat, lng } 로 통일한다. 변환 불가하면 null.
//  - TourAPI: { mapx(경도), mapy(위도) } / TAGO: { gpslati, gpslong }
export function toLatLng(raw) {
  const lat = Number(raw?.mapy ?? raw?.gpslati)
  const lng = Number(raw?.mapx ?? raw?.gpslong)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}