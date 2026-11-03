import { create } from 'zustand'

// adventure/chapters/quests/progress
//  boardTripId / boardLoadedAt: 이 판을 마지막으로 읽은 여행/시각. 탭을 오가도 캐시된 판을 바로 보여주고, 오래됐을 때만 백그라운드로 다시 읽는다. (useQuestBoard)
//  퀘스트 완료 / 챕터 이동 / REPLAN / 돌발 퀘스트 / 자유여행 전환 같은 mutation 이 있으면 화면이 reload 로 판을 새로 읽어 이 값을 즉시 갱신한다.
export const useAdventureStore = create((set) => ({
  adventures: [],
  currentAdventure: null,
  chapters: [],
  quests: [],
  progress: [],
  boardTripId: null,
  boardLoadedAt: 0,
  // 지도의 "방문한 장소" 마커 캐시 (탭 전환 때 다시 읽지 않는다. 자유여행 방문 저장 후 invalidateVisited)
  visited: [],
  visitedTripId: null,
  visitedLoadedAt: 0,

  setAdventures: (adventures) => set({ adventures }),
  setCurrentAdventure: (currentAdventure) => set({ currentAdventure }),
  setChapters: (chapters) => set({ chapters }),
  setQuests: (quests) => set({ quests }),
  setProgress: (progress) => set({ progress }),
  // 판 전체를 한 번에 교체하고 읽은 시각을 기록한다.
  setBoard: ({ tripId, adventure, chapters = [], quests = [], progress = [] }) =>
    set({ boardTripId: tripId, boardLoadedAt: Date.now(), currentAdventure: adventure, chapters, quests, progress }),
  // 완료 API 가 성공한 직후, 서버가 돌려준 결과를 화면 캐시에 바로 반영한다. (이후 background reload 가 서버 상태와 다시 맞춘다)
  //   progress: 서버의 quest_progress 행(완료/중간 인증 상태) / chapterStatus: 핵심 퀘스트를 끝낸 챕터의 새 상태(core_completed)
  applyCompletion: ({ progress, chapterId, chapterStatus }) =>
    set((state) => ({
      progress: progress ? [...state.progress.filter((row) => row.quest_id !== progress.quest_id), progress] : state.progress,
      chapters: chapterId && chapterStatus ? state.chapters.map((c) => (c.id === chapterId && c.status !== chapterStatus ? { ...c, status: chapterStatus } : c)) : state.chapters,
    })),
  setVisited: (tripId, visited) => set({ visited, visitedTripId: tripId, visitedLoadedAt: Date.now() }),
  invalidateVisited: () => set({ visitedLoadedAt: 0 }),
  // 다음 방문 때 반드시 다시 읽게 한다. (mutation 직후 등)
  // 캐시를 비우지 않고 "오래된 것"으로만 표시한다(1 = 아주 오래전). 화면은 이전 내용을 그대로 보여주고 백그라운드로 다시 읽는다.
  invalidateBoard: () => set((state) => (state.boardLoadedAt > 0 ? { boardLoadedAt: 1 } : {})),
  reset: () =>
    set({ adventures: [], currentAdventure: null, chapters: [], quests: [], progress: [], boardTripId: null, boardLoadedAt: 0, visited: [], visitedTripId: null, visitedLoadedAt: 0 }),
}))
