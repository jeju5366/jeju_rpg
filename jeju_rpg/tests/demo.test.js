import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'
import { handleDemoApi } from '../src/demo/demoApi.js'
import { DEMO_SCENARIOS, endDemo, resetScenarioStores, runDemoControl, startDemoScenario, switchDemoScenario } from '../src/demo/demoController.js'
import { DEMO_USER_ID, getDemoDb, getDemoEpoch, isDemoActive } from '../src/demo/demoRuntime.js'
import { createProfileSync } from '../src/app/profileSync.js'
import { useAgentLogStore } from '../src/store/agentLogStore.js'
import { useAuthStore } from '../src/store/authStore.js'
import { demoSession, useDemoStore } from '../src/store/demoStore.js'
import { useFinalQuestStore } from '../src/store/finalQuestStore.js'
import { useFreeTravelStore } from '../src/store/freeTravelStore.js'
import { useReplanStore } from '../src/store/replanStore.js'
import { useWeatherStore } from '../src/store/weatherStore.js'
import { computeSafeTimes } from '../src/utils/finalQuest.js'

// Demo Mode 는 실제 네트워크(/api, Supabase, OpenAI)를 절대 부르지 않아야 한다. fetch 가 불리면 테스트가 실패하게 막아 둔다.
let fetchCalls = []
const realFetch = globalThis.fetch
const store = new Map()
beforeEach(() => {
  fetchCalls = []
  globalThis.fetch = (...args) => {
    fetchCalls.push(args[0])
    throw new Error('Demo 중에는 네트워크를 부르면 안 돼')
  }
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  store.clear()
  useAgentLogStore.setState({ entries: [], scenarioId: null })
})
afterEach(() => {
  endDemo()
  globalThis.fetch = realFetch
})

const api = (name, payload, method = 'POST') => handleDemoApi(name, method, payload)
const db = () => getDemoDb()
const profile = () => db().find('jeju_profiles', (p) => p.id === DEMO_USER_ID)
const questOf = (type, pred = () => true) => db().find('jeju_quests', (q) => q.quest_type === type && !q.replaced_at && pred(q))

test('Demo 시나리오 7종: 필수 필드와 각자의 시작 상태', () => {
  assert.deepEqual(DEMO_SCENARIOS.map((s) => s.id), ['tour', 'sunny', 'rain', 'final', 'levelup', 'freetravel', 'outage'])
  for (const s of DEMO_SCENARIOS) {
    assert.ok(s.emoji && s.label && s.description && s.badge, s.id)
    assert.equal(startDemoScenario(s.id), true, s.id)
    assert.equal(useDemoStore.getState().active, true)
    assert.equal(db().all('jeju_trips').length >= 1, true)
    assert.equal(profile().onboarding_completed, true)
  }
  assert.equal(startDemoScenario('nope'), false)
})

test('실제 Supabase/API 격리: 모든 흐름이 Demo DB 로만 가고 네트워크(fetch)는 한 번도 나가지 않는다', async () => {
  // 맑은 날: 모험 3개 → 선택 → 퀘스트 생성 → 완료 → 챕터 진행
  startDemoScenario('sunny')
  const generated = await api('adventures-generate', { tripId: 'demo-trip', adventureDate: db().all('jeju_trips')[0].start_date, travelRange: 'normal' })
  assert.equal(generated.adventures.length, 3)
  assert.equal(generated.demo, true)
  await api('adventures-select', { adventureId: generated.adventures[0].id })
  const made = await api('quests-generate', { adventureId: generated.adventures[0].id })
  assert.ok(made.chapters.length === 3 && made.quests.length > 3)
  const core = questOf('core')
  const before = profile().exp_explore + profile().exp_culture + profile().exp_food + profile().exp_relax
  const done = await api('quests-complete', { questId: core.id, method: 'self' })
  assert.equal(done.progress.status, 'completed')
  assert.equal(done.chapterStatus, 'core_completed')
  assert.ok(done.rewards.quest.awarded && done.rewards.quest.total > 0)
  assert.ok(profile().exp_explore + profile().exp_culture + profile().exp_food + profile().exp_relax > before) // Demo 프로필만 바뀐다
  await assert.rejects(() => api('quests-complete', { questId: core.id, method: 'self' }), { code: 'already_completed' })
  const advanced = await api('chapters-advance', { chapterId: core.chapter_id })
  assert.equal(advanced.rewards.chapterBonus, 20)

  // 피드백/기록 저장, 사진/추억은 지원하지 않음(Demo DB 에도 쓰지 않고 안내 문구)
  const feedback = await api('trip-feedback', { tripId: 'demo-trip', rating: 4 })
  assert.equal(feedback.feedback.rating, 4)
  await assert.rejects(() => api('memories-save', {}), { message: '데모에서는 사진 기능을 쓰지 않아.' })

  assert.deepEqual(fetchCalls, [])
})

