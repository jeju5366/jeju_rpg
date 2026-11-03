import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finishFreeTravel, startFreeTravel } from '../api/_lib/freeTravel/service.js'
import { resolveVerification } from '../api/_lib/quests/verification.js'
import { DISCOVERY_ALLOWED_METHODS } from '../src/constants/gameBalance.js'

// DB 없이 서버 로직을 확인하기 위한 아주 작은 in-memory Supabase 흉내. (이 테스트에 필요한 호출만 지원)
function fakeDb(seed = {}) {
  const tables = {
    jeju_adventures: [],
    jeju_trips: [],
    jeju_free_sessions: [],
    jeju_final_quests: [],
    jeju_place_visits: [],
    jeju_place_discoveries: [],
    jeju_landmarks: [{ place_id: 'demo-seongsan' }],
    jeju_profiles: [{ id: 'u1', exp_explore: 0, exp_culture: 0, exp_food: 0, exp_relax: 0, exp_social: 0, exp_discovery: 0, unspent_exp: 0 }],
    ...seed,
  }
  const log = []
  class Query {
    constructor(table) {
      this.table = table
      this.filters = []
      this.op = 'select'
    }
    select() {
      return this
    }
    eq(key, value) {
      this.filters.push([key, value])
      return this
    }
    insert(row) {
      this.op = 'insert'
      this.row = row
      return this
    }
    update(values) {
      this.op = 'update'
      this.values = values
      return this
    }
    rows() {
      return tables[this.table].filter((r) => this.filters.every(([k, v]) => r[k] === v))
    }
    run() {
      if (this.op === 'insert') {
        const unique = {
          jeju_place_visits: (r) => r.user_id === this.row.user_id && r.free_session_id && r.free_session_id === this.row.free_session_id && r.place_id === this.row.place_id,
          jeju_free_sessions: (r) => r.user_id === this.row.user_id && r.status === 'active' && (this.row.status ?? 'active') === 'active',
        }[this.table]
        if (unique && tables[this.table].some(unique)) return { data: null, error: { code: '23505' } }
        const row = { id: `${this.table}-${tables[this.table].length + 1}`, status: 'active', started_at: new Date().toISOString(), ...this.row }
        tables[this.table].push(row)
        log.push(['insert', this.table, row])
        return { data: row, error: null }
      }
      if (this.op === 'update') {
        const rows = this.rows()
        rows.forEach((r) => Object.assign(r, this.values))
        log.push(['update', this.table, this.values])
        return { data: rows, error: null }
      }
      return { data: this.rows(), error: null }
    }
    maybeSingle() {
      const { data, error } = this.run()
      return Promise.resolve({ data: data[0] ?? null, error })
    }
    single() {
      const { data, error } = this.run()
      return Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error })
    }
    then(resolve, reject) {
      return Promise.resolve(this.run()).then(resolve, reject)
    }
  }
  return {
    tables,
    log,
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      if (name !== 'jeju_record_discovery') throw new Error(`unsupported rpc ${name}`)
      if (tables.jeju_place_discoveries.some((d) => d.user_id === args.p_user && d.place_id === args.p_place_id)) return { data: { discovered: false }, error: null }
      tables.jeju_place_discoveries.push({ user_id: args.p_user, place_id: args.p_place_id, discovery_type: args.p_type })
      tables.jeju_profiles[0].exp_discovery += args.p_amount
      return { data: { discovered: true, awarded: true }, error: null }
    },
  }
}

const USER = { id: 'u1' }
const MIN = 60 * 1000
const BASE = Date.now() - 60 * MIN
// 데모 장소(mock): 협재해수욕장 / 성산일출봉(명소) / 동문시장
const HYEOPJAE = { placeId: 'demo-hyeopjae', lat: 33.394, lng: 126.2394 }
const SEONGSAN = { placeId: 'demo-seongsan', lat: 33.458, lng: 126.9425 }
const stay = (place, minutes) => Array.from({ length: minutes + 1 }, (_, m) => ({ lat: place.lat, lng: place.lng, t: BASE + m * MIN }))
const westRoute = [
  { lat: 33.5, lng: 126.53, t: BASE },
  { lat: 33.46, lng: 126.33, t: BASE + 20 * MIN },
  { lat: 33.41, lng: 126.26, t: BASE + 40 * MIN },
]

function seededDb() {
  return fakeDb({
    jeju_adventures: [{ id: 'adv1', trip_id: 't1', user_id: 'u1', status: 'active' }],
    jeju_trips: [{ id: 't1', user_id: 'u1', travel_mode: 'quest' }],
  })
}

