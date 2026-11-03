import { isMeaningfulPlace } from '../../utils/freeTravel/tracker.js'

const hasCoords = (item) => Number.isFinite(item?.lat) && Number.isFinite(item?.lng)

// 지도에 표시할 마커 목록을 만든다. (순수 함수 — 모양은 markerConfig 가 정한다)
//  position   : 내 현재 위치 | null
//  chapters/quests : 모험 판 (현재 챕터 = active/core_completed 중 가장 앞)
//  nearbyPlaces / candidates : 자유여행 중에만 넘긴다
//  visited    : [{ place_id, place_name, place_lat, place_lng }]
// 같은 장소가 여러 종류에 해당하면 우선순위가 높은 하나만 그린다: 방문 후보 > 현재 목적지 > 선택 > 이후 > 방문 > 주변
export function buildMapMarkers({ position, chapters = [], quests = [], nearbyPlaces = [], candidates = [], visited = [] }) {
  const byPlace = new Map()
  const put = (kind, placeId, lat, lng, title) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const rank = { candidate: 6, anchor: 5, optional: 4, upcoming: 3, visited: 2, nearby: 1 }
    const prev = byPlace.get(placeId)
    if (!prev || rank[kind] > rank[prev.kind]) byPlace.set(placeId, { id: `${kind}:${placeId}`, kind, lat, lng, title })
  }

  const current = chapters.find((c) => c.status === 'active' || c.status === 'core_completed') ?? null
  const open = chapters.filter((c) => ['active', 'core_completed', 'locked', 'available'].includes(c.status))
  const placeOf = (q) => q.place_id ?? `q:${q.id}`

  for (const chapter of open) {
    const inChapter = quests.filter((q) => q.chapter_id === chapter.id && hasCoords({ lat: q.place_lat, lng: q.place_lng }))
    if (chapter.id === current?.id) {
      const core = inChapter.find((q) => q.quest_type === 'core')
      if (core && chapter.status === 'active') put('anchor', placeOf(core), core.place_lat, core.place_lng, core.place_name)
      for (const q of inChapter.filter((x) => x.quest_type === 'optional' && !x.is_hidden)) put('optional', placeOf(q), q.place_lat, q.place_lng, q.place_name)
    } else {
      const core = inChapter.find((q) => q.quest_type === 'core')
      if (core) put('upcoming', placeOf(core), core.place_lat, core.place_lng, core.place_name)
    }
  }

  for (const v of visited) put('visited', v.place_id, v.place_lat, v.place_lng, v.place_name)
  for (const place of nearbyPlaces) if (isMeaningfulPlace(place)) put('nearby', place.placeId, place.lat, place.lng, place.name)
  for (const c of candidates) put('candidate', c.placeId, c.lat, c.lng, c.name)

  const markers = [...byPlace.values()]
  if (hasCoords(position)) markers.push({ id: 'me', kind: 'me', lat: position.lat, lng: position.lng, title: '' })
  return markers
}
