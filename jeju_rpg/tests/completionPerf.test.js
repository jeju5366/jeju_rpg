import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { verifyQuestPhoto } from '../api/_lib/quests/photoVerify.js'
import { calcQuestExp } from '../src/utils/exp.js'
import { diffLevels, expsFromProfile } from '../src/utils/level.js'
import { fakeDb } from './helpers/fakeDb.js'
import { instrument } from './helpers/instrumentDb.js'

const USER = { id: 'u1' }
const GPS = () => ({ method: 'gps', position: { lat: 33.5, lng: 126.5, accuracy: 10, timestamp: Date.now() } })
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]).toString('base64')
const AID = '11111111-1111-4111-8111-111111111111'
const passJudge = async () => ({ result: 'pass', reason: '확인', usage: { model: 't', inputTokens: 1, outputTokens: 1, costUsd: 0 } })

const quest = (id, over = {}) => ({
  id, user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'optional', title: id, description: 'd', difficulty: 'normal', category_primary: 'explore', category_secondary: 'culture',
  verification_type: 'self', place_id: 'place-1', place_name: '장소', place_lat: 33.5, place_lng: 126.5, is_hidden: false, replaced_at: null, data: {}, ...over,
})

function setup({ quests, landmarks = [], profile = {}, opts = {} } = {}) {
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
      unique: {
        jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id,
        jeju_place_visits: (a, b) => a.user_id === b.user_id && a.quest_id && a.quest_id === b.quest_id,
      },
      ...opts,
    },
  )
}
const total = (db) => ['explore', 'culture', 'food', 'relax', 'social', 'discovery'].reduce((s, k) => s + db.tables.jeju_profiles[0][`exp_${k}`], 0) + db.tables.jeju_profiles[0].unspent_exp
const complete = (db, id, payload) => completeQuest({ user: USER, questId: id, payload, db })

// ───────── 정상 완료 (유형별) ─────────
test('유형별 정상 완료: 일반/core/optional/surprise/gps/photo/gps_photo 모두 기존과 같은 EXP·보상 구조', async () => {
  const cases = [
    { name: 'optional self', q: quest('q', { place_id: null }), payload: { method: 'self' }, method: 'self', type: 'optional' },
    { name: 'core gps', q: quest('q', { quest_type: 'core', verification_type: 'gps' }), payload: GPS(), method: 'gps', type: 'core' },
    { name: 'surprise gps', q: quest('q', { quest_type: 'surprise', chapter_id: null, surprise_status: 'accepted', verification_type: 'gps' }), payload: GPS(), method: 'gps', type: 'surprise' },
  ]
  for (const { name, q, payload, method, type } of cases) {
    const db = setup({ quests: [q] })
    const r = await complete(db, 'q', payload)
    const expected = calcQuestExp({ difficulty: 'normal', questType: type, verificationMethod: method }).total
    assert.equal(r.rewards.quest.total, expected, name)
    assert.equal(r.rewards.quest.parts.reduce((s, p) => s + p.amount, 0), expected, `${name} 카테고리 분배 합`)
    assert.equal('ledger' in r.rewards.quest, false, `${name}: 내부 원장은 응답에 싣지 않는다`)
    assert.equal(r.progress.verification_method, method)
    assert.equal(db.tables.jeju_exp_logs.filter((l) => l.source_key === 'quest:q:completion').length, 2, `${name} source key`)
  }
  // photo / gps_photo
  const photo = setup({ quests: [quest('q', { verification_type: 'photo_ai' })] })
  const p = await verifyQuestPhoto({ user: USER, questId: 'q', attemptId: AID, image: JPEG, db: photo, judge: passJudge })
  assert.equal(p.rewards.quest.total, calcQuestExp({ difficulty: 'normal', questType: 'optional', verificationMethod: 'photo_ai' }).total)
  assert.equal(p.rewards.discovery, null)
  const gp = setup({ quests: [quest('q', { verification_type: 'gps_photo' })] })
  await complete(gp, 'q', GPS())
  const done = await verifyQuestPhoto({ user: USER, questId: 'q', attemptId: AID, image: JPEG, db: gp, judge: passJudge })
  assert.equal(done.rewards.quest.total, calcQuestExp({ difficulty: 'normal', questType: 'optional', verificationMethod: 'gps_photo' }).total)
  assert.equal(done.rewards.discovery.amount, 20)
})

// ───────── 레벨업: 원장 기반 = 기존 스냅샷 기반 ─────────
test('레벨업 결과가 지급 전/후 EXP 스냅샷 방식(기존)과 동일: 퀘스트 + 발견 합산, 전체/카테고리', async () => {
  for (const profile of [{}, { exp_explore: 15 }, { exp_discovery: 5, exp_culture: 18 }, { exp_explore: 39, exp_culture: 19, exp_discovery: 9 }]) {
    const q = quest('q', { quest_type: 'core', verification_type: 'gps' })
    const db = setup({ quests: [q], profile })
    const before = expsFromProfile(db.tables.jeju_profiles[0]) // 기존 방식: 지급 전 스냅샷
    const r = await complete(db, 'q', GPS())
    const expected = diffLevels(before, expsFromProfile(db.tables.jeju_profiles[0])) // 기존 방식: 지급 후 스냅샷과 비교
    assert.deepEqual(r.rewards.levelUps, expected, JSON.stringify(profile))
  }
})

