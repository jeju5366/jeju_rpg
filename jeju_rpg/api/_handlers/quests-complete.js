import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'
import { completeQuest } from '../_lib/quests/progress.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/quests-complete  { questId }  → { progress, chapterCompleted, adventureCompleted }
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.questId ?? '')) throw new HttpError(400, 'questId is invalid')
    // body 의 나머지(현재 위치, 사진 등)는 9~10단계의 인증 검증이 payload 로 받는다. 지금은 쓰지 않는다.
    return completeQuest({ user, questId: body.questId, payload: body })
  },
  { method: 'POST' },
)