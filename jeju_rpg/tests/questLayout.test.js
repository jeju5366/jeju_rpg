import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcQuestExp } from '../src/utils/exp.js'
import { isQuestOpen, partitionChapterQuests, progressHint, questExpPreview, toggled } from '../src/utils/questLayout.js'

const q = (id, type, over = {}) => ({ id, quest_type: type, difficulty: 'normal', verification_type: 'self', title: id, is_hidden: false, replaced_at: null, ...over })

// ───────── 퀘스트 분류 (compact 레이아웃의 기준) ─────────
test('미완료 core 는 펼침 대상(coreDone=false), 완료되면 compact 대상(coreDone=true)', () => {
  const quests = [q('core', 'core'), q('o1', 'optional')]
  assert.equal(partitionChapterQuests({ quests, completedIds: new Set() }).coreDone, false)
  assert.equal(partitionChapterQuests({ quests, completedIds: new Set(['core']) }).coreDone, true)
})

test('미완료 선택 퀘스트는 pending(compact), 완료한 것은 done 그룹으로 이동', () => {
  const quests = [q('core', 'core'), q('o1', 'optional'), q('o2', 'optional'), q('o3', 'optional')]
  const before = partitionChapterQuests({ quests, completedIds: new Set() })
  assert.deepEqual([before.pending.length, before.done.length], [3, 0])
  const after = partitionChapterQuests({ quests, completedIds: new Set(['o2']) })
  assert.deepEqual(after.pending.map((x) => x.id), ['o1', 'o3'])
  assert.deepEqual(after.done.map((x) => x.id), ['o2'])
})

test('퀘스트 더 받기: 숨은 선택 퀘스트는 hiddenCount 로 세고, 공개되면 pending 에 compact 로 나타남', () => {
  const quests = [q('core', 'core'), q('o1', 'optional'), q('h1', 'optional', { is_hidden: true }), q('h2', 'optional', { is_hidden: true })]
  const before = partitionChapterQuests({ quests, completedIds: new Set() })
  assert.deepEqual([before.pending.length, before.hiddenCount], [1, 2])
  const revealed = quests.map((x) => (x.id === 'h1' ? { ...x, is_hidden: false } : x)) // reveal 은 서버가 is_hidden 만 바꾼다(AI 호출 없음)
  const after = partitionChapterQuests({ quests: revealed, completedIds: new Set() })
  assert.deepEqual([after.pending.map((x) => x.id), after.hiddenCount], [['o1', 'h1'], 1])
})

test('REPLAN 으로 교체된 퀘스트(replaced_at)는 어느 영역에도 남지 않음', () => {
  const quests = [q('core', 'core'), q('o1', 'optional', { replaced_at: '2026-11-03T06:00:00Z' }), q('o2', 'optional'), q('c-old', 'core', { replaced_at: '2026-11-03T06:00:00Z' })]
  const r = partitionChapterQuests({ quests, completedIds: new Set(['o1']) })
  assert.equal(r.core.id, 'core')
  assert.deepEqual(r.pending.map((x) => x.id), ['o2'])
  assert.deepEqual(r.done, [])
})

test('핵심 퀘스트가 없는 챕터도 안전', () => {
  const r = partitionChapterQuests({ quests: [q('o1', 'optional')], completedIds: new Set() })
  assert.deepEqual([r.core, r.coreDone, r.pending.length], [null, false, 1])
})

// ───────── 펼침/접힘 규칙 ─────────
test('선택 퀘스트 개별 펼치기/접기 토글(불변)', () => {
  const empty = new Set()
  const opened = toggled(empty, 'o1')
  assert.deepEqual([empty.has('o1'), opened.has('o1')], [false, true])
  assert.equal(toggled(opened, 'o1').has('o1'), false)
  assert.equal(toggled(opened, 'o2').size, 2) // 다른 카드는 따로 열린다
})

test('인증 진행 중/GPS 안내/사진 모달이 열린 카드는 사용자가 안 열었어도 자동으로 닫지 않음', () => {
  const base = { openIds: new Set(), busyQuestId: null, gpsBusyQuestId: null, gpsFeedback: null, activeQuestId: null }
  assert.equal(isQuestOpen('o1', base), false)
  assert.equal(isQuestOpen('o1', { ...base, openIds: new Set(['o1']) }), true)
  assert.equal(isQuestOpen('o1', { ...base, busyQuestId: 'o1' }), true)
  assert.equal(isQuestOpen('o1', { ...base, gpsBusyQuestId: 'o1' }), true)
  assert.equal(isQuestOpen('o1', { ...base, gpsFeedback: { questId: 'o1', kind: 'too_far' } }), true)
  assert.equal(isQuestOpen('o1', { ...base, activeQuestId: 'o1' }), true)
  assert.equal(isQuestOpen('o2', { ...base, busyQuestId: 'o1' }), false)
})

// ───────── EXP 표시(기존 계산 재사용) / 진행 힌트 ─────────
test('compact 카드의 EXP 는 기존 calcQuestExp 와 같은 값(인증 방식별)', () => {
  const photo = q('p', 'optional', { verification_type: 'photo_ai', difficulty: 'normal' })
  assert.equal(questExpPreview(photo).planned, calcQuestExp({ difficulty: 'normal', questType: 'optional', verificationMethod: 'photo_ai' }).total) // 21
  assert.equal(questExpPreview(photo).planned, 21)
  const gps = q('g', 'core', { verification_type: 'gps' })
  assert.equal(questExpPreview(gps).planned, 30)
  const both = q('b', 'optional', { verification_type: 'gps_photo' })
  assert.equal(questExpPreview(both).planned, calcQuestExp({ difficulty: 'normal', questType: 'optional', verificationMethod: 'gps_photo' }).total)
})

test('완료한 퀘스트는 실제 완료 방식 기준으로 받은 EXP 를 보여줌(예: gps 퀘스트를 직접 확인으로 끝냈다면 self 기준)', () => {
  const quest = q('g', 'core', { verification_type: 'gps' })
  const byHand = questExpPreview(quest, { status: 'completed', verification_method: 'self' })
  assert.deepEqual([byHand.earned, byHand.earnedMethod], [calcQuestExp({ difficulty: 'normal', questType: 'core', verificationMethod: 'self' }).total, 'self'])
  assert.equal(byHand.earned, 27)
  assert.equal(questExpPreview(quest, { status: 'in_progress' }).earned, null)
})

test('gps_photo 중간 상태를 compact 카드에서 알려줌', () => {
  const quest = q('b', 'optional', { verification_type: 'gps_photo' })
  assert.equal(progressHint(quest, { status: 'in_progress', gps_verified_at: 'x', photo_verified_at: null }), 'gps_done')
  assert.equal(progressHint(quest, { status: 'in_progress', gps_verified_at: null, photo_verified_at: 'x' }), 'photo_done')
  assert.equal(progressHint(quest, { status: 'completed', gps_verified_at: 'x', photo_verified_at: 'x' }), null)
  assert.equal(progressHint(quest, null), null)
})
