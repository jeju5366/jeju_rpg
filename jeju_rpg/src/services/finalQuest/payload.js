// Final Quest API 요청 body 만들기 (순수 함수 — 테스트에서 실제 payload 를 확인한다).
// position 은 최근의 유효한 현재 위치({ lat, lng, accuracy, timestamp }) 또는 null.
export const statusBody = (tripId, { refresh = false, position = null } = {}) => ({ action: 'status', tripId, refresh, position })
