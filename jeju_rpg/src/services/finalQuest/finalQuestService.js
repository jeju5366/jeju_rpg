import { apiGet, apiPost } from '../api/apiClient.js'
import { statusBody } from './payload.js'

// Final Quest / 여행 종료 / 여행 기록 API 호출. 판단(안전 시간, 상태 전이, EXP)은 모두 서버가 한다.

// 현재 Final Quest 상태. 마지막 날에만 서버가 외부 조회를 하고(TTL 캐시), 그 외에는 가볍게 none 을 돌려준다.
// → { status: none|notice|active|moving|arrived|flight_cancelled|needs_flight_info|trip_completed, phase, safe, flight, locked, noticeLock, ... }
// position: 최근의 유효한 현재 위치(있을 때만, 없으면 null). 서버가 현재 위치 → 제주공항 이동시간 계산에 쓴다.
export function fetchFinalQuestState(tripId, { refresh = false, position = null } = {}) {
  return apiPost('final-quest', statusBody(tripId, { refresh, position }))
}

// [공항으로 이동 시작]
export function startFinalQuestMove(tripId) {
  return apiPost('final-quest', { action: 'start', tripId })
}

// 공항 500m GPS 도착 확인. position: { lat, lng, accuracy, timestamp } → { status, awarded, amount }
export function arriveAtAirport(tripId, position) {
  return apiPost('final-quest', { action: 'arrive', tripId, position })
}

// [여행 마무리] → { record }  (trips.status = completed)
export function finishTripRequest(tripId) {
  return apiPost('final-quest', { action: 'finish', tripId })
}

// 지난 여행 목록 / 여행 상세 기록
export const fetchPastTrips = () => apiGet('trip-records')
export const fetchTripRecord = (tripId) => apiGet('trip-records', { tripId })

// 여행 피드백 저장(여행당 1건, 다시 저장하면 덮어쓴다)
export function saveTripFeedback(tripId, feedback) {
  return apiPost('trip-feedback', { tripId, ...feedback })
}
