import { AIRPORT_ARRIVAL_RADIUS_M } from '../constants/finalQuestRules.js'
import { DISCOVERY_EXP, FREE_EXP } from '../constants/gameBalance.js'
import { JEJU_AIRPORT } from '../constants/jeju.js'
import { useDemoStore } from '../store/demoStore.js'
import { calcQuestExp, splitExp } from '../utils/exp.js'
import { computeSafeTimes, finalQuestPhase, flightKind, treatAsInternational } from '../utils/finalQuest.js'
import { haversineMeters } from '../utils/geo.js'
import { evaluateGpsProof } from '../utils/gps.js'
import { diffLevels, expsFromProfile } from '../utils/level.js'
import { estimateTravel } from '../utils/travel.js'
import { demoNow, DEMO_USER_ID, getDemoDb } from './demoRuntime.js'
import { chapterTemplate, DEMO_PLACES, DEMO_TRIP_ID, kstDate, proposedAdventures } from './fixtures.js'

// Demo 서버 흉내. 실제 /api/* 를 부르지 않고(= 실제 OpenAI/Supabase/외부 API 호출 없음) Demo DB 만 읽고 쓴다.
// 응답은 실제 서버와 같은 모양으로 만들어서 기존 화면/서비스 코드를 그대로 쓴다. 실제 서버의 안전 규칙(Final Quest 안전 시간, GPS 반경, EXP 계산)은
// 클라이언트와 공유하는 순수 함수(utils)를 그대로 재사용한다. 약화하지 않는다.

const fail = (status, code, details = {}) => Object.assign(new Error(code), { code, status, details: { error: code, ...details } })
const unsupported = () => fail(409, 'demo_unsupported')
const db = () => getDemoDb()
const profile = () => db().find('jeju_profiles', (p) => p.id === DEMO_USER_ID)
const bump = () => useDemoStore.getState().bumpProfile()
const failing = (name) => useDemoStore.getState().failures.includes(name)
const stamp = () => new Date(demoNow()).toISOString()
const provider = (data, { fallback = false, error = null } = {}) => ({ source: 'mock', fetchedAt: stamp(), data, ...(fallback ? { fallback: true, error } : {}), demo: true })

// ───────── 외부 제공자 (시뮬레이션) ─────────
function weatherData(kind = useDemoStore.getState().weather) {
  const rain = kind === 'rain'
  const base = new Date(demoNow())
  return {
    temperatureC: rain ? 17 : 23,
    precipitation: rain ? { raining: true, type: 'rain', amountMm: 14 } : { raining: false, type: 'none', amountMm: 0 },
    sky: rain ? 'cloudy' : 'clear',
    windSpeedMs: rain ? 7.2 : 2.6,
    humidityPct: rain ? 92 : 55,
    hourlyForecast: Array.from({ length: 6 }, (_, i) => ({ time: new Date(base.getTime() + (i + 1) * 3600000).toISOString(), temperatureC: rain ? 17 : 23, precipitation: rain ? 'rain' : 'none', precipitationProbability: rain ? 90 : 10, sky: rain ? 'cloudy' : 'clear', windSpeedMs: rain ? 7 : 2.6 })),
    meta: { grid: { nx: 52, ny: 38 }, observedAt: base.toISOString(), warnings: [] },
  }
}
export const demoWeather = (kind) => weatherData(kind)
const conservativeWeather = () => ({ ...weatherData(), precipitation: { raining: false, type: 'none', amountMm: 0 }, sky: 'mostly_cloudy', windSpeedMs: 3.2 })

function placesNear({ lat, lng, radius = 20000, contentTypeId, limit = 30 }) {
  const here = { lat: Number(lat), lng: Number(lng) }
  return Object.values(DEMO_PLACES)
    .map((p) => ({ ...p, distanceMeters: haversineMeters(here, p), address: `제주 ${p.name} 일대 (데모)` }))
    .filter((p) => p.distanceMeters <= Number(radius) && (!contentTypeId || p.contentTypeId === Number(contentTypeId)))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, Number(limit))
}

function flightData() {
  const trip = db().find('jeju_trips', (t) => t.id === DEMO_TRIP_ID)
  const dep = trip?.departure_datetime ? new Date(Date.parse(trip.departure_datetime) + 9 * 3600000) : null
  const text = dep ? `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')} ${String(dep.getUTCHours()).padStart(2, '0')}:${String(dep.getUTCMinutes()).padStart(2, '0')}` : ''
  return { flightNo: trip?.departure_flight ?? 'ZE1033', found: Boolean(dep), departsFromJeju: true, totalCount: 1, flights: dep ? [{ airline: '이스타항공', flightNo: trip.departure_flight ?? 'ZE1033', scheduledDeparture: text, changedDeparture: '', diffMinutes: 0, status: '출발', delayed: false, cancelled: false, departureAirportCode: 'CJU', arrivalAirportCode: 'GMP' }] : [] }
}

