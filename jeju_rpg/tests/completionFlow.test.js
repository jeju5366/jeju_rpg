import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useAdventureStore } from '../src/store/adventureStore.js'
import { completeAndApply, createSingleFlight, shouldShowSurpriseOverlay } from '../src/utils/completionFlow.js'
import { partitionChapterQuests } from '../src/utils/questLayout.js'
import { buildRewardPopup } from '../src/utils/rewardPopup.js'
import { dismiss, emptyQueue, enqueue } from '../src/utils/rewardQueue.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const response = { progress: { quest_id: 'q1', status: 'completed', verification_method: 'self' }, chapterStatus: 'core_completed', rewards: { quest: { awarded: true, total: 20, parts: [{ category: 'explore', amount: 20 }] }, discovery: null, levelUps: [] } }

// ───────── 완료 버튼 반응속도 ─────────
test('완료 API 성공 → 로컬 반영/팝업 즉시, 반환(= busy 해제)은 느린 reload 를 기다리지 않음', async () => {
  const order = []
  let finishReload
  const slowReload = new Promise((resolve) => (finishReload = resolve))
  const returned = completeAndApply({
    call: async () => {
      order.push('api')
      return response
    },
    apply: () => order.push('apply'),
    announce: () => order.push('popup'),
    refresh: async () => {
      order.push('reload-start')
      await slowReload // 아직 끝나지 않은 느린 reload
      order.push('reload-end')
    },
  })
  const result = await returned // 호출한 쪽은 여기서 풀려난다 → finally 에서 busy 해제
  assert.deepEqual(order.slice(0, 3), ['api', 'apply', 'popup']) // 성공 응답 직후 즉시 반영 + 팝업
  assert.equal(result, response)
  assert.ok(!order.includes('reload-end')) // reload 는 아직 진행 중인데 이미 반환됐다
  finishReload()
  await tick()
  assert.ok(order.includes('reload-end')) // reload 는 background 로 계속 진행됐다
})

test('완료 요청이 실패하면 로컬 완료/팝업/refresh 모두 실행되지 않음', async () => {
  const calls = []
  await assert.rejects(
    () => completeAndApply({ call: async () => { throw Object.assign(new Error('gps_too_far'), { code: 'gps_too_far' }) }, apply: () => calls.push('apply'), announce: () => calls.push('popup'), refresh: () => calls.push('refresh') }),
    { message: 'gps_too_far' },
  )
  await tick()
  assert.deepEqual(calls, [])
})

test('background reload 가 실패해도 완료 UI(로컬 반영)는 되돌리지 않고, stale 표시 콜백만 호출', async () => {
  const store = useAdventureStore
  store.getState().reset()
  store.getState().setBoard({ tripId: 't1', adventure: { id: 'a1' }, chapters: [{ id: 'c1', status: 'active' }], quests: [{ id: 'q1', chapter_id: 'c1', quest_type: 'core' }], progress: [] })
  const loadedAt = store.getState().boardLoadedAt
  let refreshError = null
  await completeAndApply({
    call: async () => response,
    apply: (r) => store.getState().applyCompletion({ progress: r.progress, chapterId: 'c1', chapterStatus: r.chapterStatus }),
    refresh: async () => { throw new Error('network down') },
    onRefreshError: (error) => {
      refreshError = error
      store.getState().invalidateBoard()
    },
  })
  await tick()
  assert.equal(refreshError.message, 'network down')
  // 완료 상태는 그대로 유지된다
  assert.deepEqual(store.getState().progress.map((p) => [p.quest_id, p.status]), [['q1', 'completed']])
  assert.equal(store.getState().chapters[0].status, 'core_completed')
  // 캐시는 "오래된 것"으로만 표시된다 (내용은 지우지 않는다)
  assert.equal(store.getState().boardLoadedAt, 1)
  assert.ok(loadedAt > 1)
})

