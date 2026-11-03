// 화면 표시용 시각 포맷 (한국 시간). 서버가 ISO 문자열로 준 시각을 "17:30" 처럼 보여준다.
export function hhmm(iso) {
  if (!iso) return '--:--'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
}
