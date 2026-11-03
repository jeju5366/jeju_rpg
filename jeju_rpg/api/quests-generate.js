import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { generateQuests } from './_lib/agent/generateQuests.js'

// OpenAI 호출이 길어질 수 있어 Vercel 함수 최대 실행 시간을 늘린다. (로컬 dev 에서는 무시)
export const config = { maxDuration: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/quests-generate  { adventureId }  → { source, fallbackReason, chapters, quests }
// 선택한 모험(status=selected)당 1회. 메인 + 챕터 + 핵심/선택 퀘스트를 만들고 모험을 active 로 바꾼다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.adventureId ?? '')) throw new HttpError(400, 'adventureId is invalid')
    return generateQuests({ user, adventureId: body.adventureId })
  },
  { method: 'POST' },
)