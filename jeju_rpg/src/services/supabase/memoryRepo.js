import { MEMORY_BUCKET } from '../../constants/photoRules.js'
import { supabase } from '../../lib/supabaseClient.js'

// 추억 사진 조회. (RLS: 본인 행 / 본인 폴더의 Storage 객체만 읽힌다) 저장/삭제 경로는 서버 API 뿐이다.

// 이 퀘스트들 중 추억으로 저장된 퀘스트 id 집합
export async function fetchMemoryQuestIds(questIds) {
  if (!questIds.length) return new Set()
  const { data, error } = await supabase.from('jeju_travel_photos').select('quest_id').eq('is_memory', true).in('quest_id', questIds)
  if (error) throw error
  return new Set(data.map((row) => row.quest_id))
}

// 기록 화면 / 12단계 여행 요약용: 여행의 추억 사진 목록 (최신순). 사진 보기는 getMemoryUrl 로 임시 주소를 받는다.
export async function fetchTripMemories(tripId) {
  const { data, error } = await supabase
    .from('jeju_travel_photos')
    .select('id, quest_id, place_id, storage_path, caption, created_at')
    .eq('trip_id', tripId)
    .eq('is_memory', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// private bucket 이라 임시 서명 주소(기본 1시간)로 보여준다.
export async function getMemoryUrl(storagePath, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(MEMORY_BUCKET).createSignedUrl(storagePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
