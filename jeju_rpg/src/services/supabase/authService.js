import { isSupabaseConfigured } from '../../lib/env.js'
import { supabase } from '../../lib/supabaseClient.js'

function requireClient() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase 환경변수가 설정되지 않았어. .env 를 확인해줘.')
  }
  return supabase
}

export async function signUpWithEmail(email, password) {
  const { data, error } = await requireClient().auth.signUp({ email, password })
  if (error) throw error
  // 이메일 확인이 켜져 있으면 session 이 null 로 온다.
  return { user: data.user, session: data.session }
}

export async function signInWithEmail(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password })
  if (error) throw error
  return { user: data.user, session: data.session }
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut()
  if (error) throw error
}

// 콜백은 (event, session). 구독 해제 함수를 돌려준다.
export function subscribeAuthChange(callback) {
  if (!isSupabaseConfigured) return () => {}
  const { data } = supabase.auth.onAuthStateChange(callback)
  return () => data.subscription.unsubscribe()
}