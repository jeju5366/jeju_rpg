import { HttpError } from '../http.js'
import { estimateCostUsd } from './openai.js'

const STALE_PENDING_MS = 2 * 60 * 1000

// Agent 요청 1건을 jeju_agent_requests 에 "잡는다". UNIQUE(user_id, request_key) 로 같은 요청의 중복 호출을 DB 에서 막는다.
// (더블 클릭, 새로고침 재전송 포함. 이미 진행 중이면 in_progress, 실패했거나 2분 넘게 멈춘 요청만 다시 잡을 수 있다)
export async function claimAgentRequest(db, { userId, tripId, adventureId = null, requestType, requestKey, payload }) {
  const { data, error } = await db
    .from('jeju_agent_requests')
    .insert({
      user_id: userId,
      trip_id: tripId,
      adventure_id: adventureId,
      request_type: requestType,
      request_key: requestKey,
      status: 'pending',
      request_payload: payload,
    })
    .select('id')
    .single()
  if (!error) return data.id
  if (error.code !== '23505') throw error

  const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString()
  const { data: reclaimed, error: reclaimError } = await db
    .from('jeju_agent_requests')
    .update({ status: 'pending', request_payload: payload, error_message: null, created_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('request_key', requestKey)
    .or(`status.eq.failed,and(status.eq.pending,created_at.lt.${staleBefore})`)
    .select('id')
  if (reclaimError) throw reclaimError
  if (!reclaimed?.length) throw new HttpError(409, 'in_progress')
  return reclaimed[0].id
}

export async function finishAgentRequest(db, requestId, { status, response = null, error = null }) {
  await db
    .from('jeju_agent_requests')
    .update({ status, response_payload: response, error_message: error ? String(error).slice(0, 500) : null })
    .eq('id', requestId)
}

// 비용 로그 (model/input/output/cost). 로그 저장 실패가 생성 결과를 막지는 않는다.
export async function logUsages(db, { userId, requestId, usages }) {
  if (!usages.length) return
  const { error } = await db.from('jeju_api_usage_logs').insert(
    usages.map((u) => ({
      user_id: userId,
      agent_request_id: requestId,
      model: u.model,
      input_tokens: u.inputTokens,
      output_tokens: u.outputTokens,
      cost_usd: estimateCostUsd(u.model, u.inputTokens, u.outputTokens),
    })),
  )
  if (error) console.error('[agent] 비용 로그 저장 실패', error.message)
}
