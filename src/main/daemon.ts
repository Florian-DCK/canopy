import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState } from '../shared/state'
import type { AppEvent } from '../shared/types'

// Client Electron du démon : le lance s'il ne tourne pas, s'abonne à son flux d'événements
// (avec rattrapage), détecte quand son code a été reconstruit (« moteur modifié »).

type Info = { port: number; token: string; pid: number; version: string; script: string }
export type DaemonStatus = { connected: boolean; outdated: boolean; busy: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class DaemonClient {
  private info: Info | null = null
  private seq = 0
  private abort: AbortController | null = null
  private status: DaemonStatus = { connected: false, outdated: false, busy: false }

  constructor(
    private dataDir: string,
    private script: string,
    private on: {
      snapshot: (s: AppState) => void
      event: (seq: number, e: AppEvent) => void
      status: (s: DaemonStatus) => void
    }
  ) {}

  private infoFile = () => join(this.dataDir, 'daemon.json')

  private readInfo(): Info | null {
    try {
      return existsSync(this.infoFile()) ? (JSON.parse(readFileSync(this.infoFile(), 'utf8')) as Info) : null
    } catch {
      return null
    }
  }

  private async get(path: string, info = this.info): Promise<any> {
    if (!info) throw new Error('démon absent')
    const r = await fetch(`http://127.0.0.1:${info.port}${path}`, { headers: { 'x-atelier-token': info.token } })
    return r.json()
  }

  private async health(info: Info | null) {
    if (!info) return null
    try {
      const h = await this.get('/health', info)
      return h?.ok ? h : null
    } catch {
      return null
    }
  }

  private ensuring: Promise<void> | null = null

  /** Se connecte au démon existant, sinon en lance un. Un seul lancement à la fois (sinon : 2 démons). */
  ensure(): Promise<void> {
    this.ensuring ??= this.doEnsure().finally(() => (this.ensuring = null))
    return this.ensuring
  }

  private async doEnsure(): Promise<void> {
    const cur = this.readInfo()
    if (await this.health(cur)) {
      this.info = cur
      return
    }
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ATELIER_DATA: this.dataDir }
    const since = Date.now()
    // Sous Windows, Start-Process (ShellExecute) lance le démon sans hériter d'aucun handle d'Electron
    // et hors de son arbre de processus : il survit à Electron, et Electron peut se fermer sans
    // attendre le démon (avec `cmd start`, le démon gardait les pipes d'Electron ouverts).
    // Le démon écrit lui-même son journal (daemon.log).
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`
    const child =
      process.platform === 'win32'
        ? spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${q(`"${this.script}"`)} -WindowStyle Hidden`
            ],
            { env, stdio: 'ignore', windowsHide: true }
          )
        : spawn(process.execPath, [this.script], { env, detached: true, stdio: 'ignore' })
    child.unref()
    for (let i = 0; i < 150; i++) {
      await sleep(100)
      const info = this.readInfo()
      let fresh = false
      try {
        fresh = statSync(this.infoFile()).mtimeMs >= since - 50
      } catch {
        /* pas encore écrit */
      }
      if (info && fresh && (await this.health(info))) {
        this.info = info
        return
      }
    }
    throw new Error('Le démon Canopy ne démarre pas (voir daemon.log)')
  }

  async rpc<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.info) await this.ensure()
    const call = async () => {
      const r = await fetch(`http://127.0.0.1:${this.info!.port}/rpc`, {
        method: 'POST',
        headers: { 'x-atelier-token': this.info!.token, 'content-type': 'application/json' },
        body: JSON.stringify({ method, args })
      })
      return r.json()
    }
    let res: any
    try {
      res = await call()
    } catch {
      await this.ensure() // démon redémarré entre-temps
      res = await call()
    }
    if (!res.ok) throw new Error(res.error)
    return res.result as T
  }

  /** Boucle d'abonnement : snapshot, puis flux ; à la moindre coupure, reconnexion + resynchro. */
  async start() {
    for (;;) {
      try {
        await this.ensure()
        const snap: AppState = await this.get('/snapshot')
        this.seq = snap.seq
        this.on.snapshot(snap)
        this.setStatus({ connected: true })
        await this.stream()
      } catch (err) {
        console.error('[atelier] démon', err)
      }
      this.setStatus({ connected: false })
      this.info = null
      await sleep(800)
    }
  }

  private async stream() {
    this.abort = new AbortController()
    const r = await fetch(`http://127.0.0.1:${this.info!.port}/events?since=${this.seq}`, {
      headers: { 'x-atelier-token': this.info!.token },
      signal: this.abort.signal
    })
    if (!r.body) throw new Error('flux vide')
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (chunk.startsWith('event: resync')) throw new Error('resync')
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const { seq, e } = JSON.parse(line.slice(6))
        if (seq <= this.seq) continue
        this.seq = seq
        this.on.event(seq, e)
      }
    }
  }

  /** Le script du démon a-t-il été reconstruit depuis son lancement ? */
  async checkVersion() {
    const h = await this.health(this.info)
    if (!h) return
    let built = h.version
    try {
      built = createHash('sha1').update(readFileSync(this.script)).digest('hex')
    } catch {
      /* script absent */
    }
    this.setStatus({ outdated: built !== h.version, busy: !!h.busy })
  }

  /** Redémarre le démon (refusé s'il travaille, sauf force) ; les sessions ouvertes sont reprises. */
  async restart(force = false) {
    await this.rpc('shutdown', force)
    this.abort?.abort()
    this.info = null
    await sleep(300)
    await this.ensure()
    this.setStatus({ outdated: false })
  }

  async stop(force = true) {
    try {
      // Électron ne doit jamais rester bloqué à la fermeture à cause du démon.
      await Promise.race([this.rpc('shutdown', force), sleep(5000)])
    } catch {
      /* déjà arrêté */
    }
  }

  private setStatus(p: Partial<DaemonStatus>) {
    this.status = { ...this.status, ...p }
    this.on.status(this.status)
  }
}
