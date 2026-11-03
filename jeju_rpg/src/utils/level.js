import { EXPERIENCE_TIER_LEVELS } from '../constants/gameBalance.js'

// 레벨은 DB 에 저장하지 않고 EXP 에서 계산한다. (서버 api/ 와 화면이 같이 쓴다)
//
// 곡선 표기: [구간의 마지막 레벨, 그 구간에서 "다음 레벨로 오르는 데 필요한 EXP"]
//   예) [10, 20] → Lv.1~10 은 레벨마다 20 EXP 가 필요하다. (Lv.1 → Lv.11 에는 200 EXP)
const GENERAL_BANDS = [
  [10, 20],
  [25, 30],
  [50, 40],
  [75, 55],
  [100, 75],
  [200, 110],
  [300, 160],
  [500, 250],
  [750, 400],
  [999, 650],
]
const DISCOVERY_BANDS = [
  [10, 10],
  [25, 15],
  [50, 20],
  [100, 25],
  [150, 30],
  [200, 35],
]

// cumulative[L] = Lv.L 이 되기 위해 필요한 누적 EXP. (cumulative[1] = 0)
function buildCurve(bands) {
  const maxLevel = bands[bands.length - 1][0]
  const cumulative = [0, 0]
  for (let level = 1; level < maxLevel; level += 1) {
    const cost = bands.find(([last]) => level <= last)[1]
    cumulative[level + 1] = cumulative[level] + cost
  }
  return { maxLevel, cumulative }
}

export const GENERAL_CURVE = buildCurve(GENERAL_BANDS) // overall / explore / culture / food / relax / social (최대 Lv.999)
export const DISCOVERY_CURVE = buildCurve(DISCOVERY_BANDS) // discovery (최대 Lv.200)

export const EXP_CATEGORY_KEYS = ['explore', 'culture', 'food', 'relax', 'social', 'discovery']

// exp → { level, maxLevel, isMax, expIntoLevel, expForNextLevel }
export function levelFromExp(exp, curve = GENERAL_CURVE) {
  const value = Math.max(0, Math.floor(Number(exp) || 0))
  const { cumulative, maxLevel } = curve
  let low = 1
  let high = maxLevel
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (cumulative[mid] <= value) low = mid
    else high = mid - 1
  }
  const isMax = low === maxLevel
  return {
    level: low,
    maxLevel,
    isMax,
    expIntoLevel: isMax ? 0 : value - cumulative[low],
    expForNextLevel: isMax ? 0 : cumulative[low + 1] - cumulative[low],
  }
}

export const curveOf = (category) => (category === 'discovery' ? DISCOVERY_CURVE : GENERAL_CURVE)

// 6개 EXP 의 합 (별도 total_exp 를 저장하지 않는다)
export function totalExp(exps) {
  return EXP_CATEGORY_KEYS.reduce((sum, key) => sum + (Number(exps[key]) || 0), 0)
}

// { explore, ..., discovery } → { overall, explore, ..., discovery } 각각 levelFromExp 결과
export function levelsOf(exps) {
  const result = { overall: levelFromExp(totalExp(exps), GENERAL_CURVE) }
  for (const key of EXP_CATEGORY_KEYS) result[key] = levelFromExp(exps[key], curveOf(key))
  return result
}

// 지급 전/후 EXP 를 비교해 오른 레벨을 돌려준다. → [{ category, from, to }]  (category 는 'overall' 포함)
export function diffLevels(beforeExps, afterExps) {
  const before = levelsOf(beforeExps)
  const after = levelsOf(afterExps)
  return ['overall', ...EXP_CATEGORY_KEYS]
    .filter((key) => after[key].level > before[key].level)
    .map((key) => ({ category: key, from: before[key].level, to: after[key].level }))
}

// 경험도 단계 (beginner / intermediate / advanced). 추천 선호도가 아니라 "얼마나 경험했는가"를 나타낸다.
export function experienceTier(level) {
  if (level >= EXPERIENCE_TIER_LEVELS.advanced) return 'advanced'
  return level >= EXPERIENCE_TIER_LEVELS.intermediate ? 'intermediate' : 'beginner'
}

// 프로필 행(exp_explore ...) → { explore, ..., discovery }
export function expsFromProfile(profile) {
  return Object.fromEntries(EXP_CATEGORY_KEYS.map((key) => [key, Number(profile?.[`exp_${key}`]) || 0]))
}
