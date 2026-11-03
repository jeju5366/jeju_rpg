import { FINAL_QUEST_CACHE, NOTICE_BEFORE_MIN } from '../constants/finalQuestRules.js'

// Final Quest 화면 보조 (순수 함수). 안전 시간/단계 판단은 서버가 하고, 화면은 그 결과를 보여주기만 한다.
const MIN = 60 * 1000

// 마지막 날(또는 그 이후)인가: 이때부터만 Final Quest 상태를 서버에 묻는다. 그 전에는 API 를 부르지 않는다.
export const isFinalQuestDay = (trip, today) => Boolean(trip?.end_date) && trip.status !== 'completed' && today >= trip.end_date

// 상태를 다시 읽어야 하는가 (TTL)
export const isStale = (loadedAt, now = Date.now()) => !loadedAt || now - loadedAt >= FINAL_QUEST_CACHE.evalStaleMs

// 다음 경계(공항 이동 준비 시작 / Final Quest 시작)까지 남은 ms. 이 시각에 한 번만 다시 읽는다. 지났거나 값이 없으면 null.
export function nextBoundaryDelay(state, now = Date.now()) {
  if (!state || state.locked || !state.safe?.latestSafeDeparture) return null
  const latest = Date.parse(state.safe.latestSafeDeparture)
  const candidates = [latest - NOTICE_BEFORE_MIN * MIN, latest].filter((t) => t > now)
  return candidates.length ? Math.min(...candidates) - now : null
}

// 일반 퀘스트 화면을 대신해 Final Quest 만 보여줘야 하는가 (활성화됐고 여행이 안 끝난 경우)
export const showsFinalQuest = (state) => Boolean(state?.locked) && state.status !== 'trip_completed'
