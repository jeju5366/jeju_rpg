import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, test } from 'node:test'
import { useAgentLogStore } from '../src/store/agentLogStore.js'
import { entriesFromApi, entryFromApiError, finalQuestEntry, makeEntry, MAX_LOG_ENTRIES, replanProposedEntry, sanitizeText, shortReason } from '../src/utils/agentLog.js'

beforeEach(() => useAgentLogStore.setState({ entries: [], scenarioId: null, panelOpen: false }))

test('로그 항목: 작은 공통 모델 (type/level 검증, 문자열 길이 제한, 비밀값 제거)', () => {
  const entry = makeEntry({ type: 'nope', level: 'weird', title: 'x'.repeat(200), message: 'Bearer abc.def.ghi 로 a@b.com 에게 sk-ABCDEFGHIJKLMNOP' })
  assert.equal(entry.type, 'system')
  assert.equal(entry.level, 'info')
  assert.ok(entry.title.length <= 60)
  assert.doesNotMatch(entry.message, /abc\.def|a@b\.com|sk-ABC/)
  assert.match(entry.message, /\[token\]/)
  assert.equal(sanitizeText('a\n\n b'), 'a b')
  for (const key of ['id', 'timestamp', 'type', 'level', 'title', 'message']) assert.ok(key in entry)
})

test('오류 원문 대신 짧은 이유만 남긴다', () => {
  assert.equal(shortReason('OPENAI_API_KEY 가 비었어'), 'AI 연결 설정이 없음')
  assert.equal(shortReason('OpenAI HTTP 429: rate limit'), '요청 한도 초과')
  assert.equal(shortReason('The operation was aborted due to timeout'), '응답 지연')
  assert.equal(shortReason('검증 실패: 출력이 이상해'), '응답 검증 실패')
  assert.equal(shortReason('simulated_failure'), '시뮬레이션된 장애')
  assert.equal(shortReason('at stack /node_modules/x'), '일시적인 오류') // stack 을 그대로 내보내지 않는다
})

test('모험 생성 응답 → 컨텍스트 요약 / 후보 필터링 / 생성 결정 (정상 + fallback)', () => {
  const ok = entriesFromApi('adventures-generate', { adventureDate: '2026-11-03', travelRange: 'normal' }, { source: 'openai', generationSet: 1, adventures: [{ data: { facts: { weather: 'live', dailyContext: 'saved' } } }, {}, {}], meta: { gathered: 24, candidates: 9 } })
  assert.deepEqual(ok.map((e) => e.type), ['context', 'filter', 'decision'])
  assert.deepEqual([ok[1].meta.beforeCount, ok[1].meta.afterCount], [24, 9])
  assert.equal(ok[2].level, 'success')

  const fallback = entriesFromApi('adventures-generate', { adventureDate: '2026-11-03' }, { source: 'demo', generationSet: 1, fallbackReason: 'OpenAI HTTP 429', adventures: [{ data: {} }] })
  const last = fallback.at(-1)
  assert.deepEqual([last.type, last.level], ['fallback', 'warning'])
  assert.match(last.message, /준비된 규칙 기반 모험/)
  assert.match(last.message, /요청 한도 초과/)
  assert.doesNotMatch(JSON.stringify(last), /429/) // 원문 숫자/문구를 남기지 않는다
})

