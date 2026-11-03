import { apiPost } from '../api/apiClient.js'

// GENERATE_QUESTS: 선택한 모험의 메인 + 챕터 + 핵심/선택 퀘스트 생성 (모험당 1회, 서버가 검증/저장)
// → { source: 'openai' | 'demo', fallbackReason, chapters, quests }
export function generateQuests(adventureId) {
  return apiPost('quests-generate', { adventureId })
}

// 퀘스트 완료. 기본은 직접 확인(self). 위치 인증은 { method: 'gps', position } 을 함께 보내고 서버가 거리를 검증한다.
//   position: { lat, lng, accuracy, timestamp }
// GPS 인증이 실패하면 오류 코드(gps_accuracy_low / gps_too_far / gps_position_stale ...)와 error.details(distanceMeters 등)가 온다.
// 사진 인증은 10단계에서 이 경로에 붙는다.
// → { progress, chapterStatus, rewards }
export function completeQuest(questId, verification = {}) {
  return apiPost('quests-complete', { questId, ...verification })
}

// "퀘스트 더 받기": 숨겨 둔 선택 퀘스트 공개 (AI 재호출 없음) → { revealed, remainingHidden }
export function revealQuests(chapterId) {
  return apiPost('quests-reveal', { chapterId })
}
