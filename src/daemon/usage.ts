import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Quota } from '../shared/types'
import { dataFile } from './paths'

// Sonde d'usage : une session Claude Code au repos (aucun message, donc aucun appel au modèle)
// à qui l'on demande les données de /usage. API expérimentale du SDK : tout échec est silencieux.
type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')
type Sample = { t: number; pct: number }

const toMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) || undefined : undefined)
const samplesFile = () => dataFile('usage-samples.json')

function loadSamples(): Sample[] {
  try {
    return existsSync(samplesFile()) ? (JSON.parse(readFileSync(samplesFile(), 'utf8')) as Sample[]) : []
  } catch {
    return []
  }
}

export class UsageProbe {
  private q: any = null
  private release: (() => void) | null = null
  private busy = false
  private samples: Sample[] = loadSamples()

  constructor(private loadSdk: () => Promise<Sdk>, private onQuota: (q: Quota) => void) {}

  private async ensure() {
    if (this.q) return this.q
    const { query } = await this.loadSdk()
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    const idle = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<any>>((r) => (this.release = () => r({ done: true, value: undefined })))
      })
    }
    this.q = query({ prompt: idle as any, options: { env, settingSources: [] } })
    // Draine le flux pour détecter la fin du process.
    void (async () => {
      try {
        for await (const _ of this.q) {
          /* rien */
        }
      } catch {
        /* ignoré */
      }
      this.q = null
    })()
    return this.q
  }

  /** Garde les relevés de la fenêtre 5 h en cours (et persiste pour survivre à un redémarrage). */
  private record(pct: number | null | undefined, resetsAt: number | undefined) {
    if (pct == null) return
    const now = Date.now()
    const start = resetsAt ? resetsAt - 5 * 3600_000 : now - 5 * 3600_000
    this.samples = this.samples.filter((s) => s.t >= start && s.t <= now)
    // Une baisse = nouvelle fenêtre : on repart de zéro.
    const last = this.samples.at(-1)
    if (last && pct < last.pct - 1) this.samples = []
    this.samples.push({ t: now, pct })
    try {
      writeFileSync(samplesFile(), JSON.stringify(this.samples), 'utf8')
    } catch {
      /* non bloquant */
    }
  }

  async refresh() {
    if (this.busy) return
    this.busy = true
    try {
      const q = await this.ensure()
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      const rl = u?.rate_limits
      if (!u?.rate_limits_available || !rl) return
      const fiveReset = toMs(rl.five_hour?.resets_at)
      this.record(rl.five_hour?.utilization, fiveReset)
      this.onQuota({
        five: rl.five_hour ? { pct: rl.five_hour.utilization, resetsAt: fiveReset } : undefined,
        week: rl.seven_day ? { pct: rl.seven_day.utilization, resetsAt: toMs(rl.seven_day.resets_at) } : undefined,
        models: (rl.model_scoped ?? []).map((m: any) => ({ name: m.display_name, pct: m.utilization })),
        fiveSamples: this.samples,
        extra: rl.extra_usage
          ? { enabled: !!rl.extra_usage.is_enabled, used: rl.extra_usage.used_credits ?? null, currency: rl.extra_usage.currency }
          : undefined,
        updatedAt: Date.now()
      })
    } catch (err) {
      console.error('[atelier] usage', err)
      this.stop()
    } finally {
      this.busy = false
    }
  }

  stop() {
    this.release?.()
    this.release = null
    try {
      this.q?.close?.()
    } catch {
      /* ignoré */
    }
    this.q = null
  }
}
