import { supabase } from '../../lib/supabaseClient.js'
import { resolveDailyContext } from '../../utils/dailyContext.js'

// 일일 여행 조건. 모두 "DB 저장/조회만" 한다. 여기서 Agent 를 호출하지 않는다.

// 그날의 일일 조건 상태: 저장된 행 + 가장 최근 이전 행 → { saved, previous, values, source, confirmed }
//  source: saved(그날 확인함) | previous(전날 값 이어받음) | trip(여행 기본값)
export async function fetchDailyContextState({ trip, date }) {
  const [savedRes, previousRes] = await Promise.all([
    supabase.from('jeju_daily_contexts').select('*').eq('trip_id', trip.id).eq('context_date', date).maybeSingle(),
    supabase
      .from('jeju_daily_contexts')
      .select('*')
      .eq('trip_id', trip.id)
      .lt('context_date', date)
      .order('context_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (savedRes.error) throw savedRes.error
  if (previousRes.error) throw previousRes.error
  return { saved: savedRes.data, previous: previousRes.data, ...resolveDailyContext({ saved: savedRes.data, previous: previousRes.data, trip }) }
}

// 그날 조건 저장. values = { companion, party_size, transport, desired_end_time }
// replanPending: true 로 주면 "오늘 일정 다시 맞추기" 제안이 남는다. (undefined 면 기존 값 유지)
export async function saveDailyContext({ userId, tripId, date, values, replanPending }) {
  const row = {
    user_id: userId,
    trip_id: tripId,
    context_date: date,
    companion: values.companion,
    party_size: Number(values.party_size) || 1,
    transport: values.transport,
    desired_end_time: values.desired_end_time || null,
    ...(replanPending === undefined ? {} : { replan_pending: replanPending }),
  }
  const { data, error } = await supabase.from('jeju_daily_contexts').upsert(row, { onConflict: 'trip_id,context_date' }).select('*').single()
  if (error) throw error
  return data
}

export async function setReplanPending({ tripId, date, pending }) {
  const { error } = await supabase.from('jeju_daily_contexts').update({ replan_pending: pending }).eq('trip_id', tripId).eq('context_date', date)
  if (error) throw error
}