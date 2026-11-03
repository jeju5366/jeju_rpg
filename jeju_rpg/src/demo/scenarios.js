import { JEJU_AIRPORT } from '../constants/jeju.js'
import { estimateTravel } from '../utils/travel.js'
import { calcStyleScores } from '../utils/styleScore.js'
import { STYLE_QUESTIONS } from '../constants/styleTest.js'
import { createDemoDb } from './demoDb.js'
import { DEMO_USER_ID, demoNow } from './demoRuntime.js'
import { addDays, DEMO_ADVENTURE_ID, DEMO_PLACES, DEMO_TRIP_ID, kstDate, materializeAdventure, midExps, nearLevelUpExps, placeList } from './fixtures.js'

// Demo 시나리오 7종. 각 시나리오는 "시작 상태"(fixture + 시뮬레이션 값)만 정한다. 화면/동작은 실제 페이지와 같은 컴포넌트를 쓰고,
// 데이터는 Demo DB(demoDb) + 서버 흉내(demoApi)에서 온다. (시나리오별 전용 페이지는 없다)
//   build(nowMs) → { seed 옵션 } 를 buildDemoDb 가 받아 DB 를 만든다.
//   settings: { weather, failures, position, controls, freeTravel }
const answerIndexes = (axes) => STYLE_QUESTIONS.map((q) => Math.max(0, q.options.findIndex((o) => axes.some((a) => (o.scores[a] ?? 0) >= 2))))

export const DEMO_SCENARIOS = [
  {
    id: 'tour',
    emoji: '🧭',
    label: '둘러보기',
    description: '이벤트를 강제하지 않고 홈·모험·퀘스트·지도·기록·모험가를 자유롭게 둘러봐.',
    badge: '🧭 둘러보기',
    options: { lastDay: false, adventure: 'active', coreDone: 1, exps: 'mid', history: true },
    settings: { weather: 'clear', failures: [], controls: [] },
    log: '둘러보기: 여행 2일차, 진행 중인 모험과 방문/추억/칭호 기록이 준비돼 있어.',
  },
  {
    id: 'sunny',
    emoji: '☀️',
    label: '첫 여행자 / 맑은 날',
    description: '제주에 막 도착한 맑은 날. 모험 3개 후보를 받고 선택 → 퀘스트 진행까지 정상 흐름을 보여줘.',
    badge: '☀️ 첫 여행자',
    options: { lastDay: false, adventure: 'none', coreDone: 0, exps: 'zero', history: false, firstDay: true },
    settings: { weather: 'clear', failures: [], controls: [] },
    log: '첫 여행자: 맑은 날, 렌터카, 일정 여유. 탐험/발견 성향이 상대적으로 높아.',
  },
  {
    id: 'rain',
    emoji: '🌧️',
    label: '비 오는 날 → REPLAN',
    description: '야외 일정 중에 비가 많이 와. 시스템이 감지해서 일정 재조정을 제안하고, 승인해야만 바뀌어.',
    badge: '🌧 비 오는 날',
    options: { lastDay: false, adventure: 'active', coreDone: 0, exps: 'mid', history: true, outdoor: true },
    settings: { weather: 'rain', failures: [], controls: [] },
    log: '비 오는 날: 야외 일정이 포함된 모험 진행 중. 강수가 늘어나 REPLAN 제안이 나올 거야.',
  },
  {
    id: 'final',
    emoji: '✈️',
    label: '공항까지 약 2시간 → Final Quest',
    description: '마지막 날, 대중교통으로 공항까지 약 2시간. 안전 출발 시각이 임박해서 Final Quest로 이어져.',
    badge: '✈️ 마지막 날',
    options: { lastDay: true, adventure: 'active', coreDone: 2, exps: 'mid', history: true, transport: 'public_transit' },
    settings: { weather: 'clear', failures: [], position: { lat: 33.5, lng: 126.75, accuracy: 20 }, controls: [{ id: 'advance', label: '⏩ 15분 후로' }] },
    log: '마지막 날: 조천 근처, 공항까지 대중교통 약 2시간. 곧 안전 출발 시각이야.',
  },
  {
    id: 'levelup',
    emoji: '⭐',
    label: '레벨업 직전',
    description: '다음 레벨까지 EXP가 조금 남았어. 퀘스트 하나를 완료하면 보상 팝업과 LEVEL UP이 나와.',
    badge: '⭐ 레벨업 직전',
    options: { lastDay: false, adventure: 'active', coreDone: 0, exps: 'levelup', history: true, outdoor: true },
    settings: { weather: 'clear', failures: [], position: { lat: 33.5161, lng: 126.5119, accuracy: 20 }, controls: [] },
    log: '레벨업 직전: 탐험 EXP가 다음 레벨 직전이야. 퀘스트를 완료해봐.',
  },
  {
    id: 'freetravel',
    emoji: '🚶',
    label: '자유여행 복귀 → REPLAN 제안',
    description: '자유여행 중에 원래 동선에서 꽤 벗어났어. 자유여행을 끝내면 복귀 판정 후 일정 재조정을 제안해.',
    badge: '🚶 자유여행',
    options: { lastDay: false, adventure: 'active', coreDone: 1, exps: 'mid', history: true, freeTravel: true },
    settings: { weather: 'clear', failures: [], position: { lat: 33.4333, lng: 126.9288, accuracy: 25 }, controls: [] },
    log: '자유여행 복귀: 원래 동선에서 벗어난 위치에서 자유여행 중이야. 종료하면 복귀 판정을 해.',
  },
  {
    id: 'outage',
    emoji: '⚠️',
    label: 'API 장애 → Fallback',
    description: '장소·날씨·길찾기·AI가 실패하는 상황을 흉내 내. 앱은 준비된 기본 정보로 계속 진행하고 Agent Log에 기록돼.',
    badge: '⚠️ API 장애',
    options: { lastDay: false, adventure: 'none', coreDone: 0, exps: 'zero', history: false, firstDay: true },
    settings: { weather: 'clear', failures: ['places', 'weather', 'directions', 'openai'], controls: [] },
    log: 'API 장애: 장소/날씨/길찾기/AI 응답이 실패하도록 시뮬레이션했어.',
  },
]

