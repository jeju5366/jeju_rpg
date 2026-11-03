// 일일 여행 조건(daily context) 공통 규칙. 서버(api/)와 화면이 같이 쓴다.
//   여행 전체 정보(기간/숙소/항공편) = trips / accommodations
//   하루 단위 조건(동행/인원/이동수단/종료 희망 시간) = jeju_daily_contexts

export const DAILY_FIELDS = ['companion', 'party_size', 'transport', 'desired_end_time']

const hhmm = (time) => (time ? String(time).slice(0, 5) : null)

// 여행 기본값 (새 여행의 첫 날 기본값)
export function tripDefaults(trip) {
  return {
    companion: trip.companion,
    party_size: trip.party_size ?? 1,
    transport: trip.transport,
    desired_end_time: hhmm(trip.desired_end_time),
  }
}

const pickDaily = (row) => ({
  companion: row.companion,
  party_size: row.party_size ?? 1,
  transport: row.transport,
  desired_end_time: hhmm(row.desired_end_time),
})

// 그날의 일일 조건을 정한다. 우선순위: (1) 그날 저장된 값 → (2) 가장 최근의 이전 일일 조건 → (3) 여행 기본값
//   매일 같은 정보를 다시 입력하지 않게, 새 날짜는 전날 값을 그대로 미리 채운다.
// 반환: { values, source: 'saved' | 'previous' | 'trip', confirmed }  (confirmed = 그날 사용자가 조건을 확인/저장했는지)
export function resolveDailyContext({ saved, previous, trip }) {
  if (saved) return { values: pickDaily(saved), source: 'saved', confirmed: true }
  if (previous) return { values: pickDaily(previous), source: 'previous', confirmed: false }
  return { values: tripDefaults(trip), source: 'trip', confirmed: false }
}

// 바뀐 항목 목록 (DAILY_FIELDS 중). 오늘 일정에 영향을 주는 변경인지 판단할 때 쓴다.
export function changedDailyFields(before, after) {
  return DAILY_FIELDS.filter((key) => (before?.[key] ?? null) !== (after?.[key] ?? null))
}

// 날짜별 숙소: 체크인한 숙소 → 묵고 있는 숙소 → (마지막 날) 체크아웃하는 숙소 순으로 "오늘 숙소"를 정한다.
// 숙소를 옮기는 날(체크아웃 + 다른 숙소 체크인)이면 isChangeDay.
export function accommodationForDate(accommodations, date) {
  const stays = [...(accommodations ?? [])].sort((a, b) => a.check_in.localeCompare(b.check_in))
  const checkingIn = stays.find((a) => a.check_in === date) ?? null
  const checkingOut = stays.find((a) => a.check_out === date) ?? null
  const staying = stays.find((a) => a.check_in <= date && date < a.check_out) ?? null
  const isChangeDay = Boolean(checkingIn && checkingOut && checkingIn.id !== checkingOut.id)
  return {
    today: checkingIn ?? staying ?? checkingOut ?? null,
    isChangeDay,
    from: isChangeDay ? checkingOut : null,
    to: isChangeDay ? checkingIn : null,
  }
}

// 오늘 숙소가 달라졌는지 (이름/주소 기준)
export function accommodationChanged(before, after) {
  return (before?.name ?? null) !== (after?.name ?? null) || (before?.address ?? null) !== (after?.address ?? null)
}
