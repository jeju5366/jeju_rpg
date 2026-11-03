import { TRAVEL_RULES } from '../constants/replanRules.js'
import { haversineMeters } from './geo.js'

// 이동수단별 이동시간 추정. 서버(REPLAN)와 화면(다음 챕터 예고)이 같이 쓴다.
//   자동차(rental_car/taxi): NAVER Directions 5 의 실제 duration/distance 를 우선 쓴다. 없으면 직선거리 기반 추정.
//   대중교통(public_transit): 차량 경로를 대중교통 시간으로 쓰지 않는다. 직선거리 기반의 보수적 추정(+대기시간)이며 "예상"으로 표시한다.
//   도보/자전거: 직선거리 기반 임시 계산. (도보 경로 API 는 아직 연결하지 않았다)
// driving: Directions 결과 { durationSeconds, distanceMeters } | null
// → { minutes, meters, source: 'directions' | 'estimate', mode: 'car' | 'transit' | 'walk' | 'bike' }
const MODE_OF = { rental_car: 'car', taxi: 'car', public_transit: 'transit', walk: 'walk', bike: 'bike' }
const BIKE_KMH = 12

export function travelModeOf(transport) {
  return MODE_OF[transport] ?? 'car'
}

export function estimateTravel({ from, to, transport, driving = null }) {
  const mode = travelModeOf(transport)
  const straight = haversineMeters(from, to)
  if (mode === 'car' && driving && Number.isFinite(driving.durationSeconds)) {
    return { minutes: Math.max(1, Math.round(driving.durationSeconds / 60)), meters: driving.distanceMeters ?? straight, source: 'directions', mode }
  }
  const road = straight * TRAVEL_RULES.roadFactor
  const kmh = mode === 'car' ? TRAVEL_RULES.carKmh : mode === 'transit' ? TRAVEL_RULES.transitKmh : mode === 'bike' ? BIKE_KMH : TRAVEL_RULES.walkKmh
  const base = (road / 1000 / kmh) * 60 + (mode === 'transit' ? TRAVEL_RULES.transitWaitMinutes : 0)
  return { minutes: Math.max(1, Math.round(base)), meters: Math.round(road), source: 'estimate', mode }
}

// "차량 약 25분" / "대중교통 약 40분(예상)" / "도보 약 12분"
export function describeTravel(estimate) {
  const label = { car: '차량', transit: '대중교통', walk: '도보', bike: '자전거' }[estimate.mode]
  return `${label} 약 ${estimate.minutes}분${estimate.source === 'estimate' && estimate.mode !== 'walk' ? ' (예상)' : ''}`
}
