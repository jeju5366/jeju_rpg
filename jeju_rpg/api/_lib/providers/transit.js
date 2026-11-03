import { fetchPublicData, toArray } from '../dataGoKr.js'
import { serviceKey } from '../env.js'
import { haversineMeters, toLatLng } from '../geo.js'
import { runProvider } from '../provider.js'
import { MOCK_ARRIVALS, MOCK_ROUTES, MOCK_STOPS } from '../mock/transit.js'

// 국토교통부 TAGO 버스 3종 (api_test 에서 동작 확인한 호출 방식)
const STOPS_URL = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList' // 좌표 근접 정류소
const ARRIVALS_URL = 'https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList' // 정류소별 도착정보
const ROUTE_URL = 'https://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteInfoIem' // 노선 정보

async function liveStops({ lat, lng, limit }) {
  const response = await fetchPublicData(STOPS_URL, {
    serviceKey: serviceKey('TAGO_API_KEY'),
    _type: 'json',
    gpsLati: lat,
    gpsLong: lng,
    numOfRows: 30,
    pageNo: 1,
  })
  return toArray(response.body?.items)
    .map((raw) => {
      const position = toLatLng(raw)
      if (!position) return null
      return {
        stationId: String(raw.nodeid),
        stationName: raw.nodenm,
        stationNo: raw.nodeno != null ? String(raw.nodeno) : null,
        cityCode: raw.citycode != null ? String(raw.citycode) : null,
        lat: position.lat,
        lng: position.lng,
        distanceMeters: haversineMeters({ lat, lng }, position),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
}

async function liveArrivals({ cityCode, nodeId }) {
  const response = await fetchPublicData(ARRIVALS_URL, {
    serviceKey: serviceKey('TAGO_API_KEY'),
    _type: 'json',
    cityCode,
    nodeId,
    numOfRows: 30,
    pageNo: 1,
  })
  return toArray(response.body?.items)
    .map((raw) => ({
      routeId: String(raw.routeid),
      routeNo: String(raw.routeno),
      routeType: raw.routetp ?? null,
      vehicleType: raw.vehicletp ?? null,
      arrivalSec: raw.arrtime != null ? Number(raw.arrtime) : null,
      arrivalMin: raw.arrtime != null ? Math.ceil(Number(raw.arrtime) / 60) : null,
      remainingStops: raw.arrprevstationcnt != null ? Number(raw.arrprevstationcnt) : null,
    }))
    .sort((a, b) => (a.arrivalSec ?? Infinity) - (b.arrivalSec ?? Infinity))
}

async function liveRoute({ cityCode, routeId }) {
  const response = await fetchPublicData(ROUTE_URL, {
    serviceKey: serviceKey('TAGO_API_KEY'),
    _type: 'json',
    cityCode,
    routeId,
  })
  const raw = toArray(response.body?.items)[0]
  if (!raw) return null
  return {
    routeId: String(raw.routeid),
    routeNo: String(raw.routeno),
    routeType: raw.routetp ?? null,
    startStop: raw.startnodenm ?? null,
    endStop: raw.endnodenm ?? null,
  }
}

export function getNearbyStops(params) {
  return runProvider({
    live: () => liveStops(params),
    mock: async () =>
      MOCK_STOPS.map((stop) => ({ ...stop, distanceMeters: haversineMeters(params, stop) }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, params.limit),
  })
}

export function getStopArrivals(params) {
  return runProvider({ live: () => liveArrivals(params), mock: async () => MOCK_ARRIVALS[params.nodeId] ?? [] })
}

export function getRouteInfo(params) {
  return runProvider({ live: () => liveRoute(params), mock: async () => MOCK_ROUTES[params.routeId] ?? null })
}