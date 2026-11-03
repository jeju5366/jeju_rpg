import { GENERAL_CURVE } from '../utils/level.js'
import { DEMO_USER_ID } from './demoRuntime.js'

// Demo fixture: 기존 DB 행과 같은 모양의 데이터를 만들어서 기존 페이지/컴포넌트를 그대로 쓴다. (시나리오 설정은 scenarios.js)
export const DEMO_TRIP_ID = 'demo-trip'
export const DEMO_ADVENTURE_ID = 'demo-adv-1'

const iso = (ms) => new Date(ms).toISOString()
const KST_MS = 9 * 3600 * 1000
const pad = (n) => String(n).padStart(2, '0')
export const kstDate = (ms) => {
  const d = new Date(ms + KST_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
export const addDays = (ms, days) => ms + days * 86400000

// 데모 장소 (TourAPI 후보와 같은 모양). indoor 는 비 오는 날 REPLAN 의 대체 후보 기준이다. (실제 장소 이름/대략적 좌표)
export const DEMO_PLACES = {
  yongduam: { placeId: 'demo-yongduam', name: '용두암', contentTypeId: 12, category: '관광지', lat: 33.5161, lng: 126.5119, indoor: false },
  dongmun: { placeId: 'demo-dongmun', name: '동문시장', contentTypeId: 38, category: '쇼핑', lat: 33.5128, lng: 126.5278, indoor: false },
  museum: { placeId: 'demo-museum', name: '국립제주박물관', contentTypeId: 14, category: '문화시설', lat: 33.5136, lng: 126.5894, indoor: true },
  hamdeok: { placeId: 'demo-hamdeok', name: '함덕해수욕장', contentTypeId: 12, category: '관광지', lat: 33.543, lng: 126.6697, indoor: false },
  manjang: { placeId: 'demo-manjang', name: '만장굴', contentTypeId: 12, category: '관광지', lat: 33.5284, lng: 126.7714, indoor: false },
  bijarim: { placeId: 'demo-bijarim', name: '비자림', contentTypeId: 12, category: '관광지', lat: 33.4901, lng: 126.8071, indoor: false },
  sunrise: { placeId: 'demo-sunrise', name: '성산일출봉', contentTypeId: 12, category: '관광지', lat: 33.458, lng: 126.9425, indoor: false },
  art: { placeId: 'demo-art', name: '제주도립미술관', contentTypeId: 14, category: '문화시설', lat: 33.4545, lng: 126.4673, indoor: true },
  aqua: { placeId: 'demo-aqua', name: '아쿠아플라넷 제주', contentTypeId: 12, category: '관광지', lat: 33.4333, lng: 126.9288, indoor: true },
  dodu: { placeId: 'demo-dodu', name: '도두봉', contentTypeId: 12, category: '관광지', lat: 33.511, lng: 126.469, indoor: false },
  hallim: { placeId: 'demo-hallim', name: '한담해안산책로', contentTypeId: 12, category: '관광지', lat: 33.463, lng: 126.31, indoor: false },
  hyeopjae: { placeId: 'demo-hyeopjae', name: '협재해수욕장', contentTypeId: 12, category: '관광지', lat: 33.394, lng: 126.239, indoor: false },
}
export const placeList = (...keys) => keys.map((key) => DEMO_PLACES[key])

// 오늘의 모험 3개 후보
export function proposedAdventures() {
  return [
    { title: '동쪽 바람길 탐험', summary: '성산일출봉과 비자림을 지나 함덕 바다까지, 걷고 새로운 풍경을 만나는 하루.', areas: ['성산', '구좌'], categories: ['explore', 'discovery'], places: placeList('sunrise', 'bijarim', 'hamdeok') },
    { title: '제주시 이야기 산책', summary: '용두암에서 박물관, 시장까지 제주 이야기를 따라 천천히 걷는 하루.', areas: ['제주시'], categories: ['culture', 'food'], places: placeList('yongduam', 'museum', 'dongmun') },
    { title: '느긋한 서쪽 바다', summary: '도두봉과 한담해안, 협재 바다에서 여유롭게 쉬어가는 하루.', areas: ['애월', '한림'], categories: ['relax', 'discovery'], places: placeList('dodu', 'hallim', 'hyeopjae') },
  ]
}

// ───────── 퀘스트 구성 (장소 → 챕터/퀘스트) ─────────
const ACTIONS = {
  nature: [
    { core: (n) => `${n}의 풍경 속에서 가장 마음에 드는 곳 찾기`, opt: [(n) => `${n}에서 바람 소리 1분 듣기`, (n) => `${n}에서 처음 보는 식물 하나 찾아보기`], hidden: (n) => `${n}을 배경으로 인생샷 구도 찾기`, category: ['explore', 'relax'] },
  ],
  culture: [{ core: (n) => `${n}에서 가장 인상 깊은 전시/이야기 하나 알아보기`, opt: [(n) => `${n}의 안내문에서 제주 이야기 한 줄 찾기`, (n) => `${n} 주변 골목을 천천히 걸어보기`], hidden: (n) => `${n}에서 오늘의 한 장면 기록하기`, category: ['culture', 'discovery'] }],
  food: [{ core: (n) => `${n}에서 처음 보는 먹거리 하나 맛보기`, opt: [(n) => `${n}에서 상인에게 추천 음식 물어보기`, (n) => `${n}의 지역 특산물 구경하기`], hidden: (n) => `${n}에서 간식 하나 포장해 보기`, category: ['food', 'social'] }],
}
const kindOf = (place) => (place.contentTypeId === 14 ? 'culture' : place.contentTypeId === 38 || place.contentTypeId === 39 ? 'food' : 'nature')

// chapterIndex: 0-based. 반환: { chapter(seq/title/summary/data), quests: [{...row 일부}] } — id 는 호출한 쪽(db)이 붙인다.
export function chapterTemplate(place, index) {
  const kind = kindOf(place)
  const t = ACTIONS[kind][0]
  const [primary, secondary] = t.category
  const outdoor = !place.indoor
  const base = { place_id: place.placeId, place_name: place.name, place_lat: place.lat, place_lng: place.lng, data: { source: 'demo', outdoor } }
  return {
    chapter: { seq: index + 1, title: `${place.name} 이야기`, summary: `${place.name}에서 시작하는 챕터야. ${outdoor ? '야외 활동이 포함돼 있어.' : '실내 중심이라 날씨와 상관없이 즐길 수 있어.'}`, data: { source: 'demo', corePlaceId: place.placeId } },
    quests: [
      { quest_type: 'core', seq: 1, title: t.core(place.name), description: `${place.name}에 도착해서 직접 확인해보자.`, difficulty: 'normal', category_primary: primary, category_secondary: secondary, verification_type: 'gps', verification_target: place.name, is_hidden: false, ...base },
      ...t.opt.map((text, i) => ({ quest_type: 'optional', seq: i + 2, title: text(place.name), description: '가볍게 해볼 수 있는 선택 퀘스트야.', difficulty: i === 0 ? 'easy' : 'normal', category_primary: primary, category_secondary: null, verification_type: 'self', verification_target: null, is_hidden: false, ...base })),
      { quest_type: 'optional', seq: 4, title: t.hidden(place.name), description: '조금 더 해보고 싶을 때 열리는 선택 퀘스트야.', difficulty: 'easy', category_primary: secondary, category_secondary: null, verification_type: 'self', verification_target: null, is_hidden: true, ...base },
    ],
  }
}

// 모험 + 챕터/퀘스트 행을 Demo DB 에 만든다. coreDone: 핵심 퀘스트까지 끝낸 챕터 수(앞에서부터).
export function materializeAdventure(db, { adventure, places, status = 'active', coreDone = 0, nowMs }) {
  const userId = DEMO_USER_ID
  const row = db.insert('jeju_adventures', { id: adventure.id ?? DEMO_ADVENTURE_ID, user_id: userId, trip_id: DEMO_TRIP_ID, adventure_date: adventure.adventure_date, title: adventure.title, summary: adventure.summary, travel_range: 'normal', generation_set: 1, status, data: adventure.data })
  db.insert('jeju_quests', { adventure_id: row.id, user_id: userId, chapter_id: null, quest_type: 'main', title: `${adventure.title} 완주하기`, description: adventure.summary, difficulty: 'normal', category_primary: 'explore', category_secondary: null, verification_type: 'self', verification_target: null, place_id: null, place_name: null, place_lat: null, place_lng: null, is_hidden: false, seq: 1, data: { source: 'demo' }, replaced_at: null })
  const chapters = []
  places.forEach((place, index) => {
    const tpl = chapterTemplate(place, index)
    const done = index < coreDone
    // coreDone=0: 첫 챕터 active / coreDone=n: 앞의 n-1개는 닫힘(completed), n번째는 핵심만 끝난 상태(core_completed), 나머지는 잠김
    const chapterStatus = coreDone === 0 ? (index === 0 ? 'active' : 'locked') : index < coreDone - 1 ? 'completed' : index === coreDone - 1 ? 'core_completed' : 'locked'
    const chapter = db.insert('jeju_chapters', { adventure_id: row.id, user_id: userId, ...tpl.chapter, status: chapterStatus, activated_at: index <= Math.max(0, coreDone - 1) ? iso(nowMs - (index === Math.max(0, coreDone - 1) ? 15 : 200 - index * 40) * 60000) : null, closed_at: chapterStatus === 'completed' ? iso(nowMs - (120 - index * 40) * 60000) : null })
    chapters.push(chapter)
    for (const quest of tpl.quests) {
      const q = db.insert('jeju_quests', { adventure_id: row.id, user_id: userId, chapter_id: chapter.id, replaced_at: null, ...quest })
      if (done && quest.quest_type === 'core') db.insert('jeju_quest_progress', { user_id: userId, quest_id: q.id, status: 'completed', verification_method: 'gps', completed_at: iso(nowMs - 10 * 60000), photo_attempts: 0 })
    }
  })
  return { adventure: row, chapters }
}

// ───────── 경험치 (레벨업 직전) ─────────
export function nearLevelUpExps() {
  const cum = GENERAL_CURVE.cumulative
  const explore = cum[3] - 12 // 탐험이 다음 레벨 직전
  const others = { culture: 60, food: 85, relax: 40, social: 30, discovery: 70 }
  const sumOthers = Object.values(others).reduce((a, b) => a + b, 0)
  // 전체 레벨도 직전이 되게 탐험에 맞춰 나머지를 조정한다
  let k = 2
  while (cum[k] - 12 < explore + sumOthers) k += 1
  const extra = cum[k] - 12 - (explore + sumOthers)
  return { explore, ...others, food: others.food + extra }
}

export const midExps = () => ({ explore: 140, culture: 90, food: 120, relax: 60, social: 45, discovery: 75 })
