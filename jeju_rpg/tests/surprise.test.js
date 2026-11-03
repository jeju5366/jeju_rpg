import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateSurprise, respondSurprise, validateSurprise } from '../api/_lib/agent/surprise.js'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { verifyQuestPhoto } from '../api/_lib/quests/photoVerify.js'
import { calcQuestExp } from '../src/utils/exp.js'
import { fakeDb } from './helpers/fakeDb.js'

const MIN = 60 * 1000
const NOW = Date.UTC(2026, 10, 3, 6, 0, 0) // KST 15:00
const USER = { id: 'u1' }
const ANCHOR = { lat: 33.5, lng: 126.5 }
const NEARBY = [
  { placeId: 'n-1', name: '돌담 골목', contentTypeId: 12, category: '관광지', lat: 33.5005, lng: 126.5005 },
  { placeId: 'n-2', name: '작은 카페', contentTypeId: 39, category: '음식점', lat: 33.501, lng: 126.501 },
]
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]).toString('base64')
const AID = '11111111-1111-4111-8111-111111111111'

function setup({ surprises = [], mode = 'quest', requests = [] } = {}) {
  return fakeDb(
    {
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: 't1', status: 'active', adventure_date: '2026-11-03', travel_range: 'normal' }],
      jeju_trips: [{ id: 't1', user_id: 'u1', travel_mode: mode }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'core_completed' }],
      jeju_quests: [
        { id: 'q1', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'core', place_id: 'a-1', place_name: '앵커 장소', place_lat: ANCHOR.lat, place_lng: ANCHOR.lng, replaced_at: null, is_hidden: false },
        ...surprises,
      ],
      jeju_quest_progress: [],
      jeju_agent_requests: requests,
    },
    {
      defaults: { jeju_quest_progress: { photo_attempts: 0, photo_errors: 0, gps_verified_at: null, photo_verified_at: null, photo_last: null } },
      unique: {
        jeju_agent_requests: (a, b) => a.user_id === b.user_id && a.request_key === b.request_key,
        jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id,
      },
    },
  )
}

const goodQuest = { title: '돌담 앞에서 한 장', description: '제주 돌담이 보이는 장면을 한 장 찍어봐.', difficulty: 'easy', categoryPrimary: 'explore', categorySecondary: null, verificationType: 'photo_ai', timeLimitMinutes: null, placeId: 'n-1' }
function makeAgent(output) {
  const agent = async (input) => {
    agent.calls += 1
    agent.last = input
    const o = typeof output === 'function' ? output(input) : output
    const errors = validateSurprise(o, input)
    if (errors.length) throw new Error(`검증 실패: ${errors.join(' / ')}`)
    return { output: o, usages: [{ model: 'test', inputTokens: 80, outputTokens: 40 }] }
  }
  agent.calls = 0
  return agent
}
const deps = (agent, over = {}) => ({
  buildContext: async () => ({ context: { desiredEndTime: '20:00', companion: 'friends', transport: 'rental_car' }, origin: ANCHOR, visits: { thisTripIds: new Set(), pastIds: new Set() } }),
  candidates: async () => ({ places: NEARBY, source: 'mock' }),
  agent,
  ...over,
})
const ev = (db, agent, input = {}, over = {}) => evaluateSurprise({ user: USER, adventureId: 'adv1', trigger: 'core_completed', db, deps: deps(agent, over), now: NOW, ...input })
const surprise = (id, minutesAgo, status = 'declined') => ({ id, user_id: 'u1', adventure_id: 'adv1', chapter_id: null, quest_type: 'surprise', surprise_status: status, offered_at: new Date(NOW - minutesAgo * MIN).toISOString(), replaced_at: null })

// ───────── 생성 gate ─────────
test('Surprise: 이동 중이면 생성 X (Agent 호출 없음)', async () => {
  const agent = makeAgent({ decision: 'quest', quest: goodQuest })
  const r = await ev(setup(), agent, { speedMs: 14 })
  assert.deepEqual([r.offered, r.reason], [false, 'moving'])
  assert.equal(agent.calls, 0)
})

test('Surprise: 핵심 퀘스트 완료 직후 → 제안(챕터 독립, offered 상태), 실제 후보 안에서만', async () => {
  const db = setup()
  const agent = makeAgent({ decision: 'quest', quest: goodQuest })
  const r = await ev(db, agent)
  assert.equal(r.offered, true)
  const saved = db.tables.jeju_quests.find((q) => q.quest_type === 'surprise')
  assert.deepEqual([saved.chapter_id, saved.surprise_status, saved.place_id, saved.verification_type], [null, 'offered', 'n-1', 'photo_ai'])
  assert.ok(saved.offered_at)
  assert.deepEqual(agent.last.prompt.nearby.map((p) => p.placeId), ['n-1', 'n-2'])
  assert.equal(db.tables.jeju_agent_requests[0].request_type, 'GENERATE_SURPRISE_QUEST')
  assert.equal(db.tables.jeju_api_usage_logs.length, 1)
})