test('레벨업 직전: 퀘스트 완료 1개로 보상 + LEVEL UP (Demo EXP 만 변경)', async () => {
  startDemoScenario('levelup')
  const core = questOf('core')
  const done = await api('quests-complete', { questId: core.id, method: 'self' })
  assert.ok(done.rewards.levelUps.length >= 1, JSON.stringify(done.rewards.levelUps))
  assert.ok(done.rewards.levelUps.every((u) => u.to > u.from))
  assert.deepEqual(fetchCalls, [])
})

test('비 오는 날: 날씨 변화는 "제안"만 하고, 승인(요청)해야 REPLAN 이 실행된다. 완료한 것은 그대로', async () => {
  startDemoScenario('rain')
  const weather = await api('weather', { lat: 33.5, lng: 126.5 }, 'GET')
  assert.equal(weather.data.precipitation.raining, true)
  assert.equal(useWeatherStore.getState().raw.precipitation.raining, true) // 큰 변화(기준은 맑음) → 화면 코드가 제안을 만든다
  assert.equal(useWeatherStore.getState().baseline.precipitation.raining, false)
  const chaptersBefore = db().all('jeju_chapters', (c) => c.status !== 'replaced').map((c) => c.title)
  assert.ok(chaptersBefore.includes('용두암 이야기')) // 승인 전에는 아무것도 바뀌지 않았다

  const adventure = db().all('jeju_adventures')[0]
  const result = await api('adventures-replan', { adventureId: adventure.id, reason: 'WEATHER_CHANGE' })
  assert.equal(result.status, 'replanned')
  const after = db().all('jeju_chapters', (c) => c.status !== 'replaced')
  assert.ok(after.every((c) => !['용두암 이야기', '함덕해수욕장 이야기'].includes(c.title)))
  assert.equal(after.find((c) => c.seq === 1).status, 'active')
  assert.deepEqual(fetchCalls, [])
})

