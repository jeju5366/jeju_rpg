import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useAdventureStore } from '../src/store/adventureStore.js'
import { useReplanStore } from '../src/store/replanStore.js'
import { useWeatherStore } from '../src/store/weatherStore.js'
import { todayKst } from '../src/utils/time.js'

// 탭 전환 캐시 / REPLAN 제안 빈도 store 규칙 (화면 없이 store 만 확인)
test('퀘스트 판 캐시: setBoard 로 읽은 시각이 남고, invalidate 는 내용을 지우지 않고 "오래된 것"으로만 표시', () => {
  const store = useAdventureStore
  store.getState().reset()
  assert.equal(store.getState().boardLoadedAt, 0)
  store.getState().setBoard({ tripId: 't1', adventure: { id: 'a1' }, chapters: [{ id: 'c1' }], quests: [{ id: 'q1' }], progress: [] })
  assert.ok(store.getState().boardLoadedAt > 1)
  assert.equal(store.getState().boardTripId, 't1')
  store.getState().invalidateBoard()
  assert.equal(store.getState().boardLoadedAt, 1) // 이전 내용은 계속 보이고, 다음 방문 때 백그라운드 갱신
  assert.equal(store.getState().chapters.length, 1)
  store.getState().reset()
  assert.equal(store.getState().chapters.length, 0)
})

test('REPLAN 제안 빈도: 하루 2개 reason 까지(긴급 제외), 넘긴 reason 은 45분 동안 재제안 없음', () => {
  const s = useReplanStore
  s.setState({ date: todayKst(), shown: {}, dismissed: {}, bonusDismissed: {} })
  assert.equal(s.getState().canShow('SCHEDULE_DELAY'), true)
  s.getState().markShown('SCHEDULE_DELAY')
  s.getState().markShown('WEATHER_CHANGE')
  assert.equal(s.getState().canShow('SCHEDULE_DELAY'), true) // 이미 보여주던 제안은 계속
  assert.equal(s.getState().canShow('ACCOMMODATION_RISK'), false) // 오늘 제안 2개를 다 썼다
  assert.equal(s.getState().canShow('ACCOMMODATION_RISK', { urgent: true }), true) // 긴급은 예외
  s.getState().dismiss('SCHEDULE_DELAY') // "기존 일정 계속"
  assert.equal(s.getState().canShow('SCHEDULE_DELAY'), false)
  assert.equal(s.getState().canShow('SCHEDULE_DELAY', { now: Date.now() + 46 * 60000 }), true)
})

test('REPLAN 제안 빈도: 날짜가 바뀌면 하루 카운트가 초기화', () => {
  const s = useReplanStore
  s.setState({ date: '2000-01-01', shown: { A: true, B: true }, dismissed: { A: Date.now() }, bonusDismissed: { c1: true } })
  s.getState().ensureToday()
  assert.deepEqual([Object.keys(s.getState().shown).length, Object.keys(s.getState().dismissed).length, s.getState().date], [0, 0, todayKst()])
})

test('날씨 baseline: 처음 본 날씨가 기준, "그대로 진행" 하면 지금 날씨가 새 기준', () => {
  const w = useWeatherStore
  w.getState().reset()
  const clear = { temperatureC: 20 }
  const rain = { temperatureC: 17, precipitation: { type: 'rain', amountMm: 20 } }
  w.getState().setWeather(clear)
  w.getState().setWeather(rain)
  assert.equal(w.getState().baseline, clear)
  w.getState().acceptCurrentAsBaseline()
  assert.equal(w.getState().baseline, rain)
})

test('회귀: 이미 보여준 reason 을 다시 markShown 해도 store 알림이 가지 않음(무한 렌더 루프 방지)', () => {
  const s = useReplanStore
  s.setState({ date: todayKst(), shown: {}, dismissed: {}, bonusDismissed: {} })
  let notifications = 0
  const unsubscribe = s.subscribe(() => (notifications += 1))
  s.getState().markShown('SCHEDULE_DELAY')
  s.getState().markShown('SCHEDULE_DELAY')
  s.getState().markShown('SCHEDULE_DELAY')
  s.getState().ensureToday()
  unsubscribe()
  assert.equal(notifications, 1) // 처음 한 번만
})
