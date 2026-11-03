import { create } from 'zustand'

// modal/bottom sheet/loading/toast
export const useUiStore = create((set) => ({
  modal: null,
  bottomSheet: null,
  loading: false,
  toast: null,

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  openBottomSheet: (bottomSheet) => set({ bottomSheet }),
  closeBottomSheet: () => set({ bottomSheet: null }),
  setLoading: (loading) => set({ loading }),
  showToast: (toast) => set({ toast }),
  clearToast: () => set({ toast: null }),
}))
