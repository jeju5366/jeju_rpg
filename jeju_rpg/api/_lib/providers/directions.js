import { requireEnv } from '../env.js'
import { haversineMeters } from '../geo.js'
import { runProvider } from '../provider.js'

// NAVER Maps Directions 5 (자동차 길찾기). api_test 에서 동작 확인한 호출 방식.
// 인증: Dynamic Map 과 같은 NAVER Maps Application 의 Client ID / Secret 을 헤더로 보낸다.
// Secret 은 서버에만 두고 브라우저로 보내지 않는다.
// 공식 문서: start/goal 은 "경도,위도", 거리 단위 m, 소요시간 단위 ms, code 0 이 성공.
const HOSTS = ['https://maps.apigw.ntruss.com', 'https://naveropenapi.apigw.ntruss.com'] // 신규 호스트 먼저
const PATH = '/map-direction/v1/driving'
export const DRIVING_OPTIONS = ['trafast', 'tracomfort', 'traoptimal', 'traavoidtoll', 'traavoidcaronly']

const clientId = () => process.env.NAVER_MAP_CLIENT_ID?.trim() || requireEnv('VITE_NAVER_MAP_CLIENT_ID')

async function callHost(host, params, headers) {
  const url = new URL(host + PATH)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // 본문이 JSON 이 아니면 아래에서 text 로 오류를 만든다.
  }
  return { response, json, text }
}

async function liveDriving({ start, goal, option }) {
  const headers = {
    'x-ncp-apigw-api-key-id': clientId(),
    'x-ncp-apigw-api-key': requireEnv('NAVER_MAP_CLIENT_SECRET'),
  }
  const params = { start: `${start.lng},${start.lat}`, goal: `${goal.lng},${goal.lat}`, option }

  let result
  try {
    for (const host of HOSTS) {
      result = await callHost(host, params, headers)
      if (![401, 403, 404].includes(result.response.status)) break
    }
  } catch (error) {
    throw new Error(`Directions 5 호출 실패: ${error.name === 'TimeoutError' ? '시간 초과' : error.message}`)
  }

  const { response, json, text } = result
  if (!response.ok || !json) {
    const message = json?.error?.message ?? json?.message ?? text.slice(0, 200)
    throw new Error(`Directions 5 오류: ${message}`)
  }
  if (json.code !== 0) {
    // 1: 출발=도착, 2: 출발/도착이 도로 근처 아님, 3: 자동차 경로 없음, 5: 직선 1,500km 이상
    throw new Error(`Directions 5 경로 탐색 실패(code ${json.code}): ${json.message}`)
  }
  const summary = json.route?.[option]?.[0]?.summary
  if (!summary) throw new Error('Directions 5 응답에 route 요약이 없어요')

  return {
    distanceMeters: summary.distance,
    durationSeconds: Math.round(summary.duration / 1000),
    option,
    tollFare: summary.tollFare ?? null,
    taxiFare: summary.taxiFare ?? null,
    fuelPrice: summary.fuelPrice ?? null,
    straightDistanceMeters: haversineMeters(start, goal),
  }
}

// mock: 직선거리 x 1.3 을 거리로, 평균 40km/h 를 속도로 가정한 "데모 추정치"이며 실제 경로가 아니다.
async function mockDriving({ start, goal, option }) {
  const straight = haversineMeters(start, goal)
  const distanceMeters = Math.round(straight * 1.3)
  return {
    distanceMeters,
    durationSeconds: Math.round((distanceMeters / 1000 / 40) * 3600),
    option,
    tollFare: null,
    taxiFare: null,
    fuelPrice: null,
    straightDistanceMeters: straight,
  }
}

export function getDrivingRoute(params) {
  return runProvider({ live: () => liveDriving(params), mock: () => mockDriving(params) })
}