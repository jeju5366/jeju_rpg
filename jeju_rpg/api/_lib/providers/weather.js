import { fetchPublicData, toArray } from '../dataGoKr.js'
import { serviceKey } from '../env.js'
import { latLngToGrid } from '../kmaGrid.js'
import { runProvider } from '../provider.js'
import { buildMockWeather } from '../mock/weather.js'

// 기상청 단기예보 조회서비스: 초단기실황 + 초단기예보 + 단기예보를 합쳐 Agent/규칙 엔진용 구조로 정리한다.
// (api_test 의 정리 로직을 이식. 코드 비교용으로 enum 코드를 쓰고, 화면 문구는 UI 쪽에서 매핑한다.)
const BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0'
const SKY = { 1: 'clear', 3: 'mostly_cloudy', 4: 'cloudy' }
const PTY = { 0: 'none', 1: 'rain', 2: 'rain_snow', 3: 'snow', 4: 'shower', 5: 'drizzle', 6: 'drizzle_snow', 7: 'snow_flurry' }

// 기상청 발표 기준은 KST. 서버 시간대와 무관하게 KST 로 계산한다.
const pad = (n) => String(n).padStart(2, '0')
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000)
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
const minusHours = (d, h) => new Date(d.getTime() - h * 3600 * 1000)

function ncstBase(now) {
  const t = now.getUTCMinutes() < 10 ? minusHours(now, 1) : now // 매시 10분 이후 제공
  return { base_date: ymd(t), base_time: `${pad(t.getUTCHours())}00` }
}
function ultraFcstBase(now) {
  const t = now.getUTCMinutes() < 45 ? minusHours(now, 1) : now // 매시 45분 이후 제공
  return { base_date: ymd(t), base_time: `${pad(t.getUTCHours())}30` }
}
function vilageFcstBase(now) {
  const t = new Date(now.getTime() - 10 * 60 * 1000) // 발표 후 약 10분 뒤 제공
  const hours = [2, 5, 8, 11, 14, 17, 20, 23]
  const h = [...hours].reverse().find((x) => x <= t.getUTCHours())
  if (h === undefined) return { base_date: ymd(minusHours(t, 24)), base_time: '2300' }
  return { base_date: ymd(t), base_time: `${pad(h)}00` }
}

async function call(operation, base, grid, numOfRows) {
  const response = await fetchPublicData(`${BASE}/${operation}`, {
    serviceKey: serviceKey('KMA_API_KEY'),
    pageNo: 1,
    numOfRows,
    dataType: 'JSON',
    ...base,
    nx: grid.nx,
    ny: grid.ny,
  })
  return toArray(response.body?.items)
}

const num = (v) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const toIso = (date, time) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:00+09:00`

// [{fcstDate, fcstTime, category, fcstValue}] -> { 'YYYYMMDDHHmm': {카테고리: 값} }
function groupByTime(rows) {
  const out = {}
  for (const row of rows) {
    const key = `${row.fcstDate}${row.fcstTime}`
    out[key] ??= { date: row.fcstDate, time: row.fcstTime }
    out[key][row.category] = row.fcstValue
  }
  return out
}

async function liveWeather({ lat, lng }) {
  const grid = latLngToGrid(lat, lng)
  const now = kstNow()
  const ncst = ncstBase(now)

  const [ncstRes, ultraRes, vilageRes] = await Promise.allSettled([
    call('getUltraSrtNcst', ncst, grid, 20),
    call('getUltraSrtFcst', ultraFcstBase(now), grid, 100),
    call('getVilageFcst', vilageFcstBase(now), grid, 1000),
  ])
  if ([ncstRes, ultraRes, vilageRes].every((r) => r.status === 'rejected')) throw ncstRes.reason
  const warnings = [
    ['초단기실황', ncstRes],
    ['초단기예보', ultraRes],
    ['단기예보', vilageRes],
  ]
    .filter(([, r]) => r.status === 'rejected')
    .map(([name, r]) => `${name}: ${r.reason.message}`)

  // 시간별 예보: 단기예보를 바탕으로 가까운 6시간은 초단기예보 값으로 덮어쓴다.
  const byTime = {}
  for (const [key, v] of Object.entries(groupByTime(vilageRes.value ?? []))) {
    byTime[key] = {
      date: v.date,
      time: v.time,
      temperature: num(v.TMP),
      precipitationProbability: num(v.POP),
      pty: num(v.PTY),
      sky: num(v.SKY),
      windSpeed: num(v.WSD),
      humidity: num(v.REH),
    }
  }
  for (const [key, v] of Object.entries(groupByTime(ultraRes.value ?? []))) {
    byTime[key] = {
      ...byTime[key],
      date: v.date,
      time: v.time,
      temperature: num(v.T1H),
      pty: num(v.PTY),
      sky: num(v.SKY),
      windSpeed: num(v.WSD),
      humidity: num(v.REH) ?? byTime[key]?.humidity ?? null,
    }
  }

  const nowKey = `${ncst.base_date}${ncst.base_time}`
  const hourlyForecast = Object.keys(byTime)
    .sort()
    .filter((key) => key > nowKey)
    .slice(0, 24)
    .map((key) => {
      const v = byTime[key]
      return {
        time: toIso(v.date, v.time),
        temperatureC: v.temperature ?? null,
        precipitation: v.pty == null ? null : (PTY[v.pty] ?? String(v.pty)),
        precipitationProbability: v.precipitationProbability ?? null,
        sky: v.sky == null ? null : (SKY[v.sky] ?? String(v.sky)),
        windSpeedMs: v.windSpeed ?? null,
      }
    })

  // 현재 값: 실황이 우선, 하늘 상태는 실황에 없으므로 가장 가까운 예보에서 가져온다.
  const obs = {}
  for (const row of ncstRes.value ?? []) obs[row.category] = row.obsrValue
  const firstForecast = byTime[Object.keys(byTime).sort()[0]]
  const pty = num(obs.PTY) ?? firstForecast?.pty ?? null

  return {
    temperatureC: num(obs.T1H) ?? firstForecast?.temperature ?? null,
    precipitation: {
      raining: pty == null ? null : pty > 0,
      type: pty == null ? null : (PTY[pty] ?? String(pty)),
      amountMm: obs.RN1 === '강수없음' ? 0 : num(obs.RN1),
    },
    sky: firstForecast?.sky == null ? null : (SKY[firstForecast.sky] ?? String(firstForecast.sky)),
    windSpeedMs: num(obs.WSD) ?? firstForecast?.windSpeed ?? null,
    humidityPct: num(obs.REH),
    hourlyForecast,
    meta: {
      grid,
      observedAt: ncstRes.status === 'fulfilled' ? toIso(ncst.base_date, ncst.base_time) : null,
      warnings,
    },
  }
}

// 20~30분 캐시와 REPLAN 판단 규칙은 11단계에서 붙인다.
export function getWeather(params) {
  return runProvider({ live: () => liveWeather(params), mock: async () => buildMockWeather() })
}