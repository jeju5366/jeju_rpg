import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'
import { revealQuests } from '../_lib/quests/progress.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/quests-reveal  { chapterId }  → { revealed, remainingHidden }   ("퀘스트 더 받기", AI 재호출 없음)
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.chapterId ?? '')) throw new HttpError(400, 'chapterId is invalid')
    return revealQuests({ user, chapterId: body.chapterId })
  },
  { method: 'POST' },
)