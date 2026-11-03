import { GPS_SAMPLE } from '../../constants/locationRules.js'
import { useDemoStore } from '../../store/demoStore.js'

// 브라우저 Geolocation 을 감싼 유일한 곳. 페이지/컴포넌트는 navigator.geolocation 을 직접 부르지 않고
// 이 서비스(또는 hooks/useGeolocation)만 쓴다. 권한 요청은 "위치가 실제로 필요한 순간"에 이 함수들이 호출될 때 처음 일어난다.
//
// 위치 표준: { lat, lng, accuracy(미터), timestamp(ms) }
// 오류 코드: unsupported | permission_denied | position_unavailable | timeout

export const GEO_ERRORS = ['unsupported', 'permission_denied', 'position_unavailable', 'timeout']

// Demo Mode: 시뮬레이션 위치가 있으면 실제 GPS 대신 그 값을 쓴다. (권한 창/실제 위치 요청 없음)
const demoPosition = () => {
  const demo = useDemoStore.getState()
  return demo.active && demo.position ? { ...demo.position, timestamp: Date.now() } : null
}

export const isGeolocationSupported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator

export function toPosition(raw) {
  return { lat: raw.coords.latitude, lng: raw.coords.longitude, accuracy: raw.coords.accuracy, timestamp: raw.timestamp }
}

export function toGeoError(error) {
  // GeolocationPositionError: 1 PERMISSION_DENIED / 2 POSITION_UNAVAILABLE / 3 TIMEOUT
  const code = error?.code === 1 ? 'permission_denied' : error?.code === 3 ? 'timeout' : 'position_unavailable'
  const wrapped = new Error(code)
  wrapped.code = code
  return wrapped
}

const unsupportedError = () => Object.assign(new Error('unsupported'), { code: 'unsupported' })

// 권한 상태를 "묻지 않고" 확인한다. (granted | denied | prompt | unknown) — 확인만 할 뿐 권한 창을 띄우지 않는다.
export async function queryPermission() {
  if (demoPosition()) return 'granted'
  try {
    if (!navigator.permissions?.query) return 'unknown'
    return (await navigator.permissions.query({ name: 'geolocation' })).state
  } catch {
    return 'unknown'
  }
}

// 위치 한 번. (지도의 "현재 위치"처럼 가볍게 쓸 때)
export function getCurrentPosition({ timeoutMs = 10000, maxAgeMs = 30000, highAccuracy = true } = {}) {
  if (demoPosition()) return Promise.resolve(demoPosition())
  if (!isGeolocationSupported()) return Promise.reject(unsupportedError())
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((raw) => resolve(toPosition(raw)), (error) => reject(toGeoError(error)), {
      enableHighAccuracy: highAccuracy,
      timeout: timeoutMs,
      maximumAge: maxAgeMs,
    })
  })
}

// GPS 인증용: 정확도가 충분해질 때까지(또는 시간 제한까지) 기다렸다가 "가장 정확했던 위치"를 돌려준다.
// 처음 나온 값은 정확도가 나쁜 경우가 많아서, 바로 실패시키지 않고 잠깐 더 다듬는다.
// 위치를 한 번도 못 받으면 오류(권한 거부 등)로 reject 한다. 정확도가 낮아도 값이 있으면 resolve 하고 판단은 호출하는 쪽(서버)이 한다.
export function getBestPosition({ goodAccuracyMeters = GPS_SAMPLE.goodAccuracyMeters, timeoutMs = GPS_SAMPLE.timeoutMs } = {}) {
  if (demoPosition()) return Promise.resolve(demoPosition())
  if (!isGeolocationSupported()) return Promise.reject(unsupportedError())
  return new Promise((resolve, reject) => {
    let best = null
    let lastError = null
    let done = false
    let watchId = null
    let timer = null

    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (best) resolve(best)
      else reject(lastError ?? toGeoError({ code: 3 }))
    }

    watchId = navigator.geolocation.watchPosition(
      (raw) => {
        const position = toPosition(raw)
        if (!best || position.accuracy < best.accuracy) best = position
        if (best.accuracy <= goodAccuracyMeters) finish()
      },
      (error) => {
        lastError = toGeoError(error)
        if (lastError.code === 'permission_denied') finish() // 기다려도 소용없다
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: GPS_SAMPLE.maxAgeMs },
    )
    timer = setTimeout(finish, timeoutMs)
  })
}

// 위치 변화를 계속 받는다. (자유여행 중에만 쓴다) 반환: 중지 함수
export function watchPosition({ onPosition, onError, maximumAgeMs = 5000 }) {
  if (demoPosition()) {
    const timer = setInterval(() => demoPosition() && onPosition(demoPosition()), 15000) // 시뮬레이션 위치를 가끔 한 번씩만 전달한다
    onPosition(demoPosition())
    return () => clearInterval(timer)
  }
  if (!isGeolocationSupported()) {
    onError?.(unsupportedError())
    return () => {}
  }
  const id = navigator.geolocation.watchPosition((raw) => onPosition(toPosition(raw)), (error) => onError?.(toGeoError(error)), {
    enableHighAccuracy: true,
    maximumAge: maximumAgeMs,
    timeout: 30000,
  })
  return () => navigator.geolocation.clearWatch(id)
}
