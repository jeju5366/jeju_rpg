import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { STYLE_AXES } from '../src/constants/styleTest.js'
import { UI_TEXT } from '../src/constants/uiText.js'
import { calcStyleScores } from '../src/utils/styleScore.js'
import { rankedAxes, summarizeStyle } from '../src/utils/styleProfile.js'

const read = (file) => readFileSync(file, 'utf8')
const only = (a, b, extra = {}) => ({ ...Object.fromEntries(STYLE_AXES.map((x) => [x, 0])), [a]: 90, [b]: 80, ...extra })

test('상위 2개 성향 조합 15가지가 모두 문서의 RPG 성향 타이틀로 매핑된다 (순서 무관)', () => {
  const expected = {
    'explore+culture': '이야기를 따라 걷는 탐험가', 'explore+food': '맛을 찾아 움직이는 탐험가', 'explore+relax': '여유와 모험을 오가는 여행가',
    'explore+social': '함께 움직이는 모험가', 'explore+discovery': '새로운 길을 찾는 탐험가', 'culture+food': '제주의 맛과 이야기를 즐기는 여행가',
    'culture+relax': '천천히 제주를 읽는 여행가', 'culture+social': '사람과 이야기를 잇는 여행가', 'culture+discovery': '숨은 이야기를 찾는 탐구가',
    'food+relax': '맛과 여유를 즐기는 여행가', 'food+social': '함께 맛보는 미식 여행가', 'food+discovery': '새로운 맛을 찾는 미식 탐험가',
    'relax+social': '함께 쉬어가는 여행가', 'relax+discovery': '느긋하게 새로운 풍경을 찾는 여행가', 'social+discovery': '새로운 만남을 즐기는 여행가',
  }
  assert.equal(Object.keys(expected).length, 15)
  for (const [pair, title] of Object.entries(expected)) {
    const [a, b] = pair.split('+')
    assert.equal(summarizeStyle(only(a, b)).title, title, pair)
    assert.equal(summarizeStyle(only(b, a)).title, title, `${pair} 반대 순서(점수 순서만 바뀜)`)
  }
})

test('동점 정렬은 항상 같다 (STYLE_AXES 순서가 tie-breaker), 상위 3개와 전체 순위', () => {
  const tie = Object.fromEntries(STYLE_AXES.map((axis) => [axis, 50]))
  assert.deepEqual(rankedAxes(tie).map((r) => r.axis), STYLE_AXES)
  assert.deepEqual(summarizeStyle(tie).top.map((r) => r.axis), ['explore', 'culture', 'food'])
  assert.equal(summarizeStyle(tie).title, '이야기를 따라 걷는 탐험가') // 탐험 + 문화
  for (let i = 0; i < 5; i += 1) assert.equal(summarizeStyle({ ...tie, relax: 70, social: 70 }).title, '함께 쉬어가는 여행가')
  const summary = summarizeStyle(only('food', 'relax', { explore: 40 }))
  assert.deepEqual(summary.top.map((r) => [r.axis, r.score]), [['food', 90], ['relax', 80], ['explore', 40]])
  assert.equal(summary.description.length, 2) // 짧은 설명 1~2개
})

