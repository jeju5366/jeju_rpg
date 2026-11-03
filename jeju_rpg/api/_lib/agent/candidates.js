import { ADVENTURE_RULES } from '../../../src/constants/gameBalance.js'
import { getNearbyPlaces } from '../providers/tour.js'

// 서버가 후보 장소를 약 10~15개로 줄여서 GPT 에 넘긴다. GPT 는 이 목록 안에서만 고른다.
// 행사(15)는 기간 정보가 없어 지난 행사가 섞일 수 있으므로 후보에서 제외한다. (기간 검증이 붙으면 추가)
const SOURCES = [
  { type: 12, label: '관광지', fetch: 10, take: 8 },
  { type: 14, label: '문화시설', fetch: 5, take: 3 },
  { type: 39, label: '음식점', fetch: 6, take: 4 },
]

// 주소 → "제주시 애월읍" 같은 권역명. 권역명은 후보 주소에서 뽑은 값만 쓴다.
export function areaOf(address = '') {
  const match = address.match(/(제주시|서귀포시)\s*([가-힣0-9]+(?:읍|면|동))?/)
  if (!match) return '제주'
  return match[2] ? `${match[1]} ${match[2]}` : match[1]
}

// visits: { thisTripIds: Set, pastIds: Set } (context.js 의 방문 기록)
//  - 이번 여행에서 방문한 장소: 후보에서 제외 (GPT 가 다시 추천하지 못하게 서버가 막는다)
//  - 과거 여행에서 방문한 장소: 뒤로 밀고 visitedBefore 표시 (약한 감점)
// 챕터 anchor 후보 각각의 "도보 범위" 주변에서 추가 장소를 모은다. (anchor 들이 서로 멀어도 각자의 주변 후보가 잡히게)
// excludeIds: 이미 모험 장소(anchor 후보)인 곳은 제외. 반환: 중복 제거된 장소 목록 (과거 방문지는 뒤로)
export async function gatherAroundAnchors({ anchors, visits = null, radius, excludeIds, perAnchor = 10, limit }) {
  const results = await Promise.all(anchors.map((anchor) => gatherCandidates({ origin: anchor, radius, visits, limit: perAnchor })))
  const seen = new Set(excludeIds)
  const places = results
    .flatMap((result) => result.places)
    .filter((place) => !seen.has(place.placeId) && seen.add(place.placeId))
    .sort((a, b) => Number(a.visitedBefore) - Number(b.visitedBefore))
  return places.slice(0, limit)
}

export async function gatherCandidates({ origin, radius, visits = null, limit = ADVENTURE_RULES.candidateCount }) {
  const results = await Promise.all(
    SOURCES.map((s) => getNearbyPlaces({ ...origin, radius, limit: s.fetch, contentTypeId: s.type })),
  )

  const labelOf = Object.fromEntries(SOURCES.map((s) => [s.type, s.label]))
  const thisTrip = visits?.thisTripIds ?? new Set()
  const past = visits?.pastIds ?? new Set()

  const picked = []
  const rest = []
  results.forEach((result, index) => {
    const places = result.data
      .filter((place) => !thisTrip.has(place.placeId))
      .map((place) => ({
        placeId: place.placeId,
        name: place.name,
        contentTypeId: place.contentTypeId,
        category: labelOf[place.contentTypeId] ?? '기타',
        area: areaOf(place.address),
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        distanceMeters: place.distanceMeters,
        isLandmark: Boolean(place.isLandmark),
        visitedBefore: past.has(place.placeId),
      }))
    // 과거 방문지는 종류별 우선 선발에서 뒤로 보낸다.
    const ordered = [...places.filter((p) => !p.visitedBefore), ...places.filter((p) => p.visitedBefore)]
    picked.push(...ordered.slice(0, SOURCES[index].take))
    rest.push(...ordered.slice(SOURCES[index].take))
  })
  rest.sort((a, b) => Number(a.visitedBefore) - Number(b.visitedBefore) || a.distanceMeters - b.distanceMeters)

  const seen = new Set()
  const places = [...picked, ...rest].filter((place) => !seen.has(place.placeId) && seen.add(place.placeId)).slice(0, limit)

  const sources = results.map((result) => result.source)
  const source = sources.every((s) => s === 'live') ? 'live' : sources.includes('live') ? 'mixed' : 'mock'
  return { places, source }
}
