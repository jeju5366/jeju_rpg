import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isFinalQuestDay, isStale, nextBoundaryDelay, showsFinalQuest } from '../src/utils/finalQuestView.js'
import { hhmm } from '../src/utils/format.js'

const MIN = 60 * 1000
const LATEST = Date.UTC(2026, 10, 3, 7, 30)

test('마지막 날 전에는 Final Quest 상태를 서버에 묻지 않는다 / 끝난 여행도 묻지 않는다', () => {
  const trip = { end_date: '2026-11-03', status: 'active' }
  assert.equal(isFinalQuestDay(trip, '2026-11-02'), false)
  assert.equal(isFinalQuestDay(trip, '2026-11-03'), true)
  assert.equal(isFinalQuestDay(trip, '2026-11-04'), true)
  assert.equal(isFinalQuestDay({ ...trip, status: 'completed' }, '2026-11-03'), false)
  assert.equal(isFinalQuestDay(null, '2026-11-03'), false)
})

test('캐시 TTL: 5분 안에는 다시 읽지 않는다', () => {
  assert.equal(isStale(0), true)
  assert.equal(isStale(1000, 1000 + 4 * MIN), false)
  assert.equal(isStale(1000, 1000 + 5 * MIN), true)
})

test('경계 타이머: 공항 이동 준비(60분 전) → 시작 시각 순서로 한 번씩, 이미 시작됐으면 없음', () => {
  const state = { locked: false, safe: { latestSafeDeparture: new Date(LATEST).toISOString() } }
  assert.equal(nextBoundaryDelay(state, LATEST - 90 * MIN), 30 * MIN)
  assert.equal(nextBoundaryDelay(state, LATEST - 30 * MIN), 30 * MIN)
  assert.equal(nextBoundaryDelay(state, LATEST + MIN), null)
  assert.equal(nextBoundaryDelay({ ...state, locked: true }, LATEST - 90 * MIN), null)
  assert.equal(nextBoundaryDelay(null), null)
})

test('Final Quest 가 시작된 뒤에는 일반 퀘스트 화면 대신 Final Quest 만 보인다', () => {
  assert.equal(showsFinalQuest({ locked: true, status: 'active' }), true)
  assert.equal(showsFinalQuest({ locked: true, status: 'arrived' }), true)
  assert.equal(showsFinalQuest({ locked: false, status: 'notice' }), false)
  assert.equal(showsFinalQuest({ locked: true, status: 'trip_completed' }), false)
  assert.equal(showsFinalQuest(null), false)
})

test('시각 표시는 한국 시간', () => {
  assert.equal(hhmm(new Date(LATEST).toISOString()), '16:30')
  assert.equal(hhmm(null), '--:--')
})