export const findScenario = (id) => DEMO_SCENARIOS.find((s) => s.id === id) ?? null

// ───────── Demo DB 만들기 ─────────
export function buildDemoDb(scenario, nowMs) {
  const o = scenario.options
  const today = kstDate(nowMs)
  const exps = o.exps === 'levelup' ? nearLevelUpExps() : o.exps === 'zero' ? { explore: 0, culture: 0, food: 0, relax: 0, social: 0, discovery: 0 } : midExps()
  const transport = o.transport ?? 'rental_car'
  const position = scenario.settings.position ?? { lat: 33.5, lng: 126.53 }

  // 마지막 날: 공항 도착 목표 − 이동시간 − 10분이 "지금 + 10분"이 되도록 출발 시각을 잡는다. (안전 출발 시각 임박 → notice)
  const travelMin = estimateTravel({ from: position, to: JEJU_AIRPORT, transport }).minutes
  const departureAt = o.lastDay ? nowMs + (90 + travelMin + 10) * 60000 : addDays(nowMs, 2) + 5 * 3600000

  const db = createDemoDb({}, { now: demoNow, rpc: demoRpcHandlers })
  db.insert('jeju_profiles', { id: DEMO_USER_ID, nickname: '데모 모험가', ...Object.fromEntries(Object.entries(exps).map(([k, v]) => [`exp_${k}`, v])), unspent_exp: o.history ? 20 : 0, current_title: null, onboarding_completed: true })
  db.insert('jeju_characters', { user_id: DEMO_USER_ID, body_type: 'female' })
  const style = o.firstDay || !o.history ? answerIndexes(['explore', 'discovery']) : answerIndexes(['explore', 'discovery', 'culture'])
  db.insert('jeju_travel_preferences', { user_id: DEMO_USER_ID, ...calcStyleScores(style) })

  const startDate = o.lastDay ? kstDate(addDays(nowMs, -2)) : o.firstDay ? today : kstDate(addDays(nowMs, -1))
  const endDate = o.lastDay ? today : kstDate(addDays(nowMs, o.firstDay ? 3 : 2))
  db.insert('jeju_trips', {
    id: DEMO_TRIP_ID,
    user_id: DEMO_USER_ID,
    start_date: startDate,
    end_date: endDate,
    companion: 'couple',
    transport,
    party_size: 2,
    arrival_flight: 'ZE1031',
    departure_flight: 'ZE1033',
    departure_datetime: new Date(departureAt).toISOString(),
    desired_end_time: '21:00',
    travel_range: 'normal',
    status: 'active',
    travel_mode: o.freeTravel ? 'free' : 'quest',
    created_at: new Date(addDays(nowMs, -5)).toISOString(),
  })
  db.insert('jeju_accommodations', { trip_id: DEMO_TRIP_ID, user_id: DEMO_USER_ID, name: '제주 데모 스테이', address: '제주시 연동 (데모)', latitude: 33.4885, longitude: 126.4985, check_in: startDate, check_out: endDate })

  if (o.adventure === 'active') {
    const places = o.lastDay ? placeList('hamdeok', 'sunrise', 'aqua') : o.outdoor ? placeList('yongduam', 'hamdeok', 'museum') : placeList('dongmun', 'museum', 'hamdeok')
    materializeAdventure(db, {
      adventure: { id: DEMO_ADVENTURE_ID, adventure_date: today, title: o.lastDay ? '성산에서 공항으로 가는 길' : o.outdoor ? '바다와 이야기 산책' : '제주시 하루 모험', summary: '데모용으로 준비된 모험이야.', data: { source: 'demo', demo: true, areas: ['제주'], categories: ['explore', 'culture'], places, facts: { places: 'demo', weather: 'demo' } } },
      places,
      coreDone: o.coreDone,
      nowMs,
    })
  }

  if (o.history) {
    // 이전 방문/발견/추억/칭호 + 끝난 지난 여행 1개 (기록 탭/모험가 탭이 비어 보이지 않게)
    for (const [i, key] of ['yongduam', 'museum', 'dongmun'].entries()) {
      const p = DEMO_PLACES[key]
      db.insert('jeju_place_visits', { user_id: DEMO_USER_ID, trip_id: DEMO_TRIP_ID, place_id: p.placeId, place_name: p.name, place_lat: p.lat, place_lng: p.lng, visit_source: 'quest', visited_at: new Date(addDays(nowMs, -1) + i * 3600000).toISOString() })
    }
    db.insert('jeju_place_discoveries', { user_id: DEMO_USER_ID, place_id: DEMO_PLACES.yongduam.placeId, place_name: '용두암', discovery_type: 'normal', discovered_at: new Date(addDays(nowMs, -1)).toISOString() })
    db.insert('jeju_travel_photos', { user_id: DEMO_USER_ID, trip_id: DEMO_TRIP_ID, is_memory: true, storage_path: 'demo/memory-1.jpg', caption: '용두암 바다', place_id: DEMO_PLACES.yongduam.placeId, created_at: new Date(addDays(nowMs, -1)).toISOString() })
    db.insert('jeju_travel_photos', { user_id: DEMO_USER_ID, trip_id: DEMO_TRIP_ID, is_memory: true, storage_path: 'demo/memory-2.jpg', caption: '박물관 산책', place_id: DEMO_PLACES.museum.placeId, created_at: new Date(addDays(nowMs, -1)).toISOString() })
    const title = db.insert('jeju_titles', { code: 'trip_first_complete', title_type: 'behavior', name: '제주 첫 모험 완료' })
    db.insert('jeju_user_titles', { user_id: DEMO_USER_ID, title_id: title.id, trip_id: 'demo-trip-old', earned_at: new Date(addDays(nowMs, -60)).toISOString() })
    db.insert('jeju_trips', { id: 'demo-trip-old', user_id: DEMO_USER_ID, start_date: kstDate(addDays(nowMs, -63)), end_date: kstDate(addDays(nowMs, -60)), companion: 'friends', transport: 'rental_car', party_size: 2, status: 'completed', completed_at: new Date(addDays(nowMs, -60)).toISOString(), retrospective: '친구들과 제주 동쪽을 걸으며 새로운 풍경을 많이 만났어요. 수고했어요!', retrospective_source: 'stats', created_at: new Date(addDays(nowMs, -70)).toISOString() })
  }
  return db
}

// Demo DB 의 rpc: 홈의 "여행 정보 수정" 같은 클라이언트의 DB 함수 호출. (여행 설정 최초 저장은 Demo 에서 지원하지 않는다)
export const demoRpcHandlers = {
  jeju_update_trip_info: async ({ p_trip_id, p_trip }, api) => {
    api.patch('jeju_trips', (t) => t.id === p_trip_id, {
      ...(p_trip.start_date ? { start_date: p_trip.start_date } : {}),
      ...(p_trip.end_date ? { end_date: p_trip.end_date } : {}),
      departure_flight: p_trip.departure_flight || null,
      departure_datetime: p_trip.departure_datetime || null,
    })
    return null
  },
}
