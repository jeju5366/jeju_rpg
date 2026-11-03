// 퀘스트 완료 직후의 "체감 반응속도" 흐름 (UI 쪽 순서만 정한다. 서버의 EXP/discovery/idempotency 로직은 건드리지 않는다)
//
//   완료 클릭 → (버튼 loading) → 완료 API 성공 → 결과를 화면 캐시에 즉시 반영 → 보상 팝업 즉시 → 호출한 쪽은 바로 풀려난다(busy 해제)
//                                                              └→ 전체 board reload 는 background 에서 따로 진행
//   · 완료 API 가 성공하기 전에는 성공 UI(로컬 완료 상태/팝업)를 절대 보여주지 않는다. call 이 throw 하면 apply/announce/refresh 는 실행되지 않는다.
//   · background refresh 가 실패해도 이미 반영한 완료 상태를 되돌리지 않는다. 대신 onRefreshError 로 "오래된 캐시"로 표시해 다음 갱신 때 다시 맞춘다.
export async function completeAndApply({ call, apply, announce, refresh, onRefreshError }) {
  const result = await call() // 인증/API/DB/EXP 실패 → 여기서 throw (아래는 실행되지 않는다)
  apply?.(result) // 로컬 완료 상태 반영
  announce?.(result) // 보상 팝업
  // await 하지 않는다: 사용자가 reload 를 기다리지 않게 한다.
  Promise.resolve()
    .then(() => refresh?.())
    .catch((error) => onRefreshError?.(error))
  return result
}

// 같은 동작이 진행 중이면 두 번째 호출을 무시한다. (state 는 다음 렌더에야 바뀌어서, 같은 틱의 연타를 막으려면 ref 성격의 잠금이 필요하다)
// → run(fn): 실행했으면 { ran: true, value }, 이미 진행 중이라 건너뛰었으면 { ran: false }
export function createSingleFlight() {
  let running = false
  return async function run(fn) {
    if (running) return { ran: false }
    running = true
    try {
      return { ran: true, value: await fn() }
    } finally {
      running = false
    }
  }
}

// 돌발 퀘스트 오버레이를 지금 보여도 되는지. 한 번에 하나의 이벤트 오버레이만 보인다.
//   우선순위: QUEST COMPLETE 보상 팝업 → (닫힌 뒤) 돌발 퀘스트.  REPLAN 제안이 있으면 REPLAN 이 먼저다.
//   제안(offered) 상태는 서버에 남아 있으므로, 지금 못 보여줘도 사라지지 않고 조건이 풀리면 나타난다.
export function shouldShowSurpriseOverlay({ offered, rewardQueueLength = 0, replanNeeded = false, verificationOpen = false, freeActive = false }) {
  return Boolean(offered) && !freeActive && rewardQueueLength === 0 && !replanNeeded && !verificationOpen
}
