import { assertNoFinalQuest } from '../finalQuest/service.js'
import { QUEST_RULES } from '../../../src/constants/gameBalance.js'
import { JEJU_AIRPORT } from '../../../src/constants/jeju.js'
import { isLatLng } from '../../../src/utils/geo.js'
import { fitToAirportReach, orderChaptersTowardAirport } from '../../../src/utils/lastDay.js'
import { createTravelBudget, travelBetween } from './travelTime.js'
import { HttpError } from '../http.js'
import { getAdmin } from '../supabaseAdmin.js'
import { gatherAroundAnchors } from './candidates.js'
import { buildAgentContext } from './context.js'
import { claimAgentRequest, finishAgentRequest, logUsages } from './requests.js'
import { askQuestAgent, buildDemoQuests } from './quests.js'
import { buildQuestRow } from './questRows.js'
import { buildNearbyIndex } from './walkability.js'

// GENERATE_QUESTS: 선택한 모험 1개당 1회. 메인 1 + 챕터 2~4 + 챕터별 핵심 1 / 선택 pool 4~5.
// 선택 pool 중 초기 공개분을 뺀 나머지는 is_hidden 으로 저장해 두고, "퀘스트 더 받기"에서 AI 재호출 없이 공개한다.
export async function generateQuests({ user, adventureId }) {
  const db = getAdmin()
  const userId = user.id

  const { data: adventure, error } = await db.from('jeju_adventures').select('*').eq('id', adventureId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!adventure) throw new HttpError(404, 'adventure_not_found')
  if (adventure.status !== 'selected') throw new HttpError(409, adventure.status === 'proposed' ? 'adventure_not_selected' : 'already_generated')

  const { count, error: countError } = await db.from('jeju_chapters').select('id', { count: 'exact', head: true }).eq('adventure_id', adventureId)
  if (countError) throw countError
  if (count > 0) throw new HttpError(409, 'already_generated')

  const { data: trip, error: tripError } = await db.from('jeju_trips').select('*').eq('id', adventure.trip_id).eq('user_id', userId).maybeSingle()
  if (tripError) throw tripError
  if (!trip) throw new HttpError(404, 'trip_not_found')
  await assertNoFinalQuest(db, { userId, tripId: trip.id })

  // request_key = 모험 id → 선택한 모험당 1회
  const requestId = await claimAgentRequest(db, {
    userId,
    tripId: trip.id,
    adventureId,
    requestType: 'GENERATE_QUESTS',
    requestKey: `GENERATE_QUESTS:${adventureId}`,
    payload: { adventureId },
  })

  try {
    const { context, facts, visits } = await buildAgentContext({
      db,
      userId,
      trip,
      adventureDate: adventure.adventure_date,
      travelRange: adventure.travel_range ?? 'normal',
    })

    // corePool: 모험의 장소(= anchor 후보) / extraPool: 그 주변의 추가 후보 (둘 다 서버가 준비한 사실 데이터)
    const corePool = adventure.data?.places ?? []
    if (corePool.length < QUEST_RULES.chapters.min) throw new HttpError(422, 'not_enough_places')
    const extraPool = await gatherAroundAnchors({
      anchors: corePool,
      visits,
      radius: QUEST_RULES.walkMaxMeters, // 각 anchor 의 도보 범위 안에서만 추가 후보를 모은다
      excludeIds: corePool.map((p) => p.placeId),
      limit: QUEST_RULES.extraPlaceCount,
    })

    // anchor 마다 "걸어서 갈 만한 범위(지금은 직선거리 기준)" 안의 장소만 골라서 Agent 에 전달하고, 검증에도 같은 목록을 쓴다.
    const nearby = buildNearbyIndex(corePool, [...corePool, ...extraPool])
    // 검증(validateQuests)도 프롬프트와 같은 "오늘의 실제 동행자"(일일 조건)를 기준으로 한다. 여행 기본 동행자(trip.companion)가 아니다.
    const input = { context, adventure, corePool, extraPool, nearby, companion: context.companion }

    let source = 'openai'
    let fallbackReason = null
    let plan
    let usages = []
    try {
      const result = await askQuestAgent(input)
      plan = result.quests
      usages = result.usages
    } catch (agentError) {
      console.error('[agent] GENERATE_QUESTS 실패, Demo Quests 로 대체', agentError.message)
      usages = agentError.usages ?? []
      source = 'demo'
      fallbackReason = agentError.message
      plan = buildDemoQuests(input)
    }

    const placeById = new Map([...corePool, ...extraPool].map((p) => [p.placeId, p]))
    // 마지막 날: 챕터가 갈수록 공항에 가까워지게 순서를 맞추고, 마지막 챕터 → 공항이 60분을 넘으면 일정을 줄인다.
    let lastDayInfo = null
    if (adventure.adventure_date === trip.end_date) {
      const arranged = await arrangeLastDay({ plan, placeById, transport: trip.transport })
      plan = arranged.plan
      lastDayInfo = arranged.info
    }
    const saved = await saveQuestPlan(db, { userId, adventure, plan, placeById, source })

    await db.from('jeju_adventures').update({ status: 'active' }).eq('id', adventureId).eq('status', 'selected')
    await logUsages(db, { userId, requestId, usages })
    await finishAgentRequest(db, requestId, {
      status: source === 'openai' ? 'success' : 'fallback',
      response: { chapterIds: saved.chapters.map((c) => c.id), source, fallbackReason, facts, lastDay: lastDayInfo },
      error: fallbackReason,
    })
    return { source, fallbackReason, ...saved }
  } catch (caught) {
    await finishAgentRequest(db, requestId, { status: 'failed', error: caught.message })
    throw caught
  }
}

