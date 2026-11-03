import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JEJU_CITY } from '../constants/jeju.js'
import { REPLAN_URGENT_REASONS, WEATHER_CACHE_MINUTES } from '../constants/replanRules.js'
import { fetchWeather } from '../services/weather/weatherService.js'
import { fetchDailyContextState } from '../services/supabase/dailyContextRepo.js'
import { logAgent } from '../store/agentLogStore.js'
import { replanDismissedEntry, replanProposedEntry } from '../utils/agentLog.js'
import { useLocationStore } from '../store/locationStore.js'
import { useReplanStore } from '../store/replanStore.js'
import { useWeatherStore } from '../store/weatherStore.js'
import { assessWeatherChange, evaluateAccommodationRisk, evaluateSchedule } from '../utils/schedule.js'
import { clampDate, todayKst } from '../utils/time.js'

// 일정 상황 판단 (코드). Agent 는 부르지 않는다.
//   · 일정 지연(SCHEDULE_DELAY) / 큰 날씨 변화(WEATHER_CHANGE) / 숙소 복귀 위험(ACCOMMODATION_RISK) → "REPLAN 제안" 1개 (사용자가 승인해야 REPLAN 실행)
//   · 일정이 빨라짐 → REPLAN 이 아니라 추가 콘텐츠 제안(bonus)
// 날씨 API 는 캐시(WEATHER_CACHE_MINUTES)가 만료됐을 때, 그리고 챕터 전환 / 앱 복귀(resume) / 자유여행 복귀 / 사용자 확인 때만 다시 가져온다. 화면에 들어올 때마다 부르지 않는다.
// 제안은 하루 2번까지(긴급 제외), 사용자가 "기존 일정 계속"으로 넘긴 reason 은 45분 동안 다시 보여주지 않는다. (useReplanStore)
export default function useScheduleAssistant({ trip, adventure, chapters, quests, nextTravelMinutes, enabled }) {
  const [daily, setDaily] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const weather = useWeatherStore()
  const replan = useReplanStore()
  const fetching = useRef(false)

  const date = trip ? clampDate(todayKst(), trip.start_date, trip.end_date) : null
  const current = chapters.find((c) => c.status === 'active' || c.status === 'core_completed') ?? null
  const currentCore = current ? quests.find((q) => q.chapter_id === current.id && q.quest_type === 'core') : null
  const chapterKey = chapters.map((c) => `${c.id}:${c.status}`).join('|')

  // 일일 조건(종료 희망 시간): 한 번 읽어 둔다
  useEffect(() => {
    if (!enabled || !trip || !date) return
    let active = true
    fetchDailyContextState({ trip, date })
      .then((state) => active && setDaily(state))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [enabled, trip, date])

  // 1분마다 "지금" 을 갱신해 지연 판단이 시간에 따라 달라지게 한다. (네트워크/DB 호출 없음)
  useEffect(() => {
    if (!enabled) return undefined
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [enabled])

  // 날씨: 캐시가 있고 만료 전이면 다시 가져오지 않는다.
  const refreshWeather = useCallback(
    async ({ force = false } = {}) => {
      const state = useWeatherStore.getState()
      if (fetching.current) return
      if (!force && state.raw && Date.now() - state.fetchedAt < WEATHER_CACHE_MINUTES * 60000) return
      fetching.current = true
      try {
        const where = useLocationStore.getState().position ?? (currentCore?.place_lat != null ? { lat: currentCore.place_lat, lng: currentCore.place_lng } : JEJU_CITY)
        const response = await fetchWeather({ lat: where.lat, lng: where.lng })
        useWeatherStore.getState().setWeather(response.data)
      } catch {
        /* 날씨를 못 읽으면 날씨 때문에 제안하지 않는다 */
      } finally {
        fetching.current = false
      }
    },
    [currentCore],
  )

  // 최초 1회(기준 날씨가 없을 때) + 챕터 전환 + 앱 복귀 때 확인 (캐시가 만료된 경우에만 실제로 가져온다)
  useEffect(() => {
    if (enabled && adventure?.status === 'active') refreshWeather()
  }, [enabled, adventure?.status, chapterKey, refreshWeather])
  useEffect(() => {
    if (!enabled) return undefined
    const onVisible = () => document.visibilityState === 'visible' && refreshWeather()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, refreshWeather])

  const result = useMemo(() => {
    if (!enabled || !adventure || adventure.status !== 'active' || !current) return { suggestion: null, bonus: null, schedule: null }
    const desiredEndTime = daily?.values?.desired_end_time ?? null
    const schedule = evaluateSchedule({ now, chapters, desiredEndTime, nextTravelMinutes })
    const risk = evaluateAccommodationRisk({ now, desiredEndTime, remainingChapters: schedule.remainingChapters })
    const weatherChange = assessWeatherChange({ current: weather.raw, baseline: weather.baseline })

    // 우선순위: 날씨(현재 야외 일정이 어려움) → 숙소 복귀 위험 → 일정 지연. 한 번에 제안은 1개만 보여준다.
    const candidates = []
    if (weatherChange.major) candidates.push({ reason: 'WEATHER_CHANGE', severity: 'normal', detail: weatherChange.now.reasons })
    if (risk.risk) candidates.push({ reason: 'ACCOMMODATION_RISK', severity: 'strong', detail: { lateMinutes: risk.lateMinutes } })
    if (schedule.candidate) candidates.push({ reason: 'SCHEDULE_DELAY', severity: schedule.strong ? 'strong' : 'normal', detail: { delayMinutes: schedule.delayMinutes } })
    const suggestion = candidates.find((c) => replan.canShow(c.reason, { urgent: REPLAN_URGENT_REASONS.includes(c.reason) })) ?? null

    // 일정이 빨라졌고 REPLAN 제안이 없을 때만 추가 콘텐츠(Bonus Opportunity)
    const bonus = !suggestion && schedule.ahead && !replan.bonusDismissed[current.id] ? { aheadMinutes: schedule.aheadMinutes } : null
    return { suggestion, bonus, schedule }
  }, [enabled, adventure, current, daily, now, chapters, nextTravelMinutes, weather.raw, weather.baseline, replan])

  // 제안이 실제로 화면에 나타난 reason 은 오늘 제안 횟수에 센다
  const suggestedReason = result.suggestion?.reason
  useEffect(() => {
    // store 전체가 아니라 제안 reason 이 바뀔 때만 실행한다. (store 를 의존성으로 두면 markShown 이 상태를 바꿀 때마다 다시 실행되는 무한 루프가 된다)
    useReplanStore.getState().ensureToday()
    if (suggestedReason) {
      useReplanStore.getState().markShown(suggestedReason)
      logAgent(replanProposedEntry(suggestedReason)) // Agent Log: 제안 이유 + 사용자 승인 대기 (같은 reason 은 중복으로 쌓이지 않는다)
    }
  }, [suggestedReason])

  return {
    ...result,
    daily,
    refreshWeather,
    // "기존 일정 계속" / "그대로 진행": 같은 reason 은 한동안 다시 제안하지 않고, 날씨는 지금 상태를 새 기준으로 삼는다.
    dismissSuggestion: (reason) => {
      useReplanStore.getState().dismiss(reason)
      logAgent(replanDismissedEntry(reason))
      if (reason === 'WEATHER_CHANGE') useWeatherStore.getState().acceptCurrentAsBaseline()
    },
    // REPLAN 이 실행된 뒤: 새 일정 기준으로 판단이 다시 시작되게 한다
    afterReplan: (reason) => {
      useReplanStore.getState().clearReason(reason)
      useWeatherStore.getState().acceptCurrentAsBaseline()
    },
    dismissBonus: () => current && useReplanStore.getState().dismissBonus(current.id),
  }
}
