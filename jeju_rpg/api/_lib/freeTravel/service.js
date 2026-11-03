import { assertNoFinalQuest } from '../finalQuest/service.js'
import {
  FREE_VISIT_MAX_PER_SAVE,
  ROUTE_MAX_POINTS,
} from '../../../src/constants/locationRules.js'
import { cleanRoute, judgeCandidateVisit, judgeManualVisit } from '../../../src/utils/freeTravel/routeAnalysis.js'
import { isLatLng } from '../../../src/utils/geo.js'
import { HttpError } from '../http.js'
import { getExpSnapshot, levelUpsSince, recordPlaceDiscovery } from '../progression/exp.js'
import { checkTitleUnlocks } from '../progression/titles.js'
import { getAdmin } from '../supabaseAdmin.js'
import { verifyPlaces } from './places.js'

// 자유여행 서버 로직. 시작/종료와 방문 확정만 서버가 기록한다. (EXP/발견은 기존 progression 경로를 그대로 쓴다)
//
// 상태 흐름
//   quest ──(시작 확인 모달)──▶ free  : 세션 생성(status=active) + trips.travel_mode='free'. 모험(adventure)은 active 그대로,
//                                        챕터/퀘스트/진행 정보는 하나도 바뀌지 않는다. (자유여행 중에는 퀘스트 완료/챕터 이동만 서버가 막는다)
//   free  ──(종료 확인 → 방문 후보 일괄 확인)──▶ quest : 선택한 방문 저장 → trips.travel_mode='quest' → 세션 ended
//
// 위치 개인정보: 이동 경로(좌표)는 저장하지 않는다. 방문 검증에 필요한 순간에만 요청 body 로 받아 메모리에서 쓰고 버린다.
//   DB 에는 방문(place_visits), 발견(place_discoveries), 세션 요약(숫자)만 남는다.

async function one(query, notFound) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, notFound)
  return data
}

async function setTravelMode(db, { userId, tripId, mode }) {
  const { error } = await db.from('jeju_trips').update({ travel_mode: mode }).eq('id', tripId).eq('user_id', userId)
  if (error) throw error
}

// 자유여행 시작. 이미 진행 중인 세션이 있으면 그 세션을 그대로 돌려준다. (더블 클릭/다른 탭 대비, 멱등)
export async function startFreeTravel({ user, adventureId, db = getAdmin() }) {
  const userId = user.id

  const adventure = await one(db.from('jeju_adventures').select('id, trip_id, status').eq('id', adventureId).eq('user_id', userId), 'adventure_not_found')
  if (adventure.status !== 'active') throw new HttpError(409, 'adventure_not_active')
  await assertNoFinalQuest(db, { userId, tripId: adventure.trip_id }) // Final Quest 중에는 새 자유여행을 시작할 수 없다

  const findActive = async () => {
    const { data, error } = await db.from('jeju_free_sessions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle()
    if (error) throw error
    return data
  }

  let session = await findActive()
  const alreadyActive = Boolean(session)
  if (!session) {
    const { data, error } = await db
      .from('jeju_free_sessions')
      .insert({ user_id: userId, trip_id: adventure.trip_id, adventure_id: adventure.id })
      .select('*')
      .single()
    if (error) {
      if (error.code !== '23505') throw error
      session = await findActive() // 동시에 시작된 세션
    } else {
      session = data
    }
  }
  // 세션만 만들어지고 travel_mode 갱신이 끊겼어도 다시 시작하면 바로잡힌다.
  await setTravelMode(db, { userId, tripId: session.trip_id, mode: 'free' })
  return { session, alreadyActive }
}

const clampNumber = (value, max) => (Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), max)) : 0)

