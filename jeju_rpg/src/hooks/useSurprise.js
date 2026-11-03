import { useCallback, useEffect, useRef } from 'react'
import { SURPRISE_RULES } from '../constants/replanRules.js'
import { evaluateSurprise, respondSurprise } from '../services/agent/surpriseService.js'
import { getCurrentPosition, queryPermission } from '../services/location/geolocation.js'
import { useLocationStore } from '../store/locationStore.js'
import { haversineMeters } from '../utils/geo.js'
import { evaluateSurpriseGate, minutesToEndOfDay } from '../utils/schedule.js'

const DWELL_POLL_MS = 90 * 1000

// 돌발 퀘스트(Surprise). "이동 중에는 띄우지 않는다." 안정적인 시점에서만 서버에 평가를 요청한다.
//   · 핵심 퀘스트 완료 직후 / 챕터의 퀘스트를 모두 끝낸 직후(다음 챕터로 가기 전): 호출하는 쪽이 evaluate('core_completed' | 'chapter_completed') 를 부른다.
//   · anchor 근처 체류: 위치 권한이 "이미 허용된" 경우에만 90초마다 조용히 위치를 확인해서(권한 창을 띄우지 않는다), anchor 200m 안에서 3분 머물면 평가한다.
//   · 일정이 30분 이상 빨리 끝났을 때: 추가 콘텐츠 카드에서 evaluate('ahead_of_schedule').
// 화면에서도 같은 gate(evaluateSurpriseGate)로 먼저 걸러서 불필요한 요청을 보내지 않고, 서버가 최종 확인한다. 같은 상태(트리거+챕터)는 한 번만 평가한다.
// quests 중 surprise_status 가 offered(제안됨) / accepted(도전 중)인 것이 화면에 보인다. declined 는 숨겨진다.
export default function useSurprise({ adventure, current, currentCore, quests, daily, replanNeeded, verificationOpen, transitioning, freeTravel, reload }) {
  const asked = useRef(new Set())
  const dwell = useRef({ since: null })
  const inflight = useRef(false)

  const surprises = quests.filter((q) => q.quest_type === 'surprise')
  const offered = surprises.find((q) => q.surprise_status === 'offered') ?? null
  const accepted = surprises.filter((q) => q.surprise_status === 'accepted')

  const evaluate = useCallback(
    async (trigger, extras = {}) => {
      if (!adventure || adventure.status !== 'active' || !current || inflight.current) return null
      const key = `${trigger}:${current.id}:${current.status}`
      if (asked.current.has(key)) return null // 같은 상태는 한 번만
      const dayStart = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })).getTime() - 9 * 3600 * 1000
      const today = surprises.filter((q) => q.offered_at && new Date(q.offered_at).getTime() >= dayStart)
      const anchor = currentCore?.place_lat != null ? { lat: currentCore.place_lat, lng: currentCore.place_lng } : null
      const position = extras.position ?? useLocationStore.getState().position
      const gate = evaluateSurpriseGate({
        trigger,
        adventureActive: true,
        freeTravel,
        replanNeeded,
        verificationOpen,
        transitioning,
        position,
        speedMs: extras.speedMs,
        anchor,
        dwellMs: extras.dwellMs,
        dayCount: today.length,
        lastOfferedAt: today.map((q) => new Date(q.offered_at).getTime()).sort((a, b) => b - a)[0] ?? null,
        minutesToEnd: minutesToEndOfDay({ desiredEndTime: daily?.values?.desired_end_time }),
      })
      if (!gate.ok || offered) return null
      asked.current.add(key)
      inflight.current = true
      try {
        const response = await evaluateSurprise({
          adventureId: adventure.id,
          trigger,
          position: position ? { lat: position.lat, lng: position.lng } : undefined,
          speedMs: extras.speedMs,
          dwellMs: extras.dwellMs,
          replanNeeded,
          verificationOpen,
          transitioning,
        })
        if (response.offered) await reload()
        return response
      } catch {
        return null // 돌발 퀘스트는 부가 요소라서 실패해도 아무 것도 하지 않는다
      } finally {
        inflight.current = false
      }
    },
    [adventure, current, currentCore, surprises, daily, replanNeeded, verificationOpen, transitioning, freeTravel, offered, reload],
  )

  // anchor 근처 체류 감지 (권한이 이미 허용된 경우에만, 조용히)
  const stable = Boolean(adventure?.status === 'active' && current && currentCore?.place_lat != null && !freeTravel)
  useEffect(() => {
    if (!stable) return undefined
    let cancelled = false
    const tick = async () => {
      if (document.visibilityState !== 'visible' || (await queryPermission()) !== 'granted') return
      try {
        const position = await getCurrentPosition({ timeoutMs: 8000, maxAgeMs: 60000, highAccuracy: false })
        if (cancelled) return
        useLocationStore.getState().setPosition(position)
        const near = haversineMeters(position, { lat: currentCore.place_lat, lng: currentCore.place_lng }) <= SURPRISE_RULES.anchorRadiusMeters
        if (!near) {
          dwell.current.since = null
          return
        }
        dwell.current.since ??= Date.now()
        const dwellMs = Date.now() - dwell.current.since
        if (dwellMs >= SURPRISE_RULES.dwellMinutes * 60000) evaluate('anchor_dwell', { position, dwellMs })
      } catch {
        /* 위치를 못 받으면 이번 확인은 건너뛴다 */
      }
    }
    const timer = setInterval(tick, DWELL_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [stable, currentCore, evaluate])

  const respond = useCallback(
    async (quest, action) => {
      await respondSurprise(quest.id, action)
      await reload()
    },
    [reload],
  )

  return { offered, accepted, evaluate, respond }
}
