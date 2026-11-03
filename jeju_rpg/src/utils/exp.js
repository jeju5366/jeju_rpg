import { EXP_BASE, QUEST_TYPE_MULTIPLIER, TIME_LIMIT_BONUS, VERIFICATION_MULTIPLIER } from '../constants/gameBalance.js'

// 퀘스트 EXP = round(기본 EXP × 퀘스트 유형 배수 × 인증 방식 배수) + 제한시간 성공 보너스
//   예) Normal 핵심 퀘스트(self) = round(20 × 1.5 × 0.9) = 27 / GPS 였다면 20 × 1.5 × 1.00 = 30
// verificationMethod 는 "실제로 완료한 방식"이다. (퀘스트에 저장된 의도한 인증 방식이 아니다)
// 돌발 퀘스트(surprise)도 같은 함수로 계산한다. (실제 기능은 이후 단계)
export function calcQuestExp({ difficulty, questType, verificationMethod, timeLimitSuccess = false }) {
  const base = EXP_BASE[difficulty]
  const typeMultiplier = QUEST_TYPE_MULTIPLIER[questType]
  const verificationMultiplier = VERIFICATION_MULTIPLIER[verificationMethod]
  if (base === undefined || typeMultiplier === undefined || verificationMultiplier === undefined) {
    throw new Error(`EXP 를 계산할 수 없는 퀘스트야 (${difficulty} / ${questType} / ${verificationMethod})`)
  }
  const timeBonus = timeLimitSuccess ? TIME_LIMIT_BONUS : 0
  return {
    total: Math.round(base * typeMultiplier * verificationMultiplier) + timeBonus,
    base,
    typeMultiplier,
    verificationMultiplier,
    timeBonus,
  }
}

// 복합 카테고리면 총 EXP 를 두 카테고리에 나눈다. 홀수면 primary 가 1 더 가져가서 합계가 정확히 유지된다.
//   30 → 15 / 15, 27 → 14 / 13, secondary 가 없으면 전부 primary
export function splitExp(total, primary, secondary = null) {
  if (!secondary) return [{ category: primary, amount: total }]
  const first = Math.ceil(total / 2)
  return [
    { category: primary, amount: first },
    { category: secondary, amount: total - first },
  ].filter((part) => part.amount > 0)
}
