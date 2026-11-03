import { apiPost } from '../api/apiClient.js'

// GENERATE_SURPRISE_QUEST: 안정적인 시점(핵심 퀘스트 완료 직후 / 챕터 완료 후 / anchor 체류 등)에서만 부른다.
// 서버가 gate 를 다시 판단하므로 이동 중이면 { offered: false, reason: 'moving' } 이 온다.
// → { offered: true, quest } | { offered: false, reason }
export function evaluateSurprise({ adventureId, trigger, position, speedMs, dwellMs, replanNeeded, verificationOpen, transitioning }) {
  return apiPost('surprise-evaluate', { adventureId, trigger, position, speedMs, dwellMs, replanNeeded, verificationOpen, transitioning })
}

// 도전하기('accept') / 이번엔 지나가기('decline'). 거절은 실패가 아니다. (EXP/선호도 불이익 없음)
export function respondSurprise(questId, action) {
  return apiPost('surprise-respond', { questId, action })
}
