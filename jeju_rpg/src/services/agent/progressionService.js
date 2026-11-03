import { apiPost } from '../api/apiClient.js'

// 챕터 이동: active(핵심 미완료) → 건너뛰기, core_completed → 다음 챕터로 진행. (서버가 상태로 판단한다)
// → { chapterStatus, alreadyAdvanced, nextChapterId, adventureCompleted, rewards: { chapterBonus, adventureBonus } }
export function advanceChapter(chapterId) {
  return apiPost('chapters-advance', { chapterId })
}

// 자유 EXP 한 덩어리를 카테고리 하나에 전부 투자 → { amount, category, levelUps, titles }
export function investFreeExp(grantId, category) {
  return apiPost('exp-invest', { grantId, category })
}