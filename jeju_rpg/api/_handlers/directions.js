import { createHandler } from '../_lib/handler.js'
import { numberParam, stringParam } from '../_lib/http.js'
import { DRIVING_OPTIONS, getDrivingRoute } from '../_lib/providers/directions.js'

// GET /api/directions?startLat=&startLng=&goalLat=&goalLng=[&option=traoptimal]  (자동차 이동시간/거리)
export default createHandler((query) =>
  getDrivingRoute({
    start: { lat: numberParam(query, 'startLat', { min: 33, max: 39 }), lng: numberParam(query, 'startLng', { min: 124, max: 132 }) },
    goal: { lat: numberParam(query, 'goalLat', { min: 33, max: 39 }), lng: numberParam(query, 'goalLng', { min: 124, max: 132 }) },
    option: stringParam(query, 'option', { pattern: new RegExp(`^(${DRIVING_OPTIONS.join('|')})$`), fallback: 'traoptimal' }),
  }),
)