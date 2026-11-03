import { create } from 'zustand'

// 방금 사진 인증에 쓴 이미지(리사이즈된 Blob)를 "메모리에만" 잠깐 들고 있는다. (새로고침/탭 종료 시 사라진다)
// 인증용 사진은 임시라서 서버에도 저장하지 않는다. 사용자가 "추억으로 남기기"를 누르면 이 Blob 을 그때 서버로 보내 영구 저장한다.
//   verified: { [questId]: Blob }   인증에 성공한 사진 (추억 저장 후보)
export const usePhotoStore = create((set) => ({
  verified: {},
  keep: (questId, blob) => set((s) => ({ verified: { ...s.verified, [questId]: blob } })),
  release: (questId) =>
    set((s) => {
      const next = { ...s.verified }
      delete next[questId]
      return { verified: next }
    }),
  clear: () => set({ verified: {} }),
}))
