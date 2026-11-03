import { JEJU_CITY } from '../../../src/constants/jeju.js'
import { accommodationForDate } from '../../../src/utils/dailyContext.js'
import { experienceTier, expsFromProfile, levelsOf } from '../../../src/utils/level.js'
import { getSeason } from '../../../src/utils/season.js'
import { getWeather } from '../providers/weather.js'
import { loadDailyContext } from './dailyContext.js'

// 모든 Agent 가 공유하는 context 빌더. (GENERATE_ADVENTURES / GENERATE_QUESTS, 이후 REPLAN 등)
// 새 정보를 Agent 에 추가할 때는 아래 "context 조각(part)" 함수를 하나 추가하고 buildAgentContext 의 목록에 끼우면 된다.
//   part 반환값: { context: {...Agent 에 전달}, facts: {...출처 표시}, hints: {...서버 규칙용(후보 필터 등), Agent 에는 안 감} }
//
// ⚠ 최신 DB 값 원칙: 이 함수는 호출될 때마다 trips / accommodations / daily contexts / 방문 / 피드백 / EXP 를 DB 에서 다시 읽는다.
//   화면에서 숙소·항공편·일일 조건을 고친 값은 "텍스트 피드백"이 아니라 정식 DB 데이터로 반영된다.
//   (설정을 수정하는 화면은 DB 저장만 하고 Agent 를 호출하지 않는다. Agent 는 새 모험 생성 / "오늘 일정 다시 맞추기"에서만 호출된다.)
//
// 추천 기준 vs 경험도
//   preferences = 관심도(무엇을 좋아하는가, 0~100) → 추천의 주된 기준
//   experience  = 경험도(카테고리 EXP/레벨 = 얼마나 경험했는가) → 입문/심화 조절, 표현의 깊이, 반복 감소, 새로운 형태 제안에만 사용. 선호도로 쓰지 않는다.
//
// 연결 현황
//  - 여행 기간 / 출발 항공편·일시 / 오늘 숙소 / 숙소 변경 여부 : 연결됨 (trips, accommodations)
//  - 오늘 동행·인원·이동수단·종료 희망 시간 : 연결됨 (jeju_daily_contexts → 이전 값 → trips 기본값)
//  - 방문 장소(이번/과거 여행) : 조회 연결됨 → hints.visits 로 후보에서 제외/감점
//  - 사용자 피드백(최근 + 평가 요약) : 조회 연결됨 (jeju_feedback, 화면의 저장 UI 는 이후 단계)
//  - 카테고리 경험도 : 연결됨 (jeju_profiles EXP → 레벨/단계)
//  - NAVER Directions 실제 이동시간 : 미연결 (travelTimes: null) → 9단계

const PREFERENCE_KEYS = ['explore', 'culture', 'food', 'relax', 'social', 'discovery']