// ───────── 모험 / 퀘스트 ─────────
function generateAdventures({ tripId, adventureDate, travelRange }) {
  const existing = db().all('jeju_adventures', (a) => a.trip_id === tripId && a.adventure_date === adventureDate)
  if (existing.some((a) => a.status !== 'proposed')) throw fail(409, 'already_selected')
  const set = Math.max(0, ...existing.map((a) => a.generation_set)) + 1
  if (set > 2) throw fail(429, 'generation_limit_reached')
  const fallbackAi = failing('openai')
  const list = proposedAdventures()
  const ordered = set === 1 ? list : [...list.slice(1), list[0]]
  const adventures = ordered.map((a) =>
    db().insert('jeju_adventures', {
      user_id: DEMO_USER_ID,
      trip_id: tripId,
      adventure_date: adventureDate,
      title: a.title,
      summary: a.summary,
      travel_range: travelRange ?? 'normal',
      status: 'proposed',
      generation_set: set,
      data: { source: fallbackAi ? 'demo' : 'openai', demo: fallbackAi, areas: a.areas, categories: a.categories, places: a.places, facts: { places: failing('places') ? 'mock' : 'live', weather: failing('weather') ? 'mock' : 'live', dailyContext: 'trip' } },
    }),
  )
  return { source: fallbackAi ? 'demo' : 'openai', generationSet: set, fallbackReason: fallbackAi ? '시뮬레이션된 장애' : null, adventures, meta: { gathered: failing('places') ? 6 : 24, candidates: 9, places: failing('places') ? 'mock' : 'live' }, demo: true }
}

function selectAdventure({ adventureId }) {
  const adventure = db().find('jeju_adventures', (a) => a.id === adventureId)
  if (!adventure) throw fail(404, 'adventure_not_found')
  if (adventure.status !== 'proposed') throw fail(409, 'already_selected')
  if (db().all('jeju_adventures', (a) => a.trip_id === adventure.trip_id && a.adventure_date === adventure.adventure_date && a.status !== 'proposed').length) throw fail(409, 'already_selected')
  const [updated] = db().patch('jeju_adventures', (a) => a.id === adventureId, { status: 'selected' })
  return updated
}

export function addQuestsToAdventure(adventure, places, nowMs, coreDone = 0) {
  const chapters = []
  const quests = []
  places.forEach((place, index) => {
    const tpl = chapterTemplate(place, index)
    const status = coreDone === 0 ? (index === 0 ? 'active' : 'locked') : index < coreDone - 1 ? 'completed' : index === coreDone - 1 ? 'core_completed' : 'locked'
    const chapter = db().insert('jeju_chapters', { adventure_id: adventure.id, user_id: DEMO_USER_ID, ...tpl.chapter, status, activated_at: index === Math.max(0, coreDone - 1) ? new Date(nowMs).toISOString() : null, closed_at: null })
    chapters.push(chapter)
    for (const q of tpl.quests) quests.push(db().insert('jeju_quests', { adventure_id: adventure.id, user_id: DEMO_USER_ID, chapter_id: chapter.id, replaced_at: null, ...q }))
  })
  quests.unshift(db().insert('jeju_quests', { adventure_id: adventure.id, user_id: DEMO_USER_ID, chapter_id: null, quest_type: 'main', title: `${adventure.title} 완주하기`, description: adventure.summary, difficulty: 'normal', category_primary: 'explore', category_secondary: null, verification_type: 'self', verification_target: null, place_id: null, place_name: null, place_lat: null, place_lng: null, is_hidden: false, seq: 1, data: { source: 'demo' }, replaced_at: null }))
  return { chapters, quests }
}

function generateQuests({ adventureId }) {
  const adventure = db().find('jeju_adventures', (a) => a.id === adventureId)
  if (!adventure) throw fail(404, 'adventure_not_found')
  if (adventure.status !== 'selected') throw fail(409, adventure.status === 'proposed' ? 'adventure_not_selected' : 'already_generated')
  const fallbackAi = failing('openai')
  const saved = addQuestsToAdventure(adventure, adventure.data.places, demoNow())
  db().patch('jeju_adventures', (a) => a.id === adventureId, { status: 'active' })
  return { source: fallbackAi ? 'demo' : 'openai', fallbackReason: fallbackAi ? '시뮬레이션된 장애' : null, ...saved, demo: true }
}

function levelUpsFrom(before, after) {
  return diffLevels(before, after)
}
function addExp(parts) {
  const p = profile()
  const before = expsFromProfile(p)
  for (const part of parts) {
    if (part.category) p[`exp_${part.category}`] += part.amount
    else p.unspent_exp += part.amount
  }
  const after = expsFromProfile(p)
  bump()
  return levelUpsFrom(before, after)
}

