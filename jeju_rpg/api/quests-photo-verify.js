import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { verifyQuestPhoto } from './_lib/quests/photoVerify.js'

// 사진 인증은 AI 호출이 들어가서 Agent 와 같은 최대 실행 시간을 쓴다. (로컬 dev 에서는 무시)
export const config = { maxDuration: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/quests-photo-verify  { questId, attemptId, image(base64) }
//   → { result: pass|uncertain|fail, reason, completed, awaiting?, photo: { attemptsUsed, attemptsLeft, errors, canFallback }, progress?, rewards? }
// 사진 인증 1회. 인증용 사진은 저장하지 않고 분석 후 버린다. pass 면 기존 퀘스트 완료 흐름(EXP/방문/발견)으로 이어진다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.questId ?? '')) throw new HttpError(400, 'questId is invalid')
    return verifyQuestPhoto({ user, questId: body.questId, attemptId: body.attemptId, image: body.image })
  },
  { method: 'POST' },
)
