import type { TestFailure, TestReport } from '../shared/types'

// Résultats de tests lus dans la sortie d'une commande (planche 49) : Vitest, Jest, Playwright Test,
// pytest, cargo test, go test. On lit le résumé texte que chaque outil imprime par défaut ;
// aucune option n'est ajoutée aux commandes de l'agent.

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const RUNNERS: [TestReport['runner'], RegExp][] = [
  ['vitest', /\bvitest\b/],
  ['playwright', /\bplaywright\s+test\b/],
  ['jest', /\bjest\b/],
  ['pytest', /\bpytest\b|\bpython\S*\s+-m\s+pytest\b/],
  ['cargo', /\bcargo\s+(test|nextest)\b/],
  ['go', /\bgo\s+test\b/]
]

/** Commande de tests ? (npm test / npm run test comptent : le lanceur se devine à la sortie.) */
export function testRunnerOf(cmd: string): TestReport['runner'] | 'auto' | null {
  for (const [r, re] of RUNNERS) if (re.test(cmd)) return r
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/.test(cmd) ? 'auto' : null
}

const num = (re: RegExp, s: string) => Number(re.exec(s)?.[1] ?? 0)
const clip = (s: string, n = 1200) => (s.length > n ? s.slice(0, n) + '…' : s)
/** Retire les lignes vides du bord et l'indentation commune (extraits de code, diffs). */
function dedent(t: string): string {
  const lines = t.replace(/^\s*\n|\n\s*$/g, '').split('\n')
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length))
  return lines.map((l) => l.slice(pad)).join('\n')
}

/**
 * Attendu / reçu : « Expected: x / Received: y » (toBe), ou le diff « - Expected / + Received » (toEqual),
 * dont on reconstruit les deux côtés (lignes communes + lignes propres à chacun).
 */
function expectedReceived(body: string): { expected?: string; received?: string } {
  const diff = /^\s*-\s*Expected\b[^\n]*\n\s*\+\s*Received\b[^\n]*\n\s*\n([\s\S]*?)(?:\n\s*\n|\n\s*❯)/m.exec(body)?.[1]
  if (diff) {
    // Chaque ligne = indentation de la sortie + marqueur (« - », « + » ou « ␣ ») + espace + contenu.
    const lines = diff.split('\n').filter((l) => l.trim())
    const pad = Math.min(...lines.filter((l) => /^\s*[-+]/.test(l)).map((l) => /^\s*/.exec(l)![0].length))
    const side = (drop: string) => lines.filter((l) => l[pad] !== drop).map((l) => l.slice(pad + 2)).join('\n')
    return { expected: clip(dedent(side('+')), 600), received: clip(dedent(side('-')), 600) }
  }
  return { expected: /Expected:\s*(.+)/.exec(body)?.[1]?.trim(), received: /Received:\s*(.+)/.exec(body)?.[1]?.trim() }
}

export function parseTests(cmd: string, raw: string): TestReport | undefined {
  const runner0 = testRunnerOf(cmd)
  if (!runner0) return undefined
  const out = raw.replace(ANSI, '').replace(/\r/g, '')
  const runner =
    runner0 !== 'auto'
      ? runner0
      : /\n\s*Test Files\s+/.test(out) ? 'vitest' : /\nTests:\s+/.test(out) ? 'jest' : /\d+ (passed|failed).* in [\d.]+s/.test(out) ? 'pytest' : null
  if (!runner) return undefined
  const r = parsers[runner](out)
  if (!r || r.passed + r.failed + r.skipped === 0) return undefined
  return { runner, ...r, failures: r.failures.slice(0, 20) }
}

type Parsed = Omit<TestReport, 'runner'>

