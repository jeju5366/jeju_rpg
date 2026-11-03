import { handleDemoApi } from '../../demo/demoApi.js'
import { isDemoActive } from '../../demo/demoRuntime.js'
import { isSupabaseConfigured } from '../../lib/env.js'
import { supabase } from '../../lib/supabaseClient.js'
import { logAgentMany } from '../../store/agentLogStore.js'
import { entriesFromApi, entryFromApiError } from '../../utils/agentLog.js'

async function authHeader() {
  if (!isSupabaseConfigured) throw new Error('Supabase 환경변수가 설정되지 않았어.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('로그인이 필요해.')
  return { Authorization: `Bearer ${token}` }
}

// Agent Log 기록은 부가 기능이다. 실패해도 API 호출 결과에는 영향이 없다.
function record(name, requestBody, body) {
  try {
    logAgentMany(entriesFromApi(name, requestBody, body))
  } catch {
    /* 로그 때문에 요청이 실패하지 않는다 */
  }
}
function recordError(name, error) {
  try {
    const entry = entryFromApiError(name, error.code)
    if (entry) logAgentMany([entry])
  } catch {
    /* 무시 */
  }
}

// 모든 서버 호출의 공통 경로.
//   · Demo Mode 이면 실제 /api/* 를 부르지 않고 Demo 서버 흉내(demoApi)가 대신 응답한다. (실제 OpenAI/Supabase/외부 API 호출 없음)
//   · 응답은 Agent Log 용 결정 요약으로도 변환된다. (원문/토큰은 남기지 않는다)
async function request(name, method, payload) {
  try {
    let body
    if (isDemoActive()) {
      body = await handleDemoApi(name, method, payload)
    } else {
      const url = method === 'GET' ? `/api/${name}?${new URLSearchParams(payload)}` : `/api/${name}`
      const options = method === 'GET' ? { method, headers: {} } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      const response = await fetch(url, { ...options, headers: { ...(await authHeader()), ...options.headers } })
      body = await response.json().catch(() => null)
      if (!response.ok) {
        // 서버가 돌려주는 짧은 오류 코드(예: generation_limit_reached)를 error.code 로 남겨 화면에서 문구로 바꾼다.
        const error = new Error(body?.error ?? `HTTP ${response.status}`)
        error.code = body?.error ?? null
        error.status = response.status
        error.details = body // 오류 코드 외 부가 정보(예: GPS 인증 실패 시 distanceMeters)
        throw error
      }
    }
    record(name, payload, body)
    return body
  } catch (error) {
    recordError(name, error)
    throw error
  }
}

// 서버 함수(/api/*) 호출 공통 함수. 로그인 토큰을 Bearer 로 붙인다.
// 외부 데이터 응답: { source: 'live' | 'mock', fetchedAt, data, fallback?, error? }
export function apiGet(name, params = {}) {
  return request(name, 'GET', params)
}

export function apiPost(name, body = {}) {
  return request(name, 'POST', body)
}
