import { assertNoFinalQuest } from '../finalQuest/service.js'
import { ADVENTURE_RULES, TRAVEL_RANGE_RADIUS_M } from '../../../src/constants/gameBalance.js'
import { JEJU_AIRPORT } from '../../../src/constants/jeju.js'
import { convergeCandidates } from '../../../src/utils/lastDay.js'
import { HttpError } from '../http.js'
import { getAdmin } from '../supabaseAdmin.js'
import { askAdventureAgent, buildDemoAdventures } from './adventures.js'
import { gatherCandidates } from './candidates.js'
import { buildAgentContext } from './context.js'
import { claimAgentRequest, finishAgentRequest, logUsages } from './requests.js'

export async function generateAdventures({ user, tripId, adventureDate, travelRange }) {
  const db = getAdmin()
  const userId = user.id

  const { data: trip, error: tripError } = await db.from('jeju_trips').select('*').eq('id', tripId).eq('user_id', userId).maybeSingle()
  if (tripError) throw tripError
  if (!trip) throw new HttpError(404, 'trip_not_found')
  if (adventureDate < trip.start_date || adventureDate > trip.end_date) throw new HttpError(400, 'date_out_of_range')
  if (trip.status === 'completed') throw new HttpError(409, 'trip_completed') // 끝난 여행에는 새 모험을 만들지 않는다
  await assertNoFinalQuest(db, { userId, tripId })

  // 횟수 제한(최초 1세트 + 재생성 1세트)은 서버/DB 기준으로 검증한다.
  const { data: existing, error: existingError } = await db
    .from('jeju_adventures')
    .select('id, status, generation_set')
    .eq('user_id', userId)
    .eq('trip_id', tripId)
    .eq('adventure_date', adventureDate)
  if (existingError) throw existingError
  if (existing.some((a) => a.status !== 'proposed')) throw new HttpError(409, 'already_selected')
  const set = Math.max(0, ...existing.map((a) => a.generation_set)) + 1
  if (set > ADVENTURE_RULES.maxGenerationSets) throw new HttpError(429, 'generation_limit_reached')

  // request_key = 여행/날짜/세트 번호
  const requestId = await claimAgentRequest(db, {
    userId,
    tripId,
    requestType: 'GENERATE_ADVENTURES',
    requestKey: `GENERATE_ADVENTURES:${tripId}:${adventureDate}:${set}`,
    payload: { tripId, adventureDate, generationSet: set, travelRange },
  })

  try {
    const { context, origin, facts, visits } = await buildAgentContext({ db, userId, trip, adventureDate, travelRange })
    const { places: gathered, source: placesSource } = await gatherCandidates({
      origin,
      radius: TRAVEL_RANGE_RADIUS_M[travelRange],
      visits, // 이번 여행 방문지는 제외, 과거 방문지는 뒤로
    })
    // 마지막 날: 공항 반대 방향으로 깊게 들어가는 후보를 빼고 공항에 가까운 순으로 정렬한다. (Final Quest 와 별개인 "마지막 날 모험"의 선호 규칙)
    const lastDay = adventureDate === trip.end_date
    const candidates = lastDay ? convergeCandidates(gathered, { origin, minCount: ADVENTURE_RULES.count }) : gathered
    if (lastDay) context.finalDayRoute = { towardAirport: true, airport: JEJU_AIRPORT }
    if (candidates.length < ADVENTURE_RULES.count) throw new HttpError(422, 'not_enough_candidates')

    // Agent 호출. 실패(키 없음/오류/검증 실패)하면 Demo Adventure 로 대체한다.
    let source = 'openai'
    let fallbackReason = null
    let drafts
    let usages = []
    try {
      const result = await askAdventureAgent(context, candidates)
      drafts = result.adventures
      usages = result.usages
    } catch (error) {
      console.error('[agent] GENERATE_ADVENTURES 실패, Demo Adventure 로 대체', error.message)
      usages = error.usages ?? []
      source = 'demo'
      fallbackReason = error.message
      drafts = buildDemoAdventures(candidates)
    }

    const byId = new Map(candidates.map((place) => [place.placeId, place]))
    const rows = drafts.map((draft) => ({
      user_id: userId,
      trip_id: tripId,
      adventure_date: adventureDate,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      travel_range: travelRange,
      status: 'proposed',
      generation_set: set,
      data: {
        source,
        demo: source === 'demo',
        areas: draft.areas,
        categories: draft.categories,
        places: draft.recommendedPlaceIds.map((id) => byId.get(id)),
        facts: { places: placesSource, ...facts },
      },
    }))
    const { data: adventures, error: insertError } = await db.from('jeju_adventures').insert(rows).select('*')
    if (insertError) throw insertError

    await logUsages(db, { userId, requestId, usages })
    await finishAgentRequest(db, requestId, {
      status: source === 'openai' ? 'success' : 'fallback',
      response: { adventureIds: adventures.map((a) => a.id), source, fallbackReason },
      error: fallbackReason,
    })

    // meta: Agent Log(결정 요약)용 개수 — 후보를 몇 개 모았고 몇 개로 정리했는지. raw 데이터는 싣지 않는다.
    return { source, generationSet: set, fallbackReason, adventures, meta: { gathered: gathered.length, candidates: candidates.length, places: placesSource } }
  } catch (error) {
    await finishAgentRequest(db, requestId, { status: 'failed', error: error.message })
    throw error
  }
}

// 모험 선택: 같은 날 이미 선택된 모험이 없을 때만 'selected' 로 바꾼다.
export async function selectAdventure({ user, adventureId }) {
  const db = getAdmin()
  const { data: adventure, error } = await db.from('jeju_adventures').select('*').eq('id', adventureId).eq('user_id', user.id).maybeSingle()
  if (error) throw error
  if (!adventure) throw new HttpError(404, 'adventure_not_found')
  if (adventure.status !== 'proposed') throw new HttpError(409, 'already_selected')

  const { data: others, error: othersError } = await db
    .from('jeju_adventures')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('trip_id', adventure.trip_id)
    .eq('adventure_date', adventure.adventure_date)
    .neq('status', 'proposed')
  if (othersError) throw othersError
  if (others.length) throw new HttpError(409, 'already_selected')

  const { data: updated, error: updateError } = await db
    .from('jeju_adventures')
    .update({ status: 'selected' })
    .eq('id', adventureId)
    .eq('status', 'proposed')
    .select('*')
    .single()
  if (updateError) throw updateError
  return updated
}
