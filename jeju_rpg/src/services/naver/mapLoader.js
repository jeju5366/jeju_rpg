import { env } from '../../lib/env.js'

// NAVER Maps Dynamic Map JS SDK 로더. 한 번만 불러오고, 실패해도 앱은 멈추지 않는다. (호출하는 쪽이 fallback UI 를 보여준다)
// 실패 사유: no_key(키 없음) | auth_failed(인증 실패 — NAVER Cloud 콘솔에 Web 서비스 URL 이 등록되지 않음 등) | load_failed(스크립트 로드 실패/시간 초과)
const SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js'
const LOAD_TIMEOUT_MS = 10000

let loading = null

const failure = (code) => Object.assign(new Error(code), { code })

export function loadNaverMaps() {
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps)
  if (!env.naverMapClientId) return Promise.reject(failure('no_key'))
  if (loading) return loading

  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(failure('load_failed')), LOAD_TIMEOUT_MS)
    // NAVER SDK 가 인증에 실패하면 이 전역 함수를 부른다.
    window.navermap_authFailure = () => {
      clearTimeout(timer)
      reject(failure('auth_failed'))
    }
    const script = document.createElement('script')
    script.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(env.naverMapClientId)}`
    script.async = true
    script.onload = () => {
      clearTimeout(timer)
      if (window.naver?.maps?.Map) resolve(window.naver.maps)
      else reject(failure('load_failed'))
    }
    script.onerror = () => {
      clearTimeout(timer)
      reject(failure('load_failed'))
    }
    document.head.appendChild(script)
  }).catch((error) => {
    loading = null // 다음에 다시 시도할 수 있게 한다
    throw error
  })
  return loading
}
