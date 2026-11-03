// 개발용 도구: 한 사용자의 앱 데이터를 처음 상태로 되돌린다. (로그인 계정 auth.users 는 지우지 않는다)
//   node --env-file=.env scripts/dev/reset-user.mjs <userId>          지울 데이터 개수만 보여준다 (dry-run)
//   node --env-file=.env scripts/dev/reset-user.mjs <userId> --yes    실제로 지운다 (되돌릴 수 없음)
// 지우는 것: 여행/숙소/모험/챕터/퀘스트/진행/방문/발견/EXP 로그/추억 사진(Storage 포함)/피드백/칭호/Agent·비용 로그/자유여행/일일 조건/Final Quest/성향 테스트/캐릭터
// 되돌리는 것: jeju_profiles 행 (EXP 0, 자유 EXP 0, 닉네임·칭호 비움, onboarding_completed=false)
import { MEMORY_BUCKET } from '../../src/constants/photoRules.js'
import { getAdmin } from '../../api/_lib/supabaseAdmin.js'

const [userId, ...flags] = process.argv.slice(2)
if (!userId || userId.startsWith('--')) {
  console.error('사용법: node --env-file=.env scripts/dev/reset-user.mjs <userId> [--yes]')
  process.exit(1)
}
const execute = flags.includes('--yes')
const db = getAdmin()

// [테이블, 사용자 컬럼] — 자식 → 부모 순서
const TABLES = [
  ['jeju_user_titles', 'user_id'],
  ['jeju_travel_photos', 'user_id'],
  ['jeju_feedback', 'user_id'],
  ['jeju_place_visits', 'user_id'],
  ['jeju_place_discoveries', 'user_id'],
  ['jeju_exp_logs', 'user_id'],
  ['jeju_api_usage_logs', 'user_id'],
  ['jeju_agent_requests', 'user_id'],
  ['jeju_free_sessions', 'user_id'],
  ['jeju_daily_contexts', 'user_id'],
  ['jeju_final_quests', 'user_id'],
  ['jeju_quest_progress', 'user_id'],
  ['jeju_quests', 'user_id'],
  ['jeju_chapters', 'user_id'],
  ['jeju_adventures', 'user_id'],
  ['jeju_accommodations', 'user_id'],
  ['jeju_trips', 'user_id'],
  ['jeju_travel_preferences', 'user_id'],
  ['jeju_characters', 'user_id'],
]

async function listStorage() {
  const out = []
  const walk = async (prefix) => {
    const { data, error } = await db.storage.from(MEMORY_BUCKET).list(prefix, { limit: 1000 })
    if (error) return
    for (const item of data ?? []) (item.id ? out.push(`${prefix}/${item.name}`) : await walk(`${prefix}/${item.name}`))
  }
  await walk(userId)
  return out
}

console.log(`사용자 ${userId} — ${execute ? '실제 삭제' : 'dry-run (아무것도 지우지 않음)'}`)
const files = await listStorage()
console.log(`  Storage(${MEMORY_BUCKET}) 사진: ${files.length}개`)
if (execute && files.length) {
  for (let i = 0; i < files.length; i += 100) await db.storage.from(MEMORY_BUCKET).remove(files.slice(i, i + 100))
}

for (const [table, column] of TABLES) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(column, userId)
  if (error) {
    console.log(`  ${table}: 건너뜀 (${error.message})`)
    continue
  }
  if (execute && count) {
    const { error: deleteError } = await db.from(table).delete().eq(column, userId)
    if (deleteError) {
      console.log(`  ${table}: 삭제 실패 (${deleteError.message})`)
      continue
    }
  }
  console.log(`  ${table}: ${count}행${execute ? ' 삭제' : ''}`)
}

if (execute) {
  const { error } = await db
    .from('jeju_profiles')
    .update({ exp_explore: 0, exp_culture: 0, exp_food: 0, exp_relax: 0, exp_social: 0, exp_discovery: 0, unspent_exp: 0, current_title: null, nickname: null, onboarding_completed: false })
    .eq('id', userId)
  console.log(error ? `  jeju_profiles 되돌리기 실패 (${error.message})` : '  jeju_profiles: 처음 상태로 되돌림')
  console.log('완료! 앱에서 새로고침하면 캐릭터 만들기부터 다시 시작돼.')
} else {
  console.log('위 내용을 지우려면 --yes 를 붙여서 다시 실행해.')
}
