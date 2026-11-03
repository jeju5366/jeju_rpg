import { respondSurprise } from '../_lib/agent/surprise.js'
import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/surprise-respond  { questId, action: 'accept' | 'decline' }  → { quest }
// 도전하기(accept) / 이번엔 지나가기(decline). 거절은 실패가 아니고 EXP/선호도 불이익이 없다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.questId ?? '')) throw new HttpError(400, 'questId is invalid')
    return respondSurprise({ user, questId: body.questId, action: body.action })
  },
  { method: 'POST' },
)
