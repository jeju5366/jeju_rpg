import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Vercel 처럼 POST JSON body 를 req.body 로 파싱해 준다.
async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

// 로컬 개발에서 /api/*.js(Vercel 서버 함수와 같은 형태)를 vite dev 서버에서 그대로 실행한다.
// → `npm run dev` 한 줄로 화면과 API 가 같이 뜬다. 배포(Vercel)에서는 api/ 폴더가 그대로 서버 함수가 된다.
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

        const url = new URL(req.url, 'http://localhost')
        const name = url.pathname.slice('/api/'.length)
        // 영문/숫자/-만 허용: _lib 같은 내부 폴더와 경로 탈출을 막는다.
        // 그 외 /api/* 는 vite 가 소스 파일을 그대로 내보내거나 SPA 로 빠지지 않도록 404 로 끝낸다.
        const file = path.resolve(server.config.root, 'api', `${name}.js`)
        if (!/^[a-z0-9-]+$/i.test(name) || !fs.existsSync(file)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          return res.end(JSON.stringify({ error: 'not_found' }))
        }

        req.query = Object.fromEntries(url.searchParams)
        res.status = (code) => {
          res.statusCode = code
          return res
        }
        res.json = (body) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }

        try {
          if (req.method === 'POST') req.body = await readJsonBody(req)
          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          await mod.default(req, res)
        } catch (error) {
          server.ssrFixStacktrace?.(error)
          console.error('[dev-api]', error)
          if (!res.headersSent) res.status(500).json({ error: 'internal_error' })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env 의 서버 전용 값(VITE_ 없는 키)을 서버 함수가 process.env 로 읽을 수 있게 한다.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [react(), devApi()],
  }
})