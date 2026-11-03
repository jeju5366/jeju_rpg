import { MEAL_QUESTION_ID, STYLE_AXES, STYLE_QUESTIONS } from '../constants/styleTest.js'

// 성향 점수 계산. 기존 방식(성향마다 독립 정규화)을 그대로 쓴다.
//   normalized = raw / (그 성향이 테스트에서 얻을 수 있는 최대 raw) × 100 → 반올림한 0~100 정수
//   · 성향마다 등장 횟수가 달라도 각자의 최대치로 나누므로 특정 성향이 유리해지지 않는다.
//   · 고르지 않은 성향은 0 이다 (50 같은 기본값을 넣지 않는다).
//   · 최대 raw = 문항마다 그 성향에서 가장 높은 선택지 점수의 합 (categoryMaxRaw)
// answers: 문항 순서대로 고른 보기 index 배열 (길이 = 문항 수).
const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)))

// 성향별 최대 raw 점수 { explore: n, ... }
export function categoryMaxRaw(questions = STYLE_QUESTIONS) {
  return Object.fromEntries(STYLE_AXES.map((axis) => [axis, questions.reduce((sum, q) => sum + Math.max(0, ...q.options.map((o) => o.scores[axis] ?? 0)), 0)]))
}

// meal / dessert 선호: Q9 선택지가 기본값을 정하고, Q7 의 카페 선택은 dessert 를 +10 한다. (최대 100)
// meal 과 dessert 는 둘 중 하나만 고르는 값이 아니다. 둘 다 높거나 낮을 수 있다. Q9 에 답하지 않았으면 null (임의 기본값을 만들지 않는다).
export function foodPreferences(answers, questions = STYLE_QUESTIONS) {
  const index = questions.findIndex((q) => q.id === MEAL_QUESTION_ID)
  const picked = index >= 0 ? questions[index].options[answers[index]] : null
  if (!picked || picked.meal == null || picked.dessert == null) return { meal_preference: null, dessert_preference: null }
  const bonus = questions.reduce((sum, q, i) => sum + (q.options[answers[i]]?.dessertBonus ?? 0), 0)
  return { meal_preference: clamp(picked.meal), dessert_preference: clamp(picked.dessert + bonus) }
}

// → { explore, culture, food, relax, social, discovery, meal_preference, dessert_preference }  (DB jeju_travel_preferences 컬럼과 같은 이름)
export function calcStyleScores(answers, questions = STYLE_QUESTIONS) {
  const max = categoryMaxRaw(questions)
  const raw = Object.fromEntries(STYLE_AXES.map((axis) => [axis, questions.reduce((sum, q, i) => sum + (q.options[answers[i]]?.scores[axis] ?? 0), 0)]))
  const scores = Object.fromEntries(STYLE_AXES.map((axis) => [axis, max[axis] ? clamp((raw[axis] / max[axis]) * 100) : 0]))
  return { ...scores, ...foodPreferences(answers, questions) }
}
