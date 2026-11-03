// 개발용 도구: 퀘스트 완료 API(completeQuest)가 DB 를 몇 번, 어떤 순서로 왕복하는지 측정한다. (운영 UI 에는 노출되지 않는다)
//   node scripts/dev/completion-timing.mjs [latencyMs=50]
// 가짜 DB 에 호출마다 지연(latencyMs)을 흉내 내서, 직렬로 기다린 왕복 수(stages)와 전체 소요 시간을 비교한다.
// 실제 Supabase 왕복 시간 하나를 알고 싶으면 scripts/dev/db-latency.mjs 를 쓴다.
import { completeQuest } from '../../api/_lib/quests/progress.js'
import { fakeDb } from '../../tests/helpers/fakeDb.js'
import { instrument } from '../../tests/helpers/instrumentDb.js'

const latencyMs = Number(process.argv[2] ?? 50)
const gps = () => ({ method: 'gps', position: { lat: 33.5, lng: 126.5, accuracy: 10, timestamp: Date.now() } })
const base = { adventure_id: 'adv1', user_id: 'u1', chapter_id: 'c1', difficulty: 'normal', category_primary: 'explore', category_secondary: 'culture', is_hidden: false, replaced_at: null, data: {}, place_id: 'p1', place_name: '장소', place_lat: 33.5, place_lng: 126.5 }
const scenarios = [
  { name: 'self optional (장소 있음, 발견 없음)', quest: { ...base, id: 'q', quest_type: 'optional', verification_type: 'self' }, payload: { method: 'self' } },
  { name: 'gps core (방문 + 최초 발견)', quest: { ...base, id: 'q', quest_type: 'core', verification_type: 'gps' }, payload: gps() },
  { name: 'surprise gps (챕터 없음, 방문 + 최초 발견)', quest: { ...base, id: 'q', quest_type: 'surprise', chapter_id: null, surprise_status: 'accepted', verification_type: 'gps' }, payload: gps() },
]
const results = []
for (const { name, quest, payload } of scenarios) {
  const db = fakeDb(
    {
      jeju_adventures: [{ id: 'adv1', user_id: 'u1', trip_id: 't1', status: 'active' }],
      jeju_trips: [{ id: 't1', user_id: 'u1', travel_mode: 'quest' }],
      jeju_chapters: [{ id: 'c1', user_id: 'u1', adventure_id: 'adv1', seq: 1, status: 'active' }],
      jeju_quests: [quest],
      jeju_quest_progress: [],
    },
    { unique: { jeju_quest_progress: (a, b) => a.user_id === b.user_id && a.quest_id === b.quest_id } },
  )
  const probe = instrument(db, { latencyMs })
  await completeQuest({ user: { id: 'u1' }, questId: 'q', payload, db: probe.db })
  results.push({ name, ...probe.summary() })
}
console.log(`지연 시뮬레이션: DB 호출 1회 = ${latencyMs}ms\n`)
for (const r of results) {
  console.log(`■ ${r.name}\n   호출 ${r.count}회 · 직렬 왕복(stages) ${r.stages} · 소요 ${r.elapsedMs}ms`)
  console.log('   ' + Object.entries(r.byLabel).map(([k, v]) => `${k}×${v}`).join(', '))
}
