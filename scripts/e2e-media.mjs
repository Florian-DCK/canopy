// E2E médias : l'agent lit 3 images (série check) et cite une vidéo ; on vérifie vignettes,
// série, visionneuse (comparer côte à côte / curseur), vidéo, et pièce jointe renvoyée à Claude.
// Usage : node scripts/e2e-media.mjs <dossier-projet-avec-check-1..3.png+preview.mp4> <dossier-sortie>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [projDir, outDir] = process.argv.slice(2).map((p) => resolve(p))
const userData = join(outDir, 'userdata-media')
rmSync(userData, { recursive: true, force: true }) // dossier vierge à chaque test
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'media-proj', path: projDir, color: '#6A9BCC' }]))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'dark' }))

const env = { ...process.env, ATELIER_USER_DATA: userData, ATELIER_DAEMON_EPHEMERAL: '1' }
delete env.ANTHROPIC_API_KEY
const app = await electron.launch({ args: ['.'], env, colorScheme: null })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const shot = (n) => page.screenshot({ path: join(outDir, n) })

await page.waitForSelector('text=media-proj')
await page.getByTitle('Nouvelle session').first().click()
await page.fill('#composer', "Avec l'outil Read, lis check-1.png puis check-2.png puis check-3.png, un appel par image, et après chaque lecture décris la couleur du rond en une phrase. N'utilise aucun autre outil. Termine en citant le fichier preview.mp4.")
await page.keyboard.press('Enter')
await page.waitForSelector('.result', { timeout: 240000 })
await page.waitForTimeout(800)
await shot('20-fil-medias.png')
const thumbs = await page.locator('.thumb').count()
const seriesBtn = await page.getByText(/Série check · \d+ vues/).count()

// Visionneuse : comparer avec la vue précédente (côte à côte), puis curseur.
await page.getByText('Comparer avec la vue précédente').click()
await page.waitForSelector('.v-side img')
await page.waitForTimeout(500)
await shot('21-comparer.png')
await page.getByRole('button', { name: 'Curseur' }).click()
await page.locator('#cmp').fill('30')
await page.waitForTimeout(300)
await shot('22-curseur.png')
await page.keyboard.press('Escape')

// Vidéo citée.
const vid = page.locator('.thumb', { has: page.locator('video') }).first()
const hasVideo = await vid.count()
if (hasVideo) {
  await vid.click()
  await page.waitForSelector('.viewer video')
  await page.waitForTimeout(1200)
  await shot('23-video.png')
  await page.keyboard.press('Escape')
}

// Onglet Médias.
await page.getByRole('tab', { name: /Médias/ }).click()
await page.waitForTimeout(300)
await shot('24-onglet-medias.png')

// Pièce jointe : joindre check-1 et demander la couleur.
await page.locator('.thumb').first().click()
await page.getByRole('button', { name: 'Joindre → session' }).click()
await page.fill('#composer', 'De quelle couleur est le rond sur l’image jointe ? Un mot, sans outil.')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelectorAll('.result').length >= 2, null, { timeout: 180000 })
const answers = await page.locator('.msg-ai').allTextContents()

// Cockpit : dernière vue sur la carte.
await page.getByLabel('Cockpit').click()
await page.waitForTimeout(500)
await shot('25-cockpit-derniere-vue.png')
const lastView = await page.getByText(/Dernière vue/).count()

console.log(JSON.stringify({ thumbs, seriesBtn, hasVideo, lastView, attachAnswer: answers.at(-1) }))
await app.close()
