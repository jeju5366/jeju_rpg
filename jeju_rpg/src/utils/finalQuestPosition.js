import { CACHE_RULES } from '../constants/replanRules.js'

// Final Quest 안전 시간 계산에 쓸 "현재 위치" 고르기. 새 GPS polling 은 만들지 않는다.
//   1) 이미 가지고 있는 위치(location store)가 충분히 최신이면 그대로 쓴다. 기준은 기존 위치 캐시 정책(CACHE_RULES.locationStaleMs = 2분).
//   2) 오래됐으면 실제 현재 위치처럼 쓰지 않는다. 위치 권한이 이미 허용돼 있을 때만 한 번(one-shot) 새로 받아 본다. (권한 창을 띄우지 않는다)
//   3) 권한이 없거나 실패하면 null → 서버가 현재 챕터 핵심 장소, 그것도 없으면 60분 기본값으로 계산한다.

export function recentPosition(position, now = Date.now(), maxAgeMs = CACHE_RULES.locationStaleMs) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null
  const timestamp = Number(position.timestamp)
  if (!Number.isFinite(timestamp)) return null
  return now - timestamp <= maxAgeMs ? position : null
}

// → { lat, lng, accuracy, timestamp } | null. getPermission / getPosition 은 주입(테스트용). getPosition 은 실패하면 throw.
export async function resolveEvalPosition({ stored, now = Date.now(), getPermission, getPosition, onFresh = null }) {
  const fresh = recentPosition(stored, now)
  if (fresh) return fresh
  try {
    if ((await getPermission()) !== 'granted') return null
    const next = await getPosition()
    const usable = recentPosition(next, Date.now())
    if (usable) onFresh?.(usable)
    return usable
  } catch {
    return null
  }
}

// Final Quest 상태 요청 한 번: 현재 위치를 고른 뒤(resolveEvalPosition) 그 position 을 요청에 실어 보낸다. useFinalQuest 가 이 함수를 통해서만 서버를 부른다.
//   fetchState(tripId, { refresh, position }) 는 주입 (실제로는 fetchFinalQuestState)
export async function requestFinalQuestState({ tripId, refresh = false, stored, getPermission, getPosition, onFresh = null, fetchState, now = Date.now() }) {
  const position = await resolveEvalPosition({ stored, now, getPermission, getPosition, onFresh })
  return fetchState(tripId, { refresh, position })
}
