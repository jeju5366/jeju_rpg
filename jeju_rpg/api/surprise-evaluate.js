import { evaluateSurprise } from './_lib/agent/surprise.js'
import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'

export const config = { maxDuration: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/surprise-evaluate  { adventureId, trigger, position?, speedMs?, dwellMs?, replanNeeded?, verificationOpen?, transitioning? }
//   → { offered: true, quest } | { offered: false, reason }
// GENERATE_SURPRISE_QUEST. 서버가 "안정적인 시점인지"를 코드로 다시 판단하고(이동 중이면 생성 X), 통과했을 때만 Agent 를 호출한다.
// 화면은 안정적인 시점(핵심 퀘스트 완료 직후, 챕터 완료 후, anchor 도착/체류 등)에서만 이 API 를 부른다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.adventureId ?? '')) throw new HttpError(400, 'adventureId is invalid')
    const position = Number.isFinite(body.position?.lat) && Number.isFinite(body.position?.lng) ? { lat: body.position.lat, lng: body.position.lng } : null
    return evaluateSurprise({
      user,
      adventureId: body.adventureId,
      trigger: body.trigger,
      position,
      speedMs: Number.isFinite(body.speedMs) ? body.speedMs : null,
      dwellMs: Number.isFinite(body.dwellMs) ? body.dwellMs : null,
      replanNeeded: Boolean(body.replanNeeded),
      verificationOpen: Boolean(body.verificationOpen),
      transitioning: Boolean(body.transitioning),
    })
  },
  { method: 'POST' },
)
