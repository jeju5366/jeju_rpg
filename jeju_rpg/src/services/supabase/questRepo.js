import { supabase } from '../../lib/supabaseClient.js'

// 지금 진행할 모험: 선택 이상 상태(selected/active/completed 등) 중 가장 최근 것. 없으면 null. (RLS: 본인 것만)
export async function fetchCurrentAdventure(tripId) {
  const { data, error } = await supabase
    .from('jeju_adventures')
    .select('*')
    .eq('trip_id', tripId)
    .neq('status', 'proposed')
    .order('adventure_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// 모험의 챕터 / 퀘스트 / 진행 상태. 쓰기는 서버만 한다.
export async function fetchQuestBoard(adventureId) {
  const [chaptersRes, questsRes] = await Promise.all([
    // REPLAN 으로 교체된 챕터/퀘스트는 삭제되지 않고 표시만 되어 있다(010). 화면에서는 숨긴다.
    supabase.from('jeju_chapters').select('*').eq('adventure_id', adventureId).neq('status', 'replaced').order('seq', { ascending: true }),
    supabase.from('jeju_quests').select('*').eq('adventure_id', adventureId).is('replaced_at', null).order('seq', { ascending: true }),
  ])
  if (chaptersRes.error) throw chaptersRes.error
  if (questsRes.error) throw questsRes.error

  const questIds = questsRes.data.map((quest) => quest.id)
  let progress = []
  if (questIds.length) {
    const progressRes = await supabase.from('jeju_quest_progress').select('*').in('quest_id', questIds)
    if (progressRes.error) throw progressRes.error
    progress = progressRes.data
  }
  return { chapters: chaptersRes.data, quests: questsRes.data, progress }
}