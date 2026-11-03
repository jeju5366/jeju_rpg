import { useCallback, useEffect, useState } from 'react'
import { CACHE_RULES } from '../../constants/replanRules.js'
import { fetchAdventures } from '../../services/supabase/adventureRepo.js'
import { fetchDailyContextState } from '../../services/supabase/dailyContextRepo.js'
import { fetchLatestTrip } from '../../services/supabase/tripService.js'
import { useAuthStore } from '../../store/authStore.js'
import { useTripStore } from '../../store/tripStore.js'
import { clampDate, todayKst } from '../../utils/time.js'

const IN_PROGRESS = ['selected', 'active', 'paused']

// 홈 여행 정보 허브가 쓰는 데이터: 현재 여행 + 오늘의 일일 조건 + 오늘 진행 중인 모험.
// 이 훅과 홈 화면은 DB 를 읽고 저장할 뿐 Agent(AI) 를 호출하지 않는다.
// 탭 전환: 이미 읽은 값은 tripStore.hub 캐시로 즉시 보여주고, 오래됐을 때(hubStaleMs)만 백그라운드로 다시 읽는다. (저장/퀘스트 진행 같은 mutation 뒤에는 캐시가 무효화된다)
export default function useTripHub() {
  const user = useAuthStore((s) => s.user)
  const { trip, setTrip, setAccommodations, hub, setHub } = useTripStore()
  const [tripLoading, setTripLoading] = useState(!trip)
  const date = trip ? clampDate(todayKst(), trip.start_date, trip.end_date) : null
  const cached = hub && trip && hub.tripId === trip.id && hub.date === date ? hub : null
  const [daily, setDaily] = useState(cached?.daily ?? null) // { values, source, confirmed, saved }
  const [adventure, setAdventure] = useState(cached?.adventure ?? null) // 오늘 진행 중(선택됨/진행/일시정지)인 모험
  const [error, setError] = useState(null)

  const reloadTrip = useCallback(async () => {
    const latest = await fetchLatestTrip(user.id)
    setTrip(latest)
    setAccommodations(latest?.accommodations ?? [])
    return latest
  }, [user.id, setTrip, setAccommodations])

  const reloadToday = useCallback(async () => {
    if (!trip || !date) return
    const [state, adventures] = await Promise.all([fetchDailyContextState({ trip, date }), fetchAdventures({ tripId: trip.id, adventureDate: date })])
    const todayAdventure = adventures.find((a) => IN_PROGRESS.includes(a.status)) ?? null
    setDaily(state)
    setAdventure(todayAdventure)
    useTripStore.getState().setHub({ tripId: trip.id, date, daily: state, adventure: todayAdventure })
  }, [trip, date])

  useEffect(() => {
    if (trip) return
    reloadTrip()
      .catch((err) => setError(err.message))
      .finally(() => setTripLoading(false))
  }, [trip, reloadTrip])

  useEffect(() => {
    // 캐시가 아직 신선하면 다시 읽지 않는다
    const fresh = cached && Date.now() - cached.loadedAt < CACHE_RULES.hubStaleMs
    if (fresh) return
    reloadToday().catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToday])

  void setHub
  return { user, trip, date, daily, adventure, tripLoading, error, setError, reloadTrip, reloadToday }
}
