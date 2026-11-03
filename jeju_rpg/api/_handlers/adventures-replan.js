import { REPLAN_REASONS } from '../../src/constants/enums.js'
import { replanAdventure } from '../_lib/agent/replan.js'
import { createHandler } from '../_lib/handler.js'
import { HttpError } from '../_lib/http.js'

// Agent 호출이 길어질 수 있어 Vercel 함수 최대 실행 시간을 늘린다. (로컬 dev 에서는 무시)
export const config = { maxDuration: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/adventures-replan  { adventureId, reason, context? }
//   reason: RETURN_FROM_FREE_TRAVEL | WEATHER_CHANGE | SCHEDULE_DELAY | PLACE_UNAVAILABLE | USER_REQUEST | ACCOMMODATION_RISK  (SCHEDULE_AHEAD 는 REPLAN 이 아니다)
//   context: { position?: { lat, lng }, sessionId?, visitedPlaceIds?, reasons? } — 판단 근거. 거리/시간/날씨는 서버가 다시 계산한다.
//   → { status: 'replanned', replaced, added, kept, ... }
//     | { status: 'no_alternative', options: ['keep','skip','free'] }   실제 대체 후보가 없다: 화면이 3가지 선택지를 보여준다
//     | { status: 'unchanged', outcome }                                 바꿀 것이 없다/근거 없음: 기존 일정 그대로
//   오류: replan_daily_limit / replan_manual_limit / replan_system_limit / replan_cooldown / replan_failed(기존 모험 유지) ...
// 사용자가 "일정 다시 맞추기"를 승인했을 때만 호출된다. (REPLAN 1회 = 승인 1회) 설정 수정이나 화면 진입만으로는 호출하지 않는다.
export default createHandler(
  (_query, user, body) => {
    if (!UUID.test(body.adventureId ?? '')) throw new HttpError(400, 'adventureId is invalid')
    if (!REPLAN_REASONS.includes(body.reason)) throw new HttpError(400, 'reason is invalid')
    if (body.reason === 'RETURN_FROM_FREE_TRAVEL' && !UUID.test(body.context?.sessionId ?? '')) throw new HttpError(400, 'context is invalid')
    return replanAdventure({ user, adventureId: body.adventureId, reason: body.reason, context: body.context ?? {} })
  },
  { method: 'POST' },
)
