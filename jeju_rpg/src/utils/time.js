const pad = (n) => String(n).padStart(2, '0')

// 한국 시간 기준 오늘 (YYYY-MM-DD)
export function todayKst() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000)
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`
}

// start ~ end (포함) 날짜 목록
export function listDays(start, end) {
  const days = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last && days.length < 60) {
    days.push(`${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

// 날짜를 [start, end] 범위 안으로 맞춘다.
export function clampDate(date, start, end) {
  return date < start ? start : date > end ? end : date
}
// '2026-11-03' → '11/03'
export function formatMonthDay(date) {
  return date ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : ''
}

// ISO 시각 → 한국 시간 '11월 6일 18:30'
export function formatKstDateTime(iso) {
  if (!iso) return ''
  const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000)
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
}

// ISO 시각 → datetime-local 입력값 '2026-11-06T18:30' (한국 시간)
export function toKstInputValue(iso) {
  if (!iso) return ''
  const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000)
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
}