// Demo Mode 전용 메모리 DB. Supabase 클라이언트와 같은 모양의 쿼리 빌더(from/select/eq/...)를 흉내 내서,
// 기존 repo/페이지 코드를 고치지 않고도 Demo 데이터를 읽고 쓸 수 있게 한다. 실제 Supabase 로는 아무것도 나가지 않는다.
//   · 모든 쓰기는 이 메모리 객체에만 반영되고, Demo 종료(또는 시나리오 변경) 때 통째로 버려진다.
//   · 지원: select(embed 일부) / insert / update / upsert / delete / eq neq gt gte lt lte in is not contains / order / limit / single / maybeSingle / count(head)
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `demo-${Math.random().toString(16).slice(2)}-${Date.now()}`)

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

export function createDemoDb(seed = {}, { rpc = {}, now = () => Date.now() } = {}) {
  const tables = new Proxy({ ...clone(seed) }, { get: (target, name) => (name in target ? target[name] : (target[name] = [])) })
  const listeners = new Set()
  const notify = (table, op) => listeners.forEach((fn) => fn(table, op))

  class Query {
    constructor(table) {
      this.table = table
      this.filters = []
      this.orders = []
      this.op = 'select'
      this.limitN = null
      this.options = {}
      this.embeds = []
    }
    select(columns = '*', options = {}) {
      this.options = options
      // 'a:other_table(*)' 형태의 embed 만 지원한다 (여행 + 숙소)
      for (const match of String(columns).matchAll(/(\w+):(\w+)\(\*\)/g)) this.embeds.push({ alias: match[1], table: match[2] })
      return this
    }
    eq(k, v) { return this.where((r) => r[k] === v) }
    neq(k, v) { return this.where((r) => r[k] !== v) }
    gt(k, v) { return this.where((r) => r[k] > v) }
    gte(k, v) { return this.where((r) => r[k] >= v) }
    lt(k, v) { return this.where((r) => r[k] < v) }
    lte(k, v) { return this.where((r) => r[k] <= v) }
    in(k, values) { return this.where((r) => values.includes(r[k])) }
    is(k, v) { return this.where((r) => (r[k] ?? null) === v) }
    not(k, op, v) { return this.where((r) => (op === 'is' ? (r[k] ?? null) !== v : r[k] !== v)) }
    contains(k, obj) { return this.where((r) => Object.entries(obj).every(([key, val]) => r[k]?.[key] === val)) }
    where(fn) {
      this.filters.push(fn)
      return this
    }
    order(column, { ascending = true } = {}) {
      this.orders.push({ column, ascending })
      return this
    }
    limit(n) {
      this.limitN = n
      return this
    }
    insert(rows) {
      this.op = 'insert'
      this.payload = rows
      return this
    }
    upsert(rows, options = {}) {
      this.op = 'upsert'
      this.payload = rows
      this.upsertOptions = options
      return this
    }
    update(values) {
      this.op = 'update'
      this.payload = values
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    matching() {
      return tables[this.table].filter((r) => this.filters.every((f) => f(r)))
    }
    shape(rows) {
      let out = rows
      for (const { column, ascending } of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => (ascending ? 1 : -1) * compare(a[column] ?? '', b[column] ?? ''))
      }
      if (this.limitN != null) out = out.slice(0, this.limitN)
      return out.map((row) => {
        const copy = clone(row)
        for (const { alias, table } of this.embeds) copy[alias] = clone(tables[table].filter((r) => r.trip_id === row.id))
        return copy
      })
    }
    run() {
      const table = this.table
      if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload]
        const out = []
        for (const one of list) {
          const row = { id: uuid(), created_at: new Date(now()).toISOString(), ...clone(one) }
          if (this.op === 'upsert') {
            const keys = String(this.upsertOptions.onConflict ?? 'id').split(',')
            const existing = tables[table].find((r) => keys.every((k) => r[k] === row[k]))
            if (existing) {
              if (!this.upsertOptions.ignoreDuplicates) Object.assign(existing, clone(one))
              out.push(existing)
              continue
            }
          }
          tables[table].push(row)
          out.push(row)
        }
        notify(table, this.op)
        return { data: this.shape(out), error: null }
      }
      if (this.op === 'update') {
        const rows = this.matching()
        rows.forEach((r) => Object.assign(r, clone(this.payload), { updated_at: new Date(now()).toISOString() }))
        notify(table, 'update')
        return { data: this.shape(rows), error: null }
      }
      if (this.op === 'delete') {
        const rows = this.matching()
        tables[table] = tables[table].filter((r) => !rows.includes(r))
        notify(table, 'delete')
        return { data: this.shape(rows), error: null }
      }
      const rows = this.matching()
      if (this.options.head) return { data: null, count: rows.length, error: null }
      return { data: this.shape(rows), count: rows.length, error: null }
    }
    maybeSingle() {
      const { data, error } = this.run()
      return Promise.resolve({ data: data?.[0] ?? null, error })
    }
    single() {
      const { data, error } = this.run()
      return Promise.resolve(data?.[0] ? { data: data[0], error } : { data: null, error: { code: 'PGRST116', message: 'no rows' } })
    }
    then(resolve, reject) {
      return Promise.resolve(this.run()).then(resolve, reject)
    }
  }

  const client = {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      const handler = rpc[name]
      if (!handler) return { data: null, error: { message: `demo: ${name} 은 지원하지 않아` } }
      try {
        return { data: await handler(args, api), error: null }
      } catch (error) {
        return { data: null, error: { message: error.message } }
      }
    },
    // Storage: 실제 업로드 없이 자리표시 이미지(SVG data URI)를 돌려준다
    storage: {
      from: () => ({
        createSignedUrl: async (path) => ({ data: { signedUrl: placeholderImage(path) }, error: null }),
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }
  // 서버 흉내(demoApi)가 쓰는 직접 접근
  const api = {
    tables,
    uuid,
    client,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    find: (table, pred) => tables[table].find(pred) ?? null,
    all: (table, pred = () => true) => tables[table].filter(pred),
    insert: (table, row) => {
      const full = { id: uuid(), created_at: new Date(now()).toISOString(), ...row }
      tables[table].push(full)
      notify(table, 'insert')
      return full
    },
    patch: (table, pred, values) => {
      const rows = tables[table].filter(pred)
      rows.forEach((r) => Object.assign(r, values, { updated_at: new Date(now()).toISOString() }))
      if (rows.length) notify(table, 'update')
      return rows
    },
  }
  return api
}

// Demo 사진 자리표시 (이미지 파일 없이 색 블록 + 이모지)
export function placeholderImage(seed = 'demo') {
  const hue = [...String(seed)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="hsl(${hue},55%,78%)"/><text x="120" y="140" font-size="72" text-anchor="middle">📷</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
