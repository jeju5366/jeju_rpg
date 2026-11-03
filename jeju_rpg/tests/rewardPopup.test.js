import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { verifyQuestPhoto } from '../api/_lib/quests/photoVerify.js'
import { calcQuestExp } from '../src/utils/exp.js'
import { diffLevels, expsFromProfile } from '../src/utils/level.js'
import { buildRewardPopup, POPUP_DURATION_MS } from '../src/utils/rewardPopup.js'
import { dismiss, emptyQueue, enqueue } from '../src/utils/rewardQueue.js'
import { fakeDb } from './helpers/fakeDb.js'

const USER = { id: 'u1' }
const NEAR = { lat: 33.5005, lng: 126.5005, accuracy: 20 }
const gps = () => ({ method: 'gps', position: { ...NEAR, timestamp: Date.now() } })
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]).toString('base64')
const A1 = '11111111-1111-4111-8111-111111111111'
const passJudge = async () => ({ result: 'pass', reason: '확인', usage: { model: 't', inputTokens: 1, outputTokens: 1, costUsd: 0 } })

const quest = (id, over = {}) => ({
  id, user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', title: `${id} 제목`, description: '설명', difficulty: 'normal', category_primary: 'explore', category_secondary: null,
  verification_type: 'self', place_id: `place-${id}`, place_name: `장소 ${id}`, place_lat: 33.5, place_lng: 126.5, is_hidden: false, replaced_at: null, data: {}, ...over,
})

function setup({ quests, landmarks = [], profile = {} } = {}) {
  return fakeDb(
    {
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: 't1', status: 'active' }],
      jeju_trips: [{ id: 't1', user_id: 'u1', travel_mode: 'quest' }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'active' }],
      jeju_quests: quests,
      jeju_quest_progress: [],
      jeju_landmarks: landmarks,
      jeju_profiles: [{ id: 'u1', exp_explore: 0, exp_culture: 0, exp_food: 0, exp_relax: 0, exp_social: 0, exp_discovery: 0, unspent_exp: 0, ...profile }],
    },
    {
      defaults: { jeju_quest_progress: { photo_attempts: 0, photo_errors: 0, gps_verified_at: null, photo_verified_at: null, photo_last: null } },
      unique: { jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id },
    },
  )
}
// 프로필에 실제로 반영된 EXP 총량(퀘스트 EXP + 발견 EXP). 팝업이 아니라 DB 상태에서 독립적으로 읽는다. (테스트 시작 시 EXP 는 0)
const granted = (db) => ['explore', 'culture', 'food', 'relax', 'social', 'discovery'].reduce((sum, k) => sum + db.tables.jeju_profiles[0][`exp_${k}`], 0) + db.tables.jeju_profiles[0].unspent_exp
const popupOf = (q, response) => buildRewardPopup({ quest: q, rewards: response.rewards })

// ───────── 일반 퀘스트 ─────────
test('일반(self) 퀘스트: 팝업 1건, 퀘스트 EXP 만, 발견 줄 없음, 총합 줄 없음, 숫자 = 실제 지급값', async () => {
  const q = quest('q1')
  const db = setup({ quests: [q] })
  const response = await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db })
  const popup = popupOf(q, response)
  assert.equal(popup.id, 'quest:q1:completion')
  assert.deepEqual(popup.items.map((i) => [i.kind, i.amount]), [['quest', 18]])
  assert.equal(popup.items[0].amount, calcQuestExp({ difficulty: 'normal', questType: 'optional', verificationMethod: 'self' }).total)
  assert.equal(popup.items[0].amount, granted(db)) // 실제 exp_logs 지급량과 같다
  assert.equal(popup.showTotal, false)
  assert.equal(popup.items.some((i) => i.kind !== 'quest'), false)
})