test('Final Quest: 안전 시간은 실제와 같은 계산(도착 90분 − 이동시간 − 혼잡 보정), 시간 이동 → 활성화 → 도착 → +100 → 마무리', async () => {
  startDemoScenario('final')
  const first = await api('final-quest', { action: 'status', tripId: 'demo-trip' })
  assert.equal(first.status, 'notice') // 안전 출발 시각 임박 (60분 전 구간)
  assert.equal(first.noticeLock, true)
  assert.equal(first.safe.arriveBeforeMinutes, 90)
  const expected = computeSafeTimes({ departureAtMs: Date.parse(first.flight.departureAt), international: false, congestionLevel: 2, travelMinutes: first.safe.travelMinutes })
  assert.equal(first.safe.latestSafeDeparture, new Date(expected.latestSafeDeparture).toISOString())
  assert.ok(first.safe.travelMinutes >= 100 && first.safe.travelMinutes <= 140, `약 2시간: ${first.safe.travelMinutes}`)

  // 준비 구간에는 새 돌발 퀘스트를 만들지 않는다
  await assert.rejects(() => api('surprise-evaluate', { adventureId: db().all('jeju_adventures')[0].id }), { code: 'final_quest_notice' })

  runDemoControl('advance') // 시연: 15분 앞으로
  const active = await api('final-quest', { action: 'status', tripId: 'demo-trip' })
  assert.equal(active.status, 'active')
  assert.equal(active.locked, true)
  assert.equal(db().all('jeju_adventures')[0].status, 'ended_early')
  assert.ok(db().all('jeju_quest_progress', (p) => p.status === 'ended_by_final_quest').length > 0)
  await assert.rejects(() => api('surprise-evaluate', { adventureId: db().all('jeju_adventures')[0].id }), { code: 'final_quest_active' })
  await assert.rejects(() => api('quests-complete', { questId: questOf('core').id, method: 'self' }), (e) => e.status === 409)

  // 공항 500m 밖에서는 도착 확인 불가, 이동 시작 후(시뮬레이션 위치가 공항 근처) 도착 확인 → +100 EXP 한 번
  await assert.rejects(() => api('final-quest', { action: 'arrive', tripId: 'demo-trip', position: { lat: 33.4, lng: 126.6, accuracy: 10, timestamp: Date.now() } }), { code: 'gps_too_far' })
  await api('final-quest', { action: 'start', tripId: 'demo-trip' })
  const near = useDemoStore.getState().position
  const unspentBefore = profile().unspent_exp
  const arrived = await api('final-quest', { action: 'arrive', tripId: 'demo-trip', position: { ...near, timestamp: Date.now() } })
  assert.deepEqual([arrived.awarded, arrived.amount], [true, 100])
  const again = await api('final-quest', { action: 'arrive', tripId: 'demo-trip', position: { ...near, timestamp: Date.now() } })
  assert.equal(again.awarded, false)
  assert.equal(profile().unspent_exp, unspentBefore + 100)
  const finished = await api('final-quest', { action: 'finish', tripId: 'demo-trip' })
  assert.equal(finished.record.trip.status, 'completed')
  assert.deepEqual(fetchCalls, [])
})

test('자유여행: 시작/종료는 Demo DB 만, 복귀 후 REPLAN(RETURN_FROM_FREE_TRAVEL)은 사용자가 요청했을 때만', async () => {
  startDemoScenario('freetravel')
  assert.equal(useFreeTravelStore.getState().phase, 'active')
  assert.equal(Object.keys(useFreeTravelStore.getState().tracking.candidates).length, 1)
  const session = useFreeTravelStore.getState().session
  const finished = await api('free-travel-finish', { sessionId: session.id, visits: [{ placeId: 'demo-aqua' }] })
  assert.equal(finished.saved[0].placeName, '아쿠아플라넷 제주')
  assert.equal(finished.rewards.discoveries.length, 1)
  assert.equal(db().all('jeju_trips')[0].travel_mode, 'quest')
  const adventure = db().all('jeju_adventures')[0]
  assert.equal(db().all('jeju_agent_requests').length, 0) // 자동 REPLAN 없음
  const replan = await api('adventures-replan', { adventureId: adventure.id, reason: 'RETURN_FROM_FREE_TRAVEL', context: { position: { lat: 33.4333, lng: 126.9288 } } })
  assert.equal(replan.status, 'replanned')
  assert.deepEqual(fetchCalls, [])
})

