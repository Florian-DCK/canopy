import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const ud = 'C:/Users/fdonc/AppData/Local/Temp/claude/1726f5d14c2ae2e6/7d16de63-7de1-4577-bdf9-782ec70f38d7/scratchpad/cap/userdata'
rmSync(ud, { recursive: true, force: true }); mkdirSync(ud, { recursive: true })
writeFileSync(join(ud, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'demo', path: 'C:/Users/fdonc/Documents/Atelier', color: '#6A9BCC' }]))
const env = { ...process.env, ATELIER_USER_DATA: ud, ATELIER_DAEMON_EPHEMERAL: '1' }; delete env.ANTHROPIC_API_KEY; delete env.ELECTRON_RUN_AS_NODE; delete env.ATELIER_DATA
const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
await page.waitForSelector('text=demo', { timeout: 30000 })
const info = JSON.parse(readFileSync(join(ud, 'daemon.json'), 'utf8'))
const rpc = async (method, ...args) => { const r = await fetch('http://127.0.0.1:' + info.port + '/rpc', { method: 'POST', headers: { 'x-atelier-token': info.token, 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) }); return (await r.json()).result }
for (const [name, p] of [['hidden-cockpit-dark', { mode: 'hidden', view: 'cockpit', theme: 'dark', width: 1100, height: 700 }], ['hidden-cockpit-light-narrow', { mode: 'hidden', view: 'cockpit', theme: 'light', width: 700, height: 600 }], ['current', { mode: 'current', inspect: '.topbar' }]]) {
  const t = Date.now(); const r = await rpc('capture', p)
  console.log(name, r?.ok, Date.now() - t + 'ms', (r?.info || '').slice(0, 300))
  if (r?.image) writeFileSync('C:/Users/fdonc/AppData/Local/Temp/claude/1726f5d14c2ae2e6/7d16de63-7de1-4577-bdf9-782ec70f38d7/scratchpad/cap/' + name + '.jpg', Buffer.from(r.image, 'base64'))
}
await app.close()
