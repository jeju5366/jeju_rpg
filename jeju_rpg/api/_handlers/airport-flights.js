import { createHandler } from '../_lib/handler.js'
import { stringParam } from '../_lib/http.js'
import { getFlightStatus } from '../_lib/providers/airport.js'

// GET /api/airport-flights?flightNo=KE1406[&date=YYYYMMDD]  (제주 출발편 운항 상태, date 기본 오늘)
export default createHandler((query) => {
  const flightNo = String(query.flightNo ?? '').replace(/\s+/g, '').toUpperCase()
  return getFlightStatus({
    flightNo: stringParam({ flightNo }, 'flightNo', { pattern: /^[A-Z0-9]{2,3}\d{1,4}$/ }),
    date: stringParam(query, 'date', { pattern: /^\d{8}$/, fallback: '' }),
  })
})