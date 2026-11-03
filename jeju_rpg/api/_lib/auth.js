import { getSupabaseAuthConfig } from './env.js'

// Authorization: Bearer <Supabase access token> 을 Supabase Auth 로 검증한다.
// 로그인한 사용자만 공공 API 프록시를 쓸 수 있게 해서 인증키 오남용을 막는다.
export async function requireUser(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const { url, anonKey } = getSupabaseAuthConfig()
  if (!token || !url || !anonKey) return null

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    return await response.json()
  } catch (error) {
    console.error('[auth] 토큰 검증 실패', error)
    return null
  }
}