// 퀘스트 완료 결과 팝업용 데이터. "서버가 확정한 지급 결과"를 화면용으로 옮겨 담기만 한다. EXP/발견/레벨을 새로 계산하거나 추정하지 않는다.
//
// 입력: completeQuest 응답의 rewards (api/_lib/quests/progress.js 가 만든 값)
//   rewards.quest     = { awarded, total, parts: [{ category, amount }] }   퀘스트 EXP (이미 받은 보상이면 awarded=false)
//   rewards.discovery = { type: 'normal' | 'landmark', amount, placeName } | null   이번에 실제로 지급된 발견 EXP 만 들어 있다
//   rewards.levelUps  = [{ category: 'overall' | 'explore' ..., from, to }]   지급 전/후 EXP 로 기존 diffLevels 가 계산한 실제 레벨 변화
// 출력: 팝업이 그대로 그리는 데이터. 보여줄 것이 하나도 없으면 null.
export const POPUP_DURATION_MS = { normal: 4000, levelUp: 5000 } // 일반 / 레벨업 포함

export function buildRewardPopup({ quest, rewards }) {
  if (!quest?.id || !rewards) return null
  const questExp = rewards.quest?.awarded ? rewards.quest : null
  const discovery = rewards.discovery ?? null
  const levelUps = (rewards.levelUps ?? []).map(({ category, from, to }) => ({ category, from, to }))

  const items = []
  if (questExp) items.push({ kind: 'quest', amount: questExp.total, parts: (questExp.parts ?? []).map(({ category, amount }) => ({ category, amount })) })
  if (discovery) items.push({ kind: discovery.type === 'landmark' ? 'landmark' : 'discovery', amount: discovery.amount, placeName: discovery.placeName ?? null })
  if (items.length === 0) return null // 새로 지급된 EXP 가 없으면(이미 받은 보상 등) 팝업을 띄우지 않는다

  return {
    // 같은 완료 결과를 한 번만 보여주기 위한 키. EXP 중복 지급 방지 키(quest:{id}:completion)와 같은 규칙이다.
    id: `quest:${quest.id}:completion`,
    questId: quest.id,
    questTitle: quest.title ?? '',
    items,
    totalExp: items.reduce((sum, item) => sum + item.amount, 0), // 화면에 보이는 항목(서버가 확정한 값)의 합
    showTotal: items.length > 1,
    levelUps,
    durationMs: levelUps.length > 0 ? POPUP_DURATION_MS.levelUp : POPUP_DURATION_MS.normal,
  }
}
