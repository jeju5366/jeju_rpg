// 데모 대중교통(TAGO) 데이터. 실제 정류장/도착/노선 정보가 아니다. (mock/demo)
export const MOCK_STOPS = [
  { stationId: 'DEMO-NODE-1', stationName: '데모 정류장 A', stationNo: '00001', cityCode: '0', lat: 33.5, lng: 126.531 },
  { stationId: 'DEMO-NODE-2', stationName: '데모 정류장 B', stationNo: '00002', cityCode: '0', lat: 33.503, lng: 126.535 },
]

export const MOCK_ARRIVALS = {
  'DEMO-NODE-1': [
    { routeId: 'DEMO-ROUTE-101', routeNo: '101', routeType: '간선', vehicleType: '일반', arrivalSec: 240, arrivalMin: 4, remainingStops: 2 },
    { routeId: 'DEMO-ROUTE-201', routeNo: '201', routeType: '간선', vehicleType: '일반', arrivalSec: 660, arrivalMin: 11, remainingStops: 6 },
  ],
  'DEMO-NODE-2': [
    { routeId: 'DEMO-ROUTE-702', routeNo: '702', routeType: '급행', vehicleType: '일반', arrivalSec: 900, arrivalMin: 15, remainingStops: 8 },
  ],
}

export const MOCK_ROUTES = {
  'DEMO-ROUTE-101': { routeId: 'DEMO-ROUTE-101', routeNo: '101', routeType: '간선', startStop: '데모 기점', endStop: '제주시청' },
  'DEMO-ROUTE-201': { routeId: 'DEMO-ROUTE-201', routeNo: '201', routeType: '간선', startStop: '데모 기점', endStop: '서귀포' },
  'DEMO-ROUTE-702': { routeId: 'DEMO-ROUTE-702', routeNo: '702', routeType: '급행', startStop: '데모 기점', endStop: '성산' },
}