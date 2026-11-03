// 개발용 도구: 이 PC 에서 실제 Supabase 로 읽기 전용 호출 1회가 얼마나 걸리는지 잰다. (DB 를 바꾸지 않는다)
//   node --env-file=.env scripts/dev/db-latency.mjs
// 완료 API 의 지연은 "DB 왕복 횟수 × 왕복 시간"에 가깝다. 이 값에 scripts/dev/completion-timing.mjs 의 직렬 왕복 수를 곱하면 실제 체감을 가늠할 수 있다.
import { getAdmin } from '../../api/_lib/supabaseAdmin.js'

const db = getAdmin()
const samples = []
for (let i = 0; i < 8; i += 1) {
  const start = performance.now()
  const { error } = await db.from('jeju_landmarks').select('place_id').limit(1)
  if (error) throw error
  samples.push(performance.now() - start)
}
const warm = samples.slice(1) // 첫 호출은 연결 수립 시간이 섞인다
const avg = warm.reduce((a, b) => a + b, 0) / warm.length
console.log(`첫 호출 ${Math.round(samples[0])}ms (연결 수립 포함)`)
console.log(`이후 ${warm.length}회 평균 ${Math.round(avg)}ms (최소 ${Math.round(Math.min(...warm))} / 최대 ${Math.round(Math.max(...warm))})`)
console.log(`→ 왕복 ${Math.round(avg)}ms 기준: 최적화 전 gps core(직렬 16단계) ≈ ${Math.round(avg * 16)}ms, 최적화 후(9단계) ≈ ${Math.round(avg * 9)}ms`)
