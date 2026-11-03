import { useCallback, useEffect } from 'react'
import { getBestPosition, getCurrentPosition, queryPermission } from '../services/location/geolocation.js'
import { useLocationStore } from '../store/locationStore.js'

// 위치 사용의 단일 진입점. 이 훅이 없으면 어떤 화면도 위치 권한을 요청하지 않는다.
//  - locate()      : 지도에서 "내 위치" 확인. 가볍게 한 번. 처음 호출될 때 브라우저가 권한을 묻는다.
//  - locateAccurate(): GPS 인증용. 정확도가 나아질 때까지 잠깐 기다렸다가 가장 좋은 값을 돌려준다.
// 둘 다 실패하면 throw 하지 않고 { ok:false, error } 를 돌려준다. (화면이 안내 문구만 고르면 되도록)
// 마운트 시에는 권한 "상태"만 조용히 확인한다. (권한 창을 띄우지 않는다)
export default function useGeolocation({ checkPermission = false } = {}) {
  const { position, status, error, permission, setLoading, setPosition, setError, setPermission } = useLocationStore()

  useEffect(() => {
    if (!checkPermission) return
    let active = true
    queryPermission().then((state) => active && setPermission(state))
    return () => {
      active = false
    }
  }, [checkPermission, setPermission])

  const run = useCallback(
    async (getter) => {
      setLoading()
      try {
        const next = await getter()
        setPosition(next)
        return { ok: true, position: next }
      } catch (err) {
        const code = err?.code ?? 'position_unavailable'
        setError(code)
        return { ok: false, error: code }
      }
    },
    [setLoading, setPosition, setError],
  )

  const locate = useCallback(() => run(() => getCurrentPosition()), [run])
  const locateAccurate = useCallback(() => run(() => getBestPosition()), [run])

  return { position, status, error, permission, loading: status === 'loading', locate, locateAccurate }
}
