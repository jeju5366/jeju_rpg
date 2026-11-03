import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MEAL_QUESTION_ID, STYLE_AXES, STYLE_QUESTIONS } from '../src/constants/styleTest.js'
import { calcStyleScores, categoryMaxRaw, foodPreferences } from '../src/utils/styleScore.js'

const COLUMNS = ['explore', 'culture', 'food', 'relax', 'social', 'discovery', 'meal_preference', 'dessert_preference']
const q = (id) => STYLE_QUESTIONS.findIndex((question) => question.id === id)

// 선택 규칙: 각 문항에서 선호 성향 점수가 가장 높은 선택지를 고른다 (동점이면 앞쪽). overrides: { 문항 id: 선택지 index }
function respond(axes, overrides = {}) {
  return STYLE_QUESTIONS.map((question, i) => {
    if (overrides[question.id] != null) return overrides[question.id]
    let best = 0
    let bestScore = -1
    question.options.forEach((option, index) => {
      const score = axes.reduce((sum, axis) => sum + (option.scores[axis] ?? 0), 0)
      if (score > bestScore) [best, bestScore] = [index, score]
    })
    return i >= 0 ? best : 0
  })
}
const rank = (scores) => STYLE_AXES.slice().sort((a, b) => scores[b] - scores[a])

// ───────── 구조 ─────────
test('정확히 12문항, 모든 문항은 4개 선택지, 문구는 비어 있지 않다', () => {
  assert.equal(STYLE_QUESTIONS.length, 12)
  assert.deepEqual(STYLE_QUESTIONS.map((x) => x.id), Array.from({ length: 12 }, (_, i) => `q${i + 1}`))
  for (const question of STYLE_QUESTIONS) {
    assert.ok(question.text.trim().length > 0)
    assert.equal(question.options.length, 4, question.id)
    assert.equal(new Set(question.options.map((o) => o.label)).size, 4, `${question.id} 선택지 문구 중복`)
    for (const option of question.options) assert.ok(option.label.trim().length > 0)
  }
})

test('scoring map: 허용된 기본 성향 6개만, 선택지당 최대 2개 성향, 일반은 +2/+1 (Q9 C 의 food +3 만 예외)', () => {
  for (const question of STYLE_QUESTIONS) {
    for (const [index, option] of question.options.entries()) {
      const entries = Object.entries(option.scores)
      assert.ok(entries.length >= 1 && entries.length <= 2, `${question.id}-${index}: 성향 ${entries.length}개`)
      for (const [axis, value] of entries) {
        assert.ok(STYLE_AXES.includes(axis), `${question.id}-${index}: 허용되지 않은 성향 ${axis}`)
        assert.ok(Number.isInteger(value) && value >= 0, `${question.id}-${index}`)
        const exception = question.id === MEAL_QUESTION_ID && index === 2 && axis === 'food' && value === 3
        assert.ok(value <= 2 || exception, `${question.id}-${index}: ${axis} +${value}`)
      }
      // 보조(+1)는 주(+2) 성향이 있을 때만
      const values = entries.map(([, v]) => v)
      if (values.includes(1)) assert.ok(values.includes(2) || values.length === 1, `${question.id}-${index}`)
    }
  }
})

test('meal/dessert 기본값은 Q9 에만, dessertBonus 는 Q7 C 에만', () => {
  for (const question of STYLE_QUESTIONS) {
    for (const [index, option] of question.options.entries()) {
      const hasFood = option.meal != null || option.dessert != null
      assert.equal(hasFood, question.id === MEAL_QUESTION_ID, `${question.id}-${index}`)
      if (hasFood) for (const v of [option.meal, option.dessert]) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100)
      assert.equal(option.dessertBonus != null, question.id === 'q7' && index === 2, `${question.id}-${index}`)
    }
  }
})

test('사용자에게 성향 이름/점수를 보여주지 않는다 (문항 화면이 scores 를 그리지 않음)', () => {
  const page = readFileSync('src/pages/StyleTestPage.jsx', 'utf8')
  assert.doesNotMatch(page, /\.scores|explore|culture|discovery|relax|social/)
  assert.match(page, /STYLE_QUESTIONS/)
  assert.match(page, /calcStyleScores\(answers\)/) // 저장은 계산 결과를 그대로
})

// ───────── 정규화 ─────────
test('성향별 최대 raw 를 기준으로 독립 정규화: 한 성향의 모든 최고 선택지를 고르면 그 성향은 100', () => {
  const max = categoryMaxRaw()
  for (const axis of STYLE_AXES) assert.ok(max[axis] > 0, axis)
  assert.deepEqual(max, { explore: 18, culture: 16, food: 9, relax: 18, social: 10, discovery: 22 })
  for (const axis of STYLE_AXES) {
    const answers = STYLE_QUESTIONS.map((question) => {
      let best = 0
      question.options.forEach((o, i) => (o.scores[axis] ?? 0) > (question.options[best].scores[axis] ?? 0) && (best = i))
      return best
    })
    assert.equal(calcStyleScores(answers)[axis], 100, axis)
  }
})

test('고르지 않은 성향은 0 (50 같은 기본값 없음), 모든 점수는 0~100 정수 (무작위 응답 2000개)', () => {
  let seed = 12345
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  for (let n = 0; n < 2000; n += 1) {
    const answers = STYLE_QUESTIONS.map(() => Math.floor(rand() * 4))
    const scores = calcStyleScores(answers)
    assert.deepEqual(Object.keys(scores).sort(), [...COLUMNS].sort())
    for (const key of COLUMNS) assert.ok(Number.isInteger(scores[key]) && scores[key] >= 0 && scores[key] <= 100, `${key}=${scores[key]}`)
  }
  // 사회성 선택지를 하나도 고르지 않으면 social 은 0
  const noSocial = respond(['explore', 'relax'])
  assert.equal(calcStyleScores(noSocial).social, 0)
})

