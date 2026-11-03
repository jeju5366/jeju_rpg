// 데모 항공/공항 데이터(한국공항공사). 실제 운항/혼잡 정보가 아니다. (mock/demo)
const pad = (n) => String(n).padStart(2, '0')

// 요청한 편명으로 오늘 18:30 출발 정상 운항 1건을 만들어 준다.
export function buildMockFlight(flightNo, searchday) {
  const day = `${searchday.slice(0, 4)}-${searchday.slice(4, 6)}-${searchday.slice(6, 8)}`
  return {
    flightNo,
    searchday,
    found: true,
    departsFromJeju: true,
    totalCount: 1,
    flights: [
      {
        airline: '데모항공',
        flightNo,
        departureAirport: '제주',
        departureAirportCode: 'CJU',
        arrivalAirport: '김포',
        arrivalAirportCode: 'GMP',
        scheduledDeparture: `${day} 18:30`,
        changedDeparture: `${day} 18:30`,
        diffMinutes: 0,
        status: '출발',
        delayed: false,
        cancelled: false,
      },
    ],
  }
}

// 실제 API 와 같은 형태: 혼잡도 단계(1 원활 ~ 4 매우혼잡)만 있고 대기시간 필드는 없다.
export function buildMockCongestion(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  const level = { value: 2, label: '보통' }
  const current = {
    airportCode: 'CJU',
    time: `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`,
    section1: level,
    section2: level,
    section3: level,
    overall: level,
  }
  return {
    totalRows: 1,
    airports: ['CJU'],
    current,
    hourly: [current],
    hourlyAvailable: false,
    waitMinutes: null,
    securityMinutes: null,
  }
}