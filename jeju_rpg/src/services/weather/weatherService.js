import { apiGet } from '../api/apiClient.js'

// 현재 날씨 + 시간대별 예보 (기상청 단기예보). 날씨 변화 판단은 코드 규칙이 하고 GPT 는 추측하지 않는다.
export function fetchWeather({ lat, lng }) {
  return apiGet('weather', { lat, lng })
}