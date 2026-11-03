// 결과 팝업 대기열 (순수 함수). 연속으로 완료해도 결과가 유실되지 않게 순서대로 하나씩 보여주고, 같은 완료 결과(id)는 한 번만 넣는다.
//   items: 보여줄 팝업 (앞에서부터)   seen: 이미 넣었던 id (최근 것만 보관)
const SEEN_LIMIT = 100

export const emptyQueue = () => ({ items: [], seen: [] })

export function enqueue(state, popup) {
  if (!popup || state.seen.includes(popup.id)) return state // 같은 완료 결과는 다시 넣지 않는다 (rerender/재전송 방어)
  return { items: [...state.items, popup], seen: [...state.seen, popup.id].slice(-SEEN_LIMIT) }
}

// 현재(맨 앞) 팝업을 닫는다. id 가 맞지 않으면(이미 닫힌 팝업의 타이머 등) 무시한다.
export function dismiss(state, id) {
  if (state.items[0]?.id !== id) return state
  return { ...state, items: state.items.slice(1) }
}
