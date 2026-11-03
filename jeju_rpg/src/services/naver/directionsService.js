import { apiGet } from '../api/apiClient.js'

// 자동차 이동시간/거리 (NAVER Directions 5). Secret 은 서버에만 있고 브라우저는 /api/directions 만 호출한다.
// option: trafast | tracomfort | traoptimal(기본) | traavoidtoll | traavoidcaronly
// 지도 표시(Dynamic Map)와 마커는 9단계에서 이 폴더에 추가한다. (api_test/src/components/NaverMap.jsx 참고)
export function fetchDrivingRoute({ start, goal, option }) {
  return apiGet('directions', {
    startLat: start.lat,
    startLng: start.lng,
    goalLat: goal.lat,
    goalLng: goal.lng,
    ...(option ? { option } : {}),
  })
}