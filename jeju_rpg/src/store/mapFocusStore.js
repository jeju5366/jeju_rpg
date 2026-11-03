import { create } from 'zustand'

// 퀘스트/Final Quest 화면 → 지도 탭으로 "이 장소를 중심에 보여줘"를 전달하는 일회용 값. (DB 저장 없음)
//   target: { lat, lng, title, questId, placeId, key } | null
// 지도 탭이 열릴 때 consume() 으로 한 번 읽고 비운다. 그래서 지도 탭을 일반으로 열면 기존 전체 지도 동작 그대로다.
export const useMapFocusStore = create((set, get) => ({
  target: null,
  setTarget: (target) => set({ target }),
  consume: () => {
    const { target } = get()
    if (target) set({ target: null })
    return target
  },
}))
