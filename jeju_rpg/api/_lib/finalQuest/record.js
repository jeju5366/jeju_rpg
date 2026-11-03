import { EXP_CATEGORY_KEYS, levelsOf } from '../../../src/utils/level.js'
import { HttpError } from '../http.js'
import { getAdmin } from '../supabaseAdmin.js'

// 여행 기록 조립. 요약 수치는 따로 저장하지 않고, 이미 있는 표(퀘스트/진행/방문/발견/EXP 로그/사진/피드백/REPLAN 요청)에서 읽어 만든다.
// Trip Summary(간단)와 상세 기록 화면이 같은 결과를 쓰고, 화면이 필요한 부분만 골라 보여준다.
// 여행에 쓴 EXP / 레벨 변화는 "여행을 만든 시각 ~ 마무리 시각" 사이의 exp_logs 합계로 계산한다.

const one = async (query, notFound) => {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, notFound)
  return data
}
const rows = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export function countDays(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
}

// 퀘스트/진행/방문/발견 → 통계 (순수 함수)
export function computeTripStats({ quests, progress, visits, discoveries }) {
  const status = new Map(progress.map((p) => [p.quest_id, p.status]))
  const live = quests.filter((q) => ['core', 'optional', 'surprise'].includes(q.quest_type) && !q.replaced_at)
  const completed = live.filter((q) => status.get(q.id) === 'completed')
  const byType = (type) => completed.filter((q) => q.quest_type === type).length
  const categoryQuests = {}
  for (const q of completed) {
    const category = q.category_primary ?? q.category ?? 'explore'
    categoryQuests[category] = (categoryQuests[category] ?? 0) + 1
  }
  return {
    completedQuests: completed.length,
    core: byType('core'),
    optional: byType('optional'),
    surprise: byType('surprise'),
    // 여행 종료로 마감된 퀘스트: 실패가 아니다. 완료/실패 통계에 넣지 않고 따로 센다.
    endedByFinalQuest: live.filter((q) => status.get(q.id) === 'ended_by_final_quest').length,
    visitedPlaces: new Set(visits.map((v) => v.place_id)).size,
    discoveries: discoveries.length,
    categoryQuests,
  }
}

// 여행 시작 전/종료 후 카테고리별 누적 EXP. 과거 기록은 시간이 지나도 변하면 안 되므로 "지금의 profile EXP 에서 이번 여행 몫을 빼는" 방식은 쓰지 않는다.
//   1) 마무리 때 저장한 스냅샷(trips.exp_snapshot { before, after })이 있으면 그대로 쓴다. (가장 확실)
//   2) 없으면(스냅샷 도입 전에 끝난 여행/아직 진행 중인 여행) exp_logs 로 "여행 종료 시점"을 복원한다:
//        종료 후 EXP = 지금 EXP − (종료 이후에 쌓인 로그), 시작 전 EXP = 종료 후 EXP − (여행 기간 로그).
//      이후 다른 여행에서 얻은 EXP 는 종료 이후 로그라서 결과에 영향을 주지 않는다. (진행 중인 여행은 종료 시각이 없어 지금 값)
const zeroExps = () => Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, 0]))
export function resolveExpRange({ snapshot = null, allLogs = [], trip, currentExps }) {
  if (snapshot?.before && snapshot?.after) return { before: snapshot.before, after: snapshot.after, source: 'snapshot' }
  const end = trip.completed_at ?? null
  const afterEnd = zeroExps()
  const inWindow = zeroExps()
  for (const log of allLogs) {
    if (!log.category || !(log.category in inWindow)) continue
    if (end && log.created_at > end) afterEnd[log.category] += log.amount
    else if (log.created_at >= trip.created_at) inWindow[log.category] += log.amount
  }
  const after = Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, Math.max(0, (currentExps[key] ?? 0) - afterEnd[key])]))
  const before = Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, Math.max(0, after[key] - inWindow[key])]))
  return { before, after, source: 'logs' }
}

// 여행 기간 EXP(logs: 기간 안의 로그) + 시작 전/종료 후 EXP → 총 EXP / 카테고리별 레벨 변화 (기존 level curve 재사용)
export function computeExpChanges({ logs, before, after }) {
  const gained = zeroExps()
  let total = 0
  for (const log of logs) {
    total += log.amount
    if (log.category && log.category in gained) gained[log.category] += log.amount
  }
  const levelsBefore = levelsOf(before)
  const levelsAfter = levelsOf(after)
  const levelChanges = EXP_CATEGORY_KEYS.filter((key) => gained[key] > 0).map((category) => ({
    category,
    gained: gained[category],
    from: levelsBefore[category].level,
    to: levelsAfter[category].level,
  }))
  return { totalExp: total, expByCategory: gained, levelChanges, before, after }
}

