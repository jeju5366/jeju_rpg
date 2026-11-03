import { PHOTO_AI_MAX_ATTEMPTS, PHOTO_AI_MAX_ERRORS, PHOTO_PEOPLE_KEYWORDS } from '../constants/photoRules.js'

// 사진 인증 규칙 중 서버(api/)와 화면이 같이 쓰는 순수 함수들.

// 사진이 들어가는 인증 방식. DB 의 verification_type 중 photo_upload / photo_ai / gps_photo 가 해당한다.
export const PHOTO_TYPES = ['photo_upload', 'photo_ai', 'gps_photo']
export const isPhotoQuest = (quest) => PHOTO_TYPES.includes(quest?.verification_type)

// 사진 확인 방식
//   ai_check    : AI 가 사진이 퀘스트가 요구한 대상을 보여주는지 판정 (pass / uncertain / fail, 최대 2회)
//   upload_only : 정답이 없는 퀘스트("오늘 기억에 남는 풍경")나 사람이 중심인 퀘스트는 사진을 올리기만 하면 인증 성공. AI 로 분석하지 않는다.
// 우선순위: quest.data.photoMode(명시) → photo_upload 타입 → 사람 중심 퀘스트(키워드/social) → ai_check
export function photoModeOf(quest) {
  const explicit = quest.data?.photoMode
  if (explicit === 'ai_check' || explicit === 'upload_only') return explicit
  if (quest.verification_type === 'photo_upload') return 'upload_only'
  const text = `${quest.title ?? ''} ${quest.description ?? ''}`
  if (PHOTO_PEOPLE_KEYWORDS.test(text) || quest.category_primary === 'social') return 'upload_only'
  return 'ai_check'
}

// AI 에게 "무엇이 보여야 하는지"로 전달할 대상. 서버가 가진 퀘스트 데이터에서만 가져온다. (명시한 photoSubject 가 우선)
export function photoSubjectOf(quest) {
  return quest.data?.photoSubject || quest.verification_target || quest.place_name || null
}

// quest_progress 행(없으면 null)로 본 사진 인증 상태.
//   exhausted: AI 사진 인증을 다 썼다(판정 2회를 받았거나 AI 호출이 2번 실패) → 직접 확인(self) fallback 가능
export function photoAttemptState(progress) {
  const attemptsUsed = progress?.photo_attempts ?? 0
  const errors = progress?.photo_errors ?? 0
  return {
    attemptsUsed,
    attemptsLeft: Math.max(0, PHOTO_AI_MAX_ATTEMPTS - attemptsUsed),
    errors,
    exhausted: attemptsUsed >= PHOTO_AI_MAX_ATTEMPTS || errors >= PHOTO_AI_MAX_ERRORS,
  }
}

// 사진 인증 결과에서 인증 사진을 메모리에 보관(추억으로 남기기 후보)해야 하는지. 사진이 통과했다면 완료 여부와 상관없이 보관한다.
// (gps_photo 에서 사진을 GPS 보다 먼저 통과해도 이후 GPS 로 완료됐을 때 추억 저장이 가능하도록) 서버/Storage 에는 저장하지 않는다.
export const shouldKeepPhotoBlob = (result) => result?.result === 'pass'
