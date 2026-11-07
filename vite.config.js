import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// dev-server route for the settings modal: GET /styles.json serves the design
// surface, POST writes it back and reruns the generator, so an edit in the
// app lands on disk and styles.gen.css/js refresh exactly like a file edit
const STYLES_JSON = new URL('styles.json', import.meta.url).pathname
const STYLES_MJS = new URL('scripts/styles.mjs', import.meta.url).pathname

function stylesJSON() {
  return {
    name: 'loopdoc-styles-json',
    configureServer: (server) => {
      server.middlewares.use((req, res, next) => {
          if ((req.url || '').split('?')[0] !== '/styles.json') return next()
          if (req.method === 'GET') {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(readFileSync(STYLES_JSON, 'utf8'))
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('use GET or POST')
            return
          }
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            try {
              JSON.parse(body)
            } catch {
              res.statusCode = 400
              res.end('invalid json — not written')
              return
            }
            writeFileSync(STYLES_JSON, body.endsWith('\n') ? body : body + '\n')
            const regen = spawnSync(process.execPath, [STYLES_MJS, '--gen'])
            if ((regen.exitCode ?? regen.status ?? 0) !== 0) {
              res.statusCode = 500
              res.end('styles.gen regeneration failed')
              return
            }
            res.statusCode = 200
            res.end('ok')
          })
        })
    },
  }
}

export default defineConfig({
  plugins: [react(), stylesJSON()],
})
