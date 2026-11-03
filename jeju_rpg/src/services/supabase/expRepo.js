import { supabase } from '../../lib/supabaseClient.js'

// 아직 투자하지 않은 자유 EXP 덩어리 목록. (RLS: 본인 로그만 보인다)
// 지급 로그(카테고리 없음) 중에서, 투자 로그(free_exp_invest, source_id = 지급 로그 id)가 없는 것만 남긴다.
export async function fetchPendingFreeExp(userId) {
  const [grantsRes, investsRes] = await Promise.all([
    supabase
      .from('jeju_exp_logs')
      .select('id, amount, source_type, created_at')
      .eq('user_id', userId)
      .is('category', null)
      .gt('amount', 0)
      .order('created_at', { ascending: true }),
    supabase.from('jeju_exp_logs').select('source_id').eq('user_id', userId).eq('source_type', 'free_exp_invest'),
  ])
  if (grantsRes.error) throw grantsRes.error
  if (investsRes.error) throw investsRes.error
  const invested = new Set(investsRes.data.map((row) => row.source_id))
  return grantsRes.data.filter((grant) => !invested.has(grant.id))
}