test('자유여행 시작: 모험은 그대로 active 이고 여행 모드만 free, 두 번 눌러도 세션은 하나', async () => {
  const db = seededDb()
  const first = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  assert.equal(db.tables.jeju_trips[0].travel_mode, 'free')
  assert.equal(db.tables.jeju_adventures[0].status, 'active')
  const second = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  assert.equal(second.alreadyActive, true)
  assert.equal(second.session.id, first.session.id)
  assert.equal(db.tables.jeju_free_sessions.length, 1)
})

test('자유여행 시작: 진행 중인 모험이 아니면 거절', async () => {
  const db = seededDb()
  db.tables.jeju_adventures[0].status = 'completed'
  await assert.rejects(() => startFreeTravel({ user: USER, adventureId: 'adv1', db }), { message: 'adventure_not_active' })
})

test('방문 확정: 체류가 확인된 후보는 gps 방문 + 발견 EXP, 종료하면 quest 모드로 복귀', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const result = await finishFreeTravel({
    user: USER,
    sessionId: session.id,
    visits: [{ ...HYEOPJAE, source: 'candidate' }],
    route: stay(HYEOPJAE, 7),
    candidatesSeen: 1,
    db,
  })
  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0].evidence, 'gps')
  assert.equal(result.rewards.discoveries.length, 1)
  assert.equal(db.tables.jeju_place_visits[0].visit_source, 'gps')
  assert.equal(db.tables.jeju_place_visits[0].free_session_id, session.id)
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 20) // 명소가 아니면 +20
  assert.equal(db.tables.jeju_trips[0].travel_mode, 'quest')
  assert.equal(db.tables.jeju_free_sessions[0].status, 'ended')
  // 이동 경로(좌표)는 DB 어디에도 저장되지 않는다
  assert.ok(!JSON.stringify(db.log).includes('"route"'))
  assert.deepEqual(Object.keys(db.tables.jeju_free_sessions[0].summary).sort(), ['candidatesSeen', 'routePoints', 'visitsSaved'])
})

test('방문 확정: 명소(landmark whitelist)는 +35, 같은 장소 발견은 평생 한 번', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const first = await finishFreeTravel({ user: USER, sessionId: session.id, visits: [{ ...SEONGSAN, source: 'candidate' }], route: stay(SEONGSAN, 7), db })
  assert.equal(first.rewards.discoveries[0].type, 'landmark')
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 35)

  // 두 번째 자유여행에서 같은 장소를 또 방문해도 방문 기록만 남고 발견 EXP 는 없다
  db.tables.jeju_trips[0].travel_mode = 'quest'
  const again = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const second = await finishFreeTravel({ user: USER, sessionId: again.session.id, visits: [{ ...SEONGSAN, source: 'candidate' }], route: stay(SEONGSAN, 7), db })
  assert.equal(second.saved.length, 1)
  assert.equal(second.rewards.discoveries.length, 0)
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 35)
  assert.equal(db.tables.jeju_place_visits.length, 2)
})

test('방문 확정: 경로에 체류 근거가 없는 후보는 저장하지 않음(위조 방지)', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const result = await finishFreeTravel({ user: USER, sessionId: session.id, visits: [{ ...HYEOPJAE, source: 'candidate' }], route: westRoute, db })
  assert.equal(result.saved.length, 0)
  assert.equal(result.rejected[0].code, 'dwell_not_confirmed')
  assert.equal(db.tables.jeju_place_visits.length, 0)
})

test('수동 방문: 경로 근처(협재)는 route 근거로 발견 EXP, 터무니없이 먼 곳(성산)은 거절', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const result = await finishFreeTravel({
    user: USER,
    sessionId: session.id,
    visits: [
      { ...HYEOPJAE, source: 'manual' },
      { ...SEONGSAN, source: 'manual' },
    ],
    route: westRoute,
    db,
  })
  assert.deepEqual(result.saved.map((v) => [v.placeId, v.evidence, v.discovery]), [['demo-hyeopjae', 'route', true]])
  assert.deepEqual(result.rejected.map((r) => [r.placeId, r.code]), [['demo-seongsan', 'too_far_from_route']])
  assert.equal(db.tables.jeju_place_visits[0].visit_source, 'manual')
})

