// E2E sous-agents : une session délègue à Explore ; capture le cockpit pendant et après.
// Usage : node scripts/e2e-subagent.mjs <dossier-projet-test> <dossier-sortie>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [projDir, outDir] = process.argv.slice(2).map((p) => resolve(p))
const userData = join(outDir, 'userdata-sub')
rmSync(userData, { recursive: true, force: true }) // dossier vierge à chaque test
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'e2e-proj', path: projDir, color: '#BCD1CA' }]))

const env = { ...process.env, ATELIER_USER_DATA: userData, ATELIER_DAEMON_EPHEMERAL: '1' }
delete env.ANTHROPIC_API_KEY
const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.waitForSelector('text=e2e-proj')
await page.getByTitle('Nouvelle session').first().click()
await page.fill('#composer', "Lance un sous-agent Explore (outil Agent/Task) pour lister les fichiers de ce dossier, puis résume en une phrase. N'utilise aucun autre outil toi-même.")
await page.keyboard.press('Enter')
await page.getByLabel('Cockpit').click()
await page.waitForSelector('.pill', { timeout: 120000 })
await page.screenshot({ path: join(outDir, '5-cockpit-sous-agent.png') })
await page.locator('.root').first().click()
await page.waitForSelector('.result', { timeout: 180000 })
await page.getByLabel('Cockpit').click()
await page.waitForTimeout(300)
await page.screenshot({ path: join(outDir, '6-cockpit-fini.png') })
console.log(JSON.stringify({ pills: await page.locator('.pill').allTextContents() }))
await app.close()
