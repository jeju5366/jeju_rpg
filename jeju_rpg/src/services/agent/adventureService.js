import { apiPost } from '../api/apiClient.js'

// GENERATE_ADVENTURES: 오늘의 모험 3개 생성 (최초 1세트 + 재생성 1세트).
// 후보 장소 수집/검증/저장은 서버가 하고, 화면은 결과만 받는다.
// → { source: 'openai' | 'demo', generationSet, fallbackReason, adventures }
export function generateAdventures({ tripId, adventureDate, travelRange }) {
  return apiPost('adventures-generate', { tripId, adventureDate, travelRange })
}

// 모험 선택 (proposed → selected)
export function selectAdventure(adventureId) {
  return apiPost('adventures-select', { adventureId })
}