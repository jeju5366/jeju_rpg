import {
  ALLOW_FINAL_QUEST_EXTRAS,
  AIRPORT_ARRIVAL_RADIUS_M,
  FINAL_QUEST_CACHE,
  FINAL_QUEST_POSITION_MAX_AGE_MS,
} from '../../../src/constants/finalQuestRules.js'
import { JEJU_AIRPORT } from '../../../src/constants/jeju.js'
import { GPS_FUTURE_TOLERANCE_MS } from '../../../src/constants/locationRules.js'
import { isLatLng } from '../../../src/utils/geo.js'
import { computeSafeTimes, finalQuestPhase, flightKind, interpretFlight, treatAsInternational } from '../../../src/utils/finalQuest.js'
import { evaluateGpsProof } from '../../../src/utils/gps.js'
import { createTravelBudget, travelBetween } from '../agent/travelTime.js'
import { HttpError } from '../http.js'
import { awardFinalCompletion } from '../progression/exp.js'
import { checkTitleUnlocks } from '../progression/titles.js'
import { getAirportCongestion, getFlightStatus } from '../providers/airport.js'
import { getAdmin } from '../supabaseAdmin.js'
import { buildTripRecord } from './record.js'
import { writeRetrospective } from './retrospective.js'

// Final Quest = 여행의 "마지막 이벤트"(공항 이동 → 공항 도착 확인 → 여행 마무리). 마지막 날 전체 일정이 아니다.
//
// 상태 흐름 (jeju_final_quests.status)
//   (행 없음)  ── latestSafeDeparture 도달 / 코드가 "일반 퀘스트는 위험"이라고 판단 ──▶ active   (공항 이동 안내 카드, 일반 모험 종료)
//   active ──[공항으로 이동 시작]──▶ moving ──[공항 500m GPS 도착 확인, +100 EXP]──▶ arrived ──[여행 마무리]──▶ finished (trips.status='completed')
//   flight_state(normal | delayed | cancelled | unknown)는 status 와 따로 저장한다. 결항(cancelled)이면 화면 상태는 flight_cancelled 이고
//   공항 이동을 강제하지 않으며 자동 종료도 하지 않는다. 항공편 정보를 고치고 다시 평가하면 원래 흐름으로 돌아온다.
//
// 안전 시간은 항상 코드(src/utils/finalQuest.js)가 계산한다. GPT/Agent 는 항공편/이동시간/혼잡도를 추측하거나 안전 시간을 바꿀 수 없다.
// 외부 API(항공편/혼잡도/Directions) 실패는 Final Quest 를 막지 않는다. (항공편 → setup 출발 시각 / 혼잡도 → 보정 0 / Directions → 보수적 추정)
// 단, 공식 결항은 별도 상태다.

