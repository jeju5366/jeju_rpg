import { useCallback, useEffect } from 'react'
import { NEARBY_FETCH_LIMIT, NEARBY_FETCH_RADIUS_METERS } from '../constants/locationRules.js'
import { watchPosition } from '../services/location/geolocation.js'
import { fetchActiveFreeSession, finishFreeTravel, startFreeTravel } from '../services/freeTravel/freeTravelService.js'
import { fetchNearbyPlaces } from '../services/tour/tourService.js'
import { fetchQuestBoard } from '../services/supabase/questRepo.js'
import { fetchDailyContextState } from '../services/supabase/dailyContextRepo.js'
import { logAgent } from '../store/agentLogStore.js'
import { makeEntry } from '../utils/agentLog.js'
import { useAdventureStore } from '../store/adventureStore.js'
import { useAuthStore } from '../store/authStore.js'
import { useFreeTravelStore } from '../store/freeTravelStore.js'
import { useLocationStore } from '../store/locationStore.js'
import { useTripStore } from '../store/tripStore.js'
import { useWeatherStore } from '../store/weatherStore.js'
import { assessWeatherChange } from '../utils/schedule.js'
import { accommodationForDate } from '../utils/dailyContext.js'
import { collectRemainingPlan, evaluateReturn } from '../utils/freeTravel/returnCheck.js'
import { shouldFetchNearby } from '../utils/freeTravel/nearbyPolicy.js'
import { clampDate, todayKst } from '../utils/time.js'

// ───────── 앱 전체에서 한 번만 도는 런타임 (AppLayout 에서 호출) ─────────
//  1) 로그인 후 서버에 진행 중인 자유여행이 있으면 이어받는다. (앱을 닫았다 다시 열었을 때)
//  2) 자유여행 phase 가 active 인 동안만 위치를 추적한다. 위치 권한은 이때 처음 요청된다.
//     위치가 갱신될 때마다 하는 일은 "메모리 계산"뿐이다. DB/GPT 호출 없음.
//     TourAPI 는 shouldFetchNearby 규칙(거리/시간/캐시/실패 쿨다운)을 통과할 때만 부른다.
export function useFreeTravelRuntime() {
  const user = useAuthStore((s) => s.user)
  const phase = useFreeTravelStore((s) => s.phase)

  // 1) 세션 이어받기. 테이블이 아직 없거나(008 미적용) 조회가 실패해도 앱은 그대로 쓸 수 있다.
  useEffect(() => {
    if (!user) return
    let active = true
    fetchActiveFreeSession(user.id)
      .then((session) => {
        if (!active) return
        const store = useFreeTravelStore.getState()
        if (session) store.restore({ userId: user.id, session })
        else if (store.phase === 'active' || store.phase === 'reviewing' || store.userId !== user.id) store.clear() // 다른 곳에서 이미 종료됐다
      })
      .catch((error) => console.warn('[free-travel] 진행 중인 자유여행을 확인하지 못했어', error.message))
    return () => {
      active = false
    }
  }, [user])

  // 2) 위치 추적
  const tracking = phase === 'active'
  useEffect(() => {
    if (!tracking) return
    const stop = watchPosition({
      onPosition: (position) => {
        useLocationStore.getState().setPosition(position)
        const store = useFreeTravelStore.getState()
        store.ingestTick(position)
        maybeFetchNearby(position)
      },
      onError: (error) => useFreeTravelStore.getState().setTrackError(error.code),
    })
    return stop
  }, [tracking])
}

// 주변 장소 캐시 갱신. 조건을 통과하지 못하면 아무 것도 호출하지 않는다.
function maybeFetchNearby(position) {
  const store = useFreeTravelStore.getState()
  const now = Date.now()
  if (!shouldFetchNearby(store.nearby.cache, position, now)) return
  const center = { lat: position.lat, lng: position.lng }
  store.markNearbyFetching(center)
  fetchNearbyPlaces({ ...center, radius: NEARBY_FETCH_RADIUS_METERS, limit: NEARBY_FETCH_LIMIT })
    .then((response) => useFreeTravelStore.getState().setNearby({ places: response.data ?? [], center, fetchedAt: Date.now() }))
    .catch((error) => {
      console.warn('[free-travel] 주변 장소를 가져오지 못했어', error.message)
      useFreeTravelStore.getState().markNearbyFailed(Date.now())
    })
}

