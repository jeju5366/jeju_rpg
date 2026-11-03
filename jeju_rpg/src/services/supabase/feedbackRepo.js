import { supabase } from '../../lib/supabaseClient.js'

// 여행/모험/퀘스트 피드백 저장. (저장 화면은 이후 단계에서 연결한다)
// 저장된 피드백은 다음 GENERATE_ADVENTURES / GENERATE_QUESTS 의 Agent context(userFeedback)에 요약되어 들어간다.
//   api/_lib/agent/context.js 의 feedbackPart 참고: 최근 평가/코멘트 + 반복해서 높게/낮게 평가한 유형
export async function saveFeedback({ userId, tripId = null, adventureId = null, questId = null, rating = null, comment = null }) {
  const { data, error } = await supabase
    .from('jeju_feedback')
    .insert({
      user_id: userId,
      trip_id: tripId,
      adventure_id: adventureId,
      quest_id: questId,
      rating,
      comment: comment ? String(comment).slice(0, 500) : null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}