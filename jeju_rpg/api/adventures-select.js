import { createHandler } from './_lib/handler.js'
import { HttpError } from './_lib/http.js'
import { selectAdventure } from './_lib/agent/generateAdventures.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/adventures-select  { adventureId }  → 선택된 adventure 행
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.adventureId ?? '')) throw new HttpError(400, 'adventureId is invalid')
    return selectAdventure({ user, adventureId: body.adventureId })
  },
  { method: 'POST' },
)