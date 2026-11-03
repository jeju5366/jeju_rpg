import { useCallback, useEffect, useRef, useState } from 'react'
import { FINAL_QUEST_CACHE } from '../../constants/finalQuestRules.js'
import { arriveAtAirport, fetchFinalQuestState, finishTripRequest, startFinalQuestMove } from '../../services/finalQuest/finalQuestService.js'
import { fetchLatestTrip } from '../../services/supabase/tripService.js'
import { getCurrentPosition, queryPermission } from '../../services/location/geolocation.js'
import { useAuthStore } from '../../store/authStore.js'
import { useLocationStore } from '../../store/locationStore.js'
import { requestFinalQuestState } from '../../utils/finalQuestPosition.js'
import { useAdventureStore } from '../../store/adventureStore.js'
import { useFinalQuestStore } from '../../store/finalQuestStore.js'
import { useTripStore } from '../../store/tripStore.js'
import { isFinalQuestDay, isStale, nextBoundaryDelay } from '../../utils/finalQuestView.js'
import { todayKst } from '../../utils/time.js'

// Final Quest 상태 훅. 홈/퀘스트 화면이 같이 쓴다.
//   · 마지막 날에만 서버에 묻고, 결과는 store 캐시(TTL 5분)로 재사용한다. 렌더마다/GPS 폴링으로 부르지 않는다.
//   · 공항 이동 준비(60분 전)/시작 시각 경계에 한 번만 더 읽는다. (그 사이에는 5분 TTL 타이머뿐)
export default function useFinalQuest() {
  const trip = useTripStore((s) => s.trip)
  const cached = useFinalQuestStore((s) => (s.tripId === trip?.id ? s.state : null))
  const loadedAt = useFinalQuestStore((s) => (s.tripId === trip?.id ? s.loadedAt : 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inflight = useRef(null)
  const enabled = isFinalQuestDay(trip, todayKst())
  const tripId = trip?.id ?? null

  const load = useCallback(
    async ({ refresh = false } = {}) => {
      if (!tripId) return null
      if (inflight.current) return inflight.current
      inflight.current = (async () => {
        try {
          // 안전 시간 계산용 현재 위치: 최신 위치가 있으면 그대로, 없으면(권한이 이미 허용된 경우만) 한 번만 받아 본다. 실패하면 position: null.
          // 위치는 요청 body 의 position 으로 서버에 전달된다.
          const state = await requestFinalQuestState({
            tripId,
            refresh,
            stored: useLocationStore.getState().position,
            getPermission: queryPermission,
            getPosition: () => getCurrentPosition({ timeoutMs: 6000, maxAgeMs: 30000 }),
            onFresh: (fresh) => useLocationStore.getState().setPosition(fresh),
            fetchState: fetchFinalQuestState,
          })
          useFinalQuestStore.getState().setState(tripId, state)
          setError(null)
          return state
        } catch (err) {
          setError(err.code ?? err.message)
          return null
        } finally {
          inflight.current = null
        }
      })()
      return inflight.current
    },
    [tripId],
  )

  // 최초/오래됐을 때 한 번
  useEffect(() => {
    if (enabled && isStale(loadedAt)) load()
  }, [enabled, loadedAt, load])

  // TTL 타이머 + 경계 시각 타이머 (화면이 보이는 동안만)
  useEffect(() => {
    if (!enabled || cached?.status === 'trip_completed') return undefined
    const timers = [setInterval(() => !document.hidden && load(), FINAL_QUEST_CACHE.evalStaleMs)]
    const delay = nextBoundaryDelay(cached)
    if (delay != null) timers.push(setTimeout(() => load({ refresh: true }), Math.min(delay + 1000, 2 ** 31 - 1)))
    return () => timers.forEach((t) => clearInterval(t) || clearTimeout(t))
  }, [enabled, cached, load])

  const run = async (fn) => {
    if (busy) return null
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      setError(err.code ?? err.message)
      throw err
    } finally {
      setBusy(false)
    }
  }

  // Final Quest 가 시작되면 일반 모험이 닫히므로 퀘스트/홈 캐시를 오래된 것으로 표시한다.
  const markStale = () => {
    useAdventureStore.getState().invalidateBoard()
    useTripStore.getState().invalidateHub()
  }

  return {
    state: enabled || cached?.locked ? cached : null,
    enabled,
    busy,
    error,
    refresh: (options) => load({ refresh: true, ...options }),
    start: () =>
      run(async () => {
        await startFinalQuestMove(tripId)
        await load({ refresh: false })
      }),
    arrive: (position) =>
      run(async () => {
        const result = await arriveAtAirport(tripId, position)
        await load()
        return result
      }),
    // [여행 마무리]: 서버가 trips.status 를 completed 로 확정한다. 최신 여행을 다시 읽어 홈이 "끝난 여행"으로 보이게 한다.
    finish: () =>
      run(async () => {
        const result = await finishTripRequest(tripId)
        useTripStore.getState().setTrip(await fetchLatestTrip(useAuthStore.getState().user.id))
        useFinalQuestStore.getState().reset()
        markStale()
        return result
      }),
    markStale,
  }
}
