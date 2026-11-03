// 날짜(YYYY-MM-DD) → 계절. DB 에는 저장하지 않고 필요할 때 계산해서 Agent 에 전달한다.
export function getSeason(dateString) {
  const month = Number(dateString.slice(5, 7))
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}