test('photo 단독 퀘스트: 발견 줄 없음(발견 EXP 미지급)', async () => {
  const q = quest('q1', { verification_type: 'photo_ai', title: '돌담 사진' })
  const db = setup({ quests: [q] })
  const response = await verifyQuestPhoto({ user: USER, questId: 'q1', attemptId: A1, image: JPEG, db, judge: passJudge })
  const popup = popupOf(q, response)
  assert.deepEqual(popup.items.map((i) => i.kind), ['quest'])
  assert.equal(popup.items[0].amount, granted(db))
  assert.equal(db.tables.jeju_place_discoveries.length, 0)
})

// ───────── discovery ─────────
test('GPS 첫 방문: 퀘스트 EXP + 발견 EXP(+20) 실제 지급분만, 총합 = 실제 지급 합', async () => {
  const q = quest('q1', { verification_type: 'gps' })
  const db = setup({ quests: [q] })
  const response = await completeQuest({ user: USER, questId: 'q1', payload: gps(), db })
  const popup = popupOf(q, response)
  assert.deepEqual(popup.items.map((i) => [i.kind, i.amount]), [['quest', 20], ['discovery', 20]])
  assert.equal(popup.showTotal, true)
  assert.equal(popup.totalExp, 40)
  assert.equal(popup.totalExp, granted(db)) // 퀘스트 로그 + 발견 로그의 실제 합
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 20)
  assert.equal(popup.items[1].placeName, '장소 q1')
})

test('명소(landmark whitelist) 발견: +35 로 표시', async () => {
  const q = quest('q1', { verification_type: 'gps', place_id: 'demo-seongsan' })
  const db = setup({ quests: [q], landmarks: [{ place_id: 'demo-seongsan' }] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: gps(), db }))
  assert.deepEqual(popup.items.map((i) => [i.kind, i.amount]), [['quest', 20], ['landmark', 35]])
  assert.equal(popup.totalExp, 55)
})

test('gps_photo: 발견 가능 / 이미 발견한 장소를 다시 완료하면 발견 줄 없음(실제 지급된 경우만)', async () => {
  const first = quest('q1', { verification_type: 'gps_photo' })
  const second = quest('q2', { verification_type: 'gps', place_id: first.place_id }) // 같은 장소 → 이미 발견됨
  const db = setup({ quests: [first, second] })
  await completeQuest({ user: USER, questId: 'q1', payload: gps(), db }) // GPS 단계(미완료)
  const done = await verifyQuestPhoto({ user: USER, questId: 'q1', attemptId: A1, image: JPEG, db, judge: passJudge })
  assert.deepEqual(popupOf(first, done).items.map((i) => i.kind), ['quest', 'discovery'])
  const again = await completeQuest({ user: USER, questId: 'q2', payload: gps(), db })
  assert.deepEqual(popupOf(second, again).items.map((i) => i.kind), ['quest']) // 평생 1회: 두 번째 방문엔 발견 EXP 없음
})

test('직접 확인(self) 퀘스트는 장소가 있어도 발견 줄이 없음', async () => {
  const q = quest('q1', { verification_type: 'gps' }) // GPS 퀘스트를 직접 확인으로 끝냄
  const db = setup({ quests: [q] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db }))
  assert.deepEqual(popup.items.map((i) => i.kind), ['quest'])
  assert.equal(db.tables.jeju_place_discoveries.length, 0)
})

// ───────── 카테고리 배분 / 레벨업 ─────────
test('복합 카테고리: 실제 배분(parts)을 그대로 표시하고 합이 지급량과 같음', async () => {
  const q = quest('q1', { quest_type: 'core', verification_type: 'gps', category_secondary: 'culture' })
  const db = setup({ quests: [q] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: gps(), db }))
  const parts = popup.items[0].parts
  assert.deepEqual(parts.map((p) => [p.category, p.amount]), [['explore', 15], ['culture', 15]])
  assert.equal(parts.reduce((s, p) => s + p.amount, 0), popup.items[0].amount)
  assert.equal(db.tables.jeju_exp_logs.filter((l) => l.source_key === 'quest:q1:completion').length, 2)
})

