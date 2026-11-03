import { createHandler } from './_lib/handler.js'
import { stringParam } from './_lib/http.js'
import { getStopArrivals } from './_lib/providers/transit.js'

// GET /api/transit-arrivals?cityCode=&nodeId=  (정류장별 버스 도착 예정. 두 값은 transit-stops 응답에서 얻는다)
export default createHandler((query) =>
  getStopArrivals({
    cityCode: stringParam(query, 'cityCode', { pattern: /^[0-9A-Za-z]{1,10}$/ }),
    nodeId: stringParam(query, 'nodeId', { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
  }),
)