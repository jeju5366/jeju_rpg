import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { startFreeTravel } from './_lib/freeTravel/service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/free-travel-start  { adventureId }  → { session, alreadyActive }
// 진행 중인 모험(active)을 그대로 둔 채 여행 모드만 free 로 바꾼다. 사용자가 확인 모달에서 "자유여행 시작"을 눌렀을 때만 호출된다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.adventureId ?? '')) throw new HttpError(400, 'adventureId is invalid')
    return startFreeTravel({ user, adventureId: body.adventureId })
  },
  { method: 'POST' },
)
