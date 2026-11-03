import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveMemoryPhoto } from '../api/_lib/memory/service.js'
import { photoModeOf } from '../api/_lib/photo/mode.js'
import { completeQuest } from '../api/_lib/quests/progress.js'
import { verifyQuestPhoto } from '../api/_lib/quests/photoVerify.js'
import { calcQuestExp } from '../src/utils/exp.js'
import { fakeDb } from './helpers/fakeDb.js'

const USER = { id: 'u1' }
const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const A3 = '33333333-3333-4333-8333-333333333333'
// 아주 작은 JPEG 헤더(내용은 중요하지 않다. 서버는 magic bytes 로 형식만 확인하고 판정은 가짜 judge 가 한다)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64')
const SPOT = { place_id: 'demo-hyeopjae', place_name: '협재해수욕장', place_lat: 33.394, place_lng: 126.2394 }
const NEAR = { lat: 33.3941, lng: 126.2395, accuracy: 20 }
const gps = () => ({ method: 'gps', position: { ...NEAR, timestamp: Date.now() } })

function setup(questOver = {}) {
  const db = fakeDb(
    {
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: 't1', status: 'active' }],
      jeju_trips: [{ id: 't1', user_id: 'u1', travel_mode: 'quest' }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'active' }],
      jeju_quests: [
        { id: 'q1', user_id: 'u1', adventure_id: 'adv1', chapter_id: 'c1', quest_type: 'core', difficulty: 'normal', title: '화강암 사진 인증', description: '화강암 바위를 사진으로 남겨봐.', verification_type: 'photo_ai', category_primary: 'explore', category_secondary: null, is_hidden: false, data: { photoSubject: 'granite rock / granite stone' }, ...SPOT, ...questOver },
      ],
      jeju_quest_progress: [],
    },
    {
      defaults: { jeju_quest_progress: { photo_attempts: 0, photo_errors: 0, gps_verified_at: null, photo_verified_at: null, photo_last: null } }, // 009 의 컬럼 기본값
      unique: {
        jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id,
        jeju_place_visits: (a, b) => a.user_id === b.user_id && a.quest_id && a.quest_id === b.quest_id,
        jeju_travel_photos: (a, b) => a.is_memory && b.is_memory && a.user_id === b.user_id && a.quest_id === b.quest_id,
      },
    },
  )
  return db
}

// 가짜 AI: 호출 횟수를 세고, 미리 정한 결과를 순서대로 돌려준다. 'error' 는 장애.
function fakeJudge(...script) {
  const judge = async () => {
    judge.calls += 1
    const next = script.shift() ?? 'pass'
    if (next === 'error') throw new Error('OpenAI HTTP 503')
    return { result: next, reason: `${next} 사유`, usage: { model: 'test-model', inputTokens: 570, outputTokens: 35, costUsd: 0.0001 } }
  }
  judge.calls = 0
  return judge
}

const photo = (db, judge, attemptId = A1, questId = 'q1') => verifyQuestPhoto({ user: USER, questId, attemptId, image: JPEG, db, judge })
const progressOf = (db, questId = 'q1') => db.tables.jeju_quest_progress.find((p) => p.quest_id === questId)
const exp = (verificationMethod, over = {}) => calcQuestExp({ difficulty: 'normal', questType: 'core', verificationMethod, ...over }).total
const earned = (db) => db.tables.jeju_exp_logs.reduce((sum, l) => sum + l.amount, 0)

// ───────── 사진 AI 판정 ─────────
test('사진 pass → 퀘스트 완료(photo_ai), EXP ×1.05, 사진 단독은 발견 EXP 없음', async () => {
  const db = setup()
  const judge = fakeJudge('pass')
  const out = await photo(db, judge)
  assert.equal(out.result, 'pass')
  assert.equal(out.completed, true)
  assert.equal(progressOf(db).status, 'completed')
  assert.equal(progressOf(db).verification_method, 'photo_ai')
  assert.equal(earned(db), exp('photo_ai')) // 20 × 1.5 × 1.05 = 31.5 → 32
  assert.equal(exp('photo_ai'), Math.round(20 * 1.5 * 1.05))
  assert.equal(db.tables.jeju_place_visits.length, 1) // 방문은 기록
  assert.equal(db.tables.jeju_place_discoveries.length, 0) // 발견은 없음
  assert.equal(db.tables.jeju_chapters[0].status, 'core_completed')
  // 사용량 로그: Agent 요청이 아니라 purpose 로 구분
  assert.deepEqual(db.tables.jeju_api_usage_logs.map((l) => [l.purpose, l.result, l.model]), [['photo_verification', 'pass', 'test-model']])
  assert.equal(db.tables.jeju_agent_requests.length, 0)
})

