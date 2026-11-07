import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AgendaAttendee, AgendaMeeting } from '../../shared/agenda'
import { vaultDelete, vaultGet, vaultStore } from '../vault'

// Google Agenda + Gmail (lecture seule). OAuth « application installée » : serveur local sur 127.0.0.1 + PKCE.
// Les secrets restent dans le Coffre (global) et ne sont jamais écrits dans les logs.

export type RawMeeting = Omit<AgendaMeeting, 'projectId' | 'link' | 'candidates' | 'brief'>
export type Mail = { subject: string; from: string; date: number; snippet: string }

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly']
const ID = 'GOOGLE_CLIENT_ID'
const SECRET = 'GOOGLE_CLIENT_SECRET'
const REFRESH = 'GOOGLE_REFRESH_TOKEN'

const b64url = (b: Buffer) => b.toString('base64url')
const g = (name: string) => vaultGet(name, '')

export const googleConfigured = () => !!g(ID) && !!g(SECRET)
export const googleConnected = () => !!g(REFRESH)

/** Seuls les liens https sont ouverts (visio). */
export function isHttps(u?: string): boolean {
  try {
    return !!u && new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

// Une seule actualisation du jeton à la fois ; `gen` change à chaque (dé)connexion pour qu'une ancienne chaîne n'écrase rien.
let inflight: Promise<string> | null = null
let gen = 0

export function googleSetClient(id: string, secret: string) {
  vaultStore(ID, id, 'global', '')
  vaultStore(SECRET, secret, 'global', '')
  token = null
  inflight = null
}

export function googleDisconnect() {
  gen++
  vaultDelete(REFRESH, 'global')
  token = null
  inflight = null
}

/**
 * Serveur local qui attend la redirection OAuth (?code=…&state=…). Rend le port et la promesse du code.
 * Réutilisé par Teamleader (port et chemin imposés).
 */
export async function waitForCode(opts: { host: string; port: number; path: string; state: string; timeoutMs?: number }): Promise<{ port: number; code: Promise<string> }> {
  await cancelPending?.() // une nouvelle connexion libère d'abord le port de la précédente
  return startWait(opts)
}

// Attente en cours (une seule à la fois) : rend la main quand son serveur est fermé.
let cancelPending: (() => Promise<void>) | null = null

function startWait(opts: { host: string; port: number; path: string; state: string; timeoutMs?: number }): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((resolveStart, rejectStart) => {
    let done: (c: string) => void
    let fail: (e: Error) => void
    const code = new Promise<string>((res, rej) => {
      done = res
      fail = rej
    })
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://${opts.host}`)
      if (u.pathname !== opts.path) {
        res.writeHead(404).end()
        return
      }
      const c = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      const ok = !!c && u.searchParams.get('state') === opts.state
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
      res.end(`<!doctype html><meta charset="utf-8"><title>Canopy</title><body style="font:16px system-ui;padding:3rem;text-align:center">${ok ? 'C’est bon, tu peux revenir dans Canopy.' : 'Connexion refusée. Reviens dans Canopy et réessaie.'}</body>`)
      if (ok) done(c!)
      else fail(new Error(err ? `Autorisation refusée (${err}).` : 'Réponse inattendue du service.'))
    })
    const timer = setTimeout(() => fail(new Error('Délai dépassé : la connexion n’a pas été terminée en 5 minutes.')), opts.timeoutMs ?? 5 * 60_000)
    const mine = () =>
      new Promise<void>((res) => {
        srv.once('close', () => res())
        setTimeout(res, 1000)
        fail(new Error('Connexion annulée : une nouvelle connexion a été lancée.'))
      })
    cancelPending = mine
    const close = () => {
      clearTimeout(timer)
      if (cancelPending === mine) cancelPending = null
      srv.close()
    }
    void code.then(close, close)
    srv.once('error', (e) => {
      clearTimeout(timer)
      if (cancelPending === mine) cancelPending = null
      rejectStart(e)
    })
    srv.listen(opts.port, opts.host, () => {
      const a = srv.address()
      resolveStart({ port: typeof a === 'object' && a ? a.port : opts.port, code })
    })
  })
}

let token: { value: string; exp: number } | null = null
let account = ''
export const googleAccount = () => account

async function tokenCall(body: Record<string, string>) {
  const g0 = gen
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: g(ID) ?? '', client_secret: g(SECRET) ?? '', ...body }) })
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string }
  if (j.error === 'invalid_grant' && body.grant_type === 'refresh_token') {
    // Accès révoqué ou expiré : on oublie le jeton, la source s'affiche déconnectée.
    if (g0 === gen) {
      vaultDelete(REFRESH, 'global')
      token = null
    }
    throw new Error('Connexion expirée : reconnecte-toi.')
  }
  if (!r.ok || !j.access_token) throw new Error(`Google a refusé la connexion (${j.error_description ?? j.error ?? r.status}).`)
  return j
}

