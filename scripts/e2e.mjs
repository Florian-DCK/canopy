// E2E : lance l'app buildée, ouvre une session sur un projet de test,
// déclenche une autorisation Write, l'accepte, attend la fin, fait des captures.
// Usage : node scripts/e2e.mjs <dossier-projet-test> <dossier-sortie>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [projDir, outDir] = process.argv.slice(2).map((p) => resolve(p))
const userData = join(outDir, 'userdata')
rmSync(userData, { recursive: true, force: true }) // dossier vierge à chaque test
mkdirSync(userData, { recursive: true })
writeFileSync(
  join(userData, 'projects.json'),
  JSON.stringify([{ id: 'p1', name: 'e2e-proj', path: projDir, color: '#6A9BCC' }])
)

const env = { ...process.env, ATELIER_USER_DATA: userData, ATELIER_DAEMON_EPHEMERAL: '1' }
delete env.ANTHROPIC_API_KEY
const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
app.process().stdout?.on('data', (d) => process.stdout.write('MAIN ' + d))
app.process().stderr?.on('data', (d) => process.stdout.write('MAIN! ' + d))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.waitForSelector('text=e2e-proj')
await page.screenshot({ path: join(outDir, '1-cockpit-vide.png') })

await page.getByTitle('Nouvelle session').first().click()
await page.waitForSelector('#composer')
await page.fill('#composer', "Utilise l'outil Write pour créer hello.txt contenant exactement « bonjour atelier », puis réponds juste OK.")
await page.keyboard.press('Enter')

let sawPerm = false
try {
  await page.waitForSelector('text=Autoriser une fois', { timeout: 60000 })
  sawPerm = true
  await page.screenshot({ path: join(outDir, '2-autorisation.png') })
  // Le cockpit doit montrer la session en attente.
  await page.getByLabel('Cockpit').click()
  await page.waitForSelector('text=Répondre')
  await page.screenshot({ path: join(outDir, '3-cockpit-attente.png') })
  await page.getByText('Répondre').click()
  await page.getByText('Autoriser une fois').click()
} catch (e) {
  console.log('PAS DE CARTE D’AUTORISATION', String(e).slice(0, 200))
  await page.screenshot({ path: join(outDir, '2b-sans-autorisation.png') })
}

await page.waitForSelector('.result', { timeout: 120000 })
await page.waitForTimeout(500)
await page.screenshot({ path: join(outDir, '4-session-finie.png') })
const file = join(projDir, 'hello.txt')
console.log(JSON.stringify({ sawPerm, fileExists: existsSync(file), content: existsSync(file) ? readFileSync(file, 'utf8') : null, result: await page.textContent('.result') }))
await app.close()