test('성향 개수가 달라도 유리해지지 않는다: social(5문항)과 explore(10문항)를 같은 비율로 고르면 같은 점수대', () => {
  const social = calcStyleScores(respond(['social'])).social
  const explore = calcStyleScores(respond(['explore'])).explore
  assert.equal(social, 100)
  assert.equal(explore, 100)
})

// ───────── meal / dessert ─────────
test('Q9 A/B/C/D: 의도한 meal/dessert 차이, 둘은 서로 독립 (C 는 둘 다 높고 D 는 둘 다 낮다)', () => {
  const at = (index) => foodPreferences(STYLE_QUESTIONS.map((_, i) => (i === q('q9') ? index : 0)))
  assert.deepEqual(at(0), { meal_preference: 90, dessert_preference: 30 })
  assert.deepEqual(at(1), { meal_preference: 35, dessert_preference: 90 })
  assert.deepEqual(at(2), { meal_preference: 80, dessert_preference: 80 })
  assert.deepEqual(at(3), { meal_preference: 20, dessert_preference: 20 })
})

test('Q7 C 는 dessert 를 +10 하고 100 을 넘지 않는다. meal 은 변하지 않는다', () => {
  const base = STYLE_QUESTIONS.map(() => 0)
  const withCafe = (q9) => foodPreferences(base.map((_, i) => (i === q('q7') ? 2 : i === q('q9') ? q9 : 0)))
  assert.deepEqual(withCafe(0), { meal_preference: 90, dessert_preference: 40 })
  assert.deepEqual(withCafe(2), { meal_preference: 80, dessert_preference: 90 })
  assert.equal(withCafe(1).dessert_preference, 100) // 90 + 10
  // 100 초과 방어: 가상의 문항 구성에서 95 + 10 = 100
  const custom = [
    { id: 'q7', options: [{ scores: { relax: 2 }, dessertBonus: 10 }] },
    { id: 'q9', options: [{ scores: { food: 2 }, meal: 50, dessert: 95 }] },
  ]
  assert.equal(foodPreferences([0, 0], custom).dessert_preference, 100)
  // Q7 의 다른 선택지는 보정 없음
  assert.equal(foodPreferences(base.map((_, i) => (i === q('q7') ? 0 : 0))).dessert_preference, 30)
})

test('Q9 에 답하지 않았다면 meal/dessert 는 null (임의 기본값 없음)', () => {
  const answers = STYLE_QUESTIONS.map((_, i) => (i === q('q9') ? undefined : 0))
  assert.deepEqual(foodPreferences(answers), { meal_preference: null, dessert_preference: null })
})

// ───────── 저장 호환성 ─────────
test('저장 payload 는 기존 jeju_travel_preferences 컬럼(explore~discovery, meal_preference, dessert_preference)과 호환된다', () => {
  const payload = calcStyleScores(STYLE_QUESTIONS.map(() => 1))
  const schema = readFileSync('supabase/001_auth_profiles.sql', 'utf8')
  for (const key of Object.keys(payload)) assert.match(schema, new RegExp(`\\b${key}\\b`), `${key} 컬럼 없음`)
  assert.deepEqual(Object.keys(payload).sort(), [...COLUMNS].sort())
  // 002 migration 이후 meal/dessert 는 integer 0~100
  assert.match(readFileSync('supabase/002_nickname_and_preference_scores.sql', 'utf8'), /meal_preference[\s\S]*type integer/)
  assert.match(readFileSync('src/services/supabase/profileService.js', 'utf8'), /upsert\(\{ user_id: userId, \.\.\.scores \}/)
})

// ───────── 가상 여행자 sanity ─────────
test('탐험/발견형: explore 와 discovery 가 상위권', () => {
  const scores = calcStyleScores(respond(['explore', 'discovery']))
  const top = rank(scores).slice(0, 2)
  assert.ok(top.includes('explore') && top.includes('discovery'), JSON.stringify(scores))
})

test('휴식/카페형: relax 가 높고 dessert_preference 가 높다', () => {
  const scores = calcStyleScores(respond(['relax'], { q7: 2, q9: 1 }))
  assert.equal(rank(scores)[0], 'relax')
  assert.ok(scores.dessert_preference >= 90, JSON.stringify(scores))
  assert.ok(scores.dessert_preference > scores.meal_preference)
})

test('문화/교류형: culture 와 social 이 상대적으로 높다', () => {
  const scores = calcStyleScores(respond(['culture', 'social']))
  const top3 = rank(scores).slice(0, 3)
  assert.ok(top3.includes('culture') && top3.includes('social'), JSON.stringify(scores))
  assert.ok(scores.culture >= 70 && scores.social >= 70, JSON.stringify(scores))
})

// ───────── Agent 에서의 의미 ─────────
test('Agent 입력: 성향은 장기 기본값, 피드백/최근 행동은 단기 조정, 경험도(level)는 선호도가 아니다', () => {
  for (const file of ['api/_lib/agent/adventures.js', 'api/_lib/agent/quests.js']) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /장기 기본 성향\(base preference\)/)
    assert.match(source, /덮어쓰지 않고 오늘 추천의 강도만 조정하는 단기 신호/)
    assert.match(source, /experience 가 높다고 그 카테고리/) // 레벨이 높아도 비율을 늘리지 않는다
  }
  const context = readFileSync('api/_lib/agent/context.js', 'utf8')
  assert.match(context, /meal_preference/)
  assert.match(context, /experience\s+= 경험도/)
})