test('수동 방문: GPS 경로가 없으면 방문은 저장하되 발견 EXP 는 없음', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const result = await finishFreeTravel({ user: USER, sessionId: session.id, visits: [{ ...SEONGSAN, source: 'manual' }], route: [], db })
  assert.deepEqual(result.saved.map((v) => [v.evidence, v.discovery]), [['none', false]])
  assert.equal(db.tables.jeju_place_visits.length, 1)
  assert.equal(db.tables.jeju_place_discoveries.length, 0)
  assert.equal(db.tables.jeju_profiles[0].exp_discovery, 0)
})

test('방문 확정: 서버가 모르는 장소(임의 placeId)는 거절', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  const result = await finishFreeTravel({ user: USER, sessionId: session.id, visits: [{ placeId: 'fake-place', lat: 33.5, lng: 126.5, source: 'manual' }], route: westRoute, db })
  assert.equal(result.rejected[0].code, 'place_not_verified')
  assert.equal(db.tables.jeju_place_visits.length, 0)
})

test('종료: 방문 없이도 종료되고, 같은 요청을 다시 보내도(재전송) 안전하게 같은 결과', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  await finishFreeTravel({ user: USER, sessionId: session.id, visits: [], route: [], db })
  assert.equal(db.tables.jeju_trips[0].travel_mode, 'quest')
  const again = await finishFreeTravel({ user: USER, sessionId: session.id, visits: [], route: [], db })
  assert.equal(again.alreadyEnded, true)
  await assert.rejects(() => finishFreeTravel({ user: { id: 'other' }, sessionId: session.id, visits: [], route: [], db }), { message: 'free_session_not_found' })
})

test('종료: 잘못된 요청(방문 수 초과/형식 오류)은 거절', async () => {
  const db = seededDb()
  const { session } = await startFreeTravel({ user: USER, adventureId: 'adv1', db })
  await assert.rejects(() => finishFreeTravel({ user: USER, sessionId: session.id, visits: Array(31).fill({ ...HYEOPJAE, source: 'manual' }), db }), { message: 'visits_invalid' })
  await assert.rejects(() => finishFreeTravel({ user: USER, sessionId: session.id, visits: [{ placeId: 'x', lat: 'a', lng: 1, source: 'manual' }], db }), { message: 'visits_invalid' })
})

// ───────── GPS 퀘스트 인증 (서버 resolveVerification) ─────────
const gpsQuest = { verification_type: 'gps', place_lat: 33.5, place_lng: 126.53 }
const fresh = (over = {}) => ({ lat: 33.5005, lng: 126.5305, accuracy: 25, timestamp: Date.now(), ...over })

test('GPS 인증: 기본(method 없음)은 self, 반경 안 위치는 gps 로 인정', () => {
  assert.equal(resolveVerification(gpsQuest, {}).method, 'self')
  const ok = resolveVerification(gpsQuest, { method: 'gps', position: fresh() })
  assert.equal(ok.method, 'gps')
  assert.ok(ok.gps.distanceMeters < 150)
})

test('GPS 인증: 반경 밖/정확도 낮음/오래된 위치는 거절(거리 정보 포함), self fallback 은 항상 가능', () => {
  assert.throws(() => resolveVerification(gpsQuest, { method: 'gps', position: fresh({ lat: 33.52 }) }), (e) => e.message === 'gps_too_far' && e.details.distanceMeters > 150)
  assert.throws(() => resolveVerification(gpsQuest, { method: 'gps', position: fresh({ accuracy: 400 }) }), { message: 'gps_accuracy_low' })
  assert.throws(() => resolveVerification(gpsQuest, { method: 'gps', position: fresh({ timestamp: Date.now() - 10 * MIN }) }), { message: 'gps_position_stale' })
  assert.throws(() => resolveVerification(gpsQuest, { method: 'gps' }), { message: 'gps_position_invalid' })
  assert.equal(resolveVerification(gpsQuest, { method: 'self' }).method, 'self')
})

test('GPS 인증: GPS 를 의도하지 않은 퀘스트나 좌표 없는 퀘스트는 gps 로 완료할 수 없음', () => {
  assert.throws(() => resolveVerification({ verification_type: 'self', place_lat: 33.5, place_lng: 126.53 }, { method: 'gps', position: fresh() }), { message: 'gps_not_supported' })
  assert.throws(() => resolveVerification({ verification_type: 'gps', place_lat: null, place_lng: null }, { method: 'gps', position: fresh() }), { message: 'gps_target_unavailable' })
})

test('발견 인정 방식: self 는 발견 EXP 대상이 아니고 gps 는 대상', () => {
  assert.equal(DISCOVERY_ALLOWED_METHODS.includes('self'), false)
  assert.equal(DISCOVERY_ALLOWED_METHODS.includes('gps'), true)
})
