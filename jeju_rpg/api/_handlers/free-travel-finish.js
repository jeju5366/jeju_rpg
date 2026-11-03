import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'
import { finishFreeTravel } from '../_lib/freeTravel/service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/free-travel-finish  { sessionId, visits: [{ placeId, lat, lng, source }], route: [{ lat, lng, t }], candidatesSeen }
//   → { alreadyEnded, saved, rejected, rewards: { discoveries, levelUps, titles } }
// 자유여행 종료 확인 후 "방문한 장소 저장"에서 사용자가 고른 방문만 저장하고, 여행 모드를 quest 로 되돌린다.
// route(이동 경로)는 방문 검증에만 쓰고 저장하지 않는다. 선택한 방문이 없으면 visits 를 빈 배열로 보내면 된다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.sessionId ?? '')) throw new HttpError(400, 'sessionId is invalid')
    return finishFreeTravel({ user, sessionId: body.sessionId, visits: body.visits ?? [], route: body.route ?? [], candidatesSeen: Number(body.candidatesSeen) })
  },
  { method: 'POST' },
)
