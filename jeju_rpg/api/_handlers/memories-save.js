import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'
import { saveMemoryPhoto } from '../_lib/memory/service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/memories-save  { questId, image(base64), caption? }  → { saved, alreadySaved, photo }
// 사진 인증으로 완료한 퀘스트의 사진을 "추억으로 남기기". Supabase Storage(travel-memories)에 영구 저장하고 travel_photos 에 기록한다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.questId ?? '')) throw new HttpError(400, 'questId is invalid')
    return saveMemoryPhoto({ user, questId: body.questId, image: body.image, caption: body.caption })
  },
  { method: 'POST' },
)
