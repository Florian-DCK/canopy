// Mode voix : la synthèse lit mal les chiffres (« 16,5 s », « 92 % »…). On les écrit en toutes lettres avant.

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

function below100(n: number): string {
  if (n <= 16) return UNITS[n]
  if (n < 20) return `dix-${UNITS[n - 10]}`
  if (n < 70) {
    const t = Math.floor(n / 10)
    const u = n % 10
    return u === 0 ? TENS[t] : u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60)}`
  if (n === 80) return 'quatre-vingts'
  return `quatre-vingt-${below100(n - 80)}`
}

function below1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  if (!h) return below100(r)
  const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`
  return r ? `${head} ${below100(r)}` : head
}

/** Entier positif en toutes lettres (jusqu'aux milliards). */
export function intWords(n: number): string {
  if (n < 1000) return below1000(n)
  const parts: string[] = []
  const scales: [number, string, string][] = [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions']]
  for (const [v, one, many] of scales) {
    const q = Math.floor(n / v)
    if (q) parts.push(q === 1 ? `un ${one}` : `${intWords(q)} ${many}`)
    n %= v
  }
  const k = Math.floor(n / 1000)
  if (k) parts.push(k === 1 ? 'mille' : `${below1000(k)} mille`)
  n %= 1000
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}

/** « 16,5 » → « seize virgule cinq » ; « 0,21 » → « zéro virgule vingt et un » ; « 0,05 » → « zéro virgule zéro cinq ». */
function numWords(raw: string): string {
  const [i, d] = raw.replace(/[\s  ]/g, '').split(/[,.]/)
  const head = intWords(Number(i))
  if (!d) return head
  const zeros = d.match(/^0+/)?.[0].length ?? 0
  const rest = d.slice(zeros)
  return `${head} virgule ${'zéro '.repeat(zeros)}${rest ? intWords(Number(rest)) : ''}`.trim()
}

const UNIT_WORDS: Record<string, [string, string]> = {
  ms: ['milliseconde', 'millisecondes'],
  s: ['seconde', 'secondes'],
  min: ['minute', 'minutes'],
  h: ['heure', 'heures'],
  px: ['pixel', 'pixels'],
  ko: ['kilooctet', 'kilooctets'],
  Ko: ['kilooctet', 'kilooctets'],
  Mo: ['mégaoctet', 'mégaoctets'],
  Go: ['gigaoctet', 'gigaoctets'],
  k: ['mille', 'mille'],
  '%': ['pour cent', 'pour cent']
}

/** Remplace nombres, unités et symboles par leur lecture à voix haute. */
export function speakNumbers(text: string): string {
  return text
    .replace(/(\d+)\s*[×x]\s*(\d+)/g, '$1 fois $2')
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1 sur $2')
    .replace(/\b1er\b/g, 'premier')
    .replace(/\b1re\b/g, 'première')
    .replace(/\b(\d+)e\b/g, (_, n) => {
      const w = intWords(Number(n))
      return (w.endsWith('e') ? w.slice(0, -1) : w.replace(/f$/, 'v').replace(/q$/, 'qu')) + 'ième'
    })
    .replace(/[−-](?=\d)/g, (m, off, s) => (off === 0 || /[\s(]/.test(s[off - 1]) ? 'moins ' : m))
    .replace(/(\d+(?:[\s  ]\d{3})*(?:[,.]\d+)?)\s*(ms|min|Ko|ko|Mo|Go|px|s|h|k|%)(?![\p{L}])/gu, (_, n: string, u: string) => {
      const v = Number(n.replace(/[\s  ]/g, '').replace(',', '.'))
      const [one, many] = UNIT_WORDS[u]
      return `${numWords(n)} ${v >= 2 ? many : one}`
    })
    .replace(/(\d+)\.(\d+)/g, '$1 point $2')
    .replace(/\d+(?:[\s  ]\d{3})*(?:,\d+)?/g, (n) => numWords(n))
    .replace(/(vingt|cent)s mille/g, '$1 mille')
    .replace(/→/g, ', puis ')
    .replace(/≈|~/g, 'environ ')
    .replace(/\+/g, ' plus ')
    .replace(/=/g, ' égale ')
}