const parsers: Record<TestReport['runner'], (o: string) => Parsed | undefined> = {
  vitest(o) {
    const line = /^\s*Tests\s+(.+)$/m.exec(o)?.[1]
    if (!line) return undefined
    const failures: TestFailure[] = []
    // Blocs « FAIL  fichier > suite > test » suivis de l'erreur et de « ❯ fichier:ligne:col ».
    const re = /^\s*FAIL\s+(\S+)\s+>\s+(.+)$([\s\S]*?)(?=^\s*FAIL\s|^\s*⎯{3,}|^\s*Test Files\s|(?![\s\S]))/gm
    for (const m of o.matchAll(re)) {
      const body = m[3]
      const parts = m[2].split(/\s+>\s+/)
      const loc = /❯\s+([^\s:]+):(\d+):\d+/.exec(body)
      failures.push({
        name: parts.pop()!.trim(),
        suite: parts.join(' › ') || undefined,
        file: loc?.[1] ?? m[1],
        line: loc ? Number(loc[2]) : undefined,
        message: /^\s*((?:\w*Error|AssertionError)[^\n]*)/m.exec(body)?.[1]?.trim() ?? body.trim().split('\n')[0] ?? '',
        ...expectedReceived(body),
        snippet: clip(dedent(/((?:^\s*\d+\s*\|.*\n)+(?:\s*\|\s*\^.*)?)/m.exec(body)?.[1] ?? ''), 800) || undefined
      })
    }
    return {
      passed: num(/(\d+) passed/, line),
      failed: num(/(\d+) failed/, line),
      skipped: num(/(\d+) (?:skipped|todo)/, line),
      files: num(/Test Files\s+.*\((\d+)\)/, o) || undefined,
      duration: /^\s*Duration\s+([\d.]+\s*m?s)/m.exec(o)?.[1],
      failures
    }
  },
  jest(o) {
    const line = /^Tests:\s+(.+)$/m.exec(o)?.[1]
    if (!line) return undefined
    const failures: TestFailure[] = []
    for (const m of o.matchAll(/^\s*●\s+(.+?)\n([\s\S]*?)(?=^\s*●\s|^Test Suites:|(?![\s\S]))/gm)) {
      const parts = m[1].split(' › ')
      const body = m[2]
      const loc = /at .*?\(?([^\s()]+\.[cm]?[jt]sx?):(\d+):\d+\)?/.exec(body)
      failures.push({
        name: parts.pop()!.trim(),
        suite: parts.join(' › ') || undefined,
        file: loc?.[1],
        line: loc ? Number(loc[2]) : undefined,
        message: body.trim().split('\n')[0] ?? '',
        ...expectedReceived(body),
        snippet: clip(dedent(/((?:^\s*>?\s*\d+\s*\|.*\n)+)/m.exec(body)?.[1] ?? ''), 800) || undefined
      })
    }
    return {
      passed: num(/(\d+) passed/, line),
      failed: num(/(\d+) failed/, line),
      skipped: num(/(\d+) (?:skipped|todo)/, line),
      files: num(/^Test Suites:.*?(\d+) total/m, o) || undefined,
      duration: /^Time:\s+([\d.]+\s*m?s)/m.exec(o)?.[1],
      failures
    }
  },
  playwright(o) {
    const failed = num(/^\s*(\d+) failed/m, o)
    const passed = num(/^\s*(\d+) passed/m, o)
    if (!failed && !passed) return undefined
    const failures: TestFailure[] = []
    for (const m of o.matchAll(/^\s*\d+\)\s+\[[^\]]+\]\s+›\s+(\S+?):(\d+):\d+\s+›\s+(.+?)\s*─*\n([\s\S]*?)(?=^\s*\d+\)\s+\[|^\s*\d+ (?:failed|passed)|(?![\s\S]))/gm)) {
      const parts = m[3].split(' › ')
      failures.push({ name: parts.pop()!.trim(), suite: parts.join(' › ') || undefined, file: m[1], line: Number(m[2]), message: m[4].trim().split('\n')[0] ?? '', expected: /Expected[^:]*:\s*(.+)/.exec(m[4])?.[1]?.trim(), received: /Received[^:]*:\s*(.+)/.exec(m[4])?.[1]?.trim() })
    }
    return { passed, failed, skipped: num(/^\s*(\d+) skipped/m, o), duration: /passed \(([\d.]+m?s)\)/.exec(o)?.[1], failures }
  },
  pytest(o) {
    const line = /^=+\s*(.*?(?:passed|failed|error).*?)\s*=+\s*$/m.exec([...o.matchAll(/^=+.*(?:passed|failed|error).*=+$/gm)].pop()?.[0] ?? '')?.[1]
    if (!line) return undefined
    const failures: TestFailure[] = [...o.matchAll(/^FAILED\s+(\S+?)::(\S+)(?:\s+-\s+(.*))?$/gm)].map((m) => {
      const parts = m[2].split('::')
      return { name: parts.pop()!, suite: parts.join(' › ') || undefined, file: m[1], message: m[3] ?? '' }
    })
    return {
      passed: num(/(\d+) passed/, line),
      failed: num(/(\d+) failed/, line) + num(/(\d+) errors?/, line),
      skipped: num(/(\d+) skipped/, line),
      duration: / in ([\d.]+s)/.exec(line)?.[1],
      failures
    }
  },
  cargo(o) {
    const lines = [...o.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)]
    if (!lines.length) return undefined
    const sum = (i: number) => lines.reduce((a, m) => a + Number(m[i]), 0)
    const failures = [...o.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=^----|^failures:|(?![\s\S]))/gm)].map((m) => {
      const loc = /at ([^\s:]+\.rs):(\d+):\d+/.exec(m[2])
      return { name: m[1], file: loc?.[1], line: loc ? Number(loc[2]) : undefined, message: m[2].trim().split('\n').slice(0, 3).join(' '), expected: /right:\s*(.+)/.exec(m[2])?.[1], received: /left:\s*(.+)/.exec(m[2])?.[1] }
    })
    return { passed: sum(1), failed: sum(2), skipped: sum(3), failures }
  },
  go(o) {
    const fails = [...o.matchAll(/^\s*--- FAIL: (\S+) \(([\d.]+s)\)\n([\s\S]*?)(?=^\s*---|^FAIL|^ok|(?![\s\S]))/gm)]
    const passes = (o.match(/^\s*--- PASS:/gm) ?? []).length
    const okPkgs = (o.match(/^ok\s+\S+/gm) ?? []).length
    if (!fails.length && !passes && !okPkgs) return undefined
    const failures = fails.map((m) => {
      const loc = /(\w+_test\.go):(\d+):\s*(.*)/.exec(m[3])
      return { name: m[1], file: loc?.[1], line: loc ? Number(loc[2]) : undefined, message: loc?.[3] ?? m[3].trim().split('\n')[0] ?? '' }
    })
    // Sans -v, go test n'imprime pas chaque test réussi : on compte alors les paquets.
    return { passed: passes || okPkgs, failed: fails.length, skipped: (o.match(/^\s*--- SKIP:/gm) ?? []).length, failures, unit: passes ? undefined : 'paquets' }
  }
}
