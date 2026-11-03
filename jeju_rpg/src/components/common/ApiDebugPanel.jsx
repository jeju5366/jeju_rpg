import { useState } from 'react'
import { Alert, Badge, Button, Card, Form } from 'react-bootstrap'
import { JEJU_AIRPORT, JEJU_CITY } from '../../constants/jeju.js'
import { fetchAirportCongestion, fetchFlightStatus } from '../../services/airport/airportService.js'
import { fetchDrivingRoute } from '../../services/naver/directionsService.js'
import { fetchNearbyPlaces } from '../../services/tour/tourService.js'
import { fetchNearbyStops, fetchRouteInfo, fetchStopArrivals } from '../../services/transit/transitService.js'
import { fetchWeather } from '../../services/weather/weatherService.js'

// 개발 확인용(DEV 에서만 홈에 표시). 서버 함수 연결 상태를 눈으로 확인하고, 필요 없어지면 지운다.
export default function ApiDebugPanel() {
  const [flightNo, setFlightNo] = useState('KE1406')
  const [loading, setLoading] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const checks = [
    { label: '장소', run: () => fetchNearbyPlaces({ ...JEJU_CITY, radius: 20000 }) },
    { label: '음식점', run: () => fetchNearbyPlaces({ ...JEJU_CITY, radius: 20000, contentTypeId: 39 }) },
    { label: '날씨', run: () => fetchWeather(JEJU_CITY) },
    { label: '정류장', run: () => fetchNearbyStops(JEJU_CITY) },
    {
      // 정류장 → 첫 정류장의 도착정보
      label: '버스도착',
      run: async () => {
        const stops = await fetchNearbyStops(JEJU_CITY)
        const stop = stops.data[0]
        if (!stop) throw new Error('주변 정류장이 없어요')
        return fetchStopArrivals({ cityCode: stop.cityCode, nodeId: stop.stationId })
      },
    },
    {
      // 정류장 → 첫 정류장의 도착정보 → 첫 노선의 정보
      label: '노선',
      run: async () => {
        const stop = (await fetchNearbyStops(JEJU_CITY)).data[0]
        if (!stop) throw new Error('주변 정류장이 없어요')
        const arrival = (await fetchStopArrivals({ cityCode: stop.cityCode, nodeId: stop.stationId })).data[0]
        if (!arrival) throw new Error('도착 예정 버스가 없어요')
        return fetchRouteInfo({ cityCode: stop.cityCode, routeId: arrival.routeId })
      },
    },
    { label: '항공편', run: () => fetchFlightStatus({ flightNo }) },
    { label: '공항혼잡', run: () => fetchAirportCongestion() },
    { label: '길찾기', run: () => fetchDrivingRoute({ start: JEJU_CITY, goal: JEJU_AIRPORT }) },
  ]

  const run = async (check) => {
    setLoading(check.label)
    setError(null)
    try {
      setResult({ label: check.label, body: await check.run() })
    } catch (err) {
      setResult(null)
      setError(`${check.label}: ${err.message}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <Card className="mt-3">
      <Card.Body>
        <Card.Title as="h2" className="h6">
          API 연결 확인 (개발용)
        </Card.Title>
        <div className="d-flex flex-wrap gap-2 mb-2">
          {checks.map((check) => (
            <Button key={check.label} size="sm" variant="outline-primary" disabled={loading !== null} onClick={() => run(check)}>
              {loading === check.label ? '...' : check.label}
            </Button>
          ))}
        </div>
        <Form.Control
          size="sm"
          className="mb-2"
          style={{ maxWidth: 200 }}
          aria-label="항공편명"
          placeholder="항공편명 (예: KE1406)"
          value={flightNo}
          onChange={(e) => setFlightNo(e.target.value)}
        />
        {error && <Alert variant="danger">{error}</Alert>}
        {result && (
          <>
            <Badge bg={result.body.source === 'live' ? 'success' : 'secondary'} className="mb-2">
              {result.label} · {result.body.source === 'live' ? 'LIVE' : 'MOCK(데모)'}
              {result.body.fallback ? ' · fallback' : ''}
            </Badge>
            {result.body.fallback && <div className="small text-danger mb-1">live 실패 사유: {result.body.error}</div>}
            <pre className="small mb-0" style={{ maxHeight: 280, overflow: 'auto' }}>
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </>
        )}
      </Card.Body>
    </Card>
  )
}