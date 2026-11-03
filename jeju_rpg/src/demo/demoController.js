import { useAdventureStore } from '../store/adventureStore.js'
import { useAgentLogStore } from '../store/agentLogStore.js'
import { demoSession, useDemoStore } from '../store/demoStore.js'
import { useFinalQuestStore } from '../store/finalQuestStore.js'
import { useFreeTravelStore } from '../store/freeTravelStore.js'
import { useLocationStore } from '../store/locationStore.js'
import { usePhotoStore } from '../store/photoStore.js'
import { useReplanStore } from '../store/replanStore.js'
import { useTripStore } from '../store/tripStore.js'
import { useUiStore } from '../store/uiStore.js'
import { useWeatherStore } from '../store/weatherStore.js'
import { demoEntry } from '../utils/agentLog.js'
import { demoWeather } from './demoApi.js'
import { demoRpcHandlers, buildDemoDb, DEMO_SCENARIOS, findScenario } from './scenarios.js'
import { DEMO_USER_ID, setDemoDb } from './demoRuntime.js'
import { DEMO_ADVENTURE_ID, DEMO_PLACES, DEMO_TRIP_ID } from './fixtures.js'

// Demo 시작 / 시나리오 전환 / 종료. 실제 Auth session 은 건드리지 않는다. (실제 로그인 사용자가 Demo 에 들어가도 로그아웃되지 않는다)
// 시나리오 전환/종료 때는 이전 시나리오의 임시 상태(REPLAN 제안/보상 팝업/Final Quest/자유여행/날씨/위치)를 모두 비운다.

// 시나리오와 함께 움직이는 화면 상태 store. 초기 상태로 되돌린다. (실제 사용자의 데이터는 다시 읽을 수 있는 캐시뿐이다)
const SCENARIO_STORES = [useTripStore, useAdventureStore, useFinalQuestStore, useFreeTravelStore, useLocationStore, usePhotoStore, useReplanStore, useUiStore, useWeatherStore]
export function resetScenarioStores() {
  for (const store of SCENARIO_STORES) store.setState(store.getInitialState(), true)
}

export { DEMO_SCENARIOS }

export function startDemoScenario(id) {
  const scenario = findScenario(id)
  if (!scenario) return false
  const log = useAgentLogStore.getState()
  log.clearDemo() // 이전 시나리오의 Demo 로그는 지운다
  resetScenarioStores()

  const nowMs = Date.now()
  const db = buildDemoDb(scenario, nowMs, demoRpcHandlers)
  setDemoDb(db)

  const { settings } = scenario
  useDemoStore.getState().setScenario({ active: true, scenarioId: id, label: scenario.badge, offsetMs: 0, weather: settings.weather === 'rain' ? 'clear' : settings.weather, failures: settings.failures ?? [], position: settings.position ?? null, controls: settings.controls ?? [] })
  log.setScenario(id)
  log.push(demoEntry('Demo 시작', `${scenario.emoji} ${scenario.label} 시나리오를 시작했어. 실제 여행 데이터에는 영향을 주지 않아.`))
  log.push(demoEntry('시나리오 상태', scenario.log))
  if (settings.failures?.length) log.push(demoEntry('시뮬레이션된 장애', `${settings.failures.join(', ')} 응답이 실패하도록 설정했어. 화면은 준비된 기본 정보로 계속 진행해.`, 'warning'))

  if (settings.position) useLocationStore.getState().setPosition({ ...settings.position, timestamp: Date.now() })

  // 비 오는 날: 처음 본 날씨(맑음)를 기준으로 두고, 지금은 비가 오는 상태로 바꾼다. → 코드가 "큰 날씨 변화"를 감지해서 REPLAN 을 "제안"한다.
  if (settings.weather === 'rain') {
    useWeatherStore.getState().setWeather(demoWeather('clear'))
    useDemoStore.getState().setScenario({ weather: 'rain' })
    useWeatherStore.getState().setWeather(demoWeather('rain'))
    log.push(demoEntry('날씨 변화', '맑았던 하늘에 강한 비가 내리기 시작했어. 야외 일정에 영향이 있는지 코드가 판단해.', 'warning'))
  }

  // 자유여행: 진행 중인 세션 + 원래 동선과 떨어진 곳에서 이미 방문 후보 1곳이 감지된 상태
  if (scenario.options.freeTravel) {
    const session = db.insert('jeju_free_sessions', { user_id: DEMO_USER_ID, trip_id: DEMO_TRIP_ID, adventure_id: DEMO_ADVENTURE_ID, status: 'active', started_at: new Date(nowMs - 50 * 60000).toISOString() })
    const aqua = DEMO_PLACES.aqua
    const t = nowMs - 10 * 60000
    useFreeTravelStore.getState().begin({ userId: DEMO_USER_ID, session })
    useFreeTravelStore.setState((s) => ({
      tracking: {
        ...s.tracking,
        route: [{ lat: 33.5136, lng: 126.5894, t: nowMs - 45 * 60000 }, { lat: 33.4701, lng: 126.7452, t: nowMs - 25 * 60000 }, { lat: aqua.lat, lng: aqua.lng, t }],
        candidates: { [aqua.placeId]: { placeId: aqua.placeId, name: aqua.name, lat: aqua.lat, lng: aqua.lng, contentTypeId: aqua.contentTypeId, address: '제주 서귀포시 성산읍 (데모)', sinceT: nowMs - 30 * 60000, detectedAt: t, dwellMinutes: 20 } },
        lastTickT: t,
      },
    }))
    log.push(demoEntry('자유여행 상태', '원래 동선에서 멀어진 위치에서 자유여행 중이야. 종료하면 복귀 판정을 해.'))
  }

  demoSession.write(id)
  return true
}

// 시나리오 변경: 새 시나리오를 처음 상태로 다시 시작한다. (같은 Demo 안에서 이전 시나리오의 상태는 남지 않는다)
export function switchDemoScenario(id) {
  return startDemoScenario(id)
}

// Demo 종료: Demo 상태/로그/임시 상태/sessionStorage 를 정리한다. 실제 로그인 세션(authStore)은 건드리지 않는다.
export function endDemo() {
  setDemoDb(null)
  useDemoStore.getState().reset()
  useAgentLogStore.getState().clearDemo()
  resetScenarioStores() // Demo 데이터가 실제 화면 캐시에 남지 않게 한다. (실제 사용자라면 화면이 다시 읽어 온다)
  demoSession.clear()
}

// Demo 중 시나리오별 상태바 동작
export function runDemoControl(controlId) {
  const demo = useDemoStore.getState()
  if (controlId === 'advance') {
    demo.addOffsetMinutes(15)
    useFinalQuestStore.getState().reset() // 다음 화면 갱신 때 서버(demo)에 다시 묻는다
    useAgentLogStore.getState().push(demoEntry('시간 이동', '시연을 위해 시간을 15분 앞당겼어. Final Quest 안전 시간을 다시 계산해.'))
  }
}

// 새로고침 뒤 복구: sessionStorage 에 시나리오가 있으면 같은 시나리오를 처음 상태로 다시 만든다. (진행 상태까지 복원하지는 않는다)
export function restoreDemoIfNeeded() {
  const id = demoSession.read()
  if (id && !useDemoStore.getState().active) startDemoScenario(id)
}