// ───────── 화면에서 쓰는 자유여행 동작 ─────────
export function useFreeTravelActions() {
  const user = useAuthStore((s) => s.user)
  const { trip, setTrip } = useTripStore()

  const syncTripMode = useCallback(
    (mode) => {
      const latest = useTripStore.getState().trip
      if (latest) setTrip({ ...latest, travel_mode: mode })
      useTripStore.getState().setTravelMode(mode)
    },
    [setTrip],
  )

  // 시작 확인 모달에서 "자유여행 시작"을 눌렀을 때만 호출한다.
  const start = useCallback(
    async (adventureId) => {
      const { session } = await startFreeTravel(adventureId)
      useFreeTravelStore.getState().begin({ userId: user.id, session })
      syncTripMode('free')
      useAdventureStore.getState().invalidateBoard() // 자유여행 전환: 퀘스트 화면 캐시를 다시 읽게 한다
    },
    [user, syncTripMode],
  )

  // 종료 확인 모달에서 "자유여행 종료"를 눌렀을 때: 위치 추적을 멈추고 방문 후보 확인 단계로 간다. (아직 서버에 아무것도 저장하지 않는다)
  const beginReview = useCallback(() => useFreeTravelStore.getState().beginReview(), [])

  // "방문한 장소 저장": 선택한 방문만 서버에 확정하고, 그 결과로 기존 모험으로 바로 돌아가도 되는지 코드가 판단한다.
  // skipVisits: "저장하지 않고 종료" — 선택과 상관없이 방문을 하나도 저장하지 않고 마친다.
  const finish = useCallback(async ({ skipVisits = false } = {}) => {
    const s = useFreeTravelStore.getState()
    const sessionId = s.session.id
    const adventureId = s.session.adventure_id
    const candidates = Object.values(s.tracking.candidates)
    const visits = skipVisits ? [] : [
      ...candidates.filter((c) => s.selected[c.placeId]).map((c) => ({ placeId: c.placeId, lat: c.lat, lng: c.lng, source: 'candidate', visitedAt: c.sinceT })),
      ...s.manualVisits.filter((m) => s.selected[m.placeId]).map((m) => ({ placeId: m.placeId, lat: m.lat, lng: m.lng, source: 'manual', visitedAt: Date.now() })),
    ]
    const response = await finishFreeTravel({ sessionId, visits, route: s.tracking.route, candidatesSeen: candidates.length })
    syncTripMode('quest')
    useAdventureStore.getState().invalidateBoard() // 방문 저장/복귀: 퀘스트·지도(방문한 장소) 캐시 무효화
    useAdventureStore.getState().invalidateVisited()
    useTripStore.getState().invalidateHub()

    // 복귀 판단 재료를 모은다. 하나라도 못 구하면 그 항목만 빼고 판단한다. (실패해도 사용자는 모험으로 돌아갈 수 있다)
    const lastRoutePoint = s.tracking.route[s.tracking.route.length - 1] ?? null
    const position = useLocationStore.getState().position ?? lastRoutePoint
    let check = { needsReplan: false, reasons: [], metrics: {} }
    try {
      const latestTrip = useTripStore.getState().trip ?? trip
      const date = clampDate(todayKst(), latestTrip.start_date, latestTrip.end_date)
      const [board, daily] = await Promise.all([
        adventureId ? fetchQuestBoard(adventureId) : null,
        fetchDailyContextState({ trip: latestTrip, date }).catch(() => null),
      ])
      const plan = board ? collectRemainingPlan(board) : { remainingChapters: 0, stops: [] }
      const accommodation = accommodationForDate(latestTrip.accommodations ?? [], date).today
      const weatherNow = useWeatherStore.getState()
      check = evaluateReturn({
        weatherMajor: assessWeatherChange({ current: weatherNow.raw, baseline: weatherNow.baseline }).major,
        now: Date.now(),
        position,
        desiredEndTime: daily?.values?.desired_end_time ?? null,
        accommodation: accommodation?.latitude != null ? { lat: accommodation.latitude, lng: accommodation.longitude } : null,
        freeStartedAt: new Date(s.session.started_at).getTime(),
        visitedPlaceIds: response.saved.map((v) => v.placeId),
        ...plan,
      })
    } catch (error) {
      console.warn('[free-travel] 복귀 판단 재료를 읽지 못해서 기존 일정으로 복귀해', error.message)
    }

    // Agent Log: 자유여행 복귀 판정 요약 (자동 REPLAN 은 없다. 제안만 하고 사용자가 고른다)
    logAgent(
      makeEntry({
        type: 'replan',
        level: check.needsReplan ? 'warning' : 'info',
        title: '자유여행 복귀',
        message: check.needsReplan ? '자유여행에서 돌아왔어. 위치/시간 변화로 남은 일정 재조정이 필요해 보여서 제안했어. 사용자 선택을 기다리는 중이야.' : '자유여행에서 돌아왔어. 기존 일정으로 그대로 이어가도 돼.',
        meta: { reason: 'RETURN_FROM_FREE_TRAVEL' },
        key: `freetravel:return:${sessionId}`,
      }),
    )
    useFreeTravelStore.getState().setResult({
      sessionId,
      adventureId,
      saved: response.saved,
      rejected: response.rejected,
      rewards: response.rewards,
      check,
      position: position ? { lat: position.lat, lng: position.lng } : null,
    })
    return response
  }, [syncTripMode, trip])

  // 복귀 마무리 (기존 일정 계속 / 모험으로 돌아가기)
  const dismissReturn = useCallback(() => useFreeTravelStore.getState().clear(), [])

  return { start, beginReview, finish, dismissReturn }
}