test('식사/디저트 관심도는 null 이 아닐 때만 보이고, 점수가 없으면 요약 없음 (OpenAI 호출 없음)', () => {
  assert.equal(summarizeStyle(null), null)
  assert.equal(summarizeStyle({}), null)
  assert.deepEqual([summarizeStyle(only('food', 'relax')).meal, summarizeStyle(only('food', 'relax')).dessert], [null, null])
  const withMeal = summarizeStyle({ ...only('food', 'relax'), meal_preference: 80, dessert_preference: 0 })
  assert.deepEqual([withMeal.meal, withMeal.dessert], [80, 0])
  assert.doesNotMatch(read('src/utils/styleProfile.js'), /fetch\(|callResponses|import .*openai/i)
  // 점수 계산식은 그대로: 실제 테스트 결과로도 요약이 만들어진다
  assert.ok(summarizeStyle(calcStyleScores([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).title)
})

test('성향 결과 Modal: 저장 성공 후에만 표시, 닫기/계속은 이동만 (다시 저장하지 않음)', () => {
  const page = read('src/pages/StyleTestPage.jsx')
  assert.ok(page.indexOf('await saveTravelPreferences') < page.indexOf('setResult(summarizeStyle'))
  assert.match(page, /\{result && \(\s*<StyleResultModal/)
  assert.match(page, /navigate\(onboardingCompleted \? '\/profile' : '\/setup'/)
  const handleFinish = page.slice(page.indexOf('const handleFinish'), page.indexOf('return (', page.indexOf('const handleFinish')))
  assert.equal((handleFinish.match(/saveTravelPreferences/g) ?? []).length, 1)
  assert.doesNotMatch(read('src/components/style/StyleResultModal.jsx'), /saveTravelPreferences/)
  assert.equal(UI_TEXT.style.resultTitle, '너의 여행 성향을 발견했어!')
  assert.match(read('src/utils/styleScore.js'), /categoryMaxRaw/) // 점수 계산식 파일은 그대로 (이번 작업에서 수정하지 않음)
})

test('모험가 탭: 성향 카드(다시 하기 확인 Modal) + 실패해도 EXP 화면은 그대로 + 재테스트는 overwrite 만', () => {
  const profile = read('src/pages/ProfilePage.jsx')
  assert.match(profile, /fetchTravelPreferences\(user\.id\)/)
  assert.match(profile, /<StyleProfileCard state=\{styleState\} preferences=\{preferences\} \/>/)
  assert.match(profile, /\.catch\(\(\) => active && setStyleState\('error'\)\)/) // 성향 카드만 error 상태
  const card = read('src/components/style/StyleProfileCard.jsx')
  assert.match(card, /navigate\('\/style-test'\)/)
  assert.equal(UI_TEXT.style.retakeConfirm, '성향 테스트를 다시 진행할까? 완료하면 기존 여행 성향이 새 결과로 변경돼.')
  assert.equal(UI_TEXT.style.retake, '성향 테스트 다시 하기')
  // 재테스트가 온보딩 상태를 바꾸지 않는다: /style-test 는 RequireAuth 만 요구하고 save 는 upsert
  assert.match(read('src/app/router.jsx'), /\{ path: '\/style-test'/)
  assert.match(read('src/services/supabase/profileService.js'), /upsert\(\{ user_id: userId, \.\.\.scores \}, \{ onConflict: 'user_id' \}\)/)
  assert.doesNotMatch(read('src/pages/StyleTestPage.jsx'), /onboarding_completed|setOnboardingCompleted/)
})

test('/setup 문구: 항공편 예시/설명, 숙소 안내, 마무리 시간 (placeholder/help 로만, 입력값 아님)', () => {
  const t = UI_TEXT.onboarding
  assert.equal(t.flightHelp, '예: ZE1033 · 항공편명을 입력하면 마지막 날 공항 이동 시간을 더 안전하게 안내할 수 있어.')
  assert.equal(t.accommodationHelp, '숙소를 정확하게 입력하면 복귀 동선까지 고려해 모험을 구성해줘.')
  assert.match(t.departureDateTime, /^이번 제주 모험을 마무리하는 시간/)
  assert.match(t.departureDateTime, /선택/) // 여전히 선택 입력
  assert.equal(t.departureDateTimeHelp, '마지막 날 공항 이동과 여행 마무리 일정을 계획할 때 사용해.')
  const page = read('src/pages/TravelSetupPage.jsx')
  assert.match(page, /placeholder=\{text\.flightExample\}/)
  assert.doesNotMatch(page, /arrivalFlight: 'ZE1033'|departureFlight: 'ZE1033'/) // 미리 채워진 값 아님
  assert.match(page, /departure_datetime|departureDateTime/) // 저장 필드명은 그대로
  assert.match(read('src/services/supabase/tripService.js'), /departure_datetime: form\.departureDateTime/)
})