test('사진 fail / uncertain → 미완료, 재촬영 안내(남은 횟수 1), EXP 없음', async () => {
  for (const verdict of ['fail', 'uncertain']) {
    const db = setup()
    const out = await photo(db, fakeJudge(verdict))
    assert.equal(out.result, verdict)
    assert.equal(out.completed, false)
    assert.deepEqual(out.photo, { attemptsUsed: 1, attemptsLeft: 1, errors: 0, canFallback: false })
    assert.equal(progressOf(db).status, 'in_progress')
    assert.equal(earned(db), 0)
  }
})

test('1차 fail → 2차 사진 pass → 완료', async () => {
  const db = setup()
  const judge = fakeJudge('fail', 'pass')
  assert.equal((await photo(db, judge, A1)).completed, false)
  const second = await photo(db, judge, A2)
  assert.equal(second.completed, true)
  assert.equal(progressOf(db).verification_method, 'photo_ai')
  assert.equal(judge.calls, 2)
})

test('2차까지 fail → AI 인증 종료, 3번째는 AI 호출 없이 거절, 직접 확인(self ×0.9, 발견 EXP 없음)으로 완료', async () => {
  const db = setup()
  const judge = fakeJudge('fail', 'uncertain')
  await photo(db, judge, A1)
  const second = await photo(db, judge, A2)
  assert.deepEqual(second.photo, { attemptsUsed: 2, attemptsLeft: 0, errors: 0, canFallback: true })
  await assert.rejects(() => photo(db, judge, A3), (e) => e.message === 'photo_attempts_exhausted' && e.details.photo.canFallback === true)
  assert.equal(judge.calls, 2) // 무한 호출 불가

  const done = await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db })
  assert.equal(done.progress.verification_method, 'self')
  assert.equal(earned(db), exp('self')) // ×0.9
  assert.equal(db.tables.jeju_place_discoveries.length, 0)
})

test('AI 호출 전에는 직접 확인으로 완료할 수 없음(사진 인증을 먼저)', async () => {
  const db = setup()
  await assert.rejects(() => completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db }), { message: 'photo_required' })
  await photo(db, fakeJudge('fail'))
  await assert.rejects(() => completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db }), { message: 'photo_required' })
})

// ───────── 장애 / 중복 ─────────
test('AI 장애: 첫 실패는 재시도 가능(횟수 돌려줌), 두 번 실패하면 직접 확인 fallback', async () => {
  const db = setup()
  const judge = fakeJudge('error', 'error')
  await assert.rejects(() => photo(db, judge, A1), (e) => e.status === 502 && e.message === 'photo_ai_failed' && e.details.photo.canFallback === false && e.details.photo.attemptsLeft === 2)
  assert.equal(progressOf(db).photo_attempts, 0) // 장애는 판정 횟수를 쓰지 않는다
  await assert.rejects(() => photo(db, judge, A2), (e) => e.details.photo.canFallback === true && e.details.photo.errors === 2)
  await assert.rejects(() => photo(db, judge, A3), { message: 'photo_attempts_exhausted' })
  assert.equal(judge.calls, 2)
  const done = await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db })
  assert.equal(done.progress.verification_method, 'self')
})

test('AI 장애 뒤 재시도가 성공하면 정상 완료', async () => {
  const db = setup()
  const judge = fakeJudge('error', 'pass')
  await assert.rejects(() => photo(db, judge, A1))
  assert.equal((await photo(db, judge, A2)).completed, true)
})

test('같은 attemptId 재전송은 AI 를 다시 부르지 않고 같은 결과를 돌려줌', async () => {
  const db = setup()
  const judge = fakeJudge('fail')
  const first = await photo(db, judge, A1)
  const again = await photo(db, judge, A1)
  assert.equal(judge.calls, 1)
  assert.equal(again.replayed, true)
  assert.equal(again.result, first.result)
  assert.equal(progressOf(db).photo_attempts, 1)
})