// 마지막 날 일정 정리. 챕터 순서(공항 방향) → 마지막 챕터 핵심 장소 → 공항 이동시간(NAVER Directions 1회 / 실패 시 보수적 추정) → 60분 초과면 단축.
async function arrangeLastDay({ plan, placeById, transport }) {
  const placeOf = (chapter) => placeById.get(chapter.corePlaceId) ?? null
  const ordered = orderChaptersTowardAirport(plan.chapters, placeOf)
  const last = placeOf(ordered[ordered.length - 1])
  let lastTravelMinutes = null
  if (isLatLng(last)) {
    try {
      lastTravelMinutes = (await travelBetween({ from: last, to: JEJU_AIRPORT, transport, budget: createTravelBudget(1) })).minutes
    } catch (error) {
      console.warn('[agent] 마지막 챕터 → 공항 이동시간 계산 실패', error.message)
    }
  }
  const fit = fitToAirportReach(ordered, { lastTravelMinutes, minChapters: QUEST_RULES.chapters.min })
  return { plan: { ...plan, chapters: fit.chapters }, info: { reordered: true, shortened: fit.shortened, lastTravelMinutes } }
}

async function saveQuestPlan(db, { userId, adventure, plan, placeById, source }) {
  const base = { adventure_id: adventure.id, user_id: userId }
  try {
    const { data: chapters, error: chapterError } = await db
      .from('jeju_chapters')
      .insert(
        plan.chapters.map((chapter, i) => ({
          ...base,
          seq: i + 1,
          title: chapter.title.trim(),
          summary: chapter.summary.trim(),
          status: i === 0 ? 'active' : 'locked',
          activated_at: i === 0 ? new Date().toISOString() : null, // 일정 지연/앞당김 판단용 (010 migration)
          data: { source, corePlaceId: chapter.corePlaceId, optionalPlaceIds: chapter.optionalPlaceIds },
        })),
      )
      .select('*')
    if (chapterError) throw chapterError
    const chapterBySeq = new Map(chapters.map((c) => [c.seq, c]))

    const questRow = (quest, { chapter, type, seq, hidden }) => buildQuestRow({ base, quest, chapter, type, seq, hidden, placeById, source })

    const rows = [
      questRow({ ...plan.mainQuest, difficulty: 'normal', verificationType: 'self' }, { chapter: null, type: 'main', seq: 1, hidden: false }),
    ]
    plan.chapters.forEach((chapter, i) => {
      const row = chapterBySeq.get(i + 1)
      rows.push(questRow({ ...chapter.coreQuest, placeId: chapter.corePlaceId }, { chapter: row, type: 'core', seq: 1, hidden: false }))
      chapter.optionalQuests.forEach((quest, j) => {
        rows.push(questRow(quest, { chapter: row, type: 'optional', seq: j + 2, hidden: j >= QUEST_RULES.initialVisibleOptional }))
      })
    })

    const { data: quests, error: questError } = await db.from('jeju_quests').insert(rows).select('*')
    if (questError) throw questError
    return { chapters, quests }
  } catch (error) {
    // 일부만 저장된 채로 남지 않게 되돌린다.
    await db.from('jeju_quests').delete().eq('adventure_id', adventure.id)
    await db.from('jeju_chapters').delete().eq('adventure_id', adventure.id)
    throw error
  }
}