function completeQuest({ questId, method = 'self', position }) {
  const quest = db().find('jeju_quests', (q) => q.id === questId)
  if (!quest) throw fail(404, 'quest_not_found')
  const adventure = db().find('jeju_adventures', (a) => a.id === quest.adventure_id)
  if (adventure.status !== 'active') throw fail(409, 'adventure_not_active')
  const trip = db().find('jeju_trips', (t) => t.id === adventure.trip_id)
  if (trip.travel_mode === 'free') throw fail(409, 'free_travel_active')
  const existing = db().find('jeju_quest_progress', (p) => p.quest_id === questId)
  if (existing?.status === 'completed') throw fail(409, 'already_completed')
  if (existing?.status === 'ended_by_final_quest') throw fail(409, 'quest_closed')
  const chapter = quest.chapter_id ? db().find('jeju_chapters', (c) => c.id === quest.chapter_id) : null

  let used = 'self'
  if (method === 'gps') {
    if (!Number.isFinite(quest.place_lat)) throw fail(409, 'gps_target_unavailable')
    const proof = evaluateGpsProof({ position, target: { lat: quest.place_lat, lng: quest.place_lng }, now: Date.now() })
    if (!proof.ok) throw fail(proof.code === 'gps_position_invalid' ? 400 : 422, proof.code, { distanceMeters: proof.distanceMeters ?? null, accuracy: proof.accuracy ?? null })
    used = 'gps'
  }

  const exp = calcQuestExp({ difficulty: quest.difficulty, questType: quest.quest_type, verificationMethod: used })
  const parts = splitExp(exp.total, quest.category_primary ?? 'explore', quest.category_secondary)
  const questLevelUps = addExp(parts)
  db().insert('jeju_exp_logs', { user_id: DEMO_USER_ID, category: parts[0].category, amount: exp.total, source_type: 'quest', source_id: questId, source_key: `quest:${questId}:completion` })

  let discovery = null
  let discoveryLevelUps = []
  if (quest.place_id) {
    db().insert('jeju_place_visits', { user_id: DEMO_USER_ID, trip_id: adventure.trip_id, quest_id: questId, place_id: quest.place_id, place_name: quest.place_name, place_lat: quest.place_lat, place_lng: quest.place_lng, visit_source: 'quest', visited_at: stamp() })
    if (used === 'gps' && !db().find('jeju_place_discoveries', (d) => d.place_id === quest.place_id)) {
      db().insert('jeju_place_discoveries', { user_id: DEMO_USER_ID, place_id: quest.place_id, place_name: quest.place_name, discovery_type: 'normal', discovered_at: stamp() })
      discovery = { type: 'normal', amount: DISCOVERY_EXP.normal, placeName: quest.place_name }
      discoveryLevelUps = addExp([{ category: 'discovery', amount: DISCOVERY_EXP.normal }])
    }
  }

  const completedAt = stamp()
  const progress = existing ? db().patch('jeju_quest_progress', (p) => p.id === existing.id, { status: 'completed', verification_method: used, completed_at: completedAt })[0] : db().insert('jeju_quest_progress', { user_id: DEMO_USER_ID, quest_id: questId, status: 'completed', verification_method: used, completed_at: completedAt, photo_attempts: 0 })
  let chapterStatus = chapter?.status ?? null
  if (quest.quest_type === 'core' && chapter?.status === 'active') {
    db().patch('jeju_chapters', (c) => c.id === chapter.id, { status: 'core_completed' })
    chapterStatus = 'core_completed'
  }
  // 레벨업은 퀘스트 보상 + 발견 보상을 합친 "지급 전/후" 변화로 계산한다 (중복 항목은 마지막 값으로)
  const merged = new Map()
  for (const up of [...questLevelUps, ...discoveryLevelUps]) merged.set(up.category, merged.has(up.category) ? { ...up, from: merged.get(up.category).from } : up)
  return { progress, chapterStatus, rewards: { quest: { awarded: true, total: exp.total, parts, breakdown: exp }, discovery, levelUps: [...merged.values()], titles: [] } }
}

function revealQuests({ chapterId }) {
  const hidden = db().all('jeju_quests', (q) => q.chapter_id === chapterId && q.quest_type === 'optional' && q.is_hidden)
  if (!hidden.length) throw fail(409, 'nothing_to_reveal')
  const ids = hidden.slice(0, 2).map((q) => q.id)
  const revealed = db().patch('jeju_quests', (q) => ids.includes(q.id), { is_hidden: false })
  return { revealed, remainingHidden: hidden.length - ids.length }
}

function advanceChapter({ chapterId }) {
  const chapter = db().find('jeju_chapters', (c) => c.id === chapterId)
  if (!chapter) throw fail(404, 'chapter_not_found')
  const adventure = db().find('jeju_adventures', (a) => a.id === chapter.adventure_id)
  const rewards = { chapterBonus: 0, adventureBonus: 0 }
  let outcome = chapter.status
  if (chapter.status === 'active' || chapter.status === 'core_completed') {
    if (adventure.status !== 'active') throw fail(409, 'adventure_not_active')
    outcome = chapter.status === 'core_completed' ? 'completed' : 'skipped'
    if (outcome === 'completed') {
      addExp([{ category: null, amount: FREE_EXP.chapterComplete }])
      db().insert('jeju_exp_logs', { user_id: DEMO_USER_ID, category: null, amount: FREE_EXP.chapterComplete, source_type: 'chapter_complete', source_id: chapterId, source_key: `chapter:${chapterId}:completion` })
      rewards.chapterBonus = FREE_EXP.chapterComplete
    }
    db().patch('jeju_chapters', (c) => c.id === chapterId, { status: outcome, closed_at: stamp() })
  }
  const next = db().all('jeju_chapters', (c) => c.adventure_id === adventure.id && c.status === 'locked').sort((a, b) => a.seq - b.seq)[0] ?? null
  let adventureCompleted = false
  if (next) db().patch('jeju_chapters', (c) => c.id === next.id, { status: 'active', activated_at: stamp() })
  else {
    adventureCompleted = true
    db().patch('jeju_adventures', (a) => a.id === adventure.id, { status: 'completed' })
    const skipped = db().all('jeju_chapters', (c) => c.adventure_id === adventure.id && c.status === 'skipped').length
    if (!skipped) {
      addExp([{ category: null, amount: FREE_EXP.adventureComplete }])
      db().insert('jeju_exp_logs', { user_id: DEMO_USER_ID, category: null, amount: FREE_EXP.adventureComplete, source_type: 'adventure_complete', source_id: adventure.id, source_key: `adventure:${adventure.id}:completion` })
      rewards.adventureBonus = FREE_EXP.adventureComplete
    }
  }
  return { chapterStatus: outcome, alreadyAdvanced: false, nextChapterId: next?.id ?? null, adventureCompleted, rewards }
}

