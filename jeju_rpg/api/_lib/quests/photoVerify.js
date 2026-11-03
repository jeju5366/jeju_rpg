import { PHOTO_AI_MAX_ATTEMPTS, PHOTO_AI_MAX_ERRORS, PHOTO_AI_TIMEOUT_MS } from '../../../src/constants/photoRules.js'
import { HttpError } from '../http.js'
import { decodeImage } from '../photo/image.js'
import { judgePhoto } from '../photo/judge.js'
import { isPhotoQuest, photoAttemptState, photoModeOf } from '../photo/mode.js'
import { getAdmin } from '../supabaseAdmin.js'
import { completeQuest, loadQuestForVerification } from './progress.js'

// PhotoVerificationService (서버). 사진 인증 한 번의 요청을 처리한다.
//   입력: questId / attemptId(사진을 고를 때마다 새로 만든 UUID) / 이미지(base64)
//   출력: { result: pass | uncertain | fail, reason, completed, awaiting?, photo: { attemptsUsed, attemptsLeft, errors, canFallback }, ...완료 결과 }
//
// 인증용 사진은 "임시"다. 이 함수 안에서 메모리로만 쓰고 AI 분석이 끝나면 버린다. (Storage/DB 에 저장하지 않는다)
// Agent(GENERATE_*)의 요청 한도/로그(jeju_agent_requests)와 섞지 않는다. 비용은 jeju_api_usage_logs 에 purpose='photo_verification' 으로만 남긴다.
//
// 흐름 (photo_ai / gps_photo 의 ai_check)
//   1차 사진 → pass: 인증 성공 / uncertain·fail: 재촬영 안내 → 2차 사진 → pass: 성공 / uncertain·fail: AI 인증 종료 → 직접 확인(self) fallback
//   · 횟수는 DB(quest_progress.photo_attempts)에서 "AI 를 부르기 전에" 먼저 잡는다. (조건부 UPDATE 라서 동시에 여러 요청이 와도 한 번만 통과)
//   · 같은 attemptId 재전송은 저장해 둔 결과를 그대로 돌려준다. (AI 를 다시 부르지 않는다)
//   · AI 호출 자체가 실패(장애/시간 초과/형식 오류)하면 횟수를 돌려주고 photo_errors 만 올린다. 2번 실패하면 AI 인증을 닫고 직접 확인으로 안내한다.
// 업로드만 확인(upload_only): AI 호출 없이 사진을 올리면 성공. (횟수 제한 없음)
//
// gps_photo: 사진이 성공해도 GPS 를 아직 안 했으면 완료가 아니다(awaiting: 'gps'). GPS 가 이미 되어 있으면 이 요청에서 gps_photo 로 최종 완료한다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ensureProgress(db, { userId, questId, existing }) {
  if (existing) return existing
  const { data, error } = await db.from('jeju_quest_progress').insert({ user_id: userId, quest_id: questId, status: 'in_progress' }).select('*').single()
  if (!error) return data
  if (error.code !== '23505') throw error
  const { data: again, error: readError } = await db.from('jeju_quest_progress').select('*').eq('user_id', userId).eq('quest_id', questId).single()
  if (readError) throw readError
  return again
}

// 비용 로그. 저장 실패가 인증 결과를 막지는 않는다.
async function logUsage(db, { userId, questId, usage, result }) {
  const { error } = await db.from('jeju_api_usage_logs').insert({
    user_id: userId,
    quest_id: questId,
    purpose: 'photo_verification',
    result,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: usage.costUsd,
  })
  if (error) console.error('[photo] 비용 로그 저장 실패', error.message)
}

const photoInfo = (progress) => {
  const state = photoAttemptState(progress)
  return { attemptsUsed: state.attemptsUsed, attemptsLeft: state.attemptsLeft, errors: state.errors, canFallback: state.exhausted }
}

