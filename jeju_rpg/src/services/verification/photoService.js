import { apiPost } from '../api/apiClient.js'
import { blobToBase64 } from '../../utils/imageResize.js'

// 사진 인증 / 추억 저장 서버 연결. 페이지/컴포넌트는 이 파일만 거친다. (OpenAI 는 서버에서만 호출한다)

// 사진 인증 1회. blob 은 resizeImageFile 로 줄인 이미지. attemptId 는 사진을 고를 때마다 새로 만든 UUID 다. (같은 사진 재전송은 AI 를 다시 부르지 않는다)
// → { result: 'pass'|'uncertain'|'fail', reason, completed, awaiting?, photo: { attemptsUsed, attemptsLeft, errors, canFallback }, progress?, rewards? }
// 실패 코드(error.code): photo_busy / photo_attempts_exhausted / photo_ai_failed (error.details.photo 에 횟수) / image_invalid / image_too_large ...
export async function verifyQuestPhoto({ questId, attemptId, blob }) {
  return apiPost('quests-photo-verify', { questId, attemptId, image: await blobToBase64(blob) })
}

// "추억으로 남기기". 인증용 사진을 Storage 에 영구 저장하고 travel_photos 에 기록한다. (퀘스트당 1장, 중복 저장 안 됨)
// → { saved, alreadySaved, photo }
export async function saveMemoryPhoto({ questId, blob, caption }) {
  return apiPost('memories-save', { questId, image: await blobToBase64(blob), ...(caption ? { caption } : {}) })
}
