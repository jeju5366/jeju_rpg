import { createHandler } from './_lib/handler.js'
import { numberParam } from './_lib/http.js'
import { getNearbyStops } from './_lib/providers/transit.js'

// GET /api/transit-stops?lat=&lng=&limit=  (주변 버스정류장, 가까운 순. limit 기본 10, 최대 30)
export default createHandler((query) =>
  getNearbyStops({
    lat: numberParam(query, 'lat', { min: 33, max: 39 }),
    lng: numberParam(query, 'lng', { min: 124, max: 132 }),
    limit: numberParam(query, 'limit', { min: 1, max: 30, fallback: 10 }),
  }),
)