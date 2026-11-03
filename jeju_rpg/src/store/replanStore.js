import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { REPLAN_DAILY_LIMITS } from '../constants/replanRules.js'
import { todayKst } from '../utils/time.js'

// REPLAN "제안"을 얼마나 보여줬는지 / 사용자가 "기존 일정 계속"으로 넘긴 제안을 기억한다. (새로고침해도 유지)
//   · 시스템 제안은 하루 systemSuggestionsPerDay 번까지만 보여준다. (긴급 사유는 예외)
//   · 사용자가 넘긴 같은 reason 은 dismissMinutes 동안 다시 제안하지 않는다.
//   실제 REPLAN "실행" 한도/cooldown 은 서버가 강제한다. 이 store 는 화면의 제안 빈도만 조절한다.
export const useReplanStore = create(
  persist(
    (set, get) => ({
      date: null,
      shown: {}, // { [reason]: true } 오늘 이미 보여준 reason
      dismissed: {}, // { [reason]: timestamp }
      bonusDismissed: {}, // { [chapterId]: true } 일정 앞당김 제안을 넘긴 챕터

      // 날짜가 바뀌면 하루 카운트를 비운다
      ensureToday: () => {
        const today = todayKst()
        if (get().date !== today) set({ date: today, shown: {}, dismissed: {}, bonusDismissed: {} })
      },
      shownCount: () => Object.keys(get().shown).length,
      canShow: (reason, { urgent = false, now = Date.now() } = {}) => {
        const state = get()
        const dismissedAt = state.dismissed[reason]
        if (dismissedAt && now - dismissedAt < REPLAN_DAILY_LIMITS.dismissMinutes * 60000) return false
        if (state.shown[reason]) return true // 이미 보여주던 제안은 계속 보여준다
        return urgent || Object.keys(state.shown).length < REPLAN_DAILY_LIMITS.systemSuggestionsPerDay
      },
      markShown: (reason) => set((s) => (s.shown[reason] ? s : { shown: { ...s.shown, [reason]: true } })), // 이미 보여준 reason 이면 상태를 바꾸지 않는다(알림 없음)
      dismiss: (reason) => set((s) => ({ dismissed: { ...s.dismissed, [reason]: Date.now() }, shown: Object.fromEntries(Object.entries(s.shown).filter(([k]) => k !== reason)) })),
      dismissBonus: (chapterId) => set((s) => ({ bonusDismissed: { ...s.bonusDismissed, [chapterId]: true } })),
      clearReason: (reason) => set((s) => ({ shown: Object.fromEntries(Object.entries(s.shown).filter(([k]) => k !== reason)) })),
    }),
    {
      name: 'jeju-replan-v1',
      // localStorage 를 못 쓰는 환경(시크릿 창/저장소 차단/테스트)에서도 앱이 깨지지 않게, 읽기/쓰기 실패는 조용히 무시한다. (제안 기록만 새로고침 때 사라진다)
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            return localStorage.getItem(name)
          } catch {
            return null
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, value)
          } catch {
            /* 무시 */
          }
        },
        removeItem: (name) => {
          try {
            localStorage.removeItem(name)
          } catch {
            /* 무시 */
          }
        },
      })),
    },
  ),
)