// REPLAN: 사용자가 승인했을 때만 실행된다. 시작하지 않은 야외 챕터를 같은 순서의 실내 대안으로 바꾼다. 완료한 챕터/퀘스트/EXP 는 건드리지 않는다.
function replan({ adventureId, reason, context }) {
  const adventure = db().find('jeju_adventures', (a) => a.id === adventureId)
  if (!adventure) throw fail(404, 'adventure_not_found')
  if (adventure.status !== 'active') throw fail(409, 'adventure_not_in_progress')
  const chapters = db().all('jeju_chapters', (c) => c.adventure_id === adventureId && ['active', 'locked'].includes(c.status)).sort((a, b) => a.seq - b.seq)
  const used = new Set(db().all('jeju_quests', (q) => q.adventure_id === adventureId && q.place_id && !q.replaced_at).map((q) => q.place_id))
  const targets = chapters.filter((c) => {
    const core = db().find('jeju_quests', (q) => q.chapter_id === c.id && q.quest_type === 'core' && !q.replaced_at)
    const touched = db().all('jeju_quests', (q) => q.chapter_id === c.id).some((q) => db().find('jeju_quest_progress', (p) => p.quest_id === q.id))
    if (touched) return false
    return reason === 'WEATHER_CHANGE' ? core?.data?.outdoor : true
  })
  const pool = reason === 'RETURN_FROM_FREE_TRAVEL' ? Object.values(DEMO_PLACES) : Object.values(DEMO_PLACES).filter((p) => p.indoor)
  const from = context?.position ?? null
  const alternatives = pool.filter((p) => !used.has(p.placeId)).sort((a, b) => (from ? haversineMeters(from, a) - haversineMeters(from, b) : 0))
  const limit = reason === 'RETURN_FROM_FREE_TRAVEL' ? 1 : targets.length
  const chosen = targets.slice(0, limit)
  if (!chosen.length) return { status: 'unchanged', outcome: 'nothing_to_replan', demo: true }
  if (!alternatives.length) return { status: 'no_alternative', outcome: 'no_real_candidate', options: ['keep', 'skip', 'free'], demo: true }
  chosen.forEach((chapter, i) => {
    const place = alternatives[i % alternatives.length]
    const wasActive = chapter.status === 'active' // patch 전에 확인 (같은 행 객체라 patch 뒤에는 replaced 로 보인다)
    db().patch('jeju_chapters', (c) => c.id === chapter.id, { status: 'replaced', replaced_at: stamp() })
    db().patch('jeju_quests', (q) => q.chapter_id === chapter.id, { replaced_at: stamp() })
    const tpl = chapterTemplate(place, chapter.seq - 1)
    const fresh = db().insert('jeju_chapters', { adventure_id: adventureId, user_id: DEMO_USER_ID, ...tpl.chapter, seq: chapter.seq, status: wasActive ? 'active' : 'locked', activated_at: wasActive ? stamp() : null, closed_at: null })
    for (const q of tpl.quests) db().insert('jeju_quests', { adventure_id: adventureId, user_id: DEMO_USER_ID, chapter_id: fresh.id, replaced_at: null, ...q })
    used.add(place.placeId)
  })
  db().insert('jeju_agent_requests', { user_id: DEMO_USER_ID, trip_id: adventure.trip_id, adventure_id: adventureId, request_type: 'REPLAN_ADVENTURE', status: 'success', response_payload: { reason }, created_at: stamp() })
  return { status: 'replanned', outcome: 'replaced', replaced: { chapters: chosen.length }, added: { chapters: chosen.length }, source: 'demo', demo: true }
}

