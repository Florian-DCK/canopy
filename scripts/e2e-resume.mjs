// E2E historique : liste les sessions passées du projet de test, en reprend une avec Sonnet,
// et vérifie que Claude se souvient de la conversation.
// Usage : node scripts/e2e-resume.mjs <dossier-projet-test> <dossier-sortie>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [projDir, outDir] = process.argv.slice(2).map((p) => resolve(p))
const userData = join(outDir, 'userdata-resume')
rmSync(userData, { recursive: true, force: true }) // dossier vierge à chaque test
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'e2e-proj', path: projDir, color: '#EBCECE' }]))

const env = { ...process.env, ATELIER_USER_DATA: userData, ATELIER_DAEMON_EPHEMERAL: '1' }
delete env.ANTHROPIC_API_KEY
const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.waitForSelector('text=e2e-proj')
await page.getByLabel('Historique').click()
await page.waitForSelector('text=Reprendre', { timeout: 30000 })
await page.screenshot({ path: join(outDir, '7-historique.png') })
const titles = await page.locator('.band span[style*="nowrap"]').allTextContents()

// Reprend la session « hello.txt » (la plus ancienne contenant Write).
const row = page.locator('.band > div', { hasText: 'hello.txt' }).last()
await row.getByText('Reprendre').click()
await page.waitForSelector('#composer')
const replayedUser = await page.locator('.msg-user').count()
await page.selectOption('#model', 'sonnet')
await page.fill('#composer', 'Quel contenu exact as-tu écrit dans hello.txt ? Réponds uniquement par ce contenu, sans outil.')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelectorAll('.result').length >= 2, null, { timeout: 180000 })
await page.waitForTimeout(300)
await page.screenshot({ path: join(outDir, '8-reprise.png') })
const answers = await page.locator('.msg-ai').allTextContents()
console.log(JSON.stringify({ historyRows: titles.length, replayedUser, lastAnswer: answers.at(-1), model: await page.getAttribute('#model', 'title') }))
await app.close()