test('퀘스트 생성 / REPLAN / Surprise 억제 / Final Quest 응답 → 사람이 읽는 문장', () => {
  assert.equal(entriesFromApi('quests-generate', {}, { source: 'openai', chapters: [{}, {}, {}], quests: [] })[0].type, 'decision')
  assert.match(entriesFromApi('quests-generate', {}, { source: 'demo', chapters: [], quests: [], fallbackReason: 'timeout' })[0].message, /규칙 기반 퀘스트/)
  assert.match(entriesFromApi('adventures-replan', { reason: 'WEATHER_CHANGE' }, { status: 'replanned' })[0].message, /날씨 변화/)
  assert.match(entriesFromApi('adventures-replan', { reason: 'USER_REQUEST' }, { status: 'no_alternative' })[0].message, /기존 일정을 유지/)
  assert.match(entriesFromApi('surprise-evaluate', {}, { offered: false, reason: 'replan_pending' })[0].message, /REPLAN/)
  assert.equal(entriesFromApi('surprise-evaluate', {}, { offered: false, reason: 'already_evaluated' }).length, 0) // 대표 이유만
  assert.equal(entriesFromApi('surprise-evaluate', {}, { offered: true, quest: { id: 'q' } })[0].level, 'success')
  assert.match(entryFromApiError('surprise-evaluate', 'final_quest_notice').message, /Final Quest/)
  assert.equal(entryFromApiError('quests-complete', 'already_completed'), null)
  assert.match(finalQuestEntry({ status: 'notice', safe: { latestSafeDeparture: '2026-11-03T07:30:00Z' } }).message, /16:30/)
  assert.equal(finalQuestEntry({ status: 'none' }), null)
  assert.match(replanProposedEntry('SCHEDULE_DELAY').message, /사용자 승인/)
})

test('외부 API: live 성공은 남기지 않고 fallback 만 경고로 남긴다 (기술 오류 노출 없음)', () => {
  assert.equal(entriesFromApi('weather', {}, { source: 'live', data: {} }).length, 0)
  const directions = entriesFromApi('directions', {}, { source: 'mock', fallback: true, error: 'ECONNRESET at https://x/y?serviceKey=SECRET' })[0]
  assert.deepEqual([directions.type, directions.level], ['fallback', 'warning'])
  assert.match(directions.message, /거리 기반 예상 이동시간/)
  assert.doesNotMatch(JSON.stringify(directions), /SECRET|serviceKey|https/)
  assert.match(entriesFromApi('places', {}, { source: 'mock', fallback: true, error: 'x' })[0].message, /준비된 기본 후보/)
  assert.match(entriesFromApi('airport-flights', {}, { source: 'mock', fallback: true, error: 'x' })[0].message, /입력한 출발 시간/)
  assert.match(entriesFromApi('airport-congestion', {}, { source: 'mock', fallback: true, error: 'x' })[0].message, /보수적인 안전 기준/)
})

test('store: 같은 key 는 중복으로 쌓이지 않고, 최대 개수 상한, Demo 로그만 지울 수 있다', () => {
  const { push } = useAgentLogStore.getState()
  push(makeEntry({ title: 'a', key: 'k1' }))
  push(makeEntry({ title: 'a again', key: 'k1' })) // 리렌더/재응답 중복
  push(makeEntry({ title: 'b' }))
  assert.equal(useAgentLogStore.getState().entries.length, 2)
  assert.equal(useAgentLogStore.getState().entries[0].title, 'b') // 최신이 앞

  useAgentLogStore.getState().setScenario('rain')
  push(makeEntry({ title: 'demo-one' }))
  assert.equal(useAgentLogStore.getState().entries[0].meta.scenarioId, 'rain')
  useAgentLogStore.getState().clearDemo()
  assert.deepEqual(useAgentLogStore.getState().entries.map((e) => e.title).sort(), ['a', 'b'])
  assert.equal(useAgentLogStore.getState().scenarioId, null)

  for (let i = 0; i < MAX_LOG_ENTRIES + 30; i += 1) push(makeEntry({ title: `n${i}` }))
  assert.equal(useAgentLogStore.getState().entries.length, MAX_LOG_ENTRIES)
})

test('서버 응답 meta: 후보 개수만 요약해서 반환 (raw prompt/응답 없음)', () => {
  const source = readFileSync('api/_lib/agent/generateAdventures.js', 'utf8')
  assert.match(source, /meta: \{ gathered: gathered\.length, candidates: candidates\.length, places: placesSource \}/)
})

test('Agent Log 연결 지점: apiClient 공통 경로 + REPLAN 제안 + 자유여행 복귀', () => {
  assert.match(readFileSync('src/services/api/apiClient.js', 'utf8'), /entriesFromApi\(name, requestBody, body\)/)
  assert.match(readFileSync('src/hooks/useScheduleAssistant.js', 'utf8'), /logAgent\(replanProposedEntry\(suggestedReason\)\)/)
  assert.match(readFileSync('src/hooks/useFreeTravel.js', 'utf8'), /title: '자유여행 복귀'/)
})
