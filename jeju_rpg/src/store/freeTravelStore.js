import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { applyTick, createTracking } from '../utils/freeTravel/tracker.js'

// 자유여행 세션 상태 (프론트 전용). 이동 경로/방문 후보는 여기(세션 수준)에만 있고 DB 에 저장하지 않는다.
// 탭을 새로고침해도 이어지도록 localStorage 에 가끔(디바운스) 백업한다. 자유여행이 끝나면 비운다.
//
// phase 흐름
//   idle ──start──▶ active ──"자유여행 종료" 확인──▶ reviewing(방문 후보 일괄 확인) ──저장──▶ returning(복귀 판단) ──마침──▶ idle
//   active/reviewing 은 서버의 free 세션(travel_mode=free)과 함께 가고, returning 은 이미 서버에서 quest 로 돌아온 뒤다.
//
// tracking: ../utils/freeTravel/tracker.js 참고 (route / presence / candidates)
// nearby : { places, cache } — 주변 장소 캐시와 조회 상태(API 남발 방지용, 새로고침하면 사라진다)
// selected: 방문 후보 체크 상태 { [placeId]: boolean } / manualVisits: 수동으로 추가한 장소 [{ placeId, name, lat, lng, contentTypeId }]
// result: 종료 결과(returning 단계에서 보여줄 것)

const STORAGE_NAME = 'jeju-free-travel-v1'
const SAVE_DELAY_MS = 4000

// localStorage 를 디바운스해서 쓴다. (위치가 갱신될 때마다 매번 쓰지 않는다) 접근이 막혀 있으면 조용히 무시한다.
let saveTimer = null
let pending = null
const flush = () => {
  clearTimeout(saveTimer)
  saveTimer = null
  if (!pending) return
  try {
    localStorage.setItem(pending.name, pending.value)
  } catch {
    /* 저장소를 못 써도 자유여행은 계속된다 */
  }
  pending = null
}
const debouncedStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    pending = { name, value }
    if (!saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY_MS)
  },
  removeItem: (name) => {
    clearTimeout(saveTimer)
    saveTimer = null
    pending = null
    try {
      localStorage.removeItem(name)
    } catch {
      /* 무시 */
    }
  },
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

const emptyState = () => ({
  userId: null,
  session: null,
  phase: 'idle',
  tracking: createTracking(),
  nearby: { places: [], cache: null },
  trackError: null,
  notice: null, // 'gap' (앱이 멈춰 있던 동안은 기록되지 않았어)
  selected: {},
  manualVisits: [],
  result: null,
})

export const useFreeTravelStore = create(
  persist(
    (set, get) => ({
      ...emptyState(),

      // 새 세션 시작
      begin: ({ userId, session }) => set({ ...emptyState(), userId, session, phase: 'active' }),

      // 앱을 다시 열었을 때 서버에 진행 중인 세션이 있으면 이어받는다. 같은 세션이면 저장해 둔 경로/후보를 유지한다.
      restore: ({ userId, session }) => {
        const state = get()
        if (state.userId === userId && state.session?.id === session.id) {
          if (state.phase === 'idle' || state.phase === 'returning') set({ phase: 'active' })
          return
        }
        set({ ...emptyState(), userId, session, phase: 'active' }) // 다른 기기/저장소가 지워진 경우: 경로 없이 이어간다(수동 방문으로 보충)
      },

      clear: () => set(emptyState()),

      // 위치 갱신 1건 처리. DB/API 호출 없이 계산만 한다.
      ingestTick: (tick) => {
        const state = get()
        if (state.phase !== 'active') return { newCandidates: [] }
        const result = applyTick(state.tracking, tick, state.nearby.places)
        if (result.ignored) return { newCandidates: [] }
        set({ tracking: result.tracking, trackError: null, ...(result.gap ? { notice: 'gap' } : {}) })
        return { newCandidates: result.newCandidates }
      },
      dismissNotice: () => set({ notice: null }),
      setTrackError: (trackError) => set({ trackError }),

      // 주변 장소 캐시
      markNearbyFetching: (center) => set((s) => ({ nearby: { ...s.nearby, cache: { ...s.nearby.cache, center, fetching: true } } })),
      setNearby: ({ places, center, fetchedAt }) => set({ nearby: { places, cache: { center, fetchedAt, failedAt: null, fetching: false } } }),
      markNearbyFailed: (failedAt) => set((s) => ({ nearby: { ...s.nearby, cache: { ...s.nearby.cache, fetching: false, failedAt } } })),

      // 종료 확정 → 방문 후보 확인 단계. 감지된 후보는 기본으로 모두 체크해 두고 사용자가 빼게 한다.
      beginReview: () =>
        set((s) => ({
          phase: 'reviewing',
          selected: Object.fromEntries(Object.keys(s.tracking.candidates).map((id) => [id, true])),
        })),
      // 방문 후보 확인 중 "계속 자유여행하기": 추적을 다시 켠다.
      resumeFromReview: () => set({ phase: 'active' }),
      toggleSelected: (placeId) => set((s) => ({ selected: { ...s.selected, [placeId]: !s.selected[placeId] } })),
      addManualVisit: (place) =>
        set((s) =>
          s.manualVisits.some((m) => m.placeId === place.placeId) || s.tracking.candidates[place.placeId]
            ? {}
            : { manualVisits: [...s.manualVisits, place], selected: { ...s.selected, [place.placeId]: true } },
        ),
      removeManualVisit: (placeId) =>
        set((s) => ({ manualVisits: s.manualVisits.filter((m) => m.placeId !== placeId), selected: { ...s.selected, [placeId]: false } })),

      // 방문 저장 완료 → 복귀 판단 단계 (서버에서는 이미 quest 모드로 돌아왔다)
      setResult: (result) => set({ phase: 'returning', result, nearby: { places: [], cache: null } }),
    }),
    {
      name: STORAGE_NAME,
      storage: createJSONStorage(() => debouncedStorage),
      partialize: (s) => ({
        userId: s.userId,
        session: s.session,
        phase: s.phase,
        tracking: { route: s.tracking.route, candidates: s.tracking.candidates, lastTickT: s.tracking.lastTickT },
        selected: s.selected,
        manualVisits: s.manualVisits,
        result: s.result,
      }),
      // presence(지금 머무는 중)는 저장하지 않는다. 새로고침하면 머문 시간을 다시 세기 시작한다.
      merge: (persisted, current) => ({ ...current, ...persisted, tracking: { ...createTracking(), ...(persisted?.tracking ?? {}) } }),
    },
  ),
)