// → 여행 기록 전체. 본인 여행만 읽는다.
export async function buildTripRecord(db = getAdmin(), { userId, tripId, now = Date.now() }) {
  const trip = await one(db.from('jeju_trips').select('*').eq('id', tripId).eq('user_id', userId), 'trip_not_found')
  const adventures = await rows(db.from('jeju_adventures').select('id, adventure_date, title, status').eq('trip_id', tripId).eq('user_id', userId))
  const adventureIds = adventures.filter((a) => a.status !== 'proposed').map((a) => a.id)

  const [quests, visits, photos, feedbackRows, titleLinks, requests, finalRows, profile] = await Promise.all([
    adventureIds.length ? rows(db.from('jeju_quests').select('*').in('adventure_id', adventureIds).eq('user_id', userId)) : [],
    rows(db.from('jeju_place_visits').select('place_id, place_name, visited_at, quest_id').eq('trip_id', tripId).eq('user_id', userId)),
    rows(db.from('jeju_travel_photos').select('id, quest_id, storage_path, caption, place_id, created_at').eq('trip_id', tripId).eq('user_id', userId).eq('is_memory', true)),
    rows(db.from('jeju_feedback').select('*').eq('trip_id', tripId).eq('user_id', userId)),
    rows(db.from('jeju_user_titles').select('title_id, earned_at').eq('trip_id', tripId).eq('user_id', userId)),
    rows(db.from('jeju_agent_requests').select('request_type, status, created_at, response_payload').eq('trip_id', tripId).eq('user_id', userId).eq('request_type', 'REPLAN_ADVENTURE')),
    rows(db.from('jeju_final_quests').select('*').eq('trip_id', tripId).eq('user_id', userId)),
    one(db.from('jeju_profiles').select('*').eq('id', userId), 'profile_not_found'),
  ])
  const questIds = quests.map((q) => q.id)
  const progress = questIds.length ? await rows(db.from('jeju_quest_progress').select('quest_id, status, verification_method, completed_at').in('quest_id', questIds).eq('user_id', userId)) : []

  // 발견: 이번 여행에서 방문한 장소 중, 여행을 만든 뒤 처음 발견한 곳
  const visitedIds = [...new Set(visits.map((v) => v.place_id))]
  const discoveries = visitedIds.length
    ? (await rows(db.from('jeju_place_discoveries').select('place_id, place_name, discovery_type, discovered_at').in('place_id', visitedIds).eq('user_id', userId))).filter((d) => d.discovered_at >= trip.created_at)
    : []

  const titleIds = titleLinks.map((l) => l.title_id)
  const titles = titleIds.length ? (await rows(db.from('jeju_titles').select('id, code, name').in('id', titleIds))).map((t) => ({ code: t.code, name: t.name })) : []

  const allLogs = await rows(db.from('jeju_exp_logs').select('category, amount, created_at').eq('user_id', userId))
  const logs = allLogs.filter((l) => l.created_at >= trip.created_at && (!trip.completed_at || l.created_at <= trip.completed_at))
  const currentExps = Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, profile[`exp_${key}`] ?? 0]))

  const stats = computeTripStats({ quests, progress, visits, discoveries })
  const range = resolveExpRange({ snapshot: trip.exp_snapshot, allLogs, trip, currentExps })
  const exp = computeExpChanges({ logs, before: range.before, after: range.after })
  const tripFeedback = feedbackRows.find((f) => !f.quest_id && !f.adventure_id) ?? null
  const surpriseQuests = quests.filter((q) => q.quest_type === 'surprise' && !q.replaced_at)

  return {
    trip: {
      id: trip.id,
      startDate: trip.start_date,
      endDate: trip.end_date,
      days: countDays(trip.start_date, trip.end_date),
      status: trip.status,
      completedAt: trip.completed_at ?? null,
      retrospective: trip.retrospective ?? null,
      retrospectiveSource: trip.retrospective_source ?? null,
    },
    stats: { ...stats, totalExp: exp.totalExp },
    exp,
    places: visits.map((v) => ({ placeId: v.place_id, name: v.place_name, visitedAt: v.visited_at })).sort((a, b) => String(a.visitedAt).localeCompare(String(b.visitedAt))),
    discoveries: discoveries.map((d) => ({ placeId: d.place_id, name: d.place_name, type: d.discovery_type })),
    photos: photos.map((p) => ({ id: p.id, questId: p.quest_id, storagePath: p.storage_path, caption: p.caption ?? null })),
    titles,
    feedback: tripFeedback
      ? { rating: tripFeedback.rating, density: tripFeedback.density, placesRating: tripFeedback.places_rating, difficulty: tripFeedback.difficulty, comment: tripFeedback.comment }
      : null,
    // REPLAN 실행 기록(성공한 요청). Surprise 는 수락/거절 기록.
    replanLog: requests.filter((r) => r.status === 'success' || r.status === 'fallback').map((r) => ({ at: r.created_at, reason: r.response_payload?.reason ?? null })),
    surpriseLog: {
      accepted: surpriseQuests.filter((q) => q.surprise_status === 'accepted').length,
      declined: surpriseQuests.filter((q) => q.surprise_status === 'declined').length,
      items: surpriseQuests.map((q) => ({ title: q.title, status: q.surprise_status })),
    },
    finalQuest: finalRows[0] ? { status: finalRows[0].status, arrivedAt: finalRows[0].arrived_at } : null,
    generatedAt: new Date(now).toISOString(),
  }
}

// 지난 여행 목록 (Profile 탭). 가벼운 요약만: 기간 / 상태 / 완료 퀘스트 수 / 총 EXP 는 상세에서만 계산한다.
export async function listPastTrips(db = getAdmin(), { userId }) {
  const trips = await rows(db.from('jeju_trips').select('id, start_date, end_date, status, completed_at').eq('user_id', userId).eq('status', 'completed'))
  return trips
    .sort((a, b) => String(b.completed_at ?? b.end_date).localeCompare(String(a.completed_at ?? a.end_date)))
    .map((t) => ({ id: t.id, startDate: t.start_date, endDate: t.end_date, days: countDays(t.start_date, t.end_date), completedAt: t.completed_at }))
}
