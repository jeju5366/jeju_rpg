import { TRAVEL_RANGES } from '../src/constants/gameBalance.js'
import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { generateAdventures } from './_lib/agent/generateAdventures.js'

// OpenAI 호출이 길어질 수 있어 Vercel 함수 최대 실행 시간을 늘린다. (로컬 dev 에서는 무시)
export const config = { maxDuration: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

// POST /api/adventures-generate  { tripId, adventureDate: 'YYYY-MM-DD', travelRange: near|normal|anywhere }
// → { source: 'openai' | 'demo', generationSet, fallbackReason, adventures }
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.tripId ?? '')) throw new HttpError(400, 'tripId is invalid')
    if (!DATE.test(body.adventureDate ?? '')) throw new HttpError(400, 'adventureDate is invalid')
    if (!TRAVEL_RANGES.includes(body.travelRange)) throw new HttpError(400, 'travelRange is invalid')
    return generateAdventures({ user, tripId: body.tripId, adventureDate: body.adventureDate, travelRange: body.travelRange })
  },
  { method: 'POST' },
)