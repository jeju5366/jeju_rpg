import { apiGet } from '../api/apiClient.js'

// 주변 버스정류장 (TAGO 버스정류소정보). 응답의 cityCode / stationId 를 다음 호출에 쓴다.
export function fetchNearbyStops({ lat, lng, limit }) {
  return apiGet('transit-stops', { lat, lng, ...(limit ? { limit } : {}) })
}

// 정류장별 도착 예정 (TAGO 버스도착정보). nodeId = 정류장의 stationId
export function fetchStopArrivals({ cityCode, nodeId }) {
  return apiGet('transit-arrivals', { cityCode, nodeId })
}

// 노선 정보 / 접근성 판단 (TAGO 버스노선정보). routeId 는 도착정보 응답에서 얻는다.
export function fetchRouteInfo({ cityCode, routeId }) {
  return apiGet('transit-routes', { cityCode, routeId })
}