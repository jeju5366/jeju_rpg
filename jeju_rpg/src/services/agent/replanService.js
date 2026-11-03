import { apiPost } from '../api/apiClient.js'

// "오늘 일정 다시 맞추기": 사용자가 이 버튼을 직접 눌렀을 때만 REPLAN_ADVENTURE 를 요청한다.
// 설정(숙소/항공편/일일 조건)을 수정하는 것만으로는 절대 호출하지 않는다. (수정은 DB 저장만)
// 서버의 REPLAN 본체는 11단계에서 구현되며, 지금은 501(replan_not_implemented) 로 응답한다.
// context: reason 별 부가 정보. RETURN_FROM_FREE_TRAVEL 은 { sessionId, position, visitedPlaceIds, reasons }
export function requestReplan({ adventureId, reason = 'USER_REQUEST', context }) {
  return apiPost('adventures-replan', { adventureId, reason, ...(context ? { context } : {}) })
}

// 자유여행에서 돌아왔을 때의 REPLAN 요청. (자유여행 종료 → 복귀 판정이 needsReplan 이고 사용자가 "일정 다시 맞추기"를 눌렀을 때만)
// 완료한 챕터/퀘스트/EXP/방문·발견 기록은 REPLAN 이 바꾸지 않는다. 남은 일정만 대상이다. (11단계에서 서버가 강제)
export function requestReplanAfterFreeTravel({ adventureId, sessionId, position, visitedPlaceIds, reasons }) {
  return requestReplan({
    adventureId,
    reason: 'RETURN_FROM_FREE_TRAVEL',
    context: {
      sessionId,
      position: position ? { lat: position.lat, lng: position.lng } : null,
      visitedPlaceIds: visitedPlaceIds ?? [],
      reasons: reasons ?? [],
    },
  })
}