export function kstNow() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`,
    time: `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`,
  }
}

// 사용자가 쓴 자유 텍스트는 Agent 에게 "데이터"일 뿐 지시가 아니다. 줄바꿈 제거 + 길이 제한.
const clean = (value, max = 100) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// ───────── part: 성향(관심도) ─────────
async function preferencesPart(db, { userId }) {
  const { data, error } = await db.from('jeju_travel_preferences').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const preferences = Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, data?.[key] ?? 50]))
  preferences.meal = data?.meal_preference ?? 50
  preferences.dessert = data?.dessert_preference ?? 50
  return { context: { preferences }, facts: {}, hints: {} }
}

// ───────── part: 카테고리 경험도 (선호도 아님) ─────────
async function experiencePart(db, { userId }) {
  const { data, error } = await db.from('jeju_profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  const levels = levelsOf(expsFromProfile(data))
  const experience = Object.fromEntries(
    ['overall', ...PREFERENCE_KEYS].map((key) => [key, { level: levels[key].level, tier: experienceTier(levels[key].level) }]),
  )
  return { context: { experience }, facts: {}, hints: {} }
}

// ───────── part: 여행 전체 정보 (기간 / 출발 항공편) ─────────
function tripPart(trip, adventureDate) {
  const days = Math.round((new Date(`${trip.end_date}T00:00:00Z`) - new Date(`${trip.start_date}T00:00:00Z`)) / 86400000) + 1
  const dayIndex = Math.round((new Date(`${adventureDate}T00:00:00Z`) - new Date(`${trip.start_date}T00:00:00Z`)) / 86400000) + 1
  return {
    context: {
      tripPeriod: { startDate: trip.start_date, endDate: trip.end_date, dayIndex, totalDays: days, isLastDay: adventureDate === trip.end_date },
      // 출발 정보는 Final Quest 에서도 같은 값을 쓴다. 날짜와 상관없이 항상 최신 값을 전달한다.
      departure: { flight: trip.departure_flight ?? null, datetime: trip.departure_datetime ?? null },
    },
    facts: {},
    hints: {},
  }
}

// ───────── part: 오늘의 일일 조건 (동행 / 인원 / 이동수단 / 종료 희망 시간) ─────────
async function dailyPart(db, { trip, adventureDate }) {
  const daily = await loadDailyContext(db, { trip, date: adventureDate })
  const { companion, party_size: partySize, transport, desired_end_time: desiredEndTime } = daily.values
  return {
    context: { companion, partySize, transport, desiredEndTime },
    facts: { dailyContext: daily.source }, // saved(그날 확인함) | previous(전날 값 이어받음) | trip(여행 기본값)
    hints: {},
  }
}

// ───────── part: 오늘 숙소 / 숙소 변경 여부 ─────────
async function accommodationPart(db, { tripId, adventureDate }) {
  const { data, error } = await db.from('jeju_accommodations').select('*').eq('trip_id', tripId)
  if (error) throw error
  const { today, isChangeDay, from, to } = accommodationForDate(data ?? [], adventureDate)
  const hasCoordinates = today?.latitude != null && today?.longitude != null
  const brief = (a) => (a ? { name: clean(a.name, 50), address: a.address ? clean(a.address, 80) : null } : null)

  return {
    context: { accommodation: brief(today), accommodationChange: { isChangeDay, from: brief(from), to: brief(to) } },
    facts: { accommodation: today ? (hasCoordinates ? 'coordinates' : 'name_only') : 'none' },
    hints: { origin: hasCoordinates ? { lat: today.latitude, lng: today.longitude } : null },
  }
}

// ───────── part: 방문 기록 (이번 여행 / 과거 여행) ─────────
// 이번 여행에서 간 곳은 강하게 억제(후보에서 제외), 과거 여행에서 간 곳은 약하게 감점(후보 뒤로 + visitedBefore 표시).
async function visitsPart(db, { userId, tripId }) {
  const { data, error } = await db
    .from('jeju_place_visits')
    .select('place_id, place_name, trip_id')
    .eq('user_id', userId)
    .order('visited_at', { ascending: false })
    .limit(300)
  if (error) throw error

  const thisTrip = new Map()
  const past = new Map()
  for (const visit of data ?? []) {
    const target = visit.trip_id === tripId ? thisTrip : past
    if (!target.has(visit.place_id)) target.set(visit.place_id, clean(visit.place_name, 50))
  }
  for (const id of thisTrip.keys()) past.delete(id) // 이번 여행에도 갔으면 이번 여행 쪽으로만 센다

  const list = (map) => [...map].slice(0, 50).map(([placeId, name]) => ({ placeId, name }))
  return {
    context: { visitedThisTrip: list(thisTrip), visitedPastTrips: list(past) },
    facts: {},
    hints: { visits: { thisTripIds: new Set(thisTrip.keys()), pastIds: new Set(past.keys()) } },
  }
}

// ───────── part: 사용자 피드백 (최근 평가 + 유형별 요약) ─────────
// 피드백은 jeju_feedback 에 trip / adventure / quest 단위로 저장된다. (저장 화면은 이후 단계)
// 여기서는 "반복해서 높게/낮게 평가한 유형"만 단순 평균으로 요약해서 전달한다. (추천 학습 알고리즘은 아님)
//   유형 = 피드백이 붙은 모험의 대표 성향 / 퀘스트의 카테고리
const FEEDBACK_WINDOW = 30
const FEEDBACK_MIN_COUNT = 2 // 같은 유형이 이만큼 반복돼야 요약에 반영한다
const LIKED_AVG = 4
const DISLIKED_AVG = 2

// 여행 피드백(밀도/추천 장소/난이도) → Agent 가 따를 조정 목록. 값이 없거나 보통이면 비어 있다.
export function tripFeedbackAdjustments(feedback) {
  if (!feedback) return []
  const out = []
  if (feedback.density === 'tight') out.push('지난 여행에서 일정이 빡빡했다고 했어요: 하루 일정 밀도를 낮추고 이동을 줄여줘.')
  if (feedback.density === 'relaxed') out.push('지난 여행에서 일정이 여유로웠다고 했어요: 일정을 조금 더 채워도 돼요.')
  if (feedback.places_rating === 'bad') out.push('지난 여행의 추천 장소가 별로였다고 했어요: 장소 선정을 더 신중하게, 취향에 맞게 조정해줘.')
  if (feedback.difficulty === 'hard') out.push('지난 여행의 퀘스트가 어려웠다고 했어요: 퀘스트 난이도를 낮춰줘.')
  if (feedback.difficulty === 'easy') out.push('지난 여행의 퀘스트가 쉬웠다고 했어요: 퀘스트 난이도를 조금 올려도 돼요.')
  return out
}

async function feedbackPart(db, { userId }) {
  const { data, error } = await db
    .from('jeju_feedback')
    .select('rating, comment, adventure_id, quest_id, trip_id, density, places_rating, difficulty')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(FEEDBACK_WINDOW)
  if (error) throw error
  const rows = data ?? []

  const adventureIds = [...new Set(rows.map((r) => r.adventure_id).filter(Boolean))]
  const questIds = [...new Set(rows.map((r) => r.quest_id).filter(Boolean))]
  const [adventures, quests] = await Promise.all([
    adventureIds.length ? db.from('jeju_adventures').select('id, data').in('id', adventureIds) : { data: [] },
    questIds.length ? db.from('jeju_quests').select('id, category_primary, category_secondary').in('id', questIds) : { data: [] },
  ])
  const categoriesOfAdventure = new Map((adventures.data ?? []).map((a) => [a.id, a.data?.categories ?? []]))
  const categoriesOfQuest = new Map((quests.data ?? []).map((q) => [q.id, [q.category_primary, q.category_secondary].filter(Boolean)]))

  const stats = new Map()
  for (const row of rows) {
    if (row.rating == null) continue
    const categories = [...(categoriesOfQuest.get(row.quest_id) ?? []), ...(categoriesOfAdventure.get(row.adventure_id) ?? [])]
    for (const category of new Set(categories)) {
      const entry = stats.get(category) ?? { sum: 0, count: 0 }
      entry.sum += row.rating
      entry.count += 1
      stats.set(category, entry)
    }
  }
  const pick = (test) => [...stats].filter(([, s]) => s.count >= FEEDBACK_MIN_COUNT && test(s.sum / s.count)).map(([category]) => category)
  const rated = rows.filter((r) => r.rating != null)
  // 가장 최근 여행 피드백(여행 단위)에서 "다음 여행에서 무엇을 조정할지"를 코드로 정한다. (GPT 가 추측하지 않는다)
  const lastTrip = rows.find((r) => r.trip_id && !r.quest_id && !r.adventure_id && (r.density || r.places_rating || r.difficulty)) ?? null

  return {
    context: {
      userFeedback: {
        // comment 는 사용자가 쓴 텍스트라 데이터로만 쓰인다(프롬프트에서도 지시로 따르지 않도록 명시).
        recent: rows
          .filter((r) => r.rating != null || r.comment)
          .slice(0, 5)
          .map((r) => ({ rating: r.rating, comment: r.comment ? clean(r.comment) : null })),
        summary: {
          count: rows.length,
          averageRating: rated.length ? Math.round((rated.reduce((sum, r) => sum + r.rating, 0) / rated.length) * 10) / 10 : null,
          likedCategories: pick((avg) => avg >= LIKED_AVG),
          dislikedCategories: pick((avg) => avg <= DISLIKED_AVG),
          // 지난 여행 피드백 → 조정 지시 (예: 일정이 빡빡했다 → 하루 일정 밀도를 낮춘다)
          adjustments: tripFeedbackAdjustments(lastTrip),
        },
      },
    },
    facts: {},
    hints: {},
  }
}

// ───────── part: 날씨 (오늘 날짜일 때만) ─────────
async function weatherPart({ adventureDate, origin }) {
  // 다른 날짜의 날씨는 알 수 없으므로 GPT 가 추측하지 않게 null 로 둔다.
  if (adventureDate !== kstNow().date) return { context: { weather: null }, facts: { weather: null }, hints: {} }
  const result = await getWeather(origin)
  const d = result.data
  return {
    context: {
      weather: {
        temperatureC: d.temperatureC,
        sky: d.sky,
        precipitationType: d.precipitation?.type ?? null,
        maxPrecipitationProbabilityNext6h: Math.max(0, ...d.hourlyForecast.slice(0, 6).map((h) => h.precipitationProbability ?? 0)),
      },
    },
    facts: { weather: result.source },
    hints: {},
  }
}

// ───────── part: NAVER Directions 실제 이동시간 (미연결) ─────────
// TODO(9단계): 오늘 숙소/현재 위치 → 후보·장소 간 자동차 이동시간을 Directions 5 로 계산해 { placeId: { durationSeconds, distanceMeters } } 로 넣는다.
//   연결 전까지는 null 이고, 프롬프트에도 "이동시간을 알 수 없다"로 전달된다.
function travelTimesPart() {
  return { context: { travelTimes: null }, facts: { travelTimes: 'not_connected' }, hints: {} }
}

function merge(parts) {
  return {
    context: Object.assign({}, ...parts.map((p) => p.context)),
    facts: Object.assign({}, ...parts.map((p) => p.facts)),
    hints: Object.assign({}, ...parts.map((p) => p.hints)),
  }
}

// 공통 context: currentDate / currentTime / season / currentLocation / weather / transport / companion / preferences
//               + 여행 기간·출발 정보 / 일일 조건 / 숙소 / 방문 기록 / 피드백 / 경험도 / 이동시간
// 반환: { context(Agent 에 전달), origin(후보 검색 기준 좌표), facts(출처), visits(방문 id 집합) }
export async function buildAgentContext({ db, userId, trip, adventureDate, travelRange }) {
  const [preferences, experience, daily, accommodation, visits, feedback] = await Promise.all([
    preferencesPart(db, { userId }),
    experiencePart(db, { userId }),
    dailyPart(db, { trip, adventureDate }),
    accommodationPart(db, { tripId: trip.id, adventureDate }),
    visitsPart(db, { userId, tripId: trip.id }),
    feedbackPart(db, { userId }),
  ])

  // 검색 기준 좌표: 오늘 숙소 좌표가 있으면 그걸, 없으면 제주시 중심(GPS 는 9단계)
  const origin = accommodation.hints.origin ?? JEJU_CITY
  const weather = await weatherPart({ adventureDate, origin })

  const now = kstNow()
  const base = {
    context: {
      currentDate: adventureDate,
      currentTime: adventureDate === now.date ? now.time : '09:00', // 오늘이 아니면 하루 시작 시각 가정
      season: getSeason(adventureDate),
      currentLocation: { ...origin, source: accommodation.hints.origin ? 'accommodation' : 'default_jeju_city' },
      travelRange,
    },
    facts: {},
    hints: {},
  }

  const merged = merge([base, tripPart(trip, adventureDate), daily, preferences, experience, accommodation, visits, feedback, weather, travelTimesPart()])
  return {
    context: merged.context,
    origin,
    facts: merged.facts,
    visits: merged.hints.visits,
  }
}
