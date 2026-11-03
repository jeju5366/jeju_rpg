import { supabase } from '../../lib/supabaseClient.js'

// 프로필이 없으면 만들어서 돌려준다. (회원가입 직후 첫 로그인)
export async function ensureProfile(userId) {
  const { data, error } = await supabase
    .from('jeju_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (data) return data

  const { data: created, error: insertError } = await supabase
    .from('jeju_profiles')
    .insert({ id: userId })
    .select()
    .single()
  if (insertError) throw insertError
  return created
}

export async function fetchCharacter(userId) {
  const { data, error } = await supabase
    .from('jeju_characters')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchTravelPreferences(userId) {
  const { data, error } = await supabase
    .from('jeju_travel_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}
// 닉네임은 프로필 정보로 관리한다.
export async function updateNickname(userId, nickname) {
  const { data, error } = await supabase
    .from('jeju_profiles')
    .update({ nickname })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

// 신체 유형만 characters 에 저장한다.
export async function saveCharacter(userId, bodyType) {
  const { data, error } = await supabase
    .from('jeju_characters')
    .upsert({ user_id: userId, body_type: bodyType }, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

// scores: { explore, culture, food, relax, social, discovery, meal_preference, dessert_preference } (모두 0~100 정수)
export async function saveTravelPreferences(userId, scores) {
  const { data, error } = await supabase
    .from('jeju_travel_preferences')
    .upsert({ user_id: userId, ...scores }, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  return data
}