// ───────── 돌발 퀘스트 ─────────
function evaluateSurprise({ adventureId, replanNeeded, verificationOpen, transitioning }) {
  const adventure = db().find('jeju_adventures', (a) => a.id === adventureId)
  if (!adventure) throw fail(404, 'adventure_not_found')
  const trip = db().find('jeju_trips', (t) => t.id === adventure.trip_id)
  if (db().find('jeju_final_quests', (f) => f.trip_id === trip.id)) throw fail(409, 'final_quest_active')
  if (trip.end_date <= kstDate(demoNow())) {
    const state = finalQuestState({ lite: true })
    if (state.phase === 'notice' || state.phase === 'activate') throw fail(409, 'final_quest_notice') // 공항 이동 준비 구간: 새 돌발 퀘스트 없음
  }
  const surprises = db().all('jeju_quests', (q) => q.adventure_id === adventureId && q.quest_type === 'surprise')
  const waiting = surprises.find((q) => q.surprise_status === 'offered')
  if (waiting) return { offered: true, quest: waiting, existing: true }
  if (surprises.length >= 3) return { offered: false, reason: 'daily_limit' }
  if (replanNeeded) return { offered: false, reason: 'replan_pending' }
  if (verificationOpen) return { offered: false, reason: 'verification_open' }
  if (transitioning) return { offered: false, reason: 'transitioning' }
  const chapter = db().all('jeju_chapters', (c) => c.adventure_id === adventureId && ['active', 'core_completed'].includes(c.status)).sort((a, b) => a.seq - b.seq)[0]
  const core = chapter ? db().find('jeju_quests', (q) => q.chapter_id === chapter.id && q.quest_type === 'core' && !q.replaced_at) : null
  if (!core) return { offered: false, reason: 'no_quest' }
  const quest = db().insert('jeju_quests', { adventure_id: adventureId, user_id: DEMO_USER_ID, chapter_id: null, quest_type: 'surprise', surprise_status: 'offered', title: `${core.place_name} 근처의 숨은 한 컷`, description: '지나가다 마주친 작은 장면을 하나 찾아봐. 하지 않아도 불이익은 없어.', difficulty: 'easy', category_primary: 'explore', category_secondary: null, verification_type: 'self', verification_target: null, place_id: core.place_id, place_name: core.place_name, place_lat: core.place_lat, place_lng: core.place_lng, is_hidden: false, seq: 1, data: { source: 'demo' }, replaced_at: null })
  return { offered: true, quest }
}

function respondSurprise({ questId, action }) {
  const quest = db().find('jeju_quests', (q) => q.id === questId)
  if (!quest || quest.quest_type !== 'surprise') throw fail(404, 'quest_not_found')
  const next = action === 'accept' ? 'accepted' : 'declined'
  if (quest.surprise_status !== 'offered' && quest.surprise_status !== next) throw fail(409, 'surprise_already_answered')
  const [updated] = db().patch('jeju_quests', (q) => q.id === questId, { surprise_status: next })
  return { quest: updated }
}

// ───────── 자유여행 ─────────
function startFree({ adventureId }) {
  const adventure = db().find('jeju_adventures', (a) => a.id === adventureId)
  if (!adventure || adventure.status !== 'active') throw fail(409, 'adventure_not_active')
  let session = db().find('jeju_free_sessions', (s) => s.status === 'active')
  if (!session) session = db().insert('jeju_free_sessions', { user_id: DEMO_USER_ID, trip_id: adventure.trip_id, adventure_id: adventureId, status: 'active', started_at: stamp() })
  db().patch('jeju_trips', (t) => t.id === adventure.trip_id, { travel_mode: 'free' })
  return { session, alreadyActive: false }
}

function finishFree({ sessionId, visits = [] }) {
  const session = db().find('jeju_free_sessions', (s) => s.id === sessionId)
  if (!session) throw fail(404, 'session_not_found')
  const saved = []
  const discoveries = []
  let levelUps = []
  for (const visit of visits) {
    const place = Object.values(DEMO_PLACES).find((p) => p.placeId === visit.placeId)
    if (!place) continue
    db().insert('jeju_place_visits', { user_id: DEMO_USER_ID, trip_id: session.trip_id, quest_id: null, place_id: place.placeId, place_name: place.name, place_lat: place.lat, place_lng: place.lng, visit_source: 'gps', visited_at: stamp() })
    let isNew = false
    if (!db().find('jeju_place_discoveries', (d) => d.place_id === place.placeId)) {
      isNew = true
      db().insert('jeju_place_discoveries', { user_id: DEMO_USER_ID, place_id: place.placeId, place_name: place.name, discovery_type: 'normal', discovered_at: stamp() })
      levelUps = [...levelUps, ...addExp([{ category: 'discovery', amount: DISCOVERY_EXP.normal }])]
      discoveries.push({ placeId: place.placeId, placeName: place.name, type: 'normal', amount: DISCOVERY_EXP.normal })
    }
    saved.push({ placeId: place.placeId, placeName: place.name, evidence: 'dwell', discovery: isNew })
  }
  db().patch('jeju_free_sessions', (s) => s.id === sessionId, { status: 'ended', ended_at: stamp() })
  db().patch('jeju_trips', (t) => t.id === session.trip_id, { travel_mode: 'quest' })
  return { alreadyEnded: false, saved, rejected: [], rewards: { discoveries, levelUps, titles: [] } }
}