test('원장이 없는 환경(구버전 DB 함수)에서는 지급 후 EXP 로 역산해 같은 레벨업을 돌려줌', async () => {
  const q = quest('q', { quest_type: 'core', verification_type: 'gps' })
  const db = setup({ quests: [q], profile: { exp_explore: 10 } })
  const before = expsFromProfile(db.tables.jeju_profiles[0])
  const stripped = { ...db, rpc: async (name, args) => { const out = await db.rpc(name, args); if (out.data) { delete out.data.before; delete out.data.added } return out } }
  const r = await complete(stripped, 'q', GPS())
  assert.deepEqual(r.rewards.levelUps, diffLevels(before, expsFromProfile(db.tables.jeju_profiles[0])))
})

// ───────── 중복 지급 방지 ─────────
test('같은 완료를 다시 요청해도 EXP/발견 중복 지급 없음, 두 번째는 already_completed', async () => {
  const db = setup({ quests: [quest('q', { quest_type: 'core', verification_type: 'gps' })] })
  await complete(db, 'q', GPS())
  const afterFirst = total(db)
  await assert.rejects(() => complete(db, 'q', GPS()), { message: 'already_completed' })
  assert.equal(total(db), afterFirst)
  assert.equal(db.tables.jeju_place_discoveries.length, 1)
  assert.equal(db.tables.jeju_quest_progress.length, 1)
})

test('동일 quest 동시 완료 요청: 한 번만 성공, EXP 한 번만', async () => {
  const db = setup({ quests: [quest('q', { quest_type: 'core', verification_type: 'gps' })] })
  const settled = await Promise.allSettled([complete(db, 'q', GPS()), complete(db, 'q', GPS()), complete(db, 'q', GPS())])
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1)
  assert.ok(settled.filter((s) => s.status === 'rejected').every((s) => s.reason.message === 'already_completed'))
  assert.equal(db.tables.jeju_quest_progress.length, 1)
  assert.equal(db.tables.jeju_exp_logs.filter((l) => l.source_key === 'quest:q:completion').length, 2) // 카테고리 2개 = 로그 2줄, 한 세트만
  assert.equal(db.tables.jeju_place_discoveries.length, 1)
  assert.equal(total(db), 30 + 20) // 퀘스트 EXP + 발견 EXP 한 번씩
})

test('같은 장소를 두 퀘스트가 동시에 완료해도 발견 EXP 는 평생 한 번(UNIQUE)', async () => {
  const db = setup({ quests: [quest('a', { verification_type: 'gps' }), quest('b', { verification_type: 'gps' })] })
  const [ra, rb] = await Promise.all([complete(db, 'a', GPS()), complete(db, 'b', GPS())])
  assert.equal([ra, rb].filter((r) => r.rewards.discovery).length, 1)
  assert.equal(db.tables.jeju_place_discoveries.length, 1)
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 20)
  assert.equal(db.tables.jeju_place_visits.length, 2) // 방문은 퀘스트마다 기록
  assert.equal(total(db), 2 * 20 + 20) // 퀘스트 EXP 둘 + 발견 한 번
})

const completedCount = (db) => db.tables.jeju_quest_progress.filter((p) => p.status === 'completed').length

// ───────── 실패 시 안전 동작 ─────────
test('EXP RPC 실패: 진행 기록은 만들어지지 않음(progress 만 완료되고 EXP 가 빠지는 상태 없음), 재시도하면 한 번만 지급', async () => {
  const failRpc = ['jeju_apply_exp']
  const db = setup({ quests: [quest('q', { quest_type: 'core', verification_type: 'gps' })], opts: { failRpc } })
  await assert.rejects(() => complete(db, 'q', GPS()), { message: 'forced rpc failure' })
  assert.equal(completedCount(db), 0) // 완료 claim 행(in_progress)은 남을 수 있지만 completed 는 아니다
  assert.equal(db.tables.jeju_chapters[0].status, 'active')
  assert.equal(total(db), 0)
  failRpc.length = 0 // 복구
  await complete(db, 'q', GPS())
  assert.equal(total(db), 50)
  assert.equal(db.tables.jeju_quest_progress.length, 1)
})

