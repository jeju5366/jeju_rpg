// REPLAN_ADVENTURE 사유. 11단계에서 REPLAN 본체를 구현할 때 같은 목록을 쓴다.
export const REPLAN_REASONS = [
  'RETURN_FROM_FREE_TRAVEL', // 자유여행에서 복귀 (9단계 연결)
  'WEATHER_CHANGE',
  'SCHEDULE_DELAY',
  'SCHEDULE_AHEAD',
  'PLACE_UNAVAILABLE',
  'USER_REQUEST', // 사용자가 "오늘 일정 다시 맞추기"를 직접 선택
  'ACCOMMODATION_RISK',
]

// 문서에 정의된 REPLAN 제한 (11단계에서 서버/DB 로 강제한다. 지금은 호출 자체가 구현 전이라 적용되지 않는다.)
//  자동 2 + 수동 1 + 중요 예외 1, 하루 절대 4회 / 자동 후 약 30분, 수동 후 약 15분 cooldown / 같은 reason 연속 차단
export const REPLAN_LIMITS = {
  autoPerDay: 2,
  manualPerDay: 1,
  importantPerDay: 1,
  maxPerDay: 4,
  autoCooldownMinutes: 30,
  manualCooldownMinutes: 15,
}