test('Surprise: anchor 도착 + 체류 → gate 통과 / 체류 부족은 X', async () => {
  const agent = makeAgent({ decision: 'quest', quest: goodQuest })
  const near = { position: { lat: 33.5004, lng: 126.5004 }, dwellMs: 6 * MIN }
  assert.equal((await ev(setup(), agent, { trigger: 'anchor_dwell', ...near })).offered, true)
  assert.equal((await ev(setup(), makeAgent({ decision: 'quest', quest: goodQuest }), { trigger: 'anchor_dwell', ...near, dwellMs: MIN })).reason, 'no_stable_point')
})

test('Surprise: REPLAN 필요 / 인증 진행 중 / 자유여행 중 / 시간 부족이면 생성 X', async () => {
  const agent = makeAgent({ decision: 'quest', quest: goodQuest })
  assert.equal((await ev(setup(), agent, { replanNeeded: true })).reason, 'replan_pending')
  assert.equal((await ev(setup(), agent, { verificationOpen: true })).reason, 'verification_open')
  assert.equal((await ev(setup({ mode: 'free' }), agent)).reason, 'free_travel')
  const short = await ev(setup(), agent, {}, { buildContext: async () => ({ context: { desiredEndTime: '15:30', companion: 'friends' }, origin: ANCHOR, visits: { thisTripIds: new Set(), pastIds: new Set() } }) })
  assert.equal(short.reason, 'time_short')
  assert.equal(agent.calls, 0)
})

test('Surprise: 하루 3개 제한, 60분 cooldown', async () => {
  const agent = makeAgent({ decision: 'quest', quest: goodQuest })
  const three = setup({ surprises: [surprise('s1', 300), surprise('s2', 200), surprise('s3', 100)] })
  assert.equal((await ev(three, agent)).reason, 'daily_limit')
  const recent = setup({ surprises: [surprise('s1', 30)] })
  assert.equal((await ev(recent, agent)).reason, 'cooldown')
  const ok = setup({ surprises: [surprise('s1', 90)] })
  assert.equal((await ev(ok, agent)).offered, true)
  assert.equal(agent.calls, 1)
})

test('Surprise: no_quest 허용 + 같은 상태 재평가로 Agent 를 다시 부르지 않음', async () => {
  const db = setup()
  const agent = makeAgent({ decision: 'no_quest', quest: null })
  assert.deepEqual(await ev(db, agent), { offered: false, reason: 'no_quest' })
  assert.deepEqual(await ev(db, agent), { offered: false, reason: 'already_evaluated' })
  assert.equal(agent.calls, 1)
  assert.equal(db.tables.jeju_quests.filter((q) => q.quest_type === 'surprise').length, 0)
})

test('Surprise: 아직 답하지 않은 제안이 있으면 새로 만들지 않고 그대로 보여줌(같은 퀘스트 반복 제안 X)', async () => {
  const db = setup()
  const agent = makeAgent({ decision: 'quest', quest: goodQuest })
  const first = await ev(db, agent)
  const again = await ev(db, agent)
  assert.equal(again.existing, true)
  assert.equal(again.quest.id, first.quest.id)
  assert.equal(agent.calls, 1)
})

test('Surprise: Agent 실패/검증 실패는 조용히 넘어감(모험 진행 영향 없음)', async () => {
  const db = setup()
  const r = await ev(db, async () => { throw new Error('OpenAI HTTP 503') })
  assert.deepEqual([r.offered, r.reason], [false, 'failed'])
  assert.equal(db.tables.jeju_quests.filter((q) => q.quest_type === 'surprise').length, 0)
  assert.equal(db.tables.jeju_agent_requests[0].status, 'failed')
})

// ───────── 검증: 환각/추상형 방지, 직관형·탐색형 허용 ─────────
test('validateSurprise: 후보에 없는 장소/추상 감상형은 거절, 직관형·탐색형 행동 퀘스트는 허용', () => {
  const ctx = { allowedPlaceIds: new Set(['n-1']), companion: 'friends' }
  assert.ok(validateSurprise({ decision: 'quest', quest: { ...goodQuest, placeId: 'fake-9' } }, ctx).length)
  assert.ok(validateSurprise({ decision: 'quest', quest: { ...goodQuest, title: '분위기 느끼기', description: '주변 분위기를 느껴봐.' } }, ctx).length)
  assert.ok(validateSurprise({ decision: 'quest', quest: { ...goodQuest, placeId: null, verificationType: 'gps' } }, ctx).length)
  assert.ok(validateSurprise({ decision: 'quest', quest: { ...goodQuest, categoryPrimary: 'social' } }, { ...ctx, companion: 'solo' }).length)
  const intuitive = { ...goodQuest, title: '마음에 드는 풍경', description: '오늘 가장 마음에 드는 풍경을 한 장 남겨봐.', placeId: null, verificationType: 'photo_upload' }
  const exploratory = { ...goodQuest, title: '보라색 찾기', description: '주변에서 보라색 물체를 찾아 사진으로 남겨봐.', placeId: null, verificationType: 'photo_ai' }
  const compare = { ...goodQuest, title: '두 가지 비교', description: '작은 카페 메뉴 두 가지를 골라 비교해봐.', placeId: 'n-1', verificationType: 'self' }
  for (const q of [intuitive, exploratory, compare]) assert.deepEqual(validateSurprise({ decision: 'quest', quest: q }, ctx), [], q.title)
})

