import { supabase } from '../../lib/supabaseClient.js'
import { apiPost } from '../api/apiClient.js'

// 자유여행 서버 연결. 페이지/컴포넌트는 이 파일만 거친다.

// 진행 중인 자유여행 세션(사용자당 최대 1개). 없으면 null. (RLS: 본인 것만 읽는다)
export async function fetchActiveFreeSession(userId) {
  const { data, error } = await supabase.from('jeju_free_sessions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (error) throw error
  return data
}

// 자유여행 시작: 모험은 그대로 두고 여행 모드만 free 로. → { session, alreadyActive }
export function startFreeTravel(adventureId) {
  return apiPost('free-travel-start', { adventureId })
}

// 자유여행 종료 + 방문 확정. 이동 경로(route)는 검증에만 쓰이고 서버에 저장되지 않는다.
// visits: [{ placeId, lat, lng, source: 'candidate' | 'manual', visitedAt }]
// → { alreadyEnded, saved, rejected, rewards: { discoveries, levelUps, titles } }
export function finishFreeTravel({ sessionId, visits, route, candidatesSeen }) {
  return apiPost('free-travel-finish', { sessionId, visits, route, candidatesSeen })
}

// 이번 여행에서 방문한 장소(지도 마커용). 좌표가 기록된 것만.
export async function fetchVisitedPlaces(tripId) {
  const { data, error } = await supabase
    .from('jeju_place_visits')
    .select('place_id, place_name, place_lat, place_lng, visit_source')
    .eq('trip_id', tripId)
    .not('place_lat', 'is', null)
    .order('visited_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data
}