test('레벨업: 실제 지급 전/후 EXP 로 기존 diffLevels 가 계산한 변화만 표시, 팝업 5초', async () => {
  const q = quest('q1', { quest_type: 'core', verification_type: 'gps' })
  const db = setup({ quests: [q], profile: { exp_explore: 0 } })
  const before = expsFromProfile(db.tables.jeju_profiles[0])
  const response = await completeQuest({ user: USER, questId: 'q1', payload: gps(), db })
  const popup = popupOf(q, response)
  const expected = diffLevels(before, expsFromProfile(db.tables.jeju_profiles[0])) // UI 가 아니라 기존 progression 함수로 독립 계산
  assert.ok(expected.length > 0)
  assert.deepEqual(popup.levelUps, expected)
  assert.ok(popup.levelUps.some((u) => u.category === 'explore' && u.from === 1 && u.to === 2))
  assert.ok(popup.levelUps.every((u) => u.to > u.from)) // 실제로 오른 항목만
  assert.equal(popup.durationMs, POPUP_DURATION_MS.levelUp)
  assert.equal(POPUP_DURATION_MS.levelUp, 5000)
})

test('레벨업이 없으면 레벨업 영역 없음, 팝업 4초', async () => {
  const q = quest('q1')
  const db = setup({ quests: [q] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db }))
  assert.deepEqual(popup.levelUps, [])
  assert.equal(popup.durationMs, 4000)
  assert.equal(POPUP_DURATION_MS.normal, 4000)
})

// ───────── 실패 / 중복 / 연속 ─────────
test('완료 실패(인증 실패/DB 거절)에는 팝업 데이터가 없음', async () => {
  const q = quest('q1', { verification_type: 'gps' })
  const db = setup({ quests: [q] })
  const far = { method: 'gps', position: { lat: 33.6, lng: 126.7, accuracy: 20, timestamp: Date.now() } }
  await assert.rejects(() => completeQuest({ user: USER, questId: 'q1', payload: far, db }), { message: 'gps_too_far' })
  assert.equal(buildRewardPopup({ quest: q, rewards: undefined }), null)
  assert.equal(granted(db), 0)
  assert.equal(buildRewardPopup({ quest: q, rewards: { quest: { awarded: false, total: 0, parts: [] }, discovery: null, levelUps: [] } }), null) // 이미 받은 보상 → 팝업 없음
})

test('같은 완료 결과로 팝업이 두 번 쌓이지 않음 (rerender/재전송 방어)', async () => {
  const q = quest('q1')
  const db = setup({ quests: [q] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db }))
  let state = enqueue(emptyQueue(), popup)
  state = enqueue(state, popup)
  state = enqueue(state, buildRewardPopup({ quest: q, rewards: { quest: { awarded: true, total: 18, parts: [{ category: 'explore', amount: 18 }] }, discovery: null, levelUps: [] } }))
  assert.equal(state.items.length, 1)
  // 닫은 뒤에 같은 결과가 다시 들어와도 다시 뜨지 않는다
  state = dismiss(state, popup.id)
  assert.equal(enqueue(state, popup).items.length, 0)
  // 이미 닫힌 팝업의 늦은 타이머(id 불일치)는 무시된다
  const two = enqueue(enqueue(emptyQueue(), { id: 'a' }), { id: 'b' })
  assert.deepEqual(dismiss(two, 'b').items.map((p) => p.id), ['a', 'b'])
})

test('빠른 연속 완료: 결과가 유실되지 않고 완료 순서대로 하나씩 보임', async () => {
  const quests = [quest('q1'), quest('q2', { verification_type: 'gps' }), quest('q3')]
  const db = setup({ quests })
  let state = emptyQueue()
  const responses = []
  for (const [id, payload] of [['q1', { method: 'self' }], ['q2', gps()], ['q3', { method: 'self' }]]) responses.push([id, await completeQuest({ user: USER, questId: id, payload, db })])
  for (const [id, response] of responses) state = enqueue(state, popupOf(quests.find((q) => q.id === id), response))
  assert.deepEqual(state.items.map((p) => p.questId), ['q1', 'q2', 'q3'])
  assert.equal(state.items.reduce((sum, p) => sum + p.totalExp, 0), granted(db)) // 세 팝업의 합 = DB 의 실제 지급 총량
  state = dismiss(state, 'quest:q1:completion')
  assert.deepEqual(state.items.map((p) => p.questId), ['q2', 'q3'])
})

