import { supabase } from '../../lib/supabaseClient.js'

// 해당 여행/날짜의 모험 목록 (RLS: 본인 것만 보인다). 쓰기는 서버만 한다.
export async function fetchAdventures({ tripId, adventureDate }) {
  const { data, error } = await supabase
    .from('jeju_adventures')
    .select('*')
    .eq('trip_id', tripId)
    .eq('adventure_date', adventureDate)
    .order('generation_set', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}