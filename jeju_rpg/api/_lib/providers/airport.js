import { fetchPublicData, toArray } from '../dataGoKr.js'
import { optionalEnv, serviceKey } from '../env.js'
import { runProvider } from '../provider.js'
import { buildMockCongestion, buildMockFlight } from '../mock/airport.js'

// 한국공항공사 (api_test 에서 동작 확인한 호출 방식). 주소가 바뀌면 .env 의 AIRPORT_*_URL 로 덮어쓴다.
//  - 실시간 항공기 운항정보: 마지막 날 항공편 상태 (Final Quest)
//  - 공항 혼잡도: 혼잡도 "단계"만 제공한다. 대기시간/보안검색 소요시간 필드는 없다.
// latestSafeDepartureTime 은 이 값들과 코드 규칙으로 계산한다. GPT 는 계산/추측하지 않는다.
const FLIGHT_DEPART_URL = 'https://apis.data.go.kr/B551178/flight-status/depart'
const CONGESTION_URL = 'https://apis.data.go.kr/B551178/airport-congestion/v1'

const pad = (n) => String(n).padStart(2, '0')
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000)
const ymdKst = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`

// XML/JSON 변환 과정에서 키 대소문자나 값 타입이 달라질 수 있어서 키는 대소문자 무시로 읽는다.
function reader(row) {
  const lower = Object.fromEntries(Object.keys(row).map((key) => [key.toLowerCase(), row[key]]))
  return (key) => {
    const value = lower[key.toLowerCase()]
    return value === undefined || value === null || String(value).trim() === '' ? null : value
  }
}

// '202608150005' -> { text: '2026-08-15 00:05', minutes: 절대 분 (차이 계산용) }
function parseDateTime(value) {
  const s = String(value ?? '').replace(/\D/g, '')
  if (s.length < 12) return null
  const [y, mo, d, h, mi] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12)].map(Number)
  return {
    text: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`,
    minutes: Date.UTC(y, mo - 1, d, h, mi) / 60000,
  }
}

function normalizeFlight(row) {
  const get = reader(row)
  const scheduled = parseDateTime(get('scheduledatetime'))
  const estimated = parseDateTime(get('estimateddatetime'))
  const status = get('rmkKor')
  return {
    airline: get('airline'),
    flightNo: get('flightid'),
    departureAirport: get('depAirport'),
    departureAirportCode: get('depAirportCode'),
    arrivalAirport: get('arrAirport'),
    arrivalAirportCode: get('arrvAirportCode'),
    scheduledDeparture: scheduled?.text ?? null,
    changedDeparture: estimated?.text ?? null,
    diffMinutes: scheduled && estimated ? estimated.minutes - scheduled.minutes : null,
    status, // rmkKor: 출발 / 지연 / 결항 등 (원문 그대로)
    delayed: status == null ? null : /지연/.test(String(status)),
    cancelled: status == null ? null : /결항/.test(String(status)),
  }
}

async function liveFlight({ flightNo, searchday }) {
  // 불필요한 조건은 보내지 않는다: searchday + flight_id + airport_code 만 사용.
  const response = await fetchPublicData(optionalEnv('AIRPORT_FLIGHT_STATUS_URL', FLIGHT_DEPART_URL), {
    serviceKey: serviceKey('AIRPORT_API_KEY'),
    type: 'json',
    pageNo: 1,
    numOfRows: 50,
    searchday,
    flight_id: flightNo,
    airport_code: 'CJU',
  })
  const flights = toArray(response.body?.items).map(normalizeFlight)
  return {
    flightNo,
    searchday,
    found: flights.length > 0,
    departsFromJeju: flights.length ? flights.some((f) => f.departureAirportCode === 'CJU') : null,
    totalCount: Number(response.body?.totalCount ?? flights.length),
    flights,
  }
}

const LEVEL_LABEL = { 1: '원활', 2: '보통', 3: '혼잡', 4: '매우혼잡' }
const level = (value) => {
  const n = Number(value)
  return value == null || !Number.isFinite(n) ? null : { value: n, label: LEVEL_LABEL[Math.round(n)] ?? null }
}

function normalizeCongestion(row) {
  const get = reader(row)
  return {
    airportCode: get('IATA_APCD'),
    time: get('PRC_HR'), // 'HH:MM'
    section1: level(get('CGDR_A_LVL')),
    section2: level(get('CGDR_B_LVL')),
    section3: level(get('CGDR_C_LVL')),
    overall: level(get('CGDR_ALL_LVL')),
  }
}

async function liveCongestion() {
  const response = await fetchPublicData(optionalEnv('AIRPORT_CONGESTION_URL', CONGESTION_URL), {
    serviceKey: serviceKey('AIRPORT_API_KEY'),
    type: 'json',
    pageNo: 1,
    numOfRows: 100, // 1000 은 게이트웨이가 HTTP_ERROR 로 거부함 (실측)
  })
  const all = toArray(response.body?.items).map(normalizeCongestion)
  const hourly = all.filter((r) => r.airportCode === 'CJU' && r.time).sort((a, b) => a.time.localeCompare(b.time))

  // 현재 혼잡도: 지금(KST)보다 이전인 마지막 시각의 값. 없으면 가장 이른 값.
  const now = kstNow()
  const nowHHMM = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`
  const past = hourly.filter((r) => r.time <= nowHHMM)
  const current = past.length ? past[past.length - 1] : (hourly[0] ?? null)

  return {
    totalRows: all.length,
    airports: [...new Set(all.map((r) => r.airportCode).filter(Boolean))],
    current,
    hourly,
    // 실측: 공항별 '현재 시각 1건' 스냅샷만 내려온다. 시간대별 시계열이 아니면 미제공으로 취급.
    hourlyAvailable: hourly.length > 1,
    waitMinutes: null,
    securityMinutes: null,
  }
}

export function getFlightStatus(params) {
  const searchday = params.date || ymdKst(kstNow())
  return runProvider({
    live: () => liveFlight({ flightNo: params.flightNo, searchday }),
    mock: async () => buildMockFlight(params.flightNo, searchday),
  })
}

export function getAirportCongestion() {
  return runProvider({ live: () => liveCongestion(), mock: async () => buildMockCongestion() })
}