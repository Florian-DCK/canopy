import type { HttpCall } from '../shared/types'

// Requêtes HTTP lancées par l'agent (planche 48) : curl (-i, -v ou corps seul), httpie, Invoke-WebRequest.
// Lu dans la commande et sa sortie ; les en-têtes d'authentification sont masqués.

const SECRET_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i
const mask = (k: string, v: string) => (SECRET_HEADERS.test(k) ? v.replace(/^(\w+\s+)?.*/, (_m, p) => `${p ?? ''}••••••••`) : v)
const clip = (s: string, n = 20000) => (s.length > n ? s.slice(0, n) + '\n…' : s)

/** Programme HTTP de la commande, s'il y en a un. */
function clientOf(cmd: string): 'curl' | 'httpie' | 'pwsh' | null {
  if (/(^|[\s;&|(])curl(\.exe)?\s/.test(cmd)) return 'curl'
  if (/(^|[\s;&|(])https?\s+(GET|POST|PUT|PATCH|DELETE|HEAD|:?\d|[\w.-]+[:/])/i.test(cmd) || /(^|[\s;&|(])http\s+(-\S+\s+)*https?:\/\//.test(cmd)) return 'httpie'
  if (/\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i.test(cmd)) return 'pwsh'
  return null
}

function headerPairs(lines: string[]): [string, string][] {
  return lines.map((l) => /^([\w-]+):\s*(.*)$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], mask(m[1], m[2])])
}

export function parseHttp(cmd: string, raw: string): HttpCall | undefined {
  const client = clientOf(cmd)
  if (!client) return undefined
  const url = /(https?:\/\/[^\s"'`]+)/.exec(cmd)?.[1] ?? /\s(localhost:\d+[^\s"'`]*|:\d+\/[^\s"'`]*)/.exec(cmd)?.[1]
  if (!url) return undefined
  const explicit = /(?:-X|--request|-Method)\s+["']?([A-Z]+)/i.exec(cmd)?.[1]?.toUpperCase() ?? (client === 'httpie' ? /\bhttps?\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b/i.exec(cmd)?.[1]?.toUpperCase() : undefined)
  const hasBody = /\s(-d|--data\S*|--json|-F|--form|-Body)\s/.test(cmd) || (client === 'httpie' && /\s[\w.-]+:?=/.test(cmd))
  const method = explicit ?? (hasBody ? 'POST' : 'GET')
  const reqHeaders = [...cmd.matchAll(/(?:-H|--header)\s+(?:"([^"]+)"|'([^']+)')/g)].map((m) => m[1] ?? m[2])
  const reqBody = /(?:-d|--data(?:-raw|-binary)?|--json)\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/.exec(cmd)
  const out = raw.replace(/\r/g, '')
  const call: HttpCall = { method, url, body: '', reqHeaders: headerPairs(reqHeaders), reqBody: reqBody ? (reqBody[1] ?? reqBody[2]?.replace(/\\"/g, '"')) : undefined }

  if (client === 'pwsh') {
    const code = /^StatusCode\s*:\s*(\d{3})/m.exec(out)
    const desc = /^StatusDescription\s*:\s*(.*)$/m.exec(out)?.[1]?.trim()
    const content = /^Content\s*:\s*([\s\S]*?)(?:^\w+\s*:|(?![\s\S]))/m.exec(out)?.[1]?.trim()
    return { ...call, status: code ? Number(code[1]) : undefined, statusText: desc, body: clip(content ?? out.trim()) }
  }

  // curl -v : en-têtes préfixés « < » (réponse) et « > » (requête) sur la sortie d'erreur.
  if (/^< HTTP\//m.test(out)) {
    const statuses = [...out.matchAll(/^< HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/gm)]
    const last = statuses[statuses.length - 1]
    const after = out.slice(last.index!)
    const hdr = after.split('\n').filter((l) => l.startsWith('< ')).slice(1).map((l) => l.slice(2))
    const body = out.split('\n').filter((l) => !/^[<>*{}] |^[<>*]$|^Note: |^\s*% Total|^\s*Dload|^\s*\d+\s+\d+\s+\d+/.test(l)).join('\n').trim()
    return { ...call, status: Number(last[1]), statusText: last[2].trim() || undefined, headers: headerPairs(hdr), body: clip(body) }
  }

  // curl -i / httpie : « HTTP/1.1 200 OK », en-têtes, ligne vide, corps (le dernier bloc après redirections).
  const blocks = [...out.matchAll(/^HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/gm)]
  if (blocks.length) {
    const last = blocks[blocks.length - 1]
    const rest = out.slice(last.index! + last[0].length + 1)
    const cut = rest.search(/\n\s*\n/)
    const head = cut < 0 ? rest : rest.slice(0, cut)
    const body = cut < 0 ? '' : rest.slice(cut).trim()
    return { ...call, status: Number(last[1]), statusText: last[2].trim() || undefined, headers: headerPairs(head.split('\n')), body: clip(body) }
  }

  // Corps seul (curl sans -i) : pas de statut, mais un corps lisible ; `-w "%{http_code}"` final reconnu.
  const tail = /(?:^|\n)(\d{3})\s*$/.exec(out)
  const code = tail && /-w\s+["']?[^"']*%\{(http_code|response_code)\}/.test(cmd) ? Number(tail[1]) : undefined
  const body = (code ? out.slice(0, tail!.index) : out).trim()
  if (!body && !code) return undefined
  return { ...call, status: code, body: clip(body) }
}