test('방문 기록 실패: 진행 기록 없음. 재시도로 이어서 완료되고 EXP/발견은 중복되지 않음 (EXP 먼저 지급되는 기존 안전 동작 유지)', async () => {
  const failInsert = ['jeju_place_visits']
  const db = setup({ quests: [quest('q', { quest_type: 'core', verification_type: 'gps' })], opts: { failInsert } })
  await assert.rejects(() => complete(db, 'q', GPS()))
  assert.equal(completedCount(db), 0) // 커밋 지점(completed)은 아직
  const partial = total(db) // 이미 지급된 EXP 는 재시도 때 중복되지 않는다
  failInsert.length = 0
  const retry = await complete(db, 'q', GPS())
  assert.equal(total(db), 50) // 최종적으로 퀘스트 + 발견 한 번씩
  assert.ok(partial <= 50)
  assert.equal(db.tables.jeju_place_discoveries.length, 1)
  assert.equal(db.tables.jeju_quest_progress.length, 1)
  // 재시도 응답의 EXP 는 "이미 지급됨"으로 표시되어 팝업이 중복 보상처럼 보이지 않는다
  assert.ok(retry.rewards.quest.awarded === false || partial === 0)
})

test('진행 기록 저장 실패: EXP 는 이미 지급돼 있고(재시도 안전), 재시도해도 이중 지급 없음', async () => {
  const failUpdate = [(table, values) => table === 'jeju_quest_progress' && values.status === 'completed'] // 커밋(completed 저장)만 실패
  const db = setup({ quests: [quest('q', { verification_type: 'gps' })], opts: { failUpdate } })
  await assert.rejects(() => complete(db, 'q', GPS()))
  const granted = total(db)
  assert.ok(granted > 0)
  assert.equal(db.tables.jeju_quest_progress[0].status, 'in_progress') // claim 만 남은 상태
  failUpdate.length = 0
  await complete(db, 'q', GPS())
  assert.equal(total(db), granted) // 같은 source key 라 추가 지급 없음
  assert.equal(db.tables.jeju_quest_progress.length, 1)
})

test('발견 RPC 실패: 진행 기록 없음, 재시도 시 발견 EXP 한 번만', async () => {
  const failRpc = ['jeju_record_discovery']
  const db = setup({ quests: [quest('q', { verification_type: 'gps' })], opts: { failRpc } })
  await assert.rejects(() => complete(db, 'q', GPS()), { message: 'forced rpc failure' })
  assert.equal(completedCount(db), 0)
  failRpc.length = 0
  await complete(db, 'q', GPS())
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 20)
  assert.equal(db.tables.jeju_place_discoveries.length, 1)
})

// ───────── 왕복 횟수/순서 (성능 회귀 방지) ─────────
test('DB 호출 구조: 지급 전/후 EXP 스냅샷 조회가 없고, 독립 읽기는 병렬, EXP→발견은 순차, 진행 기록이 마지막 커밋', async () => {
  const db = setup({ quests: [quest('q', { quest_type: 'core', verification_type: 'gps' })] })
  const probe = instrument(db, { latencyMs: 15 })
  await complete(probe.db, 'q', GPS())
  const { count, byLabel } = probe.summary()
  assert.equal(byLabel['jeju_profiles.select'], undefined) // 최적화 전에는 2회(지급 전/후 스냅샷)
  assert.ok(count <= 12, `호출 ${count}회`) // 최적화 전 13회 (완료 claim 1회 추가)
  const at = (label) => probe.calls.find((c) => c.label === label)
  // 읽기 3개(모험/챕터/진행)는 겹쳐서 시작한다 (병렬)
  assert.ok(at('jeju_chapters.select').start < at('jeju_adventures.select').end)
  assert.ok(at('jeju_quest_progress.select').start < at('jeju_adventures.select').end)
  // 같은 profile row 를 잠그는 두 RPC 는 겹치지 않는다 (순차)
  assert.ok(at('rpc:jeju_record_discovery').start >= at('rpc:jeju_apply_exp').end)
  // 진행 기록(커밋 지점)은 EXP/방문/발견이 모두 끝난 뒤에만 시작한다
  const claim = at('jeju_quest_progress.insert') // 완료 claim 은 EXP 지급보다 먼저
  assert.ok(claim.end <= at('rpc:jeju_apply_exp').start)
  const commit = at('jeju_quest_progress.update')
  for (const label of ['rpc:jeju_apply_exp', 'rpc:jeju_record_discovery', 'jeju_place_visits.insert']) assert.ok(commit.start >= at(label).end, label)
  // 챕터 상태 변경은 진행 기록 뒤
  assert.ok(at('jeju_chapters.update').start >= commit.end)
})

test('오류 우선순위 유지: 자유여행 중이면서 챕터가 없어도 기존처럼 free_travel_active 가 먼저', async () => {
  const db = setup({ quests: [quest('q', { chapter_id: 'missing' })] })
  db.tables.jeju_trips[0].travel_mode = 'free'
  await assert.rejects(() => complete(db, 'q', { method: 'self' }), { message: 'free_travel_active' })
  db.tables.jeju_trips[0].travel_mode = 'quest'
  db.tables.jeju_adventures[0].status = 'completed'
  await assert.rejects(() => complete(db, 'q', { method: 'self' }), { message: 'adventure_not_active' })
})
