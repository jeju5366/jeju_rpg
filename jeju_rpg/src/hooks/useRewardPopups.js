import { useCallback, useState } from 'react'
import { buildRewardPopup } from '../utils/rewardPopup.js'
import { dismiss, emptyQueue, enqueue } from '../utils/rewardQueue.js'

// 퀘스트 완료 결과 팝업 대기열. 전역 알림 시스템이 아니라 퀘스트 화면 하나가 쓰는 가벼운 local state 다.
// show(quest, completeResponse): 서버가 확정한 완료 결과로 팝업을 넣는다. 새로 지급된 EXP 가 없으면 false 를 돌려준다.
export default function useRewardPopups() {
  const [queue, setQueue] = useState(emptyQueue)
  const show = useCallback((quest, response) => {
    const popup = buildRewardPopup({ quest, rewards: response?.rewards })
    if (!popup) return false
    setQueue((state) => enqueue(state, popup))
    return true
  }, [])
  const close = useCallback((id) => setQueue((state) => dismiss(state, id)), [])
  return { queue: queue.items, show, close }
}
