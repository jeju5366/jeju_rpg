import { createHandler } from '../_lib/handler.js'
import { numberParam } from '../_lib/http.js'
import { getWeather } from '../_lib/providers/weather.js'

// GET /api/weather?lat=&lng=  (현재 날씨 + 시간대별 예보)
export default createHandler((query) =>
  getWeather({
    lat: numberParam(query, 'lat', { min: 33, max: 39 }),
    lng: numberParam(query, 'lng', { min: 124, max: 132 }),
  }),
)