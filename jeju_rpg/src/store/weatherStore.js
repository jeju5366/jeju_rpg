import { create } from 'zustand'

// 날씨 캐시. 날씨를 새로 가져오는 것(API)과 GPT 호출은 별개다. 큰 변화일 때만 코드가 REPLAN "제안"을 만든다.
//  raw       : 마지막으로 가져온 날씨(/api/weather data)
//  fetchedAt : 가져온 시각 (WEATHER_CACHE_MINUTES 동안 재사용)
//  baseline  : 비교 기준 날씨. 처음 본 날씨이거나, 사용자가 "그대로 진행"/REPLAN 으로 한 번 처리한 시점의 날씨.
export const useWeatherStore = create((set) => ({
  raw: null,
  fetchedAt: 0,
  baseline: null,
  setWeather: (raw) => set((s) => ({ raw, fetchedAt: Date.now(), baseline: s.baseline ?? raw })),
  acceptCurrentAsBaseline: () => set((s) => ({ baseline: s.raw })),
  reset: () => set({ raw: null, fetchedAt: 0, baseline: null }),
}))
