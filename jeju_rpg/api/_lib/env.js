// 서버 전용 환경변수. 브라우저로 노출하지 않는다(VITE_ 접두사 금지).
//   DATA_MODE=live 일 때만 실제 외부 API 를 호출한다. 그 외(비어 있음 포함)는 항상 mock(데모 데이터).
//   live 에서도 API 별 키가 없거나 호출이 실패하면 그 API 만 mock 으로 대체한다(fallback 표시).
export function getMode() {
  return process.env.DATA_MODE === 'live' ? 'live' : 'mock'
}

export function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`환경변수 ${name} 가 없어요. .env 에 값을 넣어줘.`)
  return value
}

// 공공데이터포털 키는 Encoding/Decoding 키 둘 다 올 수 있어서 항상 decoded 상태로 맞춘다.
export function serviceKey(name) {
  const key = requireEnv(name)
  if (!key.includes('%')) return key
  try {
    return decodeURIComponent(key)
  } catch {
    return key
  }
}

// 선택 환경변수(예: 공항 API 주소 덮어쓰기)
export function optionalEnv(name, fallback) {
  return process.env[name]?.trim() || fallback
}

// Supabase URL / anon key 는 공개 키라 VITE_ 변수를 그대로 쓴다. (토큰 검증용)
export function getSupabaseAuthConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  }
}