test('동시에 서로 다른 사진 두 장 → 한 번만 판정, 나머지는 photo_busy', async () => {
  const db = setup()
  const judge = fakeJudge('fail', 'fail')
  const settled = await Promise.allSettled([photo(db, judge, A1), photo(db, judge, A2)])
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1)
  assert.equal(settled.find((s) => s.status === 'rejected').reason.message, 'photo_busy')
  assert.equal(judge.calls, 1)
  assert.equal(progressOf(db).photo_attempts, 1)
})

test('이미지 검증: 형식이 아니거나 너무 크면 거절(AI 호출 없음)', async () => {
  const db = setup()
  const judge = fakeJudge('pass')
  await assert.rejects(() => verifyQuestPhoto({ user: USER, questId: 'q1', attemptId: A1, image: Buffer.from('not an image').toString('base64'), db, judge }), { message: 'image_invalid' })
  await assert.rejects(() => verifyQuestPhoto({ user: USER, questId: 'q1', attemptId: A1, image: Buffer.alloc(2_000_000, 0xff).toString('base64'), db, judge }), { message: 'image_too_large' })
  await assert.rejects(() => verifyQuestPhoto({ user: USER, questId: 'q1', attemptId: 'x', image: JPEG, db, judge }), { message: 'attemptId_invalid' })
  assert.equal(judge.calls, 0)
})

test('자유여행 중에는 사진 인증도 막힘, 사진 대상이 아닌 퀘스트는 거절', async () => {
  const db = setup()
  db.tables.jeju_trips[0].travel_mode = 'free'
  await assert.rejects(() => photo(db, fakeJudge()), { message: 'free_travel_active' })
  const plain = setup({ verification_type: 'gps' })
  await assert.rejects(() => photo(plain, fakeJudge()), { message: 'photo_not_supported' })
})

// ───────── 업로드만 확인 ─────────
test('upload_only 사진 퀘스트: AI 호출 없이 업로드만으로 완료, EXP ×1.05', async () => {
  const db = setup({ verification_type: 'photo_upload', title: '오늘 가장 기억에 남는 풍경', description: '풍경을 한 장 남겨봐.' })
  const judge = fakeJudge()
  const out = await photo(db, judge)
  assert.equal(out.completed, true)
  assert.equal(judge.calls, 0)
  assert.equal(progressOf(db).verification_method, 'photo_upload')
  assert.equal(earned(db), exp('photo_upload'))
  assert.equal(db.tables.jeju_api_usage_logs.length, 0)
})

test('사람이 중심인 퀘스트는 AI 분석 없이 업로드만 확인(photoMode)', () => {
  assert.equal(photoModeOf({ verification_type: 'photo_ai', title: '동행과 함께 인증샷', description: '' }), 'upload_only')
  assert.equal(photoModeOf({ verification_type: 'photo_ai', title: '셀카 남기기', description: '' }), 'upload_only')
  assert.equal(photoModeOf({ verification_type: 'photo_ai', title: '화강암 사진', description: '바위', category_primary: 'explore' }), 'ai_check')
  assert.equal(photoModeOf({ verification_type: 'photo_ai', title: '풍경', description: '', data: { photoMode: 'ai_check' }, category_primary: 'social' }), 'ai_check')
  assert.equal(photoModeOf({ verification_type: 'gps_photo', title: '바다', description: '', category_primary: 'social' }), 'upload_only')
})

// ───────── gps_photo ─────────
const gpsPhoto = () => setup({ verification_type: 'gps_photo' })

test('gps_photo: GPS 성공만으로는 완료되지 않고 EXP 도 없음', async () => {
  const db = gpsPhoto()
  const out = await completeQuest({ user: USER, questId: 'q1', payload: gps(), db })
  assert.equal(out.pending, 'photo')
  assert.equal(out.rewards, null)
  assert.equal(progressOf(db).status, 'in_progress')
  assert.ok(progressOf(db).gps_verified_at)
  assert.equal(earned(db), 0)
  assert.equal(db.tables.jeju_place_visits.length, 0)
  assert.equal(db.tables.jeju_chapters[0].status, 'active')
})