// ───────── Final Quest (안전 시간 계산은 실제와 같은 shared util) ─────────
function finalQuestState({ position = null, lite = false } = {}) {
  const trip = db().find('jeju_trips', (t) => t.id === DEMO_TRIP_ID)
  const row = db().find('jeju_final_quests', (f) => f.trip_id === trip.id)
  const now = demoNow()
  const lastDay = trip.end_date <= kstDate(now)
  const base = { tripId: trip.id, lastDay, extrasAllowed: false, airport: { ...JEJU_AIRPORT, radiusMeters: AIRPORT_ARRIVAL_RADIUS_M }, demo: true }
  if (trip.status === 'completed') return { ...base, status: 'trip_completed', phase: 'none', locked: false, noticeLock: false }
  if (!row && !lastDay) return { ...base, status: 'none', phase: 'none', locked: false, noticeLock: false }

  const departureAt = trip.departure_datetime ? Date.parse(trip.departure_datetime) : null
  const kind = flightKind('GMP') // 데모 항공편은 국내선 도착(GMP)으로 확인된 것으로 둔다
  const from = position ?? useDemoStore.getState().position
  const travel = from ? estimateTravel({ from, to: JEJU_AIRPORT, transport: trip.transport }).minutes : null
  const safe = Number.isFinite(departureAt) ? computeSafeTimes({ departureAtMs: departureAt, international: treatAsInternational(kind), congestionLevel: 2, travelMinutes: travel }) : null
  const phase = safe ? finalQuestPhase({ nowMs: now, latestSafeDeparture: safe.latestSafeDeparture }) : 'none'
  let current = row
  if (!current && !lite && safe && phase === 'activate') current = activateFinalQuest(trip, safe)
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)
  return {
    ...base,
    status: current ? current.status : phase === 'none' ? 'none' : 'notice',
    phase,
    message: null,
    finalQuestId: current?.id ?? null,
    locked: Boolean(current),
    noticeLock: phase === 'notice' || phase === 'activate',
    flight: safe ? { state: 'normal', source: 'api', flightNo: trip.departure_flight, status: '출발', delayMinutes: null, departureAt: iso(departureAt) } : null,
    safe: safe ? { departureAt: iso(safe.departureAt), arriveBy: iso(safe.arriveBy), arriveBeforeMinutes: safe.arriveBeforeMinutes, travelMinutes: safe.travelMinutes, travelSource: 'estimate', travelOrigin: from ? 'gps' : 'fallback', congestionBufferMinutes: safe.congestionBufferMinutes, latestSafeDeparture: iso(safe.latestSafeDeparture), international: safe.international, flightKind: kind } : null,
    endedCounts: current?.ended_counts ?? null,
    startedAt: current?.started_at ?? null,
    arrivedAt: current?.arrived_at ?? null,
  }
}

function activateFinalQuest(trip, safe) {
  const counts = { core: 0, optional: 0, surprise: 0 }
  const adventures = db().all('jeju_adventures', (a) => a.trip_id === trip.id && ['selected', 'active'].includes(a.status))
  for (const adventure of adventures) {
    for (const q of db().all('jeju_quests', (x) => x.adventure_id === adventure.id && ['core', 'optional', 'surprise'].includes(x.quest_type) && !x.replaced_at && !x.is_hidden)) {
      if (q.quest_type === 'surprise' && q.surprise_status !== 'accepted') continue
      if (db().find('jeju_quest_progress', (p) => p.quest_id === q.id && ['completed', 'ended_by_final_quest'].includes(p.status))) continue
      db().insert('jeju_quest_progress', { user_id: DEMO_USER_ID, quest_id: q.id, status: 'ended_by_final_quest', photo_attempts: 0 })
      counts[q.quest_type] += 1
    }
    db().patch('jeju_chapters', (c) => c.adventure_id === adventure.id && ['active', 'core_completed', 'locked'].includes(c.status), { status: 'ended_by_final_quest' })
    db().patch('jeju_adventures', (a) => a.id === adventure.id, { status: 'ended_early' })
  }
  return db().insert('jeju_final_quests', { user_id: DEMO_USER_ID, trip_id: trip.id, status: 'active', flight_state: 'normal', safe, ended_counts: { ...counts, done: true }, activated_at: stamp() })
}

