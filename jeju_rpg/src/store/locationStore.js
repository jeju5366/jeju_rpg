import { create } from 'zustand'

// 마지막으로 알고 있는 현재 위치와 위치 요청 상태. (지도/GPS 인증/자유여행이 함께 쓴다)
//  status: idle(아직 요청 안 함) | loading | ready | error
//  error : unsupported | permission_denied | position_unavailable | timeout | null
//  permission: granted | denied | prompt | unknown (확인만 한 값)
export const useLocationStore = create((set) => ({
  position: null, // { lat, lng, accuracy, timestamp }
  status: 'idle',
  error: null,
  permission: 'unknown',

  setLoading: () => set({ status: 'loading', error: null }),
  setPosition: (position) => set({ position, status: 'ready', error: null, permission: 'granted' }),
  setError: (error) => set((s) => ({ status: 'error', error, permission: error === 'permission_denied' ? 'denied' : s.permission })),
  setPermission: (permission) => set({ permission }),
  reset: () => set({ position: null, status: 'idle', error: null, permission: 'unknown' }),
}))