test('gps_photo: GPS → 사진 pass 로 최종 완료. gps_photo ×1.10 EXP 한 번 + GPS 근거 발견 EXP', async () => {
  const db = gpsPhoto()
  await completeQuest({ user: USER, questId: 'q1', payload: gps(), db })
  const out = await photo(db, fakeJudge('pass'))
  assert.equal(out.completed, true)
  assert.equal(progressOf(db).verification_method, 'gps_photo')
  assert.equal(earned(db), exp('gps_photo')) // 20 × 1.5 × 1.10 = 33
  assert.equal(exp('gps_photo'), 33)
  assert.equal(db.tables.jeju_place_discoveries.length, 1)
  assert.equal(db.tables.jeju_place_visits[0].evidence, 'gps')
  assert.equal(db.tables.jeju_exp_logs.filter((l) => l.source_key === 'quest:q1:completion').length, 1)
  // 다시 완료를 시도해도 보상은 중복되지 않는다
  await assert.rejects(() => completeQuest({ user: USER, questId: 'q1', payload: gps(), db }), { message: 'already_completed' })
  assert.equal(earned(db), exp('gps_photo'))
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 20) // 발견 EXP 는 별도 지급(평생 1회)
})

test('gps_photo: 사진 먼저 pass → 아직 미완료(GPS 대기), 이후 GPS 성공하면 최종 완료', async () => {
  const db = gpsPhoto()
  const out = await photo(db, fakeJudge('pass'))
  assert.equal(out.completed, false)
  assert.equal(out.awaiting, 'gps')
  assert.equal(progressOf(db).status, 'in_progress')
  assert.equal(earned(db), 0)
  const done = await completeQuest({ user: USER, questId: 'q1', payload: gps(), db })
  assert.equal(done.progress.verification_method, 'gps_photo')
  assert.equal(earned(db), exp('gps_photo'))
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 20) // 발견 EXP 는 별도 지급(평생 1회)
})

test('gps_photo: GPS 성공 + 사진 fail → 미완료 유지', async () => {
  const db = gpsPhoto()
  await completeQuest({ user: USER, questId: 'q1', payload: gps(), db })
  const out = await photo(db, fakeJudge('fail'))
  assert.equal(out.completed, false)
  assert.equal(progressOf(db).status, 'in_progress')
  assert.ok(progressOf(db).gps_verified_at)
  assert.equal(earned(db), 0)
})

test('gps_photo: GPS 가 어렵다면 사진 통과 뒤 직접 확인으로 마칠 수 있음(갇히지 않음, 발견 EXP 없음)', async () => {
  const db = gpsPhoto()
  await photo(db, fakeJudge('pass'))
  const done = await completeQuest({ user: USER, questId: 'q1', payload: { method: 'self' }, db })
  assert.equal(done.progress.verification_method, 'self')
  assert.equal(db.tables.jeju_place_discoveries.length, 0)
})

// ───────── 추억 사진 ─────────
const memoryOf = (db, over = {}) => saveMemoryPhoto({ user: USER, questId: 'q1', image: JPEG, caption: '  협재   바다 ', db, ...over })

test('추억: 저장하지 않아도 퀘스트는 완료 상태 유지', async () => {
  const db = setup()
  await photo(db, fakeJudge('pass'))
  assert.equal(progressOf(db).status, 'completed')
  assert.equal(db.tables.jeju_travel_photos.length, 0)
  assert.equal(db.storage.objects.size, 0) // 인증 사진은 Storage 에 어디에도 남지 않는다
})

test('추억: 저장하면 Storage 경로(userId/tripId/uuid) + travel_photos 행, 같은 퀘스트는 중복 저장 안 됨', async () => {
  const db = setup()
  await photo(db, fakeJudge('pass'))
  const first = await memoryOf(db)
  assert.equal(first.alreadySaved, false)
  const row = db.tables.jeju_travel_photos[0]
  assert.match(row.storage_path, /^u1\/t1\/[0-9a-f-]{36}\.jpg$/)
  assert.deepEqual([row.is_memory, row.quest_id, row.trip_id, row.adventure_id, row.place_id, row.caption], [true, 'q1', 't1', 'adv1', 'demo-hyeopjae', '협재 바다'])
  assert.equal(db.storage.objects.size, 1)
  assert.ok(db.storage.objects.has(`travel-memories/${row.storage_path}`))

  const second = await memoryOf(db)
  assert.equal(second.alreadySaved, true)
  assert.equal(db.tables.jeju_travel_photos.length, 1)
  assert.equal(db.storage.objects.size, 1)
  assert.equal(progressOf(db).status, 'completed') // 완료 상태는 그대로
})

