import { calcQuestExp, splitExp } from './exp.js'

// 퀘스트 화면의 "표시 방식" 판단(순수 함수). 퀘스트 생성/완료/검증/EXP 로직은 건드리지 않고, 이미 있는 데이터를 어떻게 묶어 보여줄지만 정한다.

// 현재 챕터의 퀘스트를 화면용으로 나눈다.
//   core        : 핵심 퀘스트 (REPLAN 으로 교체된 것은 제외)
//   coreDone    : 핵심 퀘스트 완료 여부 → 완료되면 한 줄(compact)로 접어 보여준다
//   pending     : 공개된 미완료 선택 퀘스트 → compact 카드
//   done        : 완료한 선택 퀘스트 → 하나의 접힌 그룹
//   hiddenCount : 아직 공개 전인 선택 퀘스트 수 ("퀘스트 더 받기")
export function partitionChapterQuests({ quests, completedIds }) {
  const live = quests.filter((q) => !q.replaced_at)
  const core = live.find((q) => q.quest_type === 'core') ?? null
  const optional = live.filter((q) => q.quest_type === 'optional')
  const visible = optional.filter((q) => !q.is_hidden)
  return {
    core,
    coreDone: Boolean(core && completedIds.has(core.id)),
    pending: visible.filter((q) => !completedIds.has(q.id)),
    done: visible.filter((q) => completedIds.has(q.id)),
    hiddenCount: optional.length - visible.length,
  }
}

// compact 카드에 보여줄 인증 방식 아이콘
export const VERIFICATION_ICON = { self: '📝', gps: '📍', photo_upload: '📷', photo_ai: '📷', gps_photo: '📍📷' }

// compact 카드의 EXP: "받을 수 있는 대표 보상"(미완료) / "받은 보상"(완료, 실제 인증 방식 기준).
// 계산은 기존 calcQuestExp 를 그대로 쓴다. (EXP 규칙은 바꾸지 않는다)
export function questExpPreview(quest, progress = null) {
  const method = quest.verification_type === 'gps_photo' ? 'gps_photo' : quest.verification_type
  const planned = method === 'photo_upload' || method === 'photo_ai' || method === 'gps' || method === 'gps_photo' || method === 'self' ? method : 'self'
  const expOf = (verificationMethod) => calcQuestExp({ difficulty: quest.difficulty, questType: quest.quest_type, verificationMethod }).total
  const earnedMethod = progress?.status === 'completed' ? progress.verification_method : null
  return {
    planned: expOf(planned),
    earned: earnedMethod ? expOf(earnedMethod) : null,
    earnedMethod,
  }
}

// 진행 중인 인증 상태를 compact 카드 한 줄로 알려준다. (예: gps_photo 에서 위치만 끝난 상태)
export function progressHint(quest, progress) {
  if (!progress || progress.status === 'completed') return null
  if (quest.verification_type === 'gps_photo') {
    if (progress.gps_verified_at && !progress.photo_verified_at) return 'gps_done'
    if (progress.photo_verified_at && !progress.gps_verified_at) return 'photo_done'
  }
  return null
}

// Set 토글 (불변)
export function toggled(set, id) {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// 선택 퀘스트가 펼쳐져 있어야 하는지: 사용자가 펼쳤거나, 인증이 진행 중이거나, 방금 인증 안내가 떠 있으면 자동으로 닫지 않는다.
export function isQuestOpen(id, { openIds, busyQuestId, gpsBusyQuestId, gpsFeedback, activeQuestId }) {
  return openIds.has(id) || busyQuestId === id || gpsBusyQuestId === id || gpsFeedback?.questId === id || activeQuestId === id
}

// "예상 성장": 이 퀘스트를 (의도한 인증 방식으로) 완료하면 어떤 카테고리에 EXP 가 들어가는지.
// 새 계산 규칙이 아니라 서버가 지급할 때 쓰는 기존 함수(calcQuestExp → splitExp)를 그대로 호출해서, 완료 후의 실제 지급과 같은 값이 나온다.
// 실제 완료 방식이 달라지면(예: 직접 확인 fallback) 수치가 달라질 수 있어서 카드에는 "예상"으로, 완료 팝업에는 서버가 확정한 "획득"으로 구분해 보여준다.
// → [{ category, amount }]  (카테고리가 없는 퀘스트는 서버와 같이 explore 로 본다)
export function questGrowthPreview(quest) {
  const { planned } = questExpPreview(quest)
  return splitExp(planned, quest.category_primary ?? 'explore', quest.category_secondary ?? null)
}
