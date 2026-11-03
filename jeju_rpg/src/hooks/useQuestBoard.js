import { useCallback, useEffect, useRef, useState } from 'react'
import { CACHE_RULES } from '../constants/replanRules.js'
import { fetchCurrentAdventure, fetchQuestBoard } from '../services/supabase/questRepo.js'
import { fetchLatestTrip } from '../services/supabase/tripService.js'
import { useAdventureStore } from '../store/adventureStore.js'
import { useAuthStore } from '../store/authStore.js'
import { useTripStore } from '../store/tripStore.js'

// 퀘스트 판(모험 + 챕터 + 퀘스트 + 진행)을 store 캐시로 보여주고 필요할 때만 읽는다. 퀘스트/지도 화면이 같이 쓴다.
//   · 이미 읽은 판이 있으면 즉시 보여주고(전체 화면 spinner 없음), 오래됐을 때(staleMs)만 백그라운드로 다시 읽는다. → refreshing
//   · loading 은 "보여줄 캐시가 전혀 없을 때의 최초 로드"에서만 true.
//   · mutation 후에는 reload() 로 서버 기록을 즉시 다시 읽는다. (캐시가 오래된 상태로 남지 않게)
export default function useQuestBoard({ staleMs = CACHE_RULES.boardStaleMs } = {}) {
  const user = useAuthStore((s) => s.user)
  const { trip, setTrip } = useTripStore()
  const board = useAdventureStore()
  const [checked, setChecked] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const inflight = useRef(null)

  const hasCache = Boolean(trip) && board.boardTripId === trip.id && board.boardLoadedAt > 0

  const load = useCallback(async (tripId) => {
    // 같은 요청이 진행 중이면 합친다. (연달아 호출돼도 한 번만 읽는다)
    if (inflight.current) return inflight.current
    inflight.current = (async () => {
      try {
        const adventure = await fetchCurrentAdventure(tripId)
        const data = adventure ? await fetchQuestBoard(adventure.id) : { chapters: [], quests: [], progress: [] }
        useAdventureStore.getState().setBoard({ tripId, adventure, ...data })
        useTripStore.getState().invalidateHub() // 모험 상태가 바뀌었을 수 있다: 홈의 캐시도 다음에 다시 읽게 한다
        return adventure
      } finally {
        inflight.current = null
      }
    })()
    return inflight.current
  }, [])

  const tripId = trip?.id ?? null
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let current = useTripStore.getState().trip
        if (!current) {
          current = await fetchLatestTrip(user.id)
          if (!active) return
          setTrip(current)
        }
        if (current) {
          const state = useAdventureStore.getState()
          const fresh = state.boardTripId === current.id && Date.now() - state.boardLoadedAt < staleMs
          if (!fresh) {
            setRefreshing(true)
            await load(current.id)
          }
        }
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) {
          setChecked(true)
          setRefreshing(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [tripId, user.id, setTrip, load, staleMs])

  const reload = useCallback(
    (id) => {
      const target = id ?? useTripStore.getState().trip?.id
      return target ? load(target) : Promise.resolve(null)
    },
    [load],
  )

  return {
    trip,
    adventure: hasCache ? board.currentAdventure : null,
    chapters: hasCache ? board.chapters : [],
    quests: hasCache ? board.quests : [],
    progress: hasCache ? board.progress : [],
    hasCache,
    loading: !hasCache && !checked && !error,
    refreshing,
    error,
    reload,
  }
}
