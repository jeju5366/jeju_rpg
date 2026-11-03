import { useDemoStore } from '../store/demoStore.js'

// Demo Mode 런타임 접근점. 실제 서비스 코드(supabaseClient / apiClient / geolocation)가 "Demo 인가?"를 이 한 곳으로 묻는다.
// 무거운 Demo DB 는 demoStore 가 아니라 여기(모듈 변수)에 둔다. 새로고침하면 시나리오 fixture 로 다시 만든다.
let db = null
let epoch = 0 // Demo 시작/종료(DB 교체)마다 바뀐다. 비동기 작업이 "기다리는 사이 Demo 가 있었는지" 알아내는 용도

export const isDemoActive = () => useDemoStore.getState().active
export const getDemoDb = () => db
export const setDemoDb = (next) => {
  db = next
  epoch += 1
}
export const getDemoEpoch = () => epoch
// Demo 의 "지금": 실제 시각 + 사용자가 앞당긴 시간(Final Quest 시연용)
export const demoNow = () => Date.now() + useDemoStore.getState().offsetMs
export const DEMO_USER_ID = 'demo-user'
