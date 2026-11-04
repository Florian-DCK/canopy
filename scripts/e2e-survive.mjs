// E2E démon : une session tourne, on ferme Electron en pleine réponse, on le relance ;
// la session doit avoir continué dans le démon et se terminer normalement.
// Usage : node scripts/e2e-survive.mjs <dossier-projet-test> <dossier-sortie>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [projDir, outDir] = process.argv.slice(2).map((p) => resolve(p))
const userData = join(outDir, 'userdata-survive')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'survie', path: projDir, color: '#E3DACC' }]))

const base = { ...process.env, ATELIER_USER_DATA: userData }
delete base.ANTHROPIC_API_KEY

// 1) Lancement normal (le démon survivra à la fermeture).
let app = await electron.launch({ args: ['.'], env: base })
let page = await app.firstWindow()
await page.waitForSelector('text=survie')
await page.getByTitle('Nouvelle session').first().click()
await page.fill('#composer', 'Sans utiliser aucun outil, écris un texte de 350 mots sur l’histoire des montgolfières, puis termine par le mot FIN.')
await page.keyboard.press('Enter')
await page.waitForSelector('text=Claude travaille', { timeout: 60000 })
await page.waitForTimeout(3000)
console.log('étape 1 : réponse en cours, fermeture d’Electron')
await app.close() // ← Electron coupé en pleine réponse
const closedAt = Date.now()

// 2) Relance : on doit retrouver la session, toujours en cours ou déjà terminée.
app = await electron.launch({ args: ['.'], env: { ...base, ATELIER_DAEMON_EPHEMERAL: '1' } })
page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.waitForSelector('text=survie')
console.log('étape 2 : relancé, session visible')
await page.screenshot({ path: join(outDir, '29-relance.png') })
await page.locator('.root').first().click()
await page.waitForSelector('.result, .perm', { timeout: 120000 })
const text = (await page.locator('.msg-ai').allTextContents()).join(' ')
await page.screenshot({ path: join(outDir, '30-survie.png') })
console.log(JSON.stringify({ relaunchMs: Date.now() - closedAt, endsWithFin: /FIN\W*$/.test(text.trim()), words: text.split(/\s+/).length }))
await app.close() // éphémère : arrête aussi le démon