export async function verifyQuestPhoto({ user, questId, attemptId, image, db = getAdmin(), judge = judgePhoto }) {
  const userId = user.id
  if (!UUID.test(attemptId ?? '')) throw new HttpError(400, 'attemptId_invalid')
  const decoded = decodeImage(image)

  const { quest, existing } = await loadQuestForVerification(db, { userId, questId })
  if (!isPhotoQuest(quest)) throw new HttpError(400, 'photo_not_supported')
  const mode = photoModeOf(quest)
  const method = mode === 'upload_only' ? 'photo_upload' : 'photo_ai'

  // 사진은 통과했는데 완료 처리가 끊긴 경우(또는 gps_photo 에서 GPS 만 남은 경우): 사진을 다시 받지 않고 이어서 처리한다.
  if (existing?.photo_verified_at) return finish({ db, user, quest, progress: existing, result: 'pass', reason: existing.photo_last?.reason ?? '', method, replayed: true })

  // 같은 사진의 재전송(더블 클릭/네트워크 재시도): 저장해 둔 결과를 돌려준다. AI 는 다시 부르지 않는다.
  const last = existing?.photo_last
  if (last?.attemptId === attemptId) {
    if (last.status === 'pending') throw new HttpError(409, 'photo_busy')
    return { result: last.result, reason: last.reason ?? '', completed: false, replayed: true, photo: photoInfo(existing) }
  }

  let progress = await ensureProgress(db, { userId, questId, existing })
  // 다른 사진의 AI 판정이 아직 진행 중이면(방금 시작됨) 기다리게 한다. 오래된 pending(서버가 중간에 끊김)은 무시한다.
  const inFlight = progress.photo_last?.status === 'pending' && Date.now() - (progress.photo_last.at ?? 0) < PHOTO_AI_TIMEOUT_MS + 5000
  if (inFlight) throw new HttpError(409, 'photo_busy')

  // ── 업로드만 확인: 올리면 성공 (AI 호출/횟수 없음)
  if (mode === 'upload_only') {
    progress = await update(db, progress, { photo_verified_at: new Date().toISOString(), photo_last: { attemptId, status: 'done', result: 'pass', reason: '', mode } })
    return finish({ db, user, quest, progress, result: 'pass', reason: '', method })
  }

  // ── AI 확인
  const state = photoAttemptState(progress)
  if (state.exhausted) throw new HttpError(409, 'photo_attempts_exhausted', { photo: photoInfo(progress) })

  // 횟수를 AI 호출 "전에" 잡는다. photo_attempts 가 방금 읽은 값일 때만 올라가는 조건부 UPDATE → 동시 요청은 한쪽만 통과한다.
  const { data: claimed, error: claimError } = await db
    .from('jeju_quest_progress')
    .update({ photo_attempts: state.attemptsUsed + 1, photo_last: { attemptId, status: 'pending', mode, at: Date.now() } })
    .eq('id', progress.id)
    .eq('photo_attempts', state.attemptsUsed)
    .eq('status', 'in_progress')
    .select('*')
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) throw new HttpError(409, 'photo_busy')

  let verdict
  try {
    verdict = await judge({ quest, image: decoded.buffer, mime: decoded.mime })
  } catch (error) {
    // AI 장애는 사용자 잘못이 아니다: 판정 횟수는 돌려주고, 장애 횟수만 올린다.
    console.error('[photo] AI 판정 실패', error.message)
    const errors = (claimed.photo_errors ?? 0) + 1
    await db.from('jeju_quest_progress').update({ photo_attempts: state.attemptsUsed, photo_errors: errors, photo_last: null }).eq('id', progress.id)
    throw new HttpError(502, 'photo_ai_failed', { photo: { attemptsUsed: state.attemptsUsed, attemptsLeft: PHOTO_AI_MAX_ATTEMPTS - state.attemptsUsed, errors, canFallback: errors >= PHOTO_AI_MAX_ERRORS } })
  }

  await logUsage(db, { userId, questId, usage: verdict.usage, result: verdict.result })
  progress = await update(db, claimed, {
    photo_last: { attemptId, status: 'done', result: verdict.result, reason: verdict.reason, mode },
    ...(verdict.result === 'pass' ? { photo_verified_at: new Date().toISOString() } : {}),
  })
  return finish({ db, user, quest, progress, result: verdict.result, reason: verdict.reason, method })
}

async function update(db, progress, values) {
  const { data, error } = await db.from('jeju_quest_progress').update(values).eq('id', progress.id).select('*').single()
  if (error) throw error
  return data
}

// 판정 결과에 따른 마무리. pass 면 같은 완료 흐름(completeQuest)으로 최종 완료까지 간다.
async function finish({ db, user, quest, progress, result, reason, method, replayed = false }) {
  const base = { result, reason, replayed, photo: photoInfo(progress) }
  if (result !== 'pass') return { ...base, completed: false }

  // gps_photo: GPS 가 아직이면 완료가 아니다. 이미 GPS 가 되어 있으면 gps_photo 로 최종 완료.
  if (quest.verification_type === 'gps_photo') {
    if (!progress.gps_verified_at) return { ...base, completed: false, awaiting: 'gps' }
    return { ...base, completed: true, ...(await completeQuest({ user, questId: quest.id, preverified: { method: 'gps_photo' }, db })) }
  }
  return { ...base, completed: true, ...(await completeQuest({ user, questId: quest.id, preverified: { method }, db })) }
}