// ───────── 카테고리 EXP 가시성: 카드의 "예상 성장" ↔ 팝업의 "획득한 성장" ─────────
import { questGrowthPreview } from '../src/utils/questLayout.js'

test('예상 성장(카드) = 실제 지급(팝업): 같은 인증 방식으로 완료하면 카테고리별 숫자가 그대로 이어짐 (복수 카테고리)', async () => {
  const q = quest('q1', { quest_type: 'core', verification_type: 'gps', category_secondary: 'culture' })
  const preview = questGrowthPreview(q)
  const db = setup({ quests: [q] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: gps(), db }))
  assert.deepEqual(preview, [{ category: 'explore', amount: 15 }, { category: 'culture', amount: 15 }])
  assert.deepEqual(popup.items[0].parts, preview) // 카드에서 본 chip 이 완료 팝업의 chip 과 같다
  assert.equal(preview.reduce((s, p) => s + p.amount, 0), popup.items[0].amount)
})

test('예상 성장: 단일 카테고리 / 카테고리 없음(서버와 같이 explore) / 홀수 분배(합 유지)', () => {
  assert.deepEqual(questGrowthPreview(quest('a', { verification_type: 'photo_ai', category_primary: 'culture' })), [{ category: 'culture', amount: 21 }])
  assert.deepEqual(questGrowthPreview(quest('b', { category_primary: null })), [{ category: 'explore', amount: 18 }])
  const odd = questGrowthPreview(quest('c', { category_primary: 'food', category_secondary: 'social' })) // self 18 → 9 / 9
  assert.deepEqual(odd, [{ category: 'food', amount: 9 }, { category: 'social', amount: 9 }])
  const photoDual = questGrowthPreview(quest('d', { verification_type: 'photo_ai', category_primary: 'relax', category_secondary: 'culture' })) // 21 → 11 / 10 (합 유지)
  assert.equal(photoDual.reduce((s, p) => s + p.amount, 0), 21)
})

test('인증 방식이 달라지면(직접 확인 fallback) 카드의 예상과 실제 지급이 다를 수 있음 → 카드는 "예상", 팝업은 서버가 확정한 값', async () => {
  const q = quest('q1', { quest_type: 'core', verification_type: 'gps', category_secondary: 'culture' })
  const expected = questGrowthPreview(q).reduce((s, p) => s + p.amount, 0) // GPS 기준 30
  const db = setup({ quests: [q] })
  const popup = popupOf(q, await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db }))
  assert.equal(expected, 30)
  assert.equal(popup.items[0].amount, 27) // 실제는 self ×0.9
  assert.equal(popup.items[0].parts.reduce((s, p) => s + p.amount, 0), 27)
})

test('특별 보상(발견)은 발견이 실제 지급된 경우에만 popup 데이터에 존재, 카테고리 성장(parts)과 분리됨', async () => {
  const withDiscovery = quest('q1', { verification_type: 'gps' })
  const dbA = setup({ quests: [withDiscovery] })
  const a = popupOf(withDiscovery, await completeQuest({ user: USER, questId: 'q1', payload: gps(), db: dbA }))
  assert.deepEqual(a.items.map((i) => i.kind), ['quest', 'discovery'])
  assert.ok(a.items[0].parts.every((p) => p.category !== 'discovery')) // 일반 성장 chip 에 발견이 섞이지 않는다
  const selfQuest = quest('q2', { verification_type: 'gps' })
  const dbB = setup({ quests: [selfQuest] })
  const b = popupOf(selfQuest, await completeQuest({ user: USER, questId: 'q2', payload: { method: 'self' }, db: dbB }))
  assert.deepEqual(b.items.map((i) => i.kind), ['quest']) // self → 특별 보상 섹션 없음
})
