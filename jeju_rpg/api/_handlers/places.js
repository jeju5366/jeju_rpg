import { createHandler } from '../_lib/handler.js'
import { numberParam } from '../_lib/http.js'
import { getNearbyPlaces } from '../_lib/providers/tour.js'

// GET /api/places?lat=&lng=&radius=&contentTypeId=&limit=
//  radius: 미터(기본 5000, 최대 20000) / limit: 기본 20, 최대 100
//  contentTypeId: 12 관광지, 14 문화시설, 15 행사·축제, 39 음식점 (생략 시 전체)
export default createHandler((query) =>
  getNearbyPlaces({
    lat: numberParam(query, 'lat', { min: 33, max: 39 }),
    lng: numberParam(query, 'lng', { min: 124, max: 132 }),
    radius: numberParam(query, 'radius', { min: 1, max: 20000, fallback: 5000 }),
    limit: numberParam(query, 'limit', { min: 1, max: 100, fallback: 20 }),
    contentTypeId: query.contentTypeId ? numberParam(query, 'contentTypeId', { min: 1, max: 100 }) : undefined,
  }),
)