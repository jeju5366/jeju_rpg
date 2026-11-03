import { createHandler } from '../_lib/handler.js'
import { stringParam } from '../_lib/http.js'
import { getRouteInfo } from '../_lib/providers/transit.js'

// GET /api/transit-routes?cityCode=&routeId=  (버스 노선 정보. routeId 는 transit-arrivals 응답에서 얻는다)
export default createHandler((query) =>
  getRouteInfo({
    cityCode: stringParam(query, 'cityCode', { pattern: /^[0-9A-Za-z]{1,10}$/ }),
    routeId: stringParam(query, 'routeId', { pattern: /^[A-Za-z0-9_-]{1,40}$/ }),
  }),
)