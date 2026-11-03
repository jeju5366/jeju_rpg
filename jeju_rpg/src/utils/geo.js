// 좌표 표준은 항상 { lat, lng } (number). 서버(api/_lib/geo.js)와 화면이 같은 계산을 쓴다.
export function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)))
}

export const isLatLng = (value) =>
  Number.isFinite(value?.lat) && Number.isFinite(value?.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
