import { createHandler } from '../_lib/handler.js'
import { getAirportCongestion } from '../_lib/providers/airport.js'

// GET /api/airport-congestion  (제주공항 혼잡도 단계. 대기시간 값은 제공되지 않는다)
export default createHandler(() => getAirportCongestion())