test('API 장애 시뮬레이션: 화면은 죽지 않고 fallback 메타와 함께 계속 진행 (기술 오류 문자열 없음)', async () => {
  startDemoScenario('outage')
  const weather = await api('weather', { lat: 33.5, lng: 126.5 }, 'GET')
  assert.deepEqual([weather.fallback, weather.source], [true, 'mock'])
  assert.ok(weather.data.sky) // 보수적 기본값으로 계속
  assert.equal(weather.data.precipitation.raining, false)
  const places = await api('places', { lat: 33.5, lng: 126.5, radius: 50000 }, 'GET')
  assert.equal(places.fallback, true)
  assert.ok(places.data.length > 0)
  const route = await api('directions', { startLat: 33.5, startLng: 126.5, goalLat: 33.45, goalLng: 126.9 }, 'GET')
  assert.equal(route.fallback, true)
  assert.ok(route.data.durationSeconds > 0)
  const generated = await api('adventures-generate', { tripId: 'demo-trip', adventureDate: db().all('jeju_trips')[0].start_date })
  assert.equal(generated.source, 'demo')
  assert.equal(generated.adventures.length, 3) // 준비된 규칙 기반 모험으로 계속
  assert.doesNotMatch(String(generated.fallbackReason), /simulated|Error|stack/i)
  assert.deepEqual(fetchCalls, [])
})

test('시나리오 변경: 이전 시나리오의 REPLAN/Final Quest/자유여행/날씨/시간/위치/Demo 로그가 남지 않는다', async () => {
  startDemoScenario('rain')
  useReplanStore.getState().markShown('WEATHER_CHANGE')
  useFinalQuestStore.getState().setState('demo-trip', { status: 'active' })
  runDemoControl('advance')
  assert.ok(useAgentLogStore.getState().entries.some((e) => e.meta?.scenarioId === 'rain'))

  switchDemoScenario('freetravel')
  assert.equal(useDemoStore.getState().scenarioId, 'freetravel')
  assert.equal(useDemoStore.getState().offsetMs, 0)
  assert.equal(useDemoStore.getState().weather, 'clear')
  assert.deepEqual(useReplanStore.getState().shown, {})
  assert.equal(useFinalQuestStore.getState().state, null)
  assert.equal(useWeatherStore.getState().raw, null)
  assert.equal(useFreeTravelStore.getState().phase, 'active') // 새 시나리오의 상태
  assert.equal(db().all('jeju_trips', (t) => t.id === 'demo-trip')[0].travel_mode, 'free')
  const stale = useAgentLogStore.getState().entries.filter((e) => e.meta?.scenarioId === 'rain')
  assert.equal(stale.length, 0)
})

test('Demo 종료: 상태/DB/로그/sessionStorage 정리, 실제 Auth store 는 그대로', () => {
  const real = { user: { id: 'real-user' }, profile: { id: 'real-user', nickname: '진짜' }, onboardingCompleted: true, session: { access_token: 't' } }
  useAuthStore.setState(real)
  startDemoScenario('tour')
  assert.equal(demoSession.read(), 'tour')
  // Demo 중에는 화면이 Demo 사용자를 본다 (store 는 그대로)
  assert.equal(useAuthStore.getState().user.id, DEMO_USER_ID)
  assert.equal(useAuthStore.getState().profile.nickname, '데모 모험가')
  assert.equal(useAuthStore.getState().session.access_token, 't') // 실제 session 은 바뀌지 않는다

  endDemo()
  assert.equal(useDemoStore.getState().active, false)
  assert.equal(getDemoDb(), null)
  assert.equal(demoSession.read(), null)
  assert.equal(useAgentLogStore.getState().entries.filter((e) => e.meta?.scenarioId).length, 0)
  assert.equal(useAuthStore.getState().user.id, 'real-user')
  assert.equal(useAuthStore.getState().profile.nickname, '진짜')
  assert.equal(useAuthStore.getState().onboardingCompleted, true)
  assert.equal(useAuthStore.getState().session.access_token, 't')
  useAuthStore.setState({ session: null, user: null, profile: null, onboardingCompleted: false })
  resetScenarioStores()
})

test('격리 경계가 코드에 있다: supabase 프록시 / apiClient / geolocation / RouteGuards', () => {
  const client = readFileSync('src/lib/supabaseClient.js', 'utf8')
  assert.match(client, /new Proxy\(real \?\? \{\}/)
  assert.match(client, /DEMO_METHODS = new Set\(\['from', 'rpc', 'storage'\]\)/) // auth 는 항상 실제
  assert.match(readFileSync('src/services/api/apiClient.js', 'utf8'), /if \(isDemoActive\(\)\) \{\s*body = await handleDemoApi/)
  assert.match(readFileSync('src/services/location/geolocation.js', 'utf8'), /demoPosition\(\)/)
  const guards = readFileSync('src/components/common/RouteGuards.jsx', 'utf8')
  assert.equal((guards.match(/if \(demo\) return <Outlet \/>/g) ?? []).length, 2) // RequireAuth / RequireOnboarding 만
  assert.doesNotMatch(readFileSync('src/store/authStore.js', 'utf8'), /setSession\(\{/) // fake session 을 넣지 않는다
})

test('Demo 전용 페이지를 복제하지 않는다 (기존 Route/컴포넌트 공유)', () => {
  const router = readFileSync('src/app/router.jsx', 'utf8')
  assert.doesNotMatch(router, /Demo/)
})

// ───────── 실제 로그인 사용자 → Demo → 종료: 실제 auth 상태 보존 ─────────
const snapshot = () => {
  const s = useAuthStore.base.getState()
  return JSON.parse(JSON.stringify({ session: s.session, user: s.user, profile: s.profile, onboardingCompleted: s.onboardingCompleted, initializing: s.initializing, profileRefreshing: s.profileRefreshing, profileError: s.profileError }))
}

test('실제 로그인 사용자 → Demo 진입 → Profile 탭 방문/EXP 변경 → Demo 종료 → 기존 auth state 보존', async () => {
  const real = { session: { access_token: 'real-token', user: { id: 'real-user' } }, user: { id: 'real-user', email: 'x' }, profile: { id: 'real-user', nickname: '진짜', exp_explore: 777, onboarding_completed: true }, onboardingCompleted: true, initializing: false, profileRefreshing: false, profileError: null }
  useAuthStore.base.setState(real)
  const before = snapshot()

  startDemoScenario('levelup')
  assert.deepEqual(snapshot(), before) // 진입만으로 실제 store 는 변하지 않는다

  // Profile 탭이 하는 일: ensureProfile(user.id) → setProfile(fresh) / 온보딩·로딩 action 들 (Demo 중에는 base 를 수정하지 않는다)
  const view = useAuthStore.getState()
  assert.equal(view.user.id, DEMO_USER_ID)
  const demoProfile = profile()
  view.setProfile({ ...demoProfile })
  view.setOnboardingCompleted(false)
  view.setInitializing(true)
  view.setProfileRefreshing(true)
  view.setProfileError('demo error')
  assert.deepEqual(snapshot(), before)

  // Demo 프로필은 demoDb + profileVersion 경로로만 바뀐다
  const versionBefore = useDemoStore.getState().profileVersion
  const expBefore = useAuthStore.getState().profile.exp_explore
  await api('quests-complete', { questId: questOf('core').id, method: 'self' })
  assert.ok(useDemoStore.getState().profileVersion > versionBefore)
  assert.ok(useAuthStore.getState().profile.exp_explore > expBefore) // 화면(view)에는 새 Demo EXP
  assert.equal(useAuthStore.getState().profile.nickname, '데모 모험가')
  assert.deepEqual(snapshot(), before) // 그래도 실제 store 는 그대로

  endDemo()
  assert.deepEqual(snapshot(), before) // 종료 뒤: session / user / profile / onboardingCompleted 가 Demo 진입 전과 같다
  assert.equal(useAuthStore.getState().profile.exp_explore, 777)
  assert.equal(useAuthStore.getState().session.access_token, 'real-token') // fake session 은 만들지 않았다
  useAuthStore.base.setState({ session: null, user: null, profile: null, onboardingCompleted: false, initializing: true })
  resetScenarioStores()
})

test('Auth bootstrap 구조: 실제(base) store 만 다루고, Demo 경계는 profileSync 가 처리하며, setProfile 경로는 모두 view 경유', () => {
  const source = readFileSync('src/app/useAuthBootstrap.js', 'utf8')
  assert.match(source, /createProfileSync\(\{/)
  assert.doesNotMatch(source, /useAuthStore\.getState\(\)/) // 모두 authBase(실제 store)
  assert.match(source, /const authBase = useAuthStore\.base/)
  for (const file of ['src/pages/ProfilePage.jsx', 'src/pages/CharacterPage.jsx', 'src/pages/TravelSetupPage.jsx']) assert.match(readFileSync(file, 'utf8'), /useAuthStore\(/, file)
  assert.match(readFileSync('src/store/authStore.js', 'utf8'), /DEMO_NOOP_ACTIONS = \{ setProfile: noop, setOnboardingCompleted: noop, setInitializing: noop, setProfileRefreshing: noop, setProfileError: noop \}/)
})

// ───────── profile sync 비동기 race ─────────
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  const d = {}
  d.promise = new Promise((resolve, reject) => Object.assign(d, { resolve, reject }))
  return d
}
const realAuth = (over = {}) => ({ session: { access_token: 'real-token', user: { id: 'real-user' } }, user: { id: 'real-user' }, profile: { id: 'real-user', nickname: '진짜', exp_explore: 777, onboarding_completed: true }, onboardingCompleted: true, initializing: false, profileRefreshing: false, profileError: null, ...over })
const baseSnap = () => {
  const s = useAuthStore.base.getState()
  return JSON.parse(JSON.stringify({ profile: s.profile, onboardingCompleted: s.onboardingCompleted, initializing: s.initializing, profileRefreshing: s.profileRefreshing, profileError: s.profileError, session: s.session }))
}
function makeSync(ensureProfile) {
  const synced = []
  const sync = createProfileSync({
    authBase: useAuthStore.base,
    ensureProfile,
    isDemoActive,
    getEpoch: getDemoEpoch,
    onSynced: () => synced.push(1),
    // useAuthBootstrap 과 같은 방식
    whenDemoEnds: (fn) => {
      if (!useDemoStore.getState().active) return void queueMicrotask(fn)
      const unsubscribe = useDemoStore.subscribe((state) => {
        if (!state.active) {
          unsubscribe()
          fn()
        }
      })
    },
  })
  return { sync, synced }
}
const resetAuth = () => {
  useAuthStore.base.setState({ session: null, user: null, profile: null, onboardingCompleted: false, initializing: true, profileRefreshing: false, profileError: null })
  resetScenarioStores()
}
const session = { user: { id: 'real-user' }, access_token: 'real-token' }

test('race: Demo 가 profile fetch 도중 시작되고 fetch 가 성공해도 base 의 profile/flags 는 바뀌지 않고, Demo 종료 뒤 실제 기준으로 다시 sync', async () => {
  useAuthStore.base.setState(realAuth())
  const pending = deferred()
  let calls = 0
  const { sync, synced } = makeSync(() => (++calls === 1 ? pending.promise : Promise.resolve({ id: 'real-user', nickname: '진짜(새로고침)', exp_explore: 800, onboarding_completed: true })))

  const running = sync(session, { background: true })
  assert.equal(useAuthStore.base.getState().profileRefreshing, true) // Demo 이전에 켠 로딩 표시

  startDemoScenario('tour') // fetch 가 pending 인 채로 Demo 시작
  const atDemoStart = baseSnap()
  pending.resolve({ id: 'demo-user', nickname: '데모 모험가', exp_explore: 1, onboarding_completed: true }) // Demo DB 값처럼 보이는 결과
  await running
  await tick()
  assert.deepEqual(baseSnap(), atDemoStart) // profile / onboardingCompleted / initializing / profileRefreshing / profileError 모두 그대로
  assert.equal(useAuthStore.base.getState().profile.nickname, '진짜')
  assert.equal(synced.length, 0)

  endDemo() // Demo 종료 → 실제 기준 재 sync
  await tick()
  await tick()
  const after = useAuthStore.base.getState()
  assert.equal(after.profile.nickname, '진짜(새로고침)') // Demo 값이 아니라 실제 프로필
  assert.deepEqual([after.profileRefreshing, after.initializing, after.profileError, after.onboardingCompleted], [false, false, null, true])
  assert.equal(after.session.access_token, 'real-token')
  assert.equal(calls, 2)
  resetAuth()
})

test('race: Demo 가 시작된 뒤 profile fetch 가 reject 돼도 catch 가 base 를 바꾸지 않는다 (setProfile(null)/profileError 없음)', async () => {
  useAuthStore.base.setState(realAuth({ initializing: false }))
  const pending = deferred()
  let calls = 0
  const { sync } = makeSync(() => (++calls === 1 ? pending.promise : Promise.resolve({ id: 'real-user', nickname: '진짜', exp_explore: 777, onboarding_completed: true })))

  const running = sync(session, { background: false }) // 처음 로딩(initializing) 경로
  assert.equal(useAuthStore.base.getState().initializing, true)
  startDemoScenario('rain')
  const atDemoStart = baseSnap()
  pending.reject(new Error('network down'))
  await running
  await tick()
  assert.deepEqual(baseSnap(), atDemoStart) // profile 이 null 이 되지 않고 profileError 도 없다
  assert.notEqual(useAuthStore.base.getState().profile, null)
  assert.equal(useAuthStore.base.getState().profileError, null)

  endDemo()
  await tick()
  await tick()
  const after = useAuthStore.base.getState()
  assert.equal(after.profile.nickname, '진짜')
  assert.deepEqual([after.initializing, after.profileRefreshing, after.profileError], [false, false, null]) // 로딩 표시가 남지 않는다
  resetAuth()
})

test('race: fetch 도중 Demo 가 시작했다 끝나도(epoch 변경) 읽은 값은 버리고 실제 기준으로 다시 sync', async () => {
  useAuthStore.base.setState(realAuth())
  const pending = deferred()
  let calls = 0
  const { sync } = makeSync(() => (++calls === 1 ? pending.promise : Promise.resolve({ id: 'real-user', nickname: '진짜2', onboarding_completed: true })))
  const running = sync(session, { background: true })
  startDemoScenario('tour')
  endDemo() // pending 중에 시작 + 종료
  pending.resolve({ id: 'demo-user', nickname: '데모 모험가', onboarding_completed: true })
  await running
  await tick()
  await tick()
  assert.equal(useAuthStore.base.getState().profile.nickname, '진짜2') // Demo DB 값은 반영되지 않았다
  assert.equal(useAuthStore.base.getState().profileRefreshing, false)
  assert.equal(calls, 2)
  resetAuth()
})

test('race: Demo 가 아닐 때의 정상 동작은 그대로 (성공/실패/로딩 표시)', async () => {
  useAuthStore.base.setState(realAuth({ profile: null, onboardingCompleted: false, initializing: true }))
  const ok = makeSync(async () => ({ id: 'real-user', nickname: '진짜', onboarding_completed: true }))
  await ok.sync(session, { background: false })
  let s = useAuthStore.base.getState()
  assert.deepEqual([s.profile.nickname, s.onboardingCompleted, s.initializing, s.profileError], ['진짜', true, false, null])
  assert.equal(ok.synced.length, 1)

  const originalError = console.error
  console.error = () => {}
  try {
    const fail = makeSync(async () => {
      throw new Error('boom')
    })
    await fail.sync(session, { background: true }) // 백그라운드 실패는 기존 프로필 유지
    s = useAuthStore.base.getState()
    assert.equal(s.profile.nickname, '진짜')
    assert.equal(s.profileRefreshing, false)
    await fail.sync(session, { background: false }) // 처음 로딩 실패는 오류 표시
    s = useAuthStore.base.getState()
    assert.deepEqual([s.profile, s.profileError, s.initializing], [null, 'boom', false])
  } finally {
    console.error = originalError
  }
  resetAuth()
})
