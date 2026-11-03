import { fetchPublicData, toArray } from '../dataGoKr.js'
import { serviceKey } from '../env.js'
import { haversineMeters, toLatLng } from '../geo.js'
import { runProvider } from '../provider.js'
import { MOCK_PLACES } from '../mock/places.js'

// 한국관광공사 국문 관광정보 (api_test 에서 동작 확인한 호출 방식)
// TourAPI 가 KorService1 -> KorService2 로 넘어가는 중이라 둘 다 시도한다.
const ENDPOINTS = [
  'https://apis.data.go.kr/B551011/KorService2/locationBasedList2',
  'https://apis.data.go.kr/B551011/KorService1/locationBasedList1',
]

async function locationBasedList({ lat, lng, radius, contentTypeId, limit }) {
  const params = {
    serviceKey: serviceKey('TOUR_API_KEY'),
    MobileOS: 'ETC',
    MobileApp: 'JejuRPG',
    _type: 'json',
    mapX: lng, // TourAPI 는 X=경도, Y=위도
    mapY: lat,
    radius,
    contentTypeId, // 12 관광지 / 14 문화시설 / 15 행사·축제 / 39 음식점 (생략하면 전체)
    numOfRows: limit,
    pageNo: 1,
    arrange: 'E', // 거리순
  }
  let firstError
  for (const url of ENDPOINTS) {
    try {
      return toArray((await fetchPublicData(url, params)).body?.items)
    } catch (error) {
      firstError ??= error
    }
  }
  throw firstError
}

// live 결과의 isLandmark 는 whitelist(DB/server)가 아직 없어 항상 false. (8단계)
async function liveNearby(params) {
  const origin = { lat: params.lat, lng: params.lng }
  return (await locationBasedList(params))
    .map((raw) => {
      const position = toLatLng(raw)
      if (!position) return null
      return {
        placeId: String(raw.contentid),
        name: raw.title,
        contentTypeId: Number(raw.contenttypeid),
        address: [raw.addr1, raw.addr2].filter(Boolean).join(' '),
        lat: position.lat,
        lng: position.lng,
        imageUrl: raw.firstimage || raw.firstimage2 || null,
        distanceMeters: haversineMeters(origin, position),
        isLandmark: false,
      }
    })
    .filter(Boolean)
}

async function mockNearby({ lat, lng, radius, contentTypeId, limit }) {
  return MOCK_PLACES.map((place) => ({
    ...place,
    imageUrl: null,
    distanceMeters: haversineMeters({ lat, lng }, place),
  }))
    .filter((place) => place.distanceMeters <= radius && (!contentTypeId || place.contentTypeId === contentTypeId))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
}

export function getNearbyPlaces(params) {
  return runProvider({ live: () => liveNearby(params), mock: () => mockNearby(params) })
}