const KST_MS = 9 * 3600 * 1000
const pad = (n) => String(n).padStart(2, '0')
const kstParts = (ms) => {
  const d = new Date(ms + KST_MS)
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, ymd: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` }
}
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)

async function one(query, notFound) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, notFound)
  return data
}

// ───────── 외부 조회 (TTL 캐시, 마지막 날 평가에서만 부른다) ─────────
const cache = new Map()
export const _clearFinalQuestCache = () => cache.clear() // 테스트용
async function cached(key, ttlMs, now, load) {
  const hit = cache.get(key)
  if (hit && now - hit.at < ttlMs) return hit.value
  const value = await load()
  cache.set(key, { at: now, value })
  return value
}

const defaultDeps = { getFlightStatus, getAirportCongestion, travelBetween }

// 항공편: 조회 실패/못 찾음 → setup 출발 시각. 반환 { state, departureAtMs, arrivalAirportCode, source, ... }
async function loadFlight(trip, { now, deps, refresh }) {
  const fallbackDepartureMs = trip.departure_datetime ? Date.parse(trip.departure_datetime) : null
  const flightNo = String(trip.departure_flight ?? '').replace(/\s+/g, '').toUpperCase()
  if (!flightNo || !/^[A-Z0-9]{2,3}\d{1,4}$/.test(flightNo)) return { ...interpretFlight(null, { fallbackDepartureMs }), flightNo: flightNo || null }
  const day = Number.isFinite(fallbackDepartureMs) ? kstParts(fallbackDepartureMs).ymd : kstParts(now).ymd
  const key = `flight:${flightNo}:${day}`
  if (refresh) cache.delete(key)
  try {
    const result = await cached(key, FINAL_QUEST_CACHE.flightTtlMs, now, () => deps.getFlightStatus({ flightNo, date: day }))
    return { ...interpretFlight(result?.data, { flightNo, fallbackDepartureMs }), flightNo }
  } catch (error) {
    console.warn('[final-quest] 항공편 조회 실패, setup 출발 시각 사용', error.message)
    return { ...interpretFlight(null, { fallbackDepartureMs }), flightNo }
  }
}

// 혼잡도: 실패/없음 → null (보정 0)
async function loadCongestionLevel({ now, deps, refresh }) {
  const key = 'congestion:CJU'
  if (refresh) cache.delete(key)
  try {
    const result = await cached(key, FINAL_QUEST_CACHE.congestionTtlMs, now, () => deps.getAirportCongestion())
    const level = result?.data?.current?.overall?.value
    return Number.isFinite(Number(level)) ? Number(level) : null
  } catch (error) {
    console.warn('[final-quest] 혼잡도 조회 실패, 보정 0 사용', error.message)
    return null
  }
}

// 현재 위치 → 제주공항 이동시간. 위치가 없으면 지금 챕터의 핵심 장소를 출발지로 쓰고, 그것도 없으면 null (보수적 기본값을 쓴다).
async function loadTravelMinutes({ db, userId, trip, position, now, deps }) {
  let from = usablePosition(position, now) // 1) 최근의 유효한 사용자 GPS
  let origin = from ? 'gps' : null
  if (!from) {
    from = await currentAnchor(db, { userId, tripId: trip.id }) // 2) 현재 챕터 핵심 장소
    origin = from ? 'anchor' : null
  }
  if (!from) return { minutes: null, source: 'fallback', origin: 'fallback' } // 3) 보수적 기본값(60분)
  try {
    const result = await deps.travelBetween({ from, to: JEJU_AIRPORT, transport: trip.transport, budget: createTravelBudget(1), now })
    return { minutes: result.minutes, source: result.source, origin }
  } catch (error) {
    console.warn('[final-quest] 이동시간 계산 실패, 보수적 기본값 사용', error.message)
    return { minutes: null, source: 'fallback', origin: 'fallback' }
  }
}

// 클라이언트가 보낸 위치가 "지금 쓸 수 있는 위치"인지 서버가 다시 확인한다. 시각이 없거나 너무 오래됐으면(또는 미래면) 현재 위치로 쓰지 않는다.
export function usablePosition(position, now) {
  if (!isLatLng(position)) return null
  const timestamp = Number(position.timestamp)
  if (!Number.isFinite(timestamp)) return null
  const age = now - timestamp
  if (age > FINAL_QUEST_POSITION_MAX_AGE_MS || age < -GPS_FUTURE_TOLERANCE_MS) return null
  return { lat: position.lat, lng: position.lng }
}

async function currentAnchor(db, { userId, tripId }) {
  const { data: adventures, error } = await db.from('jeju_adventures').select('id, status').eq('trip_id', tripId).eq('user_id', userId)
  if (error) throw error
  const active = (adventures ?? []).find((a) => a.status === 'active')
  if (!active) return null
  const { data: chapters } = await db.from('jeju_chapters').select('id, seq, status').eq('adventure_id', active.id).eq('user_id', userId)
  const current = (chapters ?? []).filter((c) => c.status === 'active' || c.status === 'core_completed').sort((a, b) => a.seq - b.seq)[0]
  if (!current) return null
  const { data: quests } = await db.from('jeju_quests').select('place_lat, place_lng, quest_type').eq('chapter_id', current.id).eq('user_id', userId).eq('quest_type', 'core')
  const core = (quests ?? [])[0]
  return Number.isFinite(core?.place_lat) && Number.isFinite(core?.place_lng) ? { lat: core.place_lat, lng: core.place_lng } : null
}

// ───────── 잠금 ─────────
export async function getFinalQuestRow(db, { userId, tripId }) {
  const { data, error } = await db.from('jeju_final_quests').select('*').eq('trip_id', tripId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

// Final Quest 가 시작됐거나 여행이 끝났으면 일반 흐름(새 모험/퀘스트/REPLAN/Surprise/자유여행)을 막는다. (Final Quest 가 어떤 제안보다 우선한다)
export async function assertNoFinalQuest(db, { userId, tripId }) {
  const row = await getFinalQuestRow(db, { userId, tripId })
  if (row) throw new HttpError(409, 'final_quest_active')
}

// 돌발 퀘스트 gate: 활성화 뒤에는 막고, "공항 이동 준비" 구간(활성화 전 60분)에도 새 돌발은 만들지 않는다.
// 마지막 날이 아니면 외부 조회를 하지 않는다.
export async function assertFinalQuestGate(db, { userId, trip, kind = 'surprise', now = Date.now(), deps = {} }) {
  await assertNoFinalQuest(db, { userId, tripId: trip.id })
  if (kind !== 'surprise' || !trip.end_date || kstParts(now).date < trip.end_date) return
  const state = await computeState({ db, userId, trip, now, deps: { ...defaultDeps, ...deps }, activate: false })
  if (state.phase === 'notice' || state.phase === 'activate') throw new HttpError(409, 'final_quest_notice')
}

// ───────── 평가 ─────────
// 마지막 날(또는 그 이후)에만 외부 조회를 한다. row 가 이미 있으면 저장된 이동시간으로 안전 시간만 다시 계산한다. (Directions 재호출 없음)
async function computeState({ db, userId, trip, position = null, now, deps, refresh = false, activate = true }) {
  const row = await getFinalQuestRow(db, { userId, tripId: trip.id })
  const lastDay = Boolean(trip.end_date) && kstParts(now).date >= trip.end_date
  if (!row && !lastDay) return base(trip, { status: 'none', phase: 'none', lastDay })

  const flight = await loadFlight(trip, { now, deps, refresh })

  // 결항(공식): 별도 상태. 공항 이동을 강제하지 않고, 자동 종료도 하지 않는다.
  if (flight.state === 'cancelled') {
    const updated = row && row.flight_state !== 'cancelled' ? await patchRow(db, row.id, { flight_state: 'cancelled' }) : row
    return base(trip, { status: 'flight_cancelled', phase: 'none', lastDay, row: updated ?? row, flight, message: 'flight_cancelled' })
  }

  if (!Number.isFinite(flight.departureAtMs)) {
    return base(trip, { status: row ? row.status : 'needs_flight_info', phase: 'none', lastDay, row, flight })
  }

  const kind = flightKind(flight.arrivalAirportCode) // 확실한 국내선만 90분, 국제선/알 수 없음은 150분
  const international = treatAsInternational(kind)
  const congestionLevel = await loadCongestionLevel({ now, deps, refresh })
  const travel = row && Number.isFinite(row.safe?.travelMinutes) && !usablePosition(position, now) ? { minutes: row.safe.travelMinutes, source: row.safe.travelSource ?? 'stored', origin: row.safe.travelOrigin ?? 'stored' } : await loadTravelMinutes({ db, userId, trip, position, now, deps })
  const safe = computeSafeTimes({ departureAtMs: flight.departureAtMs, international, congestionLevel, travelMinutes: travel.minutes })
  const safeInfo = { ...safe, flightKind: kind, travelSource: travel.source, travelOrigin: travel.origin ?? null, congestionLevel, flightSource: flight.source }
  const phase = finalQuestPhase({ nowMs: now, latestSafeDeparture: safe.latestSafeDeparture })

  let current = row
  if (!current && activate && phase === 'activate') current = await activateFinalQuest(db, { userId, trip, flight, safeInfo, now })
  else if (current) {
    // 지연/혼잡 변화로 안전 시간이 바뀌면 기록을 갱신한다. 이미 공항으로 이동 중이면 일반 모험으로 되돌리지 않는다. (잠금은 그대로)
    const needsEnd = !current.ended_counts?.done
    const stateChanged = current.flight_state !== flight.state
    if (stateChanged || current.safe?.latestSafeDeparture !== safeInfo.latestSafeDeparture || needsEnd) {
      current = await patchRow(db, current.id, { flight_state: flight.state, safe: safeInfo })
    }
    if (needsEnd) current = await endNormalQuests(db, { userId, trip, row: current })
  }

  const status = current ? current.status : phase === 'none' ? 'none' : 'notice'
  return base(trip, { status, phase, lastDay, row: current, flight, safe: safeInfo })
}

function base(trip, { status, phase, lastDay, row = null, flight = null, safe = null, message = null }) {
  const departureAt = flight?.departureAtMs ?? null
  return {
    tripId: trip.id,
    status,
    phase,
    lastDay,
    message,
    finalQuestId: row?.id ?? null,
    locked: Boolean(row), // 일반 퀘스트/REPLAN/Surprise/자유여행 잠금
    noticeLock: phase === 'notice' || phase === 'activate', // 새 돌발/긴 선택 퀘스트 중단
    extrasAllowed: ALLOW_FINAL_QUEST_EXTRAS,
    flight: flight ? { state: flight.state, source: flight.source, flightNo: flight.flightNo ?? null, status: flight.status ?? null, delayMinutes: flight.delayMinutes ?? null, departureAt: iso(departureAt) } : null,
    safe: safe
      ? {
          departureAt: iso(safe.departureAt),
          arriveBy: iso(safe.arriveBy),
          arriveBeforeMinutes: safe.arriveBeforeMinutes,
          travelMinutes: safe.travelMinutes,
          travelSource: safe.travelSource,
          travelOrigin: safe.travelOrigin ?? null, // gps | anchor | fallback | stored
          congestionBufferMinutes: safe.congestionBufferMinutes,
          latestSafeDeparture: iso(safe.latestSafeDeparture),
          international: safe.international,
          flightKind: safe.flightKind ?? null,
        }
      : null,
    airport: { ...JEJU_AIRPORT, radiusMeters: AIRPORT_ARRIVAL_RADIUS_M },
    endedCounts: row?.ended_counts ?? null,
    startedAt: row?.started_at ?? null,
    arrivedAt: row?.arrived_at ?? null,
  }
}

async function patchRow(db, id, values) {
  const { data, error } = await db.from('jeju_final_quests').update(values).eq('id', id).select('*').maybeSingle()
  if (error) throw error
  return data
}

// Final Quest 시작: 행을 만들고(UNIQUE(trip_id) = 커밋 지점) 진행 중이던 일반 퀘스트를 "여행 종료로 마감" 처리한다.
async function activateFinalQuest(db, { userId, trip, flight, safeInfo, now, reason = 'safe_departure' }) {
  const { data, error } = await db
    .from('jeju_final_quests')
    .insert({ user_id: userId, trip_id: trip.id, status: 'active', flight_state: flight.state, activation_reason: reason, safe: safeInfo, ended_counts: {}, activated_at: iso(now) })
    .select('*')
    .single()
  let row = data
  if (error) {
    if (error.code !== '23505') throw error
    row = await getFinalQuestRow(db, { userId, tripId: trip.id }) // 동시에 시작된 활성화
  }
  return row.ended_counts?.done ? row : endNormalQuests(db, { userId, trip, row })
}

// 진행 중이던 일반 모험의 미완료 퀘스트를 ended_by_final_quest 로 마감한다. (실패가 아니다: 완료한 퀘스트/EXP/방문/발견/사진은 그대로)
// 여러 번 호출돼도 안전하다(이미 마감된 것은 건너뜀).
async function endNormalQuests(db, { userId, trip, row }) {
  const { data: adventures, error } = await db.from('jeju_adventures').select('id, status').eq('trip_id', trip.id).eq('user_id', userId)
  if (error) throw error
  const open = (adventures ?? []).filter((a) => ['selected', 'active', 'paused'].includes(a.status)).map((a) => a.id)
  if (open.length) {
    const { data: quests, error: questError } = await db.from('jeju_quests').select('id, quest_type, replaced_at, is_hidden, surprise_status').in('adventure_id', open).eq('user_id', userId)
    if (questError) throw questError
    const { data: progress, error: progressError } = await db.from('jeju_quest_progress').select('id, quest_id, status, verification_method').in('quest_id', (quests ?? []).map((q) => q.id)).eq('user_id', userId)
    if (progressError) throw progressError
    const progressOf = new Map((progress ?? []).map((p) => [p.quest_id, p]))

    // 답하지 않은 돌발 제안은 거절(불이익 없음)로 닫는다. Final Quest 가 우선한다.
    const offered = (quests ?? []).filter((q) => q.quest_type === 'surprise' && q.surprise_status === 'offered').map((q) => q.id)
    if (offered.length) {
      const { error: offerError } = await db.from('jeju_quests').update({ surprise_status: 'declined' }).in('id', offered)
      if (offerError) throw offerError
    }

    const unfinished = (quests ?? []).filter((q) => {
      if (!['core', 'optional', 'surprise'].includes(q.quest_type) || q.replaced_at || q.is_hidden) return false
      if (q.quest_type === 'surprise' && q.surprise_status !== 'accepted') return false
      const row = progressOf.get(q.id)
      // 완료 claim 이 이미 확정된 행(in_progress + verification_method)은 일반 완료가 진행 중이다. 마감하지 않는다.
      return !row || (row.status === 'in_progress' && !row.verification_method)
    })
    const fresh = unfinished.filter((q) => !progressOf.get(q.id))
    const started = unfinished.filter((q) => progressOf.get(q.id))
    if (fresh.length) {
      // 읽은 뒤~쓰기 전에 사용자의 일반 완료 요청이 progress 를 먼저 만들 수 있다. 일반 insert 는 unique 충돌 한 건에 배치 전체가 실패하므로,
      // upsert + ignoreDuplicates(ON CONFLICT (user_id, quest_id) DO NOTHING)로 "없는 것만" 만들고 이미 있는 행(완료 포함)은 그대로 둔다.
      const { error: insertError } = await db
        .from('jeju_quest_progress')
        .upsert(fresh.map((q) => ({ user_id: userId, quest_id: q.id, status: 'ended_by_final_quest' })), { onConflict: 'user_id,quest_id', ignoreDuplicates: true })
      if (insertError) throw insertError
    }
    if (started.length) {
      const { error: updateError } = await db.from('jeju_quest_progress').update({ status: 'ended_by_final_quest' }).in('id', started.map((q) => progressOf.get(q.id).id)).eq('status', 'in_progress').is('verification_method', null)
      if (updateError) throw updateError
    }

    const { error: chapterError } = await db.from('jeju_chapters').update({ status: 'ended_by_final_quest' }).in('adventure_id', open).in('status', ['locked', 'available', 'active', 'core_completed'])
    if (chapterError) throw chapterError
    const { error: adventureError } = await db.from('jeju_adventures').update({ status: 'ended_early' }).in('id', open)
    if (adventureError) throw adventureError
  }
  // 집계는 "마감하려고 시도한 수"가 아니라 DB 에 실제로 ended_by_final_quest 로 남은 퀘스트 수다.
  // (읽은 뒤 일반 완료가 claim 을 먼저 만들어 upsert 가 건너뛴 퀘스트, 이미 완료된 퀘스트는 포함되지 않는다. 다시 실행돼도 같은 값이 나온다.)
  const counts = await countEnded(db, { userId, adventureIds: (adventures ?? []).filter((a) => a.status !== 'proposed').map((a) => a.id) })
  return patchRow(db, row.id, { ended_counts: { ...counts, done: true } })
}

// 최종 progress 상태 기준으로 ended_by_final_quest 퀘스트 수를 종류별로 센다.
async function countEnded(db, { userId, adventureIds }) {
  const counts = { core: 0, optional: 0, surprise: 0 }
  if (!adventureIds.length) return counts
  const { data: quests, error } = await db.from('jeju_quests').select('id, quest_type').in('adventure_id', adventureIds).eq('user_id', userId)
  if (error) throw error
  const type = new Map((quests ?? []).map((q) => [q.id, q.quest_type]))
  if (!type.size) return counts
  const { data: progress, error: progressError } = await db.from('jeju_quest_progress').select('quest_id, status').in('quest_id', [...type.keys()]).eq('user_id', userId)
  if (progressError) throw progressError
  for (const p of progress ?? []) if (p.status === 'ended_by_final_quest' && p.quest_id && type.get(p.quest_id) in counts) counts[type.get(p.quest_id)] += 1
  return counts
}

// ───────── 공개 함수 ─────────
// 현재 Final Quest 상태 평가. { tripId, position?, refresh? } — position 은 "공항 이동 시간" 계산에만 쓰이고, 클라이언트가 보낼 때만 쓴다.
export async function evaluateFinalQuest({ user, tripId, position = null, refresh = false, db = getAdmin(), deps = {}, now = Date.now() }) {
  const trip = await one(db.from('jeju_trips').select('*').eq('id', tripId).eq('user_id', user.id), 'trip_not_found')
  if (trip.status === 'completed') return base(trip, { status: 'trip_completed', phase: 'none', lastDay: true })
  return computeState({ db, userId: user.id, trip, position, now, deps: { ...defaultDeps, ...deps }, refresh })
}

// [공항으로 이동 시작]: active → moving (재전송해도 같은 결과)
export async function startFinalQuestMove({ user, tripId, db = getAdmin() }) {
  const row = await requireRow(db, { userId: user.id, tripId })
  if (row.flight_state === 'cancelled') throw new HttpError(409, 'flight_cancelled')
  if (row.status !== 'active') return { finalQuestId: row.id, status: row.status }
  const { data, error } = await db.from('jeju_final_quests').update({ status: 'moving', started_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'active').select('*').maybeSingle()
  if (error) throw error
  return { finalQuestId: row.id, status: data?.status ?? 'moving' }
}

async function requireRow(db, { userId, tripId }) {
  const row = await getFinalQuestRow(db, { userId, tripId })
  if (!row) throw new HttpError(404, 'final_quest_not_found')
  return row
}

// 공항 도착 확인: 제주공항 500m GPS. self(직접 확인) 대체 없음 — 실제로 공항에 있어야 한다. 완료 EXP +100 은 한 번만.
export async function arriveFinalQuest({ user, tripId, position, db = getAdmin(), now = Date.now() }) {
  const row = await requireRow(db, { userId: user.id, tripId })
  if (row.flight_state === 'cancelled') throw new HttpError(409, 'flight_cancelled')
  if (row.status === 'arrived' || row.status === 'finished') return { finalQuestId: row.id, status: row.status, awarded: false, amount: 0, alreadyArrived: true }

  const proof = evaluateGpsProof({ position, target: JEJU_AIRPORT, now, radius: AIRPORT_ARRIVAL_RADIUS_M })
  if (!proof.ok) throw new HttpError(proof.code === 'gps_position_invalid' ? 400 : 422, proof.code, { distanceMeters: proof.distanceMeters ?? null, accuracy: proof.accuracy ?? null })

  // 보상(중복 지급 방지 키) → 상태 확정 순서. 중간에 끊겨도 같은 요청을 다시 보내면 이어서 처리된다.
  const reward = await awardFinalCompletion(db, { userId: user.id, finalQuestId: row.id })
  const { data, error } = await db.from('jeju_final_quests').update({ status: 'arrived', arrived_at: new Date(now).toISOString() }).eq('id', row.id).in('status', ['active', 'moving']).select('*').maybeSingle()
  if (error) throw error
  return { finalQuestId: row.id, status: data?.status ?? 'arrived', awarded: reward.awarded, amount: reward.amount, distanceMeters: proof.distanceMeters }
}

// [여행 마무리]: 칭호 해금 → 회고 → 기록 확정(trips.status='completed'). 이미 마무리됐으면 같은 기록을 그대로 돌려준다.
export async function finishTrip({ user, tripId, db = getAdmin(), deps = {}, now = Date.now() }) {
  const userId = user.id
  const trip = await one(db.from('jeju_trips').select('*').eq('id', tripId).eq('user_id', userId), 'trip_not_found')
  const row = await requireRow(db, { userId, tripId })
  if (row.flight_state === 'cancelled') throw new HttpError(409, 'flight_cancelled')
  if (row.status === 'active' || row.status === 'moving') throw new HttpError(409, 'final_quest_not_completed')

  if (trip.status !== 'completed' || row.status !== 'finished') {
    // 1) 기록 조립(통계) → 칭호 → 회고. 모두 여러 번 실행돼도 안전하고, 실패해도 마무리를 막지 않는다(회고는 코드 통계로 대체).
    const preview = await buildTripRecord(db, { userId, tripId, now })
    const titles = await checkTitleUnlocks(db, { userId, trigger: 'trip_completed', data: { tripId, stats: preview.stats } }).catch((error) => {
      console.error('[final-quest] 칭호 확인 실패', error.message)
      return []
    })
    const retro = trip.retrospective ? { text: trip.retrospective, source: trip.retrospective_source } : await writeRetrospective(db, { userId, trip, record: preview, titles, deps })
    // 2) 커밋: 마지막에 trips.status = completed
    const completedAt = trip.completed_at ?? new Date(now).toISOString()
    const { error } = await db.from('jeju_trips').update({ status: 'completed', completed_at: completedAt, retrospective: retro.text, retrospective_source: retro.source, travel_mode: 'quest', exp_snapshot: trip.exp_snapshot ?? { before: preview.exp.before, after: preview.exp.after } }).eq('id', tripId).eq('user_id', userId)
    if (error) throw error
    await patchRow(db, row.id, { status: 'finished', finished_at: new Date(now).toISOString() })
  }
  return { record: await buildTripRecord(db, { userId, tripId, now }) }
}

// 여행 피드백 저장(여행당 1건, 다시 저장하면 덮어쓴다). 다음 여행의 Agent context(context.js feedbackPart)가 이 값을 읽는다.
const DENSITIES = ['relaxed', 'fair', 'tight']
const PLACES = ['good', 'ok', 'bad']
const DIFFICULTIES = ['easy', 'fair', 'hard']
export async function saveTripFeedback({ user, tripId, rating = null, density = null, placesRating = null, difficulty = null, comment = null, db = getAdmin() }) {
  const userId = user.id
  await one(db.from('jeju_trips').select('id').eq('id', tripId).eq('user_id', userId), 'trip_not_found')
  const r = rating == null ? null : Number(rating)
  if (r != null && !(Number.isInteger(r) && r >= 1 && r <= 5)) throw new HttpError(400, 'rating_invalid')
  if (density != null && !DENSITIES.includes(density)) throw new HttpError(400, 'density_invalid')
  if (placesRating != null && !PLACES.includes(placesRating)) throw new HttpError(400, 'places_invalid')
  if (difficulty != null && !DIFFICULTIES.includes(difficulty)) throw new HttpError(400, 'difficulty_invalid')
  const values = { rating: r, density, places_rating: placesRating, difficulty, comment: comment ? String(comment).trim().slice(0, 200) || null : null }

  const { data: existing, error } = await db.from('jeju_feedback').select('id').eq('user_id', userId).eq('trip_id', tripId).is('quest_id', null).is('adventure_id', null).maybeSingle()
  if (error) throw error
  const write = existing
    ? db.from('jeju_feedback').update({ ...values, updated_at: new Date().toISOString() }).eq('id', existing.id)
    : db.from('jeju_feedback').insert({ user_id: userId, trip_id: tripId, ...values })
  const { data: saved, error: writeError } = await write.select('*').single()
  if (writeError) throw writeError
  return { feedback: saved }
}
