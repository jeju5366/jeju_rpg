import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { advanceChapter } from './_lib/quests/progress.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/chapters-advance  { chapterId }
//  active(핵심 미완료) → skipped / core_completed → completed. 남은 선택 퀘스트는 종료되고 다음 챕터가 열린다.
//  → { chapterStatus, alreadyAdvanced, nextChapterId, adventureCompleted, rewards: { chapterBonus, adventureBonus } }
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.chapterId ?? '')) throw new HttpError(400, 'chapterId is invalid')
    return advanceChapter({ user, chapterId: body.chapterId })
  },
  { method: 'POST' },
)