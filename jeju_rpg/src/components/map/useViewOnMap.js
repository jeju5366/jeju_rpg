import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMapFocusStore } from '../../store/mapFocusStore.js'

// "지도에서 보기": 포커스 대상을 store 에 한 번 넣고 /map 으로 이동한다. (query/router state 대신 store 를 쓰는 이유: 새로고침/뒤로가기에 남지 않는 일회용 값이고, 좌표를 URL 에 노출하지 않는다)
export default function useViewOnMap() {
  const navigate = useNavigate()
  return useCallback(
    (target) => {
      if (target) useMapFocusStore.getState().setTarget(target)
      navigate('/map')
    },
    [navigate],
  )
}