// ───────── 로컬 완료 상태 반영 ─────────
test('완료 응답을 store 에 즉시 반영: 선택 퀘스트는 완료 그룹으로, 핵심은 compact(coreDone), 중복 행 없음', () => {
  const store = useAdventureStore
  store.getState().reset()
  const quests = [
    { id: 'core', chapter_id: 'c1', quest_type: 'core' },
    { id: 'o1', chapter_id: 'c1', quest_type: 'optional' },
    { id: 'o2', chapter_id: 'c1', quest_type: 'optional' },
  ]
  store.getState().setBoard({ tripId: 't', adventure: {}, chapters: [{ id: 'c1', status: 'active' }], quests, progress: [] })
  const view = () => {
    const completedIds = new Set(store.getState().progress.filter((p) => p.status === 'completed').map((p) => p.quest_id))
    return partitionChapterQuests({ quests, completedIds })
  }
  assert.deepEqual([view().coreDone, view().pending.length, view().done.length], [false, 2, 0])
  store.getState().applyCompletion({ progress: { quest_id: 'o1', status: 'completed' }, chapterId: 'c1', chapterStatus: 'active' })
  assert.deepEqual([view().pending.map((q) => q.id), view().done.map((q) => q.id)], [['o2'], ['o1']]) // 완료 그룹으로 이동
  store.getState().applyCompletion({ progress: { quest_id: 'core', status: 'completed' }, chapterId: 'c1', chapterStatus: 'core_completed' })
  assert.equal(view().coreDone, true) // compact 완료 상태
  assert.equal(store.getState().chapters[0].status, 'core_completed')
  // 같은 퀘스트 결과가 두 번 들어와도(서버 재전송 등) 행이 늘지 않는다
  store.getState().applyCompletion({ progress: { quest_id: 'o1', status: 'completed' } })
  assert.equal(store.getState().progress.filter((p) => p.quest_id === 'o1').length, 1)
  // gps_photo 중간 상태 행도 반영된다
  store.getState().applyCompletion({ progress: { quest_id: 'o2', status: 'in_progress', gps_verified_at: 'x' } })
  assert.equal(view().pending.length, 1) // 아직 미완료
})

// ───────── 중복 클릭 ─────────
test('같은 틱에 연타해도 완료 API 는 한 번만 호출됨', async () => {
  const flight = createSingleFlight()
  let apiCalls = 0
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const click = () => flight(async () => { apiCalls += 1; await gate })
  const results = [click(), click(), click()]
  release()
  const settled = await Promise.all(results)
  assert.equal(apiCalls, 1)
  assert.deepEqual(settled.map((r) => r.ran), [true, false, false])
  assert.equal((await click()).ran, true) // 끝난 뒤에는 다시 실행 가능(다음 퀘스트)
})

test('성공한 퀘스트는 로컬에서 즉시 완료 상태라 다시 완료 버튼 대상이 아님', () => {
  const quests = [{ id: 'o1', chapter_id: 'c1', quest_type: 'optional' }]
  const done = partitionChapterQuests({ quests, completedIds: new Set(['o1']) })
  assert.deepEqual([done.pending.length, done.done.length], [0, 1])
})

// ───────── 오버레이 충돌 방지 ─────────
const offered = { id: 's1' }
test('QUEST COMPLETE 팝업이 표시/대기 중이면 돌발 퀘스트 오버레이는 뜨지 않고, 모두 끝난 뒤 나타남', () => {
  assert.equal(shouldShowSurpriseOverlay({ offered, rewardQueueLength: 1 }), false)
  assert.equal(shouldShowSurpriseOverlay({ offered, rewardQueueLength: 3 }), false)
  assert.equal(shouldShowSurpriseOverlay({ offered, rewardQueueLength: 0 }), true)
})

test('보상 팝업 대기열 흐름: 완료 직후 돌발이 생성돼도 팝업 → (닫힘) → 돌발 순서', () => {
  const popup = buildRewardPopup({ quest: { id: 'q1', title: 't' }, rewards: response.rewards })
  let queue = enqueue(emptyQueue(), popup)
  const timeline = []
  timeline.push(shouldShowSurpriseOverlay({ offered, rewardQueueLength: queue.items.length })) // 팝업 표시 중: 돌발은 대기
  queue = dismiss(queue, popup.id) // 탭 또는 4초 뒤 종료
  timeline.push(shouldShowSurpriseOverlay({ offered, rewardQueueLength: queue.items.length })) // 이제 돌발 표시
  assert.deepEqual(timeline, [false, true])
})

test('REPLAN 제안/인증 진행 중/자유여행 중에는 돌발 오버레이를 띄우지 않음(REPLAN 우선), 제안은 사라지지 않고 조건이 풀리면 나타남', () => {
  assert.equal(shouldShowSurpriseOverlay({ offered, replanNeeded: true }), false)
  assert.equal(shouldShowSurpriseOverlay({ offered, verificationOpen: true }), false)
  assert.equal(shouldShowSurpriseOverlay({ offered, freeActive: true }), false)
  assert.equal(shouldShowSurpriseOverlay({ offered: null }), false) // no_quest: 제안 자체가 없으니 아무것도 안 뜬다
  assert.equal(shouldShowSurpriseOverlay({ offered, replanNeeded: false }), true)
})
