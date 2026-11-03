// 개발용 도구: 진행 중인 모험의 현재 챕터에 "화강암 사진 인증" 테스트 퀘스트를 임시로 추가한다. (실제 사진 인증 흐름을 화면에서 시험하기 위함)
// 서비스 UX/실제 퀘스트 데이터에는 포함되지 않는다. 시험이 끝나면 --cleanup 으로 지운다. (data.devFixture 표시가 있는 퀘스트만 지운다)
//
//   node --env-file=.env scripts/dev/seed-photo-quest.mjs <userId>                       photo_ai 퀘스트(AI 판정)
//   node --env-file=.env scripts/dev/seed-photo-quest.mjs <userId> --type gps_photo --lat 33.5 --lng 126.53   GPS + 사진
//   node --env-file=.env scripts/dev/seed-photo-quest.mjs <userId> --type photo_upload   업로드만 확인
//   node --env-file=.env scripts/dev/seed-photo-quest.mjs <userId> --cleanup
//
// userId 는 Supabase 의 auth 사용자 id(UUID)다.
import { getAdmin } from '../../api/_lib/supabaseAdmin.js'

const args = process.argv.slice(2)
const userId = args[0]
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
if (!userId || userId.startsWith('--')) {
  console.error('사용법: node --env-file=.env scripts/dev/seed-photo-quest.mjs <userId> [--type photo_ai|gps_photo|photo_upload] [--lat N --lng N] [--cleanup]')
  process.exit(1)
}

const db = getAdmin()

if (args.includes('--cleanup')) {
  const { data, error } = await db.from('jeju_quests').select('id').eq('user_id', userId).contains('data', { devFixture: true })
  if (error) throw error
  if (data.length) {
    const { error: deleteError } = await db.from('jeju_quests').delete().in('id', data.map((q) => q.id))
    if (deleteError) throw deleteError
  }
  console.log(`테스트 퀘스트 ${data.length}개를 지웠어.`)
  process.exit(0)
}

const type = flag('--type') ?? 'photo_ai'
if (!['photo_ai', 'photo_upload', 'gps_photo'].includes(type)) throw new Error('--type 은 photo_ai | photo_upload | gps_photo')

const { data: adventure, error: advError } = await db.from('jeju_adventures').select('id').eq('user_id', userId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
if (advError) throw advError
if (!adventure) throw new Error('진행 중(active)인 모험이 없어. 먼저 모험을 시작하고 퀘스트를 받아줘.')

const { data: chapters, error: chError } = await db.from('jeju_chapters').select('id, seq, status').eq('adventure_id', adventure.id).in('status', ['active', 'core_completed']).order('seq')
if (chError) throw chError
const chapter = chapters[0]
if (!chapter) throw new Error('진행 중인 챕터가 없어.')

const lat = flag('--lat')
const lng = flag('--lng')
const upload = type === 'photo_upload'
const row = {
  user_id: userId,
  adventure_id: adventure.id,
  chapter_id: chapter.id,
  quest_type: 'optional',
  title: upload ? '[테스트] 기억에 남는 풍경 한 장' : '[테스트] 화강암 사진 인증',
  description: upload ? '오늘 가장 기억에 남는 풍경을 한 장 남겨봐.' : '화강암 바위를 사진으로 남겨봐.',
  difficulty: 'normal',
  category_primary: 'explore',
  verification_type: type,
  verification_target: upload ? null : 'granite rock',
  place_id: lat && lng ? 'dev-fixture-place' : null,
  place_name: lat && lng ? '테스트 장소' : null,
  place_lat: lat ? Number(lat) : null,
  place_lng: lng ? Number(lng) : null,
  is_hidden: false,
  seq: 90,
  data: { devFixture: true, photoSubject: 'granite rock / granite stone' },
}
const { data: quest, error } = await db.from('jeju_quests').insert(row).select('id, title').single()
if (error) throw error
console.log(`추가했어: ${quest.title} (${type}) — 퀘스트 화면을 새로고침해서 현재 챕터의 선택 퀘스트로 확인해줘.`)
console.log(`지우려면: node --env-file=.env scripts/dev/seed-photo-quest.mjs ${userId} --cleanup`)
