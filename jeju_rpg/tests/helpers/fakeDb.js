// DB/Storage 없이 서버 로직을 확인하기 위한 작은 in-memory Supabase 흉내. (이 테스트들에 필요한 호출만 지원)
// unique: { 테이블: (기존행, 새행) => 중복이면 true } — 23505(unique violation)를 흉내 낸다. defaults: { 테이블: 기본값 } — 컬럼 default 흉내.
// failUpdate: [(table, values) => boolean] — 조건에 맞는 update 를 실패시킨다 (저장 중 오류 흉내)
export function fakeDb(seed = {}, { unique = {}, defaults = {}, failInsert = [], failUpdate = [], failRpc = [] } = {}) {
  const tables = new Proxy(
    {
      jeju_profiles: [{ id: 'u1', exp_explore: 0, exp_culture: 0, exp_food: 0, exp_relax: 0, exp_social: 0, exp_discovery: 0, unspent_exp: 0 }],
      jeju_landmarks: [],
      jeju_place_discoveries: [],
      jeju_place_visits: [],
      jeju_exp_logs: [],
      jeju_api_usage_logs: [],
      jeju_travel_photos: [],
      ...seed,
    },
    { get: (target, name) => (name in target ? target[name] : (target[name] = [])) },
  )
  const log = []
  let counter = 0

  class Query {
    constructor(table) {
      this.table = table
      this.filters = []
      this.preds = []
      this.op = 'select'
    }
    select() {
      return this
    }
    eq(key, value) {
      this.filters.push([key, value])
      return this
    }
    neq(key, value) {
      this.preds.push((r) => r[key] !== value)
      return this
    }
    gte(key, value) {
      this.preds.push((r) => r[key] >= value)
      return this
    }
    lt(key, value) {
      this.preds.push((r) => r[key] < value)
      return this
    }
    is(key, value) {
      this.preds.push((r) => (r[key] ?? null) === value)
      return this
    }
    in(key, values) {
      this.preds.push((r) => values.includes(r[key]))
      return this
    }
    not(key, op, value) {
      this.preds.push((r) => (op === 'is' ? (r[key] ?? null) !== value : r[key] !== value))
      return this
    }
    contains(key, obj) {
      this.preds.push((r) => Object.entries(obj).every(([k, v]) => r[key]?.[k] === v))
      return this
    }
    order() {
      return this
    }
    or() {
      this.preds.push((r) => r.status === 'failed') // claimAgentRequest 의 재시도 조건(실패한 요청만 다시 잡는다)을 단순화
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    limit() {
      return this
    }
    insert(row) {
      this.op = 'insert'
      this.row = row
      return this
    }
    // upsert(rows, { ignoreDuplicates }) : 충돌(unique)하는 행은 건드리지 않고 건너뛴다 (ON CONFLICT DO NOTHING). ignoreDuplicates 가 아니면 덮어쓴다.
    upsert(rows, options = {}) {
      this.op = 'upsert'
      this.row = Array.isArray(rows) ? rows : [rows]
      this.options = options
      return this
    }
    update(values) {
      this.op = 'update'
      this.values = values
      return this
    }
    rows() {
      return tables[this.table].filter((r) => this.filters.every(([k, v]) => r[k] === v) && this.preds.every((p) => p(r)))
    }
    run() {
      if (this.op === 'insert' && failInsert.includes(this.table)) return { data: null, error: { code: 'XX000', message: 'forced insert failure' } }
      if (this.op === 'upsert') {
        const isDup = unique[this.table]
        const out = []
        for (const one of this.row) {
          const clash = isDup ? tables[this.table].find((existing) => isDup(existing, one)) : null
          if (clash) {
            if (!this.options.ignoreDuplicates) Object.assign(clash, one)
            continue
          }
          const row = { id: `${this.table}-${++counter}`, ...defaults[this.table], ...one }
          tables[this.table].push(row)
          out.push(row)
        }
        log.push(['upsert', this.table, out.length])
        return { data: out, error: null }
      }
      if (this.op === 'insert' && Array.isArray(this.row)) {
        const out = this.row.map((one) => {
          const row = { id: `${this.table}-${++counter}`, ...defaults[this.table], ...one }
          tables[this.table].push(row)
          return row
        })
        log.push(['insert', this.table, out.length])
        return { data: out, error: null }
      }
      if (this.op === 'insert') {
        const isDup = unique[this.table]
        if (isDup && tables[this.table].some((existing) => isDup(existing, this.row))) return { data: null, error: { code: '23505', message: 'duplicate' } }
        const row = { id: `${this.table}-${++counter}`, ...defaults[this.table], ...this.row } // defaults: DB 컬럼 기본값 흉내
        tables[this.table].push(row)
        log.push(['insert', this.table, row])
        return { data: row, error: null }
      }
      if (this.op === 'delete') {
        const rows = this.rows()
        tables[this.table] = tables[this.table].filter((r) => !rows.includes(r))
        return { data: rows, error: null }
      }
      if (this.op === 'update' && failUpdate.some((fails) => fails(this.table, this.values))) return { data: null, error: { code: 'XX000', message: 'forced update failure' } }
      if (this.op === 'update') {
        const rows = this.rows()
        // update 로 바뀌는 값이 unique 를 깨면 23505 (예: 챕터 seq 충돌)
        const isDup = unique[this.table]
        if (isDup) {
          for (const r of rows) {
            const next = { ...r, ...this.values }
            if (tables[this.table].some((other) => other !== r && isDup(other, next))) return { data: null, error: { code: '23505', message: 'duplicate on update' } }
          }
        }
        rows.forEach((r) => Object.assign(r, this.values))
        log.push(['update', this.table, this.values])
        return { data: rows, error: null }
      }
      return { data: this.rows(), error: null }
    }
    maybeSingle() {
      const { data, error } = this.run()
      return Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error })
    }
    single() {
      const { data, error } = this.run()
      return Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error })
    }
    then(resolve, reject) {
      return Promise.resolve(this.run()).then(resolve, reject)
    }
  }

  // Storage: bucket 별 객체 목록
  const storage = {
    objects: new Map(),
    failUpload: false,
    from(bucket) {
      return {
        upload: async (path, buffer, options) => {
          if (storage.failUpload) return { error: new Error('storage down') }
          if (storage.objects.has(`${bucket}/${path}`)) return { error: new Error('exists') }
          storage.objects.set(`${bucket}/${path}`, { size: buffer.length, contentType: options.contentType })
          return { error: null }
        },
        remove: async (paths) => {
          paths.forEach((p) => storage.objects.delete(`${bucket}/${p}`))
          return { error: null }
        },
      }
    },
  }

  return {
    tables,
    log,
    storage,
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      if (failRpc.includes(name)) return { data: null, error: { message: 'forced rpc failure' } } // failRpc: 이름이 맞는 RPC 를 실패시킨다(배열을 나중에 비우면 복구)
      // 실제 DB 함수(007)와 같은 모양: { awarded, before: 지급 전 EXP, added: 이번에 더한 EXP }
      const KEYS = ['explore', 'culture', 'food', 'relax', 'social', 'discovery']
      const snapshot = (profile) => ({ ...Object.fromEntries(KEYS.map((k) => [k, profile[`exp_${k}`]])), unspent: profile.unspent_exp })
      if (name === 'jeju_apply_exp') {
        const profile = tables.jeju_profiles.find((p) => p.id === args.p_user)
        const before = snapshot(profile)
        const added = { explore: 0, culture: 0, food: 0, relax: 0, social: 0, discovery: 0, unspent: 0 }
        if (tables.jeju_exp_logs.some((l) => l.user_id === args.p_user && l.source_key === args.p_source_key)) return { data: { awarded: false, before, added }, error: null }
        for (const part of args.p_parts) {
          tables.jeju_exp_logs.push({ user_id: args.p_user, source_key: args.p_source_key, category: part.category, amount: part.amount })
          const key = part.category ?? 'unspent'
          profile[part.category ? `exp_${part.category}` : 'unspent_exp'] += part.amount
          added[key] += part.amount
        }
        return { data: { awarded: true, before, added }, error: null }
      }
      if (name === 'jeju_record_discovery') {
        if (tables.jeju_place_discoveries.some((d) => d.user_id === args.p_user && d.place_id === args.p_place_id)) return { data: { discovered: false }, error: null }
        tables.jeju_place_discoveries.push({ user_id: args.p_user, place_id: args.p_place_id, discovery_type: args.p_type })
        const profile = tables.jeju_profiles.find((p) => p.id === args.p_user)
        const before = snapshot(profile)
        profile.exp_discovery += args.p_amount
        return { data: { discovered: true, awarded: true, before, added: { explore: 0, culture: 0, food: 0, relax: 0, social: 0, discovery: args.p_amount, unspent: 0 } }, error: null }
      }
      throw new Error(`unsupported rpc ${name}`)
    },
  }
}
