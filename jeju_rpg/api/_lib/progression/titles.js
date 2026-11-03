import { TEMP_TITLES } from '../../../src/constants/finalQuestRules.js'

// 칭호 해금 연결 지점. 실제 칭호 이름/연출은 14단계에서 확정한다. 지금은 "임시 칭호" 몇 개만 여행 정산(trip_completed)에서 해금한다.
// 구조: 정의는 jeju_titles(code, title_type, category, threshold, name), 획득은 jeju_user_titles(user_id, title_id, trip_id),
//       장착(profiles.current_title)은 사용자가 직접 고른다 (자동 장착 금지 — 여기서는 장착하지 않는다).
// trigger 별 호출 위치:
//   level_reached  → 퀘스트 완료/자유 EXP 투자 후 (levelUps 전달)         [8단계 연결됨, 아직 해금 없음]
//   trip_completed → 여행 마무리 (12단계)                                 [임시 칭호 5종]
//   free_travel    → 자유여행 (9단계)
//   surprise_quest → 돌발 퀘스트 (11단계)
//   memory_photo   → 추억 사진 저장 (10단계)
export const TITLE_TRIGGERS = ['level_reached', 'trip_completed', 'free_travel', 'surprise_quest', 'memory_photo']

// 이번 여행 통계 → 조건을 만족한 임시 칭호 code 목록 (순수 함수)
//   stats: { completedQuests, discoveries, categoryQuests: { explore: n, food: n ... } }
export function tempTitleCodes(stats) {
  const codes = [TEMP_TITLES.first.code]
  const count = (category) => stats.categoryQuests?.[category] ?? 0
  if (count(TEMP_TITLES.explorer.category) >= TEMP_TITLES.explorer.minCategoryQuests) codes.push(TEMP_TITLES.explorer.code)
  if (count(TEMP_TITLES.foodie.category) >= TEMP_TITLES.foodie.minCategoryQuests) codes.push(TEMP_TITLES.foodie.code)
  if ((stats.discoveries ?? 0) >= TEMP_TITLES.discoverer.minDiscoveries) codes.push(TEMP_TITLES.discoverer.code)
  if ((stats.completedQuests ?? 0) >= TEMP_TITLES.master.minCompleted) codes.push(TEMP_TITLES.master.code)
  return codes
}

// 새로 얻은 칭호 목록 [{ code, name }] 을 돌려준다. 이미 가진 칭호는 다시 주지 않는다. (여행 재호출에도 안전)
export async function checkTitleUnlocks(db, { userId, trigger, data }) {
  if (trigger !== 'trip_completed') return []
  const wanted = tempTitleCodes(data?.stats ?? {})
  const { data: defs, error } = await db.from('jeju_titles').select('id, code, name').in('code', wanted)
  if (error) throw error
  if (!defs?.length) return [] // 칭호 seed(011 migration)가 아직 없으면 조용히 건너뛴다

  const { data: owned, error: ownedError } = await db.from('jeju_user_titles').select('title_id').eq('user_id', userId)
  if (ownedError) throw ownedError
  const ownedIds = new Set((owned ?? []).map((row) => row.title_id))
  const fresh = defs.filter((def) => !ownedIds.has(def.id))
  if (!fresh.length) return []

  const { error: insertError } = await db.from('jeju_user_titles').insert(fresh.map((def) => ({ user_id: userId, title_id: def.id, trip_id: data.tripId ?? null })))
  if (insertError && insertError.code !== '23505') throw insertError
  return fresh.map((def) => ({ code: def.code, name: def.name }))
}