export async function googleConnect() {
  if (!googleConfigured()) throw new Error('Renseigne d’abord l’identifiant et le secret client Google.')
  const my = ++gen
  inflight = null
  const verifier = b64url(randomBytes(48))
  const state = b64url(randomBytes(16))
  const { port, code } = await waitForCode({ host: '127.0.0.1', port: 0, path: '/', state })
  const redirect = `http://127.0.0.1:${port}`
  const q = new URLSearchParams({ client_id: g(ID)!, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' })
  void shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
  const j = await tokenCall({ grant_type: 'authorization_code', code: await code, redirect_uri: redirect, code_verifier: verifier })
  if (my !== gen) throw new Error('Une autre connexion a pris le relais.')
  if (!j.refresh_token) throw new Error('Google n’a pas renvoyé d’accès durable. Réessaie.')
  vaultStore(REFRESH, j.refresh_token, 'global', '')
  token = { value: j.access_token!, exp: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 }
  try {
    const p = JSON.parse(Buffer.from(j.id_token?.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string }
    if (p.email) account = p.email
  } catch {
    /* l'adresse sera lue avec l'agenda */
  }
}

async function refreshToken(): Promise<string> {
  const g0 = gen
  const rt = g(REFRESH)
  if (!rt) throw new Error('Google n’est pas connecté.')
  const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: rt })
  if (g0 === gen) token = { value: j.access_token!, exp: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 }
  return j.access_token!
}

function accessToken(): Promise<string> {
  if (token && token.exp > Date.now()) return Promise.resolve(token.value)
  if (inflight) return inflight
  const p: Promise<string> = refreshToken().finally(() => {
    if (inflight === p) inflight = null
  })
  return (inflight = p)
}

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
  if (!r.ok) throw new Error(`Google a répondu ${r.status}.`)
  return (await r.json()) as T
}

type GEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  recurringEventId?: string
  eventType?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[]
}

const LINK = /https:\/\/(?:teams\.microsoft\.com|meet\.google\.com)\/[^\s"<>)]+/

/** Réunions d'aujourd'hui (minuit local) et des 7 jours suivants. */
export async function googleListEvents(): Promise<RawMeeting[]> {
  const t0 = new Date()
  t0.setHours(0, 0, 0, 0)
  const q = new URLSearchParams({ timeMin: t0.toISOString(), timeMax: new Date(t0.getTime() + 8 * 86_400_000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })
  const j = await api<{ summary?: string; items?: GEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`)
  if (!account && j.summary?.includes('@')) account = j.summary
  const domain = account.split('@')[1]?.toLowerCase() ?? ''
  const out: RawMeeting[] = []
  for (const e of j.items ?? []) {
    // Lieu de travail (télétravail), absence, temps de concentration : pas des réunions.
    if (e.eventType && e.eventType !== 'default' && e.eventType !== 'fromGmail') continue
    if (e.status === 'cancelled' || e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
    const allDay = !!e.start?.date
    const start = Date.parse(e.start?.dateTime ?? e.start?.date ?? '')
    const end = Date.parse(e.end?.dateTime ?? e.end?.date ?? '')
    if (Number.isNaN(start)) continue
    const attendees: AgendaAttendee[] = []
    for (const a of e.attendees ?? []) {
      const email = a.email?.toLowerCase()
      if (!email || a.resource || email.endsWith('resource.calendar.google.com')) continue
      attendees.push({ email, name: a.displayName, self: a.self, external: !a.self && (email.split('@')[1] !== domain || domain === 'gmail.com') })
    }
    const link = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? (e.location ?? '').match(LINK)?.[0] ?? (e.description ?? '').match(LINK)?.[0]
    const joinUrl = isHttps(link) ? link : undefined
    out.push({
      id: e.id,
      recurringId: e.recurringEventId,
      title: e.summary?.trim() || '(Sans titre)',
      start,
      end: Number.isNaN(end) ? start : end,
      allDay: allDay || undefined,
      description: e.description,
      location: e.location,
      joinUrl,
      attendees,
      external: attendees.some((a) => a.external)
    })
  }
  return out
}

// Mots trop génériques pour dire de quoi parle une réunion.
const MAIL_STOP = new Set(['kickoff', 'reunion', 'meeting', 'point', 'call', 'suivi', 'weekly', 'daily', 'stand', 'update', 'sync', 'avec', 'pour', 'signe', 'devis', 'projet', 'project', 'dans', 'entre', 'chez', 'hilarious'])
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const topicWords = (...texts: (string | undefined)[]) => [...new Set(texts.flatMap((t) => strip(t ?? '').split(/[^a-z0-9]+/)).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !MAIL_STOP.has(w)))].slice(0, 8)

export type MailTopic = { title: string; project?: string; /** Adresses des autres participants. */ participants: string[]; /** Parmi elles, les externes. */ external: string[] }

/** Mails récents sur le sujet de la réunion : mots du titre et du projet, d'abord avec les participants, puis sans. Jamais les seuls collègues. */
export async function googleMails(t: MailTopic, max = 8): Promise<Mail[]> {
  const me = account.toLowerCase()
  const who = (l: string[]) => l.filter((e) => e && e.toLowerCase() !== me).map((a) => `from:${a} OR to:${a}`)
  const words = topicWords(t.title, t.project)
  const people = who(t.participants)
  // Les invitations d’agenda (et leurs mises à jour) ne disent rien de plus que l’événement lui-même.
  const NO_INVITES = '-filename:ics -filename:invite.ics -subject:(Invitation OR "Invitation mise à jour" OR "Updated invitation" OR Accepté OR Accepted OR Refusé OR Declined)'
  const find = async (q: string) => (await api<{ messages?: { id: string }[] }>(`https://www.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: `${q} ${NO_INVITES}`, maxResults: String(max) })}`)).messages ?? []
  let ids: { id: string }[] = []
  if (words.length) {
    const w = `(${words.join(' OR ')})`
    if (people.length) ids = await find(`${w} (${people.join(' OR ')}) newer_than:60d`)
    if (ids.length < 2) {
      const wide = await find(`${w} newer_than:60d`)
      if (wide.length > ids.length) ids = wide
    }
  }
  const ext = who(t.external)
  if (!ids.length && ext.length) ids = await find(`(${ext.join(' OR ')}) newer_than:30d`)
  const out: Mail[] = []
  for (const m of ids.slice(0, max)) {
    const d = await api<{ snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`)
    const h = (n: string) => d.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? ''
    out.push({ subject: h('subject'), from: h('from'), date: Date.parse(h('date')) || 0, snippet: d.snippet ?? '' })
  }
  return out
}
