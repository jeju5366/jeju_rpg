import { apiGet } from '../api/apiClient.js'

// 제주 출발편 운항 상태 (한국공항공사 실시간 항공기 운항정보). flightNo 예: KE1406, date: YYYYMMDD (기본 오늘)
export function fetchFlightStatus({ flightNo, date }) {
  return apiGet('airport-flights', { flightNo, ...(date ? { date } : {}) })
}

// 제주공항 혼잡도 단계 (한국공항공사 공항 혼잡도). 대기시간 값은 제공되지 않는다.
export function fetchAirportCongestion() {
  return apiGet('airport-congestion')
}