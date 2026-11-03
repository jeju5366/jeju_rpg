import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'
import { investFreeExp } from '../_lib/progression/exp.js'
import { checkTitleUnlocks } from '../_lib/progression/titles.js'
import { getAdmin } from '../_lib/supabaseAdmin.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/exp-invest  { grantId, category }
// 자유 EXP 한 덩어리(지급 로그 1건)를 카테고리 하나에 전부 투자한다. (분할 불가, 같은 덩어리는 한 번만)
// → { amount, category, levelUps, titles }
export default createHandler(
  async (_query, user, body) => {
    if (!UUID.test(body.grantId ?? '')) throw new HttpError(400, 'grantId is invalid')
    const db = getAdmin()
    const result = await investFreeExp(db, { userId: user.id, grantId: body.grantId, category: String(body.category ?? '') })
    const titles = await checkTitleUnlocks(db, { userId: user.id, trigger: 'level_reached', data: { levelUps: result.levelUps } })
    return { ...result, titles }
  },
  { method: 'POST' },
)