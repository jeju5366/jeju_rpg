import { create } from 'zustand'

// 현재 trip/숙소/travel_mode/설정
// trip.status: upcoming | active | completed | ended_early
// trip.travel_mode: quest | free
//  hub: 홈/퀘스트가 함께 쓰는 "오늘" 데이터 캐시 { date, daily, adventure, loadedAt }. 탭 전환 때 즉시 보여주고 오래됐을 때만 백그라운드로 다시 읽는다.
export const useTripStore = create((set) => ({
  trip: null,
  accommodations: [],
  travelMode: 'quest',
  // /setup 입력 임시값. DB 저장(trips/accommodations)은 4단계에서 연결한다.
  setupDraft: null,
  hub: null,

  setTrip: (trip) => set({ trip }),
  setAccommodations: (accommodations) => set({ accommodations }),
  setTravelMode: (travelMode) => set({ travelMode }),
  setSetupDraft: (setupDraft) => set({ setupDraft }),
  setHub: (hub) => set({ hub: hub ? { ...hub, loadedAt: Date.now() } : null }),
  invalidateHub: () => set((s) => (s.hub ? { hub: { ...s.hub, loadedAt: 0 } } : {})),
  reset: () => set({ trip: null, accommodations: [], travelMode: 'quest', setupDraft: null, hub: null }),
}))