// 자유여행 종료 + 방문 확정.
//   visits: [{ placeId, lat, lng, source: 'candidate' | 'manual' }]  사용자가 "방문한 장소 저장"에서 체크한 장소만
//   route : [{ lat, lng, t }]  자유여행 동안의 이동 경로(저장하지 않고 이 요청의 검증에만 쓴다)
// 장소의 이름/좌표는 클라이언트 값을 믿지 않고 TourAPI 조회 결과로 다시 확인한다. (임의 장소로 발견 EXP 를 받는 것 방지)
// 방문 근거(evidence)
//   candidate → 경로에서 체류(FREE_VISIT_DWELL_MINUTES)가 확인되면 gps
//   manual    → 경로가 충분하면 경로 근처일 때만(route), 경로가 부족하면 방문만 저장(none)
// 발견 EXP 는 evidence 가 gps/route 일 때만 지급한다. (none 은 방문 기록만)
export async function finishFreeTravel({ user, sessionId, visits = [], route = [], candidatesSeen = 0, db = getAdmin() }) {
  const userId = user.id

  const session = await one(db.from('jeju_free_sessions').select('*').eq('id', sessionId).eq('user_id', userId), 'free_session_not_found')
  if (!Array.isArray(visits) || visits.length > FREE_VISIT_MAX_PER_SAVE) throw new HttpError(400, 'visits_invalid')
  if (!Array.isArray(route) || route.length > ROUTE_MAX_POINTS * 2) throw new HttpError(400, 'route_invalid')

  // 이미 종료된 세션을 다시 종료하려는 요청(재전송). 방문은 세션당 장소별 UNIQUE 라서 중복 저장되지 않고, 여행 모드만 확실히 되돌린다.
  const alreadyEnded = session.status === 'ended'
  const points = cleanRoute(route)

  // 같은 장소는 한 번만. 사용자가 고른 근거(source)는 candidate 가 우선한다.
  const wanted = new Map()
  for (const visit of visits) {
    if (typeof visit?.placeId !== 'string' || !visit.placeId || !isLatLng(visit)) throw new HttpError(400, 'visits_invalid')
    if (visit.source !== 'candidate' && visit.source !== 'manual') throw new HttpError(400, 'visits_invalid')
    const prev = wanted.get(visit.placeId)
    if (!prev || visit.source === 'candidate') wanted.set(visit.placeId, visit)
  }

  const before = await getExpSnapshot(db, userId)
  const verified = await verifyPlaces([...wanted.values()])

  const saved = []
  const rejected = []
  const discoveries = []
  const sessionStart = new Date(session.started_at).getTime()

  for (const visit of wanted.values()) {
    const place = verified.get(visit.placeId)
    if (!place) {
      rejected.push({ placeId: visit.placeId, code: 'place_not_verified' })
      continue
    }
    const judged = visit.source === 'candidate' ? judgeCandidateVisit(place, points) : judgeManualVisit(place, points)
    if (!judged.ok) {
      rejected.push({ placeId: visit.placeId, placeName: place.name, code: judged.code })
      continue
    }

    const { error } = await db.from('jeju_place_visits').insert({
      user_id: userId,
      trip_id: session.trip_id,
      place_id: place.placeId,
      place_name: place.name,
      visit_source: visit.source === 'candidate' ? 'gps' : 'manual',
      evidence: judged.evidence,
      place_lat: place.lat,
      place_lng: place.lng,
      free_session_id: session.id,
      visited_at: new Date(Math.max(sessionStart, Math.min(Number(visit.visitedAt) || Date.now(), Date.now()))).toISOString(),
    })
    // 이미 저장된 방문(재전송)이면 건너뛰고 발견만 이어서 확인한다. (발견은 평생 1회라 중복 지급되지 않는다)
    if (error && error.code !== '23505') throw error

    let discovery = null
    if (judged.evidence !== 'none') discovery = await recordPlaceDiscovery(db, { userId, placeId: place.placeId, placeName: place.name })
    if (discovery) discoveries.push(discovery)
    saved.push({ placeId: place.placeId, placeName: place.name, evidence: judged.evidence, discovery: Boolean(discovery) })
  }

  await setTravelMode(db, { userId, tripId: session.trip_id, mode: 'quest' })
  if (!alreadyEnded) {
    const { error } = await db
      .from('jeju_free_sessions')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        summary: { visitsSaved: saved.length, candidatesSeen: clampNumber(candidatesSeen, 200), routePoints: points.length },
      })
      .eq('id', session.id)
      .eq('status', 'active')
    if (error) throw error
  }

  const levelUps = await levelUpsSince(db, userId, before)
  const titles = await checkTitleUnlocks(db, { userId, trigger: 'free_travel', data: { visits: saved.length, levelUps } })
  return { alreadyEnded, saved, rejected, rewards: { discoveries, levelUps, titles } }
}
