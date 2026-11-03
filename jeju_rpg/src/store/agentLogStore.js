import { create } from 'zustand'
import { MAX_LOG_ENTRIES } from '../utils/agentLog.js'

// Agent Log 저장소: 클라이언트 세션(메모리)에만 둔다. DB 테이블 없음, 새로고침하면 사라진다.
//  · 최근 MAX_LOG_ENTRIES 개만 유지
//  · key 가 있는 이벤트는 같은 key 가 최근 dedupeMs 안에 있으면 다시 쌓지 않는다 (리렌더/재응답 중복 방지)
//  · Demo 중에 쌓인 로그는 meta.scenarioId 가 붙어서 Demo 종료/시나리오 변경 때 지울 수 있다.
const DEDUPE_MS = 5 * 60 * 1000

export const useAgentLogStore = create((set, get) => ({
  entries: [], // 최신이 앞
  panelOpen: false, // 모바일 오프캔버스
  scenarioId: null, // Demo 중이면 시나리오 id (새 로그에 붙는다)

  push: (entry, { dedupeMs = DEDUPE_MS } = {}) => {
    if (!entry) return
    const { entries, scenarioId } = get()
    if (entry.key && entries.some((e) => e.key === entry.key && entry.timestamp - e.timestamp < dedupeMs)) return
    const stamped = scenarioId ? { ...entry, meta: { ...entry.meta, scenarioId } } : entry
    set({ entries: [stamped, ...entries].slice(0, MAX_LOG_ENTRIES) })
  },
  pushMany: (list) => list.forEach((entry) => get().push(entry)),
  setScenario: (scenarioId) => set({ scenarioId }),
  // Demo 로그만 지운다 (실제 사용 중에 쌓인 로그는 유지)
  clearDemo: () => set((s) => ({ entries: s.entries.filter((e) => !e.meta?.scenarioId), scenarioId: null })),
  clear: () => set({ entries: [] }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
}))

// 어디서든 쓸 수 있는 짧은 호출
export const logAgent = (entry) => useAgentLogStore.getState().push(entry)
export const logAgentMany = (list) => useAgentLogStore.getState().pushMany(list)
