import { saveTripFeedback } from '../_lib/finalQuest/service.js'
import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/trip-feedback  { tripId, rating?, density?, placesRating?, difficulty?, comment? }  → { feedback }  (여행당 1건, 다시 저장하면 덮어씀)
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.tripId ?? '')) throw new HttpError(400, 'tripId is invalid')
    return saveTripFeedback({ user, tripId: body.tripId, rating: body.rating ?? null, density: body.density ?? null, placesRating: body.placesRating ?? null, difficulty: body.difficulty ?? null, comment: body.comment ?? null })
  },
  { method: 'POST' },
)
