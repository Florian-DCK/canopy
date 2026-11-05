// Détection des secrets dans un message, avant l'envoi et sur ta machine (planche 39). Chaque mot est noté :
// formes connues (sk-, ghp_, postgres://…), hasard des caractères, mots autour (« token », « clé », « mot de passe »).
// sure : remplacé d'office par une puce ; maybe : signalé, un clic pour trancher. Les références lisibles
// (CMD-2026-4481), hashes de commit, UUID, chemins et adresses ne sont pas touchés.

export type Detection = { value: string; index: number; name: string; level: 'sure' | 'maybe'; why: string }

const KNOWN: [RegExp, string, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, 'PRIVATE_KEY', 'clé privée'],
  [/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|mssql):\/\/[^\s:@/]+:[^\s@]+@[^\s]+/g, 'DATABASE_URL', 'chaîne de connexion avec mot de passe'],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, 'OPENAI_API_KEY', 'préfixe de clé d’API (sk-)'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, 'STRIPE_SECRET_KEY', 'clé Stripe'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g, 'GITHUB_TOKEN', 'token GitHub'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, 'GITLAB_TOKEN', 'token GitLab'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'SLACK_TOKEN', 'token Slack'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS_ACCESS_KEY_ID', 'clé AWS'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, 'GOOGLE_API_KEY', 'clé Google'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT_TOKEN', 'jeton JWT']
]
const CONTEXT = /(token|cl[ée]|key|secret|password|mot de passe|mdp|pwd|passphrase|api|bearer|credential|identifiant)\b[^.\n]{0,40}$/i

function entropy(s: string) {
  const f = new Map<string, number>()
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1)
  let h = 0
  for (const n of f.values()) h -= (n / s.length) * Math.log2(n / s.length)
  return h
}
const classes = (s: string) => [/[a-z]/, /[A-Z]/, /\d/].filter((r) => r.test(s)).length

/** Le mot ressemble-t-il à une référence lisible plutôt qu'à un secret ? */
function readable(w: string) {
  if (/^[0-9a-f]{7,40}$/i.test(w) && !/[g-z]/i.test(w)) return true // hash git / hexadécimal court
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(w)) return true // UUID
  if (/^[A-Z]{2,6}-\d{2,}(-\d+)*$/.test(w)) return true // CMD-2026-4481
  if (/[/\\]|^https?:|\.(com|be|fr|io|dev|net|org|app|js|ts|tsx|json|md|png|jpg)$/i.test(w)) return true
  if (/^\d+$/.test(w)) return true
  if (/^(?:[A-Z]?[a-z]{2,})(?:[A-Z][a-z]{2,})+\d{0,2}$/.test(w)) return true // ButtonPrimaryLarge, designSystem
  if (/^[a-z]{2,}(?:_[a-z0-9]{2,})+$/.test(w) || /^[A-Z]{2,}(?:_[A-Z0-9]{2,})+$/.test(w)) return true // snake_case, DATABASE_URL
  if (/^[a-z]+$/.test(w)) return true // un mot ordinaire
  return false
}

function nameFromContext(before: string, fallback: string) {
  const b = before.toLowerCase()
  if (/mot de passe|password|mdp|pwd/.test(b)) return 'PASSWORD'
  if (/api/.test(b) && /token/.test(b)) return 'API_TOKEN'
  if (/api/.test(b)) return 'API_KEY'
  if (/token|bearer/.test(b)) return 'TOKEN'
  if (/secret/.test(b)) return 'SECRET'
  return fallback
}

export function detectSecrets(text: string): Detection[] {
  const out: Detection[] = []
  const taken: [number, number][] = []
  const free = (i: number, j: number) => !taken.some(([a, b]) => i < b && j > a)
  for (const [re, name, why] of KNOWN) {
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0
      if (!free(i, i + m[0].length)) continue
      taken.push([i, i + m[0].length])
      out.push({ value: m[0], index: i, name, level: 'sure', why })
    }
  }
  for (const m of text.matchAll(/[A-Za-z0-9_\-+/=]{8,}/g)) {
    const w = m[0].replace(/[=]+$/, '')
    const i = m.index ?? 0
    if (!free(i, i + m[0].length) || readable(w)) continue
    const before = text.slice(Math.max(0, i - 50), i)
    const ctx = CONTEXT.test(before)
    // Sans mot comme « token » juste avant, il faut au moins deux sortes de caractères (lettres et chiffres…).
    if (!ctx && classes(w) < 2) continue
    const h = entropy(w)
    const long = w.length >= 16
    let level: Detection['level'] | null = null
    if (long && ((ctx && h >= 3.0) || (h >= 3.5 && classes(w) === 3))) level = 'sure'
    else if ((long && h >= 3.2) || (ctx && w.length >= 8 && h >= 2.0)) level = 'maybe'
    if (!level) continue
    taken.push([i, i + m[0].length])
    out.push({ value: m[0], index: i, name: nameFromContext(before, 'SECRET'), level, why: `${w.length} caractères au hasard${ctx ? ', après un mot comme « token » ou « clé »' : ''}` })
  }
  // Noms uniques dans le message.
  const seen = new Map<string, number>()
  for (const d of out.sort((a, b) => a.index - b.index)) {
    const n = seen.get(d.name) ?? 0
    seen.set(d.name, n + 1)
    if (n) d.name = `${d.name}_${n + 1}`
  }
  return out
}

/** Repère laissé dans le message à la place de la valeur : Claude lit le nom, jamais le secret. */
export const placeholder = (name: string, where?: string) => `⟦secret ${name}${where ? ` · dans ${where}` : ''}⟧`
export const sanitizeName = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^[^A-Z]+/, '')
    .slice(0, 64) || 'SECRET'
