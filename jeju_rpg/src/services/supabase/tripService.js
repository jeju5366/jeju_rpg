import { supabase } from '../../lib/supabaseClient.js'

// /setup 입력값을 trips + accommodations 로 한 번에 저장한다.
// DB 함수(jeju_save_trip_setup)가 한 트랜잭션에서 onboarding_completed 도 true 로 올린다.
export async function saveTripSetup(form) {
  const { data, error } = await supabase.rpc('jeju_save_trip_setup', {
    p_trip: {
      start_date: form.startDate,
      end_date: form.endDate,
      companion: form.companion,
      transport: form.transport,
      arrival_flight: form.arrivalFlight,
      departure_flight: form.departureFlight,
      party_size: Number(form.partySize) || 1,
      travel_range: form.travelRange || null,
      desired_end_time: form.desiredEndTime || null,
      // datetime-local 값은 시간대가 없어서 한국 시간(+09:00)으로 저장한다.
      departure_datetime: form.departureDateTime ? `${form.departureDateTime}:00+09:00` : null,
    },
    p_accommodations: form.accommodations.map((a) => ({
      name: a.name,
      address: a.address || null,
      latitude: null, // 지도 연동(9단계)에서 주소 → 좌표 변환 후 채운다
      longitude: null,
      check_in: a.checkIn,
      check_out: a.checkOut,
    })),
  })
  if (error) throw error
  return data // 새 trip id
}

// 가장 최근 여행과 숙소 목록. 없으면 null.
export async function fetchLatestTrip(userId) {
  const { data, error } = await supabase
    .from('jeju_trips')
    .select('*, accommodations:jeju_accommodations(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// 여행 전체 정보(기간/숙소/항공편) 수정. DB 저장만 하고 Agent 는 호출하지 않는다.
// 이후 Agent 호출은 buildAgentContext 가 최신 DB 값을 다시 읽어서 사용한다.
// accommodations: [{ id?, name, address, checkIn, checkOut }]  (id 가 있으면 수정, 없으면 추가, 목록에 없는 기존 숙소는 삭제)
export async function updateTripInfo(tripId, { startDate, endDate, departureFlight, departureDateTime, accommodations }) {
  const { error } = await supabase.rpc('jeju_update_trip_info', {
    p_trip_id: tripId,
    p_trip: {
      start_date: startDate,
      end_date: endDate,
      departure_flight: departureFlight ?? '',
      // datetime-local 값은 시간대가 없어서 한국 시간(+09:00)으로 저장한다.
      departure_datetime: departureDateTime ? `${departureDateTime}:00+09:00` : '',
    },
    p_accommodations: accommodations.map((a) => ({
      id: a.id ?? null,
      name: a.name,
      address: a.address || null,
      check_in: a.checkIn,
      check_out: a.checkOut,
    })),
  })
  if (error) throw error
}