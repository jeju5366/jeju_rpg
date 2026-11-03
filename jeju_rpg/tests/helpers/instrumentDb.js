// DB 호출을 "왕복(round-trip) 1회"로 세고, 호출마다 지연(latency)을 흉내 내는 계측 래퍼.
// 실제 Supabase 호출 하나 = 네트워크 왕복 한 번이라서, 호출 수와 직렬 단계 수가 완료 API 지연의 대부분을 정한다.
//   instrument(db, { latencyMs }) → { db, calls, summary() }
//   calls: [{ label, start, end }]  (label: "jeju_quests.select" / "rpc:jeju_apply_exp" ...)
//   summary(): { count, elapsedMs, stages, byLabel }   stages ≈ elapsed / latency = 직렬로 기다린 왕복 수(임계 경로 길이)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => performance.now()

export function instrument(db, { latencyMs = 0 } = {}) {
  const calls = []
  const origin = now()

  const record = async (label, run) => {
    const start = now()
    if (latencyMs) await sleep(latencyMs) // 요청이 서버에 닿는 시간
    const result = await run()
    calls.push({ label, start, end: now() })
    return result
  }

  // 쿼리마다 자기 프록시를 가진다 (병렬로 여러 쿼리를 만들어도 서로 섞이지 않는다)
  const wrapQuery = (query) => {
    const proxy = new Proxy(query, {
      get(target, prop) {
        if (prop === 'then') return (resolve, reject) => record(`${target.table}.${target.op}`, () => target.run()).then(resolve, reject)
        if (prop === 'maybeSingle' || prop === 'single') return () => record(`${target.table}.${target.op}`, () => Promise.resolve(target[prop]()))
        const value = target[prop]
        if (typeof value !== 'function') return value
        return (...args) => {
          const out = value.apply(target, args)
          return out === target ? proxy : out // 체이닝을 같은 프록시로 유지
        }
      },
    })
    return proxy
  }

  const wrapped = {
    ...db,
    from: (table) => wrapQuery(db.from(table)),
    rpc: (name, args) => record(`rpc:${name}`, () => db.rpc(name, args)),
  }

  return {
    db: wrapped,
    calls,
    summary() {
      const byLabel = {}
      for (const call of calls) byLabel[call.label] = (byLabel[call.label] ?? 0) + 1
      const end = Math.max(0, ...calls.map((c) => c.end))
      return { count: calls.length, elapsedMs: Math.round(end - origin), stages: latencyMs ? Math.round((end - origin) / latencyMs) : null, byLabel }
    },
  }
}
