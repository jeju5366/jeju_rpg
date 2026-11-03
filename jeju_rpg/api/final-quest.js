import { arriveFinalQuest, evaluateFinalQuest, finishTrip, startFinalQuestMove } from './_lib/finalQuest/service.js'
import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/final-quest  { action: 'status' | 'start' | 'arrive' | 'finish', tripId, position?, refresh? }
//   status : 현재 Final Quest 상태 평가 (마지막 날에만 외부 조회, TTL 캐시)  → { status, phase, safe, flight, ... }
//   start  : [공항으로 이동 시작]
//   arrive : 공항 500m GPS 도착 확인 (+100 EXP, 한 번만)  body.position = { lat, lng, accuracy, timestamp }
//   finish : [여행 마무리] → trips.status = completed, 여행 기록 확정 → { record }
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.tripId ?? '')) throw new HttpError(400, 'tripId is invalid')
    const common = { user, tripId: body.tripId }
    switch (body.action) {
      case 'status':
        return evaluateFinalQuest({ ...common, position: body.position ?? null, refresh: body.refresh === true })
      case 'start':
        return startFinalQuestMove(common)
      case 'arrive':
        return arriveFinalQuest({ ...common, position: body.position })
      case 'finish':
        return finishTrip(common)
      default:
        throw new HttpError(400, 'action_invalid')
    }
  },
  { method: 'POST' },
)