// ───────── 수락 / 거절 / 인증 / EXP ─────────
async function offered() {
  const db = setup()
  const r = await ev(db, makeAgent({ decision: 'quest', quest: { ...goodQuest, verificationType: 'gps' } }))
  return { db, quest: r.quest }
}
const profileExp = (db) => db.tables.jeju_profiles[0]
const totalExp = (db) => db.tables.jeju_exp_logs.reduce((s, l) => s + l.amount, 0)

test('Surprise 거절: 실패/감점 없음, 진행·EXP 변화 없음, 다시 완료할 수 없음', async () => {
  const { db, quest } = await offered()
  const before = JSON.stringify(profileExp(db))
  const r = await respondSurprise({ user: USER, questId: quest.id, action: 'decline', db })
  assert.equal(r.quest.surprise_status, 'declined')
  assert.equal(JSON.stringify(profileExp(db)), before)
  assert.equal(db.tables.jeju_exp_logs.length, 0)
  assert.equal(db.tables.jeju_quest_progress.length, 0)
  assert.equal((await respondSurprise({ user: USER, questId: quest.id, action: 'decline', db })).quest.surprise_status, 'declined') // 재전송 안전
  await assert.rejects(() => respondSurprise({ user: USER, questId: quest.id, action: 'accept', db }), { message: 'surprise_already_answered' })
  await assert.rejects(() => completeQuest({ user: USER, questId: quest.id, payload: { method: 'self' }, db }), { message: 'surprise_not_accepted' })
})

test('Surprise 수락 → GPS 인증으로 완료: surprise ×1.5 × gps ×1.0 EXP, 발견 EXP 별도', async () => {
  const { db, quest } = await offered()
  await assert.rejects(() => completeQuest({ user: USER, questId: quest.id, payload: { method: 'self' }, db }), { message: 'surprise_not_accepted' }) // 수락 전에는 불가
  await respondSurprise({ user: USER, questId: quest.id, action: 'accept', db })
  const position = { lat: 33.5006, lng: 126.5006, accuracy: 20, timestamp: Date.now() }
  const done = await completeQuest({ user: USER, questId: quest.id, payload: { method: 'gps', position }, db })
  assert.equal(done.chapterStatus, null)
  assert.equal(done.progress.verification_method, 'gps')
  const expected = calcQuestExp({ difficulty: 'easy', questType: 'surprise', verificationMethod: 'gps' }).total
  assert.equal(expected, Math.round(10 * 1.5 * 1.0))
  assert.equal(totalExp(db), expected)
  assert.equal(db.tables.jeju_place_discoveries.length, 1) // 최초 방문 발견 EXP 는 별도
  assert.equal(db.tables.jeju_chapters[0].status, 'core_completed') // 챕터 진행과 독립
})

test('Surprise 수락 → 사진 인증(PhotoVerificationService 재사용) ×1.05 × surprise ×1.5', async () => {
  const db = setup()
  const r = await ev(db, makeAgent({ decision: 'quest', quest: goodQuest })) // photo_ai
  await respondSurprise({ user: USER, questId: r.quest.id, action: 'accept', db })
  const judge = async () => ({ result: 'pass', reason: '돌담이 보여', usage: { model: 'test', inputTokens: 500, outputTokens: 30, costUsd: 0 } })
  const out = await verifyQuestPhoto({ user: USER, questId: r.quest.id, attemptId: AID, image: JPEG, db, judge })
  assert.equal(out.completed, true)
  assert.equal(totalExp(db), calcQuestExp({ difficulty: 'easy', questType: 'surprise', verificationMethod: 'photo_ai' }).total)
  assert.equal(db.tables.jeju_quest_progress[0].verification_method, 'photo_ai')
})

test('Surprise: 교체된(replaced) 퀘스트/자유여행 중에는 완료 불가', async () => {
  const { db, quest } = await offered()
  await respondSurprise({ user: USER, questId: quest.id, action: 'accept', db })
  db.tables.jeju_trips[0].travel_mode = 'free'
  await assert.rejects(() => completeQuest({ user: USER, questId: quest.id, payload: { method: 'self' }, db }), { message: 'free_travel_active' })
})
