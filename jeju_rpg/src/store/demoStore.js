import { create } from 'zustand'

// Demo Mode 상태 (반응형으로 화면이 구독해야 하는 값만). 실제 Auth session 은 건드리지 않는다.
//  active / scenarioId / label : Demo 진행 여부와 시나리오 (상단 DEMO 배지)
//  profileVersion              : Demo DB 의 프로필(EXP)이 바뀌면 올라간다 → 모험가 탭/보상 화면이 새 값을 읽는다
//  offsetMs                    : 시연용 시간 앞당김 (Final Quest)
//  weather / failures / position : 시뮬레이션 값 (simulatedWeather / simulatedFailures / simulatedPosition)
// 시나리오 시작/전환/종료 로직은 src/demo/demoController.js 가 한다. (store 를 작게 유지)
const SESSION_KEY = 'jeju-demo-scenario'

export const useDemoStore = create((set) => ({
  active: false,
  scenarioId: null,
  label: '',
  profileVersion: 0,
  offsetMs: 0,
  weather: 'clear', // clear | rain
  failures: [], // ['places', 'weather', 'directions', 'openai']
  position: null, // { lat, lng, accuracy } 시뮬레이션 위치
  controls: [], // 시나리오별 상태바 버튼 [{ id, label }]
  setScenario: (patch) => set(patch),
  bumpProfile: () => set((s) => ({ profileVersion: s.profileVersion + 1 })),
  addOffsetMinutes: (minutes) => set((s) => ({ offsetMs: s.offsetMs + minutes * 60000 })),
  reset: () => set({ active: false, scenarioId: null, label: '', offsetMs: 0, weather: 'clear', failures: [], position: null, controls: [] }),
}))

// sessionStorage: 새로고침에도 발표 중 Demo 가 유지되게 시나리오 id 만 기억한다. (종료하면 지운다. localStorage 는 쓰지 않는다)
export const demoSession = {
  read: () => {
    try {
      return sessionStorage.getItem(SESSION_KEY)
    } catch {
      return null
    }
  },
  write: (id) => {
    try {
      sessionStorage.setItem(SESSION_KEY, id)
    } catch {
      /* 저장소를 못 써도 Demo 는 계속된다 */
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* 무시 */
    }
  },
}
