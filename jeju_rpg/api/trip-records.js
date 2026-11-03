import { buildTripRecord, listPastTrips } from './_lib/finalQuest/record.js'
import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { getAdmin } from './_lib/supabaseAdmin.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/trip-records            → { trips: [지난 여행 목록] }
// GET /api/trip-records?tripId=... → { record: 여행 상세 기록 }  (본인 여행만)
export default createHandler(async (query, user) => {
  const db = getAdmin()
  if (!query.tripId) return { trips: await listPastTrips(db, { userId: user.id }) }
  if (!UUID.test(query.tripId)) throw new HttpError(400, 'tripId is invalid')
  return { record: await buildTripRecord(db, { userId: user.id, tripId: query.tripId }) }
})
