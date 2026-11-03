import { resolveDailyContext } from '../../../src/utils/dailyContext.js'

// 그날의 일일 조건을 DB 에서 "매번 새로" 읽는다. (저장된 값 → 가장 최근 이전 값 → 여행 기본값)
// Agent 호출 직전에 읽기 때문에 화면에서 방금 수정한 값이 그대로 반영된다.
export async function loadDailyContext(db, { trip, date }) {
  const [savedRes, previousRes] = await Promise.all([
    db.from('jeju_daily_contexts').select('*').eq('trip_id', trip.id).eq('context_date', date).maybeSingle(),
    db.from('jeju_daily_contexts').select('*').eq('trip_id', trip.id).lt('context_date', date).order('context_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (savedRes.error) throw savedRes.error
  if (previousRes.error) throw previousRes.error
  return resolveDailyContext({ saved: savedRes.data, previous: previousRes.data, trip })
}
