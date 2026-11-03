// Agent Log: "입력 상태 / 규칙 판단 결과 / fallback 여부 / 이벤트 발생·억제 이유"를 짧게 보여주는 결정 요약 로그.
// chain-of-thought, raw prompt, 전체 GPT 응답, 토큰/이메일, stack trace 는 만들지도 저장하지도 않는다.
// 서버의 raw 응답 구조에 UI 가 직접 의존하지 않도록, 여기서 작은 공통 모델로 바꿔 준다. (순수 함수 — 테스트 가능)
//
// 이벤트 모델
//   { id, timestamp, type: 'context'|'filter'|'decision'|'replan'|'surprise'|'fallback'|'system'|'demo', level: 'info'|'warning'|'success',
//     title, message, meta?: { source?, reason?, beforeCount?, afterCount?, scenarioId? }, key? }
//   key: 같은 이벤트를 다시 렌더/재응답해도 중복으로 쌓지 않기 위한 식별자 (store 가 최근 로그와 비교한다)

export const LOG_TYPES = ['context', 'filter', 'decision', 'replan', 'surprise', 'fallback', 'system', 'demo']
export const LOG_LEVELS = ['info', 'warning', 'success']
export const MAX_LOG_ENTRIES = 150

// 로그에 들어가는 문자열은 짧게, 비밀로 보이는 값은 지운다.
export function sanitizeText(value, max = 140) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '[token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{10,})\b/g, '[secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

let counter = 0
export function makeEntry({ type = 'system', level = 'info', title, message = '', meta = undefined, key = undefined, now = Date.now() }) {
  counter += 1
  const safeType = LOG_TYPES.includes(type) ? type : 'system'
  const safeLevel = LOG_LEVELS.includes(level) ? level : 'info'
  return {
    id: `log-${now}-${counter}`,
    timestamp: now,
    type: safeType,
    level: safeLevel,
    title: sanitizeText(title, 60),
    message: sanitizeText(message, 200),
    ...(meta ? { meta } : {}),
    ...(key ? { key } : {}),
  }
}

// 서버/외부 오류 문자열 → 짧고 사람이 읽을 수 있는 이유. (원문은 남기지 않는다)
export function shortReason(raw) {
  const text = String(raw ?? '').toLowerCase()
  if (!text) return '원인 미상'
  if (/api[_ ]?key|requireenv|환경변수|not configured/.test(text)) return 'AI 연결 설정이 없음'
  if (/429|rate|limit|quota/.test(text)) return '요청 한도 초과'
  if (/timeout|timed out|abort|지연/.test(text)) return '응답 지연'
  if (/json|schema|valid|검증|출력|비었|refus|거절/.test(text)) return '응답 검증 실패'
  if (/network|fetch|econn|enotfound|load_failed/.test(text)) return '네트워크 문제'
  if (/simulated|시뮬/.test(text)) return '시뮬레이션된 장애'
  return '일시적인 오류'
}

// 외부 제공자(provider) fallback 안내 문구 (사용자 일반 화면 문구와 Agent Log 문구)
export const PROVIDER_FALLBACK = {
  directions: { title: '길찾기', message: '실시간 경로 정보를 불러오지 못해 거리 기반 예상 이동시간을 사용했어.' },
  weather: { title: '날씨', message: '날씨 정보를 불러오지 못해 준비된 기본 값을 쓰고, 날씨는 확정하지 않고 보수적으로 판단해.' },
  places: { title: '장소', message: '장소 정보를 불러오지 못해 준비된 기본 후보로 이어갔어.' },
  'airport-flights': { title: '항공편', message: '항공편 실시간 정보를 불러오지 못해 입력한 출발 시간을 기준으로 계산했어.' },
  'airport-congestion': { title: '공항 혼잡도', message: '공항 혼잡도를 불러오지 못해 보정 없이 보수적인 안전 기준을 유지했어.' },
  'transit-stops': { title: '대중교통', message: '대중교통 정보를 불러오지 못해 준비된 기본 정보를 사용했어.' },
  'transit-arrivals': { title: '대중교통', message: '대중교통 정보를 불러오지 못해 준비된 기본 정보를 사용했어.' },
  'transit-routes': { title: '대중교통', message: '대중교통 정보를 불러오지 못해 준비된 기본 정보를 사용했어.' },
}

// Surprise 가 만들어지지 않은 이유 → 문장 (대표적인 억제 이유만)
const SURPRISE_REASON = {
  moving: '이동 중이라 돌발 퀘스트를 만들지 않았어.',
  no_stable_point: '안정적인 시점이 아니라 돌발 퀘스트를 만들지 않았어.',
  time_short: '종료 시간이 가까워 돌발 퀘스트를 만들지 않았어.',
  replan_pending: '일정 재조정(REPLAN) 제안이 먼저라 돌발 퀘스트를 미뤘어.',
  verification_open: '인증이 진행 중이라 돌발 퀘스트를 미뤘어.',
  transitioning: '챕터를 넘어가는 중이라 돌발 퀘스트를 미뤘어.',
  daily_limit: '오늘 돌발 퀘스트 한도에 도달했어.',
  cooldown: '직전 돌발 퀘스트 이후 쉬는 시간이라 만들지 않았어.',
  free_travel: '자유여행 중이라 돌발 퀘스트를 만들지 않았어.',
  heavy_rain: '날씨가 좋지 않아 돌발 퀘스트를 만들지 않았어.',
  strong_wind: '날씨가 좋지 않아 돌발 퀘스트를 만들지 않았어.',
  no_quest: '조건에 맞는 돌발 퀘스트 후보가 없어서 만들지 않았어.',
  final_quest_notice: '공항 이동 준비 시간이라 새 돌발 퀘스트를 만들지 않았어. (Final Quest)',
  final_quest_active: 'Final Quest 중이라 새 돌발 퀘스트를 만들지 않았어.',
}

const REPLAN_REASON = {
  WEATHER_CHANGE: '날씨 변화',
  SCHEDULE_DELAY: '일정 지연',
  ACCOMMODATION_RISK: '숙소 복귀 위험',
  RETURN_FROM_FREE_TRAVEL: '자유여행 복귀',
  PLACE_UNAVAILABLE: '장소 이용 불가',
  USER_REQUEST: '사용자 요청',
}
export const replanReasonLabel = (reason) => REPLAN_REASON[reason] ?? '일정 조정'

// REPLAN 제안이 화면에 나타났을 때 / 사용자가 유지를 선택했을 때
export const replanProposedEntry = (reason) =>
  makeEntry({ type: 'replan', level: 'warning', title: 'REPLAN 제안', message: `${replanReasonLabel(reason)} 때문에 일정 재조정을 제안했어. 사용자 승인을 기다리는 중이야.`, meta: { reason }, key: `replan:proposed:${reason}` })
export const replanDismissedEntry = (reason) =>
  makeEntry({ type: 'replan', level: 'info', title: 'REPLAN 취소', message: `${replanReasonLabel(reason)} 제안은 기존 일정 유지로 넘겼어.`, meta: { reason } })

// API 응답 하나 → 로그 이벤트 목록. name 은 /api/ 뒤의 함수 이름, request 는 보낸 body/params, response 는 받은 body.
export function entriesFromApi(name, request, response) {
  const out = []
  const body = response ?? {}

  // 외부 제공자: live 성공은 남기지 않고, fallback 만 남긴다 (스팸 방지는 key 로)
  if (PROVIDER_FALLBACK[name] && (body.fallback === true || (body.source === 'mock' && body.error))) {
    const info = PROVIDER_FALLBACK[name]
    out.push(makeEntry({ type: 'fallback', level: 'warning', title: `${info.title} fallback`, message: `${info.message} (${shortReason(body.error)})`, meta: { source: 'mock', reason: shortReason(body.error) }, key: `fallback:${name}` }))
    return out
  }

  if (name === 'adventures-generate' && Array.isArray(body.adventures)) {
    const first = body.adventures[0]?.data ?? {}
    const facts = first.facts ?? {}
    const parts = [`이동 범위 ${request?.travelRange ?? '기본'}`]
    if (facts.weather) parts.push(`날씨 ${facts.weather === 'mock' ? '준비된 기본값' : facts.weather === 'live' && body.demo ? 'Demo 시뮬레이션' : '실시간'}`)
    if (facts.dailyContext) parts.push('오늘 조건 반영')
    out.push(makeEntry({ type: 'context', title: '오늘 컨텍스트 요약', message: parts.join(' · '), key: `ctx:${request?.adventureDate}:${body.generationSet}` }))
    if (body.meta && Number.isFinite(body.meta.gathered) && Number.isFinite(body.meta.candidates)) {
      out.push(makeEntry({ type: 'filter', title: '장소 후보 필터링', message: `후보 ${body.meta.gathered}개 → 모험에 쓸 후보 ${body.meta.candidates}개로 정리했어.`, meta: { beforeCount: body.meta.gathered, afterCount: body.meta.candidates }, key: `filter:${request?.adventureDate}:${body.generationSet}` }))
    }
    out.push(generationEntry('모험 생성', body, `adventures:${request?.adventureDate}:${body.generationSet}`, `${body.adventures.length}개 모험을 구성했어.`, 'AI 모험 생성이 완료되지 않아 준비된 규칙 기반 모험으로 이어갔어.'))
  } else if (name === 'quests-generate' && (body.chapters || body.quests)) {
    out.push(generationEntry('퀘스트 생성', body, `quests:${body.chapters?.[0]?.adventure_id ?? request?.adventureId}`, `챕터 ${body.chapters?.length ?? 0}개와 퀘스트를 구성했어.`, 'AI 퀘스트 생성이 완료되지 않아 준비된 규칙 기반 퀘스트로 이어갔어.'))
  } else if (name === 'adventures-replan') {
    const status = body.status ?? body.outcome
    if (status === 'no_alternative' || status === 'unchanged') out.push(makeEntry({ type: 'replan', level: 'info', title: 'REPLAN 결과', message: '바꿀 만한 대안이 없어서 기존 일정을 유지했어.', meta: { reason: request?.reason } }))
    else out.push(makeEntry({ type: 'replan', level: 'success', title: 'REPLAN 실행', message: `${replanReasonLabel(request?.reason)} 때문에 남은 일정을 다시 구성했어. (완료한 퀘스트/EXP는 그대로)`, meta: { reason: request?.reason, source: body.source } }))
  } else if (name === 'surprise-evaluate') {
    if (body.offered && !body.existing) out.push(makeEntry({ type: 'surprise', level: 'success', title: 'Surprise 생성', message: '돌발 퀘스트가 나타났어. 도전할지는 사용자가 선택해.', key: `surprise:${body.quest?.id}` }))
    else if (body.offered === false && SURPRISE_REASON[body.reason]) out.push(makeEntry({ type: 'surprise', level: 'info', title: 'Surprise 억제', message: SURPRISE_REASON[body.reason], meta: { reason: body.reason }, key: `surprise:skip:${body.reason}` }))
  } else if (name === 'final-quest' && request?.action === 'status') {
    const entry = finalQuestEntry(body)
    if (entry) out.push(entry)
  }
  return out
}

function generationEntry(title, body, key, okMessage, fallbackMessage) {
  if (body.source === 'openai') return makeEntry({ type: 'decision', level: 'success', title, message: `${body.demo ? '(Demo 시뮬레이션) ' : ''}AI가 ${okMessage}`, meta: { source: 'openai' }, key })
  return makeEntry({ type: 'fallback', level: 'warning', title: `${title} fallback`, message: `${fallbackMessage} (${shortReason(body.fallbackReason)})`, meta: { source: 'code', reason: shortReason(body.fallbackReason) }, key })
}

// Final Quest 상태 → 결정 요약
export function finalQuestEntry(state) {
  if (!state || !state.status) return null
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '')
  if (state.status === 'notice') return makeEntry({ type: 'decision', level: 'warning', title: 'Final Quest 임박', message: `${time(state.safe?.latestSafeDeparture)} 쯤 공항으로 출발해야 안전해. 새 돌발 퀘스트는 만들지 않아.`, key: 'final:notice' })
  if (state.status === 'active') return makeEntry({ type: 'decision', level: 'warning', title: 'Final Quest 활성화', message: '안전 출발 시각이 되어 일반 퀘스트를 마감하고 공항 이동으로 전환했어. (새 일반 일정/Surprise 차단)', key: 'final:active' })
  if (state.status === 'flight_cancelled') return makeEntry({ type: 'decision', level: 'warning', title: '항공편 결항', message: '항공편 결항이 확인돼서 공항 이동을 강제하지 않고 상태 확인을 안내했어.', key: 'final:cancelled' })
  if (state.status === 'arrived') return makeEntry({ type: 'decision', level: 'success', title: 'Final Quest 완료', message: '공항 도착을 확인했어. 여행 마무리를 눌러야 여행이 끝나.', key: 'final:arrived' })
  return null
}

// API 오류 코드 → 로그 (대표적인 억제/차단 이유만. stack/원문은 남기지 않는다)
export function entryFromApiError(name, code) {
  if (code === 'final_quest_notice' || code === 'final_quest_active') {
    return makeEntry({ type: 'surprise', level: 'info', title: 'Final Quest 차단', message: SURPRISE_REASON[code], meta: { reason: code }, key: `block:${code}` })
  }
  return null
}

// Demo Mode 이벤트
export const demoEntry = (title, message, level = 'info') => makeEntry({ type: 'demo', level, title, message })