test('추억: 동시에 두 번 눌러도 한 장만 남고 중복 파일은 정리됨', async () => {
  const db = setup()
  await photo(db, fakeJudge('pass'))
  const results = await Promise.all([memoryOf(db), memoryOf(db)])
  assert.equal(db.tables.jeju_travel_photos.length, 1)
  assert.equal(db.storage.objects.size, 1)
  assert.equal(results.filter((r) => r.alreadySaved).length, 1)
})

test('추억: 사진 인증으로 완료하지 않았거나 미완료면 저장할 수 없음, 업로드 실패 시 행을 만들지 않음', async () => {
  const notDone = setup()
  await assert.rejects(() => memoryOf(notDone), { message: 'memory_not_available' })

  const selfDone = setup({ verification_type: 'gps' })
  await completeQuest({ user: USER, questId: 'q1', payload: gps(), db: selfDone })
  await assert.rejects(() => memoryOf(selfDone), { message: 'memory_not_available' }) // GPS 로 완료한 퀘스트는 사진 인증이 아니다

  const failing = setup()
  await photo(failing, fakeJudge('pass'))
  failing.storage.failUpload = true
  await assert.rejects(() => memoryOf(failing), { message: 'memory_upload_failed' })
  assert.equal(failing.tables.jeju_travel_photos.length, 0)
})

test('추억: 남의 퀘스트/잘못된 이미지는 거절', async () => {
  const db = setup()
  await photo(db, fakeJudge('pass'))
  await assert.rejects(() => memoryOf(db, { user: { id: 'other' } }), { message: 'quest_not_found' })
  await assert.rejects(() => memoryOf(db, { image: Buffer.from('nope').toString('base64') }), { message: 'image_invalid' })
})

// ───────── 추억 사진 Blob 보관 규칙 (두 인증 순서 모두) ─────────
import { shouldKeepPhotoBlob } from '../src/utils/photoMode.js'

// 화면(QuestPage)과 같은 규칙으로 "임시 보관된 사진"을 흉내 낸다: 사진 pass 때만 보관하고, 추억 저장은 보관된 사진이 있어야 가능.
async function memoryFlow(order) {
  const db = setup({ verification_type: 'gps_photo' })
  let kept = false
  const steps = {
    gps: () => completeQuest({ user: USER, questId: 'q1', payload: gps(), db }),
    photo: async () => {
      const result = await photo(db, fakeJudge('pass'))
      if (shouldKeepPhotoBlob(result)) kept = true
      return result
    },
  }
  for (const step of order) await steps[step]()
  assert.equal(progressOf(db).status, 'completed')
  assert.equal(progressOf(db).verification_method, 'gps_photo')
  assert.equal(kept, true, '사진 pass 시 Blob 이 보관돼야 해')
  const saved = await memoryOf(db)
  return { db, saved, earned: earned(db) }
}

test('추억: GPS → 사진 → 완료 → 추억 저장 가능', async () => {
  const { db, saved, earned: total } = await memoryFlow(['gps', 'photo'])
  assert.equal(saved.alreadySaved, false)
  assert.equal(db.tables.jeju_travel_photos.length, 1)
  assert.equal(total, exp('gps_photo'))
})

test('추억: 사진 → GPS → 완료 → 추억 저장 가능 (사진 먼저 통과해도 Blob 보관)', async () => {
  const { db, saved, earned: total } = await memoryFlow(['photo', 'gps'])
  assert.equal(saved.alreadySaved, false)
  assert.equal(db.tables.jeju_travel_photos.length, 1)
  assert.equal(total, exp('gps_photo')) // EXP 는 최종 완료 때 한 번
  assert.equal((await memoryOf(db)).alreadySaved, true) // 중복 저장 방지 유지
  assert.equal(db.tables.jeju_travel_photos.length, 1)
})

test('Blob 보관 규칙: pass 만 보관(fail/uncertain 은 보관 안 함), 서버/Storage 에는 자동 저장 없음', async () => {
  assert.equal(shouldKeepPhotoBlob({ result: 'pass', completed: false, awaiting: 'gps' }), true)
  assert.equal(shouldKeepPhotoBlob({ result: 'pass', completed: true }), true)
  assert.equal(shouldKeepPhotoBlob({ result: 'fail' }), false)
  assert.equal(shouldKeepPhotoBlob({ result: 'uncertain' }), false)
  const db = setup({ verification_type: 'gps_photo' })
  await photo(db, fakeJudge('pass'))
  assert.equal(db.storage.objects.size, 0)
  assert.equal(db.tables.jeju_travel_photos.length, 0)
})