function finalQuest(body) {
  const row = () => db().find('jeju_final_quests', (f) => f.trip_id === DEMO_TRIP_ID)
  switch (body.action) {
    case 'status':
      return finalQuestState({ position: body.position })
    case 'start': {
      const r = row()
      if (!r) throw fail(404, 'final_quest_not_found')
      if (r.status === 'active') db().patch('jeju_final_quests', (f) => f.id === r.id, { status: 'moving', started_at: stamp() })
      // 시연용: 공항으로 이동 시작하면 시뮬레이션 위치를 공항 근처로 옮긴다. (실제 GPS 가 없어도 도착 확인을 재현)
      useDemoStore.getState().setScenario({ position: { lat: JEJU_AIRPORT.lat + 0.001, lng: JEJU_AIRPORT.lng, accuracy: 15 } })
      return { finalQuestId: r.id, status: 'moving' }
    }
    case 'arrive': {
      const r = row()
      if (!r) throw fail(404, 'final_quest_not_found')
      if (['arrived', 'finished'].includes(r.status)) return { finalQuestId: r.id, status: r.status, awarded: false, amount: 0, alreadyArrived: true }
      const proof = evaluateGpsProof({ position: body.position, target: JEJU_AIRPORT, now: Date.now(), radius: AIRPORT_ARRIVAL_RADIUS_M })
      if (!proof.ok) throw fail(proof.code === 'gps_position_invalid' ? 400 : 422, proof.code, { distanceMeters: proof.distanceMeters ?? null })
      const awarded = !db().find('jeju_exp_logs', (l) => l.source_key === `final:${r.id}:completion`)
      if (awarded) {
        addExp([{ category: null, amount: FREE_EXP.finalComplete }])
        db().insert('jeju_exp_logs', { user_id: DEMO_USER_ID, category: null, amount: FREE_EXP.finalComplete, source_type: 'final_complete', source_id: r.id, source_key: `final:${r.id}:completion` })
      }
      db().patch('jeju_final_quests', (f) => f.id === r.id, { status: 'arrived', arrived_at: stamp() })
      return { finalQuestId: r.id, status: 'arrived', awarded, amount: FREE_EXP.finalComplete }
    }
    case 'finish': {
      const r = row()
      if (!r) throw fail(404, 'final_quest_not_found')
      if (r.status === 'active' || r.status === 'moving') throw fail(409, 'final_quest_not_completed')
      db().patch('jeju_trips', (t) => t.id === DEMO_TRIP_ID, { status: 'completed', completed_at: stamp(), retrospective: '데모 여행을 마무리했어요. 퀘스트와 발견, 추억이 기록에 남았어요. 수고했어요!', retrospective_source: 'stats', travel_mode: 'quest' })
      db().patch('jeju_final_quests', (f) => f.id === r.id, { status: 'finished', finished_at: stamp() })
      return { record: tripRecord(DEMO_TRIP_ID) }
    }
    default:
      throw fail(400, 'action_invalid')
  }
}

// ───────── 여행 기록 ─────────
function tripRecord(tripId) {
  const trip = db().find('jeju_trips', (t) => t.id === tripId)
  if (!trip) throw fail(404, 'trip_not_found')
  const adventureIds = db().all('jeju_adventures', (a) => a.trip_id === tripId && a.status !== 'proposed').map((a) => a.id)
  const quests = db().all('jeju_quests', (q) => adventureIds.includes(q.adventure_id) && ['core', 'optional', 'surprise'].includes(q.quest_type) && !q.replaced_at)
  const status = (q) => db().find('jeju_quest_progress', (p) => p.quest_id === q.id)?.status
  const completed = quests.filter((q) => status(q) === 'completed')
  const visits = db().all('jeju_place_visits', (v) => v.trip_id === tripId)
  const discoveries = db().all('jeju_place_discoveries', (d) => visits.some((v) => v.place_id === d.place_id))
  const logs = db().all('jeju_exp_logs', () => true)
  const p = profile()
  const exps = expsFromProfile(p)
  const feedback = db().find('jeju_feedback', (f) => f.trip_id === tripId)
  const titleRows = db().all('jeju_user_titles', (t) => t.trip_id === tripId)
  const days = Math.round((Date.parse(`${trip.end_date}T00:00:00Z`) - Date.parse(`${trip.start_date}T00:00:00Z`)) / 86400000) + 1
  const surprises = quests.filter((q) => q.quest_type === 'surprise')
  return {
    trip: { id: trip.id, startDate: trip.start_date, endDate: trip.end_date, days, status: trip.status, completedAt: trip.completed_at ?? null, retrospective: trip.retrospective ?? null, retrospectiveSource: trip.retrospective_source ?? null },
    stats: { completedQuests: completed.length, core: completed.filter((q) => q.quest_type === 'core').length, optional: completed.filter((q) => q.quest_type === 'optional').length, surprise: completed.filter((q) => q.quest_type === 'surprise').length, endedByFinalQuest: quests.filter((q) => status(q) === 'ended_by_final_quest').length, visitedPlaces: new Set(visits.map((v) => v.place_id)).size, discoveries: discoveries.length, categoryQuests: {}, totalExp: logs.reduce((s, l) => s + (l.amount ?? 0), 0) },
    exp: { totalExp: logs.reduce((s, l) => s + (l.amount ?? 0), 0), expByCategory: exps, levelChanges: [], before: exps, after: exps },
    places: visits.map((v) => ({ placeId: v.place_id, name: v.place_name, visitedAt: v.visited_at })),
    discoveries: discoveries.map((d) => ({ placeId: d.place_id, name: d.place_name, type: d.discovery_type })),
    photos: db().all('jeju_travel_photos', (ph) => ph.trip_id === tripId && ph.is_memory).map((ph) => ({ id: ph.id, questId: ph.quest_id, storagePath: ph.storage_path, caption: ph.caption ?? null })),
    titles: titleRows.map((t) => ({ code: 'demo', name: db().find('jeju_titles', (x) => x.id === t.title_id)?.name ?? '칭호' })),
    feedback: feedback ? { rating: feedback.rating, density: feedback.density, placesRating: feedback.places_rating, difficulty: feedback.difficulty, comment: feedback.comment } : null,
    replanLog: db().all('jeju_agent_requests', (r) => r.trip_id === tripId && r.request_type === 'REPLAN_ADVENTURE').map((r) => ({ at: r.created_at, reason: r.response_payload?.reason ?? null })),
    surpriseLog: { accepted: surprises.filter((q) => q.surprise_status === 'accepted').length, declined: surprises.filter((q) => q.surprise_status === 'declined').length, items: surprises.map((q) => ({ title: q.title, status: q.surprise_status })) },
    finalQuest: db().find('jeju_final_quests', (f) => f.trip_id === tripId) ? { status: db().find('jeju_final_quests', (f) => f.trip_id === tripId).status } : null,
  }
}

