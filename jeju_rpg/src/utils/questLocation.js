import { JEJU_AIRPORT } from '../constants/jeju.js'
import { CACHE_RULES } from '../constants/replanRules.js'
import { haversineMeters, isLatLng } from './geo.js'
import { estimateTravel } from './travel.js'

// 퀘스트 탭의 위치 요약 / 지도 preview 보조 (순수 함수). 거리/시간은 코드가 계산하고(Agent 가 추측하지 않는다),
// 이동시간은 기존 estimateTravel(직선거리 기반 추정)을 재사용한다. 정보가 없으면 null 을 돌려줘서 화면이 그 줄을 아예 그리지 않게 한다.

// 지도 preview 높이(px). 펼쳤을 때만 이 높이를 차지한다. (180~220 범위)
export const PREVIEW_HEIGHT_PX = 200
// 이 거리 이하면 도보, 넘으면 사용자의 이동수단으로 추정한다.
export const WALK_MAX_METERS = 1200

const placeCoords = (quest) => (quest && Number.isFinite(quest.place_lat) && Number.isFinite(quest.place_lng) ? { lat: quest.place_lat, lng: quest.place_lng } : null)

// 현재 챕터의 목적지: 핵심 퀘스트(좌표가 있을 때만). → { questId, placeId, name, lat, lng } | null
export function chapterDestination(currentQuests) {
  const core = currentQuests.find((q) => q.quest_type === 'core' && !q.replaced_at)
  const coords = placeCoords(core)
  return core && coords ? { questId: core.id, placeId: core.place_id ?? null, name: core.place_name ?? core.title, ...coords } : null
}

// 최근의 유효한 현재 위치만 쓴다 (기존 위치 캐시 정책 CACHE_RULES.locationStaleMs). 오래된 위치로 거리를 보여주지 않는다.
export function freshPosition(position, now = Date.now()) {
  if (!isLatLng(position) || !Number.isFinite(Number(position.timestamp))) return null
  return now - Number(position.timestamp) <= CACHE_RULES.locationStaleMs ? position : null
}

// 현재 위치 → 목적지 거리/이동시간. 위치나 좌표가 없으면 null. → { meters, minutes, mode, source }
export function distanceSummary({ position, destination, transport = 'walk', now = Date.now() }) {
  const here = freshPosition(position, now)
  if (!here || !isLatLng(destination)) return null
  const meters = haversineMeters(here, destination)
  const estimate = estimateTravel({ from: here, to: destination, transport: meters <= WALK_MAX_METERS ? 'walk' : transport })
  return { meters, minutes: estimate.minutes, mode: estimate.mode, source: estimate.source }
}

export const formatDistance = (meters) => (meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters / 10) * 10}m`)

const MODE_LABEL = { walk: '도보', car: '차량', transit: '대중교통', bike: '자전거' }
// "현재 위치에서 약 420m · 도보 약 6분" (도보가 아닌 추정은 "(예상)" 표시)
export function describeDistance(summary) {
  const mode = MODE_LABEL[summary.mode] ?? ''
  const estimated = summary.source === 'estimate' && summary.mode !== 'walk' ? ' (예상)' : ''
  return `약 ${formatDistance(summary.meters)} · ${mode} 약 ${summary.minutes}분${estimated}`
}

// 선택 퀘스트가 핵심과 "다른 장소"를 쓰는가 (좌표가 있고, 같은 place_id 가 아니고, 30m 이상 떨어짐). 같은 장소면 위치 UI 를 반복하지 않는다.
export function optionalHasOwnPlace(optional, core) {
  const coords = placeCoords(optional)
  if (!coords) return false
  if (optional.place_id && core?.place_id && optional.place_id === core.place_id) return false
  const coreCoords = placeCoords(core)
  return !(coreCoords && haversineMeters(coords, coreCoords) < 30)
}

// 지도 탭으로 넘길 포커스 대상. DB 에 저장하지 않는 화면 간 전달용 값이다. → { lat, lng, title, questId, placeId, key }
export function mapFocusTarget({ quest = null, destination = null, now = Date.now() }) {
  const source = quest ? { ...placeCoords(quest), name: quest.place_name ?? quest.title, questId: quest.id, placeId: quest.place_id ?? null } : destination
  if (!source || !isLatLng(source)) return null
  return { lat: source.lat, lng: source.lng, title: source.name ?? '', questId: source.questId ?? null, placeId: source.placeId ?? null, key: now }
}

export const airportFocusTarget = (now = Date.now()) => ({ ...JEJU_AIRPORT, title: '제주국제공항', questId: null, placeId: 'CJU', key: now })

// 지도 preview 펼침 상태 (기본 접힘). 화면 local state 로만 기억한다.
export const initialPreviewOpen = () => false
export const togglePreview = (open) => !open
