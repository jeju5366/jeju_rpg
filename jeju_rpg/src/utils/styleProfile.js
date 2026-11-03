import { STYLE_AXES } from '../constants/styleTest.js'

// 성향 테스트 결과를 사용자에게 설명하기 위한 "표현용" helper. (성향 테스트 결과 Modal 과 모험가 탭 카드가 같이 쓴다)
// ⚠ 여기서 만든 RPG 성향 타이틀/설명은 사용자 설명용 파생값이다. DB 에 저장하지 않고, Agent 입력/추천 가중치도 바꾸지 않는다.
//    점수 계산(calcStyleScores)은 건드리지 않는다. OpenAI 도 호출하지 않는다.

export const AXIS_LABEL = { explore: '탐험', culture: '문화', food: '미식', relax: '휴식', social: '교류', discovery: '발견' }

const AXIS_PHRASE = {
  explore: '직접 움직이고 도전하는 경험을 즐기는 편이야',
  culture: '지역의 역사와 이야기를 알아가는 걸 좋아해',
  food: '여행에서 먹는 경험을 소중하게 생각해',
  relax: '여유로운 풍경과 느린 일정을 좋아해',
  social: '사람들과 함께하는 경험에서 즐거움을 느껴',
  discovery: '아직 경험해보지 않은 새로운 곳을 만나는 걸 좋아해',
}

// 상위 2개 성향(순서 무관) → RPG 성향 타이틀
const PAIR_TITLES = {
  'explore+culture': '이야기를 따라 걷는 탐험가',
  'explore+food': '맛을 찾아 움직이는 탐험가',
  'explore+relax': '여유와 모험을 오가는 여행가',
  'explore+social': '함께 움직이는 모험가',
  'explore+discovery': '새로운 길을 찾는 탐험가',
  'culture+food': '제주의 맛과 이야기를 즐기는 여행가',
  'culture+relax': '천천히 제주를 읽는 여행가',
  'culture+social': '사람과 이야기를 잇는 여행가',
  'culture+discovery': '숨은 이야기를 찾는 탐구가',
  'food+relax': '맛과 여유를 즐기는 여행가',
  'food+social': '함께 맛보는 미식 여행가',
  'food+discovery': '새로운 맛을 찾는 미식 탐험가',
  'relax+social': '함께 쉬어가는 여행가',
  'relax+discovery': '느긋하게 새로운 풍경을 찾는 여행가',
  'social+discovery': '새로운 만남을 즐기는 여행가',
}

const pairKey = (a, b) => [a, b].sort((x, y) => STYLE_AXES.indexOf(x) - STYLE_AXES.indexOf(y)).join('+')

// 점수 내림차순, 동점이면 STYLE_AXES 순서(항상 같은 결과). → [{ axis, label, score }]
export function rankedAxes(scores) {
  return STYLE_AXES.map((axis, order) => ({ axis, label: AXIS_LABEL[axis], score: Number(scores?.[axis]) || 0, order }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ axis, label, score }) => ({ axis, label, score }))
}

// 저장된 성향(jeju_travel_preferences 행 또는 calcStyleScores 결과) → 화면용 요약. 점수가 하나도 없으면 null.
export function summarizeStyle(preferences) {
  if (!preferences || !STYLE_AXES.some((axis) => Number.isFinite(Number(preferences[axis])))) return null
  const ranked = rankedAxes(preferences)
  const [first, second] = ranked
  const meal = Number.isFinite(Number(preferences.meal_preference)) && preferences.meal_preference !== null ? Number(preferences.meal_preference) : null
  const dessert = Number.isFinite(Number(preferences.dessert_preference)) && preferences.dessert_preference !== null ? Number(preferences.dessert_preference) : null
  return {
    title: PAIR_TITLES[pairKey(first.axis, second.axis)],
    top: ranked.slice(0, 3),
    all: ranked,
    description: [`${AXIS_LABEL[first.axis]} 성향이 가장 높아. ${AXIS_PHRASE[first.axis]}.`, `${AXIS_LABEL[second.axis]} 성향도 높아서, ${AXIS_PHRASE[second.axis]}.`],
    meal,
    dessert,
  }
}