function investExp({ grantId, category }) {
  const grant = db().find('jeju_exp_logs', (l) => l.id === grantId && l.category === null)
  if (!grant) throw fail(404, 'grant_not_found')
  if (db().find('jeju_exp_logs', (l) => l.source_type === 'free_exp_invest' && l.source_id === grantId)) throw fail(409, 'already_invested')
  const p = profile()
  p.unspent_exp = Math.max(0, p.unspent_exp - grant.amount)
  const levelUps = addExp([{ category, amount: grant.amount }])
  db().insert('jeju_exp_logs', { user_id: DEMO_USER_ID, category, amount: grant.amount, source_type: 'free_exp_invest', source_id: grantId, source_key: `invest:${grantId}` })
  return { amount: grant.amount, category, levelUps, titles: [] }
}

// ───────── 진입점 ─────────
// name: /api/ 뒤의 함수 이름, payload: GET 이면 query 객체 / POST 이면 body
export async function handleDemoApi(name, method, payload = {}) {
  await Promise.resolve() // 실제 네트워크처럼 비동기로 처리한다
  switch (name) {
    case 'weather':
      return failing('weather') ? provider(conservativeWeather(), { fallback: true, error: 'simulated_failure' }) : provider(weatherData())
    case 'places':
      return failing('places') ? provider(placesNear(payload).slice(0, 5), { fallback: true, error: 'simulated_failure' }) : provider(placesNear(payload))
    case 'directions': {
      const from = { lat: Number(payload.startLat), lng: Number(payload.startLng) }
      const to = { lat: Number(payload.goalLat), lng: Number(payload.goalLng) }
      const estimate = estimateTravel({ from, to, transport: 'rental_car' })
      const data = { durationSeconds: estimate.minutes * 60, distanceMeters: estimate.meters }
      return failing('directions') ? provider(data, { fallback: true, error: 'simulated_failure' }) : { ...provider(data), source: 'live' }
    }
    case 'airport-flights':
      return provider(flightData())
    case 'airport-congestion':
      return provider({ current: { overall: { value: 2, label: '보통' } }, hourly: [], hourlyAvailable: false, waitMinutes: null, securityMinutes: null })
    case 'transit-stops':
    case 'transit-arrivals':
    case 'transit-routes':
      return provider([])
    case 'adventures-generate':
      return generateAdventures(payload)
    case 'adventures-select':
      return selectAdventure(payload)
    case 'quests-generate':
      return generateQuests(payload)
    case 'quests-complete':
      return completeQuest(payload)
    case 'quests-reveal':
      return revealQuests(payload)
    case 'chapters-advance':
      return advanceChapter(payload)
    case 'adventures-replan':
      return replan(payload)
    case 'surprise-evaluate':
      return evaluateSurprise(payload)
    case 'surprise-respond':
      return respondSurprise(payload)
    case 'free-travel-start':
      return startFree(payload)
    case 'free-travel-finish':
      return finishFree(payload)
    case 'final-quest':
      return finalQuest(payload)
    case 'trip-records': {
      if (!payload.tripId) {
        const trips = db().all('jeju_trips', (t) => t.status === 'completed').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
        return { trips: trips.map((t) => ({ id: t.id, startDate: t.start_date, endDate: t.end_date, days: Math.round((Date.parse(`${t.end_date}T00:00:00Z`) - Date.parse(`${t.start_date}T00:00:00Z`)) / 86400000) + 1, completedAt: t.completed_at })) }
      }
      return { record: tripRecord(payload.tripId) }
    }
    case 'trip-feedback': {
      const row = { user_id: DEMO_USER_ID, trip_id: payload.tripId, rating: payload.rating ?? null, density: payload.density ?? null, places_rating: payload.placesRating ?? null, difficulty: payload.difficulty ?? null, comment: payload.comment ?? null }
      const existing = db().find('jeju_feedback', (f) => f.trip_id === payload.tripId)
      return { feedback: existing ? db().patch('jeju_feedback', (f) => f.id === existing.id, row)[0] : db().insert('jeju_feedback', row) }
    }
    case 'exp-invest':
      return investExp(payload)
    case 'memories-save':
    case 'quests-photo-verify':
      throw Object.assign(new Error('데모에서는 사진 기능을 쓰지 않아.'), { code: 'demo_unsupported', status: 409, details: { error: 'demo_unsupported' } })
    default:
      throw unsupported()
  }
}

