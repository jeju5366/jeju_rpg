// 데모 날씨. 실제 관측/예보값이 아니다. (mock/demo)
// sky: clear | mostly_cloudy | cloudy
// precipitation.type: none | rain | rain_snow | snow | shower | drizzle | drizzle_snow | snow_flurry
export function buildMockWeather(now = new Date()) {
  const hourly = [
    { temperatureC: 21, precipitation: 'none', precipitationProbability: 10, sky: 'mostly_cloudy', windSpeedMs: 3.0 },
    { temperatureC: 21, precipitation: 'none', precipitationProbability: 20, sky: 'cloudy', windSpeedMs: 3.4 },
    { temperatureC: 20, precipitation: 'none', precipitationProbability: 40, sky: 'cloudy', windSpeedMs: 4.1 },
    { temperatureC: 19, precipitation: 'rain', precipitationProbability: 60, sky: 'cloudy', windSpeedMs: 5.0 },
    { temperatureC: 18, precipitation: 'rain', precipitationProbability: 60, sky: 'cloudy', windSpeedMs: 5.5 },
    { temperatureC: 18, precipitation: 'none', precipitationProbability: 30, sky: 'mostly_cloudy', windSpeedMs: 4.2 },
  ]
  return {
    temperatureC: 21.5,
    precipitation: { raining: false, type: 'none', amountMm: 0 },
    sky: 'mostly_cloudy',
    windSpeedMs: 3.2,
    humidityPct: 62,
    hourlyForecast: hourly.map((h, i) => ({
      time: new Date(now.getTime() + (i + 1) * 3600 * 1000).toISOString(),
      ...h,
    })),
    meta: { grid: { nx: 52, ny: 38 }, observedAt: now.toISOString(), warnings: [] },
  }
}