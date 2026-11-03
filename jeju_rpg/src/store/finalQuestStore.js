import { create } from 'zustand'

// Final Quest 평가 결과 캐시. 탭을 오가도 다시 부르지 않고, 오래됐을 때(FINAL_QUEST_CACHE.evalStaleMs)만 백그라운드로 다시 읽는다.
export const useFinalQuestStore = create((set) => ({
  tripId: null,
  state: null,
  loadedAt: 0,
  setState: (tripId, state) => set({ tripId, state, loadedAt: Date.now() }),
  reset: () => set({ tripId: null, state: null, loadedAt: 0 }),
}))
