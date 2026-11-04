import '../session.css'
import '../tools.css'
import { useEffect, useMemo, useState } from 'react'
import type { AgentFile, MemoryList, ToolsInventory } from '../../../shared/types'
import { Icon } from '../icons'
import { api, useStore } from '../store'
import { Tile, TopBar } from '../ui'
import { FocusChat } from './SessionView'
import { MemoryDetail, MemoryPane } from './MemoryTab'
import { AgentSide, AgentsPane, type AgentSel } from './AgentsTab'

// « Outils de Claude » (planche 20) : ce que Claude charge avant ton premier mot, skill par skill et
// serveur par serveur, mesuré sur une session ouverte du projet ; activer / couper ; une mini-session par élément.

type Tab = 'skills' | 'mcp' | 'agents' | 'memory'
type Row = { key: string; name: string; source: string; tokens: number; enabled: boolean; state: string; extra: string; toggle?: () => Promise<void> }

const CAT_COLOR: Record<string, string> = {
  system_prompt: 'var(--g400)',
  system_tools: 'var(--g550)',
  system_tools_deferred: 'var(--g300)',
  mcp_tools: 'var(--blue)',
  mcp_instructions: 'color-mix(in srgb, var(--blue) 60%, transparent)',
  mcp_tools_deferred: 'color-mix(in srgb, var(--blue) 35%, transparent)',
  skills: 'var(--clay)',
  custom_agents: '#E8C07A',
  memory_files: 'var(--st-ok)',
  autocompact_buffer: 'var(--g200)',
  compact_buffer: 'var(--g200)'
}
/** Libellés français des catégories de contexte (identifiants du SDK). */
const CAT_NAME: Record<string, string> = {
  system_prompt: 'Consignes système',
  system_tools: 'Outils intégrés',
  mcp_tools: 'Outils MCP',
  mcp_instructions: 'Consignes des serveurs MCP',
  skills: 'Skills',
  custom_agents: 'Agents',
  memory_files: 'CLAUDE.md et mémoire'
}
/** Au démarrage : on écarte ce qui n'est chargé qu'à la demande (différé) et les réserves de compactage. */
const atStartup = (id: string) => !/deferred|buffer/.test(id)
const SOURCE_NAME: Record<string, string> = {
  'built-in': 'intégré',
  builtin: 'intégré',
  userSettings: 'perso',
  projectSettings: 'projet',
  localSettings: 'projet (local)',
  syncedSkills: 'claude.ai',
  policySettings: 'organisation',
  user: 'utilisateur',
  project: 'projet',
  local: 'projet (local)',
  dynamic: 'session',
  sdk: 'Canopy',
  claudeai: 'claude.ai',
  plugin: 'plugin'
}
const sourceName = (s: string) => SOURCE_NAME[s] ?? s

const STATE_WORD: Record<string, string> = { connected: 'connecté', failed: 'en échec', 'needs-auth': 'à authentifier', pending: 'connexion…', disabled: 'coupé ici' }
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n))

const MINI_KEY = 'atelier.tools.minis'
const loadMinis = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(MINI_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function ToolsView() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  // Projet par défaut : celui de la session la plus récente.
  const recent = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const [projectId, setProjectId] = useState<string | undefined>(recent?.projectId ?? projects[0]?.id)
  const [inv, setInv] = useState<ToolsInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('skills')
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [mem, setMem] = useState<MemoryList | null>(null)
  const loadMem = (id = projectId) => id && void api.listMemory(id).then(setMem).catch(() => setMem(null))
  useEffect(() => {
    setMem(null)
    if (tab === 'memory') loadMem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tab])
  // Agents custom : lus dans les fichiers (les miens et ceux du projet), avec leur état pour ce projet.
  const [agents, setAgents] = useState<AgentFile[] | null>(null)
  const [agentSel, setAgentSel] = useState<AgentSel | null>(null)
  const loadAgents = async (keep?: AgentFile) => {
    if (!projectId) return
    const list = await api.listAgents(projectId).catch(() => [] as AgentFile[])
    setAgents(list)
    if (keep) setAgentSel({ kind: 'file', agent: list.find((a) => a.path === keep.path) ?? keep })
  }
  useEffect(() => {
    setAgents(null)
    setAgentSel(null)
    void loadAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])
  const toggleAgent = async (a: AgentFile) => {
    if (!projectId) return
    await api.setAgentEnabled(projectId, a.name, !a.enabled)
    setAgents((cur) => cur && cur.map((x) => (x.path === a.path ? { ...x, enabled: !a.enabled } : x)))
    setAgentSel((s) => (s?.kind === 'file' && s.agent.path === a.path ? { kind: 'file', agent: { ...s.agent, enabled: !a.enabled } } : s))
  }

  const measure = async (id = projectId, force = false) => {
    if (!id) return
    setLoading(true)
    try {
      setInv(await api.toolsInventory(id, force))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projects, projectId])
  useEffect(() => {
    setInv(null)
    void measure(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const project = projects.find((p) => p.id === projectId)
  const rows: Row[] = useMemo(() => {
    if (!inv) return []
    const list: Row[] =
      tab === 'skills'
        ? inv.skills.map((s) => ({
            key: `skill:${s.name}`,
            name: s.name,
            source: s.plugin ? `plugin ${s.plugin}` : sourceName(s.source),
            tokens: s.tokens,
            enabled: s.enabled,
            state: s.enabled ? 'actif' : 'désactivé',
            extra: s.path ?? '',
            toggle: async () => {
              await api.setSkillEnabled(s.name, !s.enabled)
              setInv((cur) => cur && { ...cur, skills: cur.skills.map((x) => (x.name === s.name ? { ...x, enabled: !s.enabled } : x)) })
            }
          }))
        : tab === 'mcp'
          ? inv.mcp.map((m) => ({
              key: `mcp:${m.name}`,
              name: m.name,
              source: m.name.startsWith('claude.ai ') ? 'claude.ai' : sourceName(m.scope ?? ''),
              tokens: m.tokens,
              enabled: m.enabled,
              state: m.enabled ? (STATE_WORD[m.status] ?? m.status) : 'coupé ici',
              extra: m.tools.length ? `${m.tools.length} outil${m.tools.length > 1 ? 's' : ''}${m.deferred ? ' · différés' : ''}` : '—',
              toggle: async () => {
                if (!projectId) return
                await api.setMcpEnabled(projectId, m.name, !m.enabled)
                setInv((cur) => cur && { ...cur, mcp: cur.mcp.map((x) => (x.name === m.name ? { ...x, enabled: !m.enabled } : x)) })
              }
            }))
          : inv.agents.map((a) => ({ key: `agent:${a.name}`, name: a.name, source: sourceName(a.source), tokens: a.tokens, enabled: true, state: 'actif', extra: '' }))
    const q = filter.trim().toLowerCase()
    return list.filter((r) => !q || r.name.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
  }, [inv, tab, filter, projectId])
  const cur = rows.find((r) => r.key === sel) ?? rows[0]
  const memCur = mem?.items.find((m) => m.file === sel) ?? mem?.items[0]
  const max = Math.max(1, ...rows.map((r) => r.tokens))
  const cats = (inv?.categories ?? []).filter((c) => atStartup(c.id) && c.tokens > 0)
  const startup = cats.reduce((n, c) => n + c.tokens, 0)

  return (
    <div className="main tools">
      <TopBar>
        Canopy / <b>Outils de Claude</b>
      </TopBar>
      <div className="tools-body">
        <main className="tools-main">
          <div className="tools-top">
            <label className="tools-proj">
              <span className="muted small">Vus depuis</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {project && <Tile project={project} size={22} />}
            <span className="small muted">{loading ? 'mesure… (quelques secondes sans session ouverte)' : inv?.measuredAt ? `mesuré sur « ${inv.sessionTitle} » · ${new Date(inv.measuredAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn sm" disabled={loading} onClick={() => void measure(projectId, true)}>
              <Icon name="restart" size={14} />Mesurer
            </button>
          </div>

          {inv && !inv.measuredAt && !loading && (
            <div className="tools-empty">
              <b>La mesure n’a pas abouti.</b> Claude Code n’a pas pu être lancé dans {project?.name ?? 'ce projet'} pour la mesure : réessaie avec « Mesurer ». Les éléments désactivés restent listés ci-dessous.
            </div>
          )}

          {inv?.measuredAt && (
            <section className="tools-budget" aria-label="Contexte de départ">
              <div className="tools-budget-h">
                <h1 className="h2">Ce que Claude charge avant ton premier mot</h1>
                <span className="small muted">
                  <b>{k(startup)}</b> tokens{inv.max ? ` sur ${k(inv.max)} · ${Math.round((startup / inv.max) * 100)} %` : ''}
                </span>
              </div>
              <div className="tools-bar" role="img" aria-label="Répartition du contexte de départ">
                {cats.map((c) => (
                  <span key={c.id} title={`${CAT_NAME[c.id] ?? c.name} · ${c.tokens} tokens`} style={{ width: `${(c.tokens / Math.max(1, startup)) * 100}%`, background: CAT_COLOR[c.id] ?? 'var(--g400)' }} />
                ))}
              </div>
              <div className="tools-legend">
                {cats.map((c) => (
                  <span key={c.id}><i style={{ background: CAT_COLOR[c.id] ?? 'var(--g400)' }} />{CAT_NAME[c.id] ?? c.name} <b>{k(c.tokens)}</b></span>
                ))}
              </div>
            </section>
          )}

          <div className="tools-bar2">
            <span className="seg" role="tablist" aria-label="Catégorie">
              {(['skills', 'mcp', 'agents', 'memory'] as Tab[]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => { setTab(t); setSel(null) }}>
                  {t === 'skills' ? 'Skills' : t === 'mcp' ? 'Serveurs MCP' : t === 'agents' ? 'Agents' : 'Mémoire'} <span className="muted">{t === 'memory' ? (mem?.items.length ?? '') : t === 'agents' ? (agents ? agents.length + (inv?.agents.filter((a) => !agents.some((f) => f.name === a.name)).length ?? 0) : '') : inv ? (t === 'skills' ? inv.skills.length : inv.mcp.length) : ''}</span>
                </button>
              ))}
            </span>
            <label className="tools-filter">
              <span className="sr-only">Filtrer</span>
              <Icon name="search" size={14} />
              <input value={filter} placeholder="Filtrer…" onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>

          {tab === 'memory' && (
            <MemoryPane mem={mem} inv={inv} filter={filter} sel={memCur?.file} onSel={setSel} projectName={project?.name ?? 'ce projet'} />
          )}
          {tab === 'agents' && (
            <AgentsPane agents={agents} inv={inv} filter={filter} sel={agentSel ?? (agents?.[0] ? { kind: 'file', agent: agents[0] } : null)} onSel={setAgentSel} onToggle={(a) => void toggleAgent(a)} />
          )}
          {tab !== 'memory' && tab !== 'agents' && (
          <div className="tools-table" role="list" aria-label="Éléments">
            {rows.length === 0 && <div className="empty">{loading ? 'Mesure en cours…' : 'Rien à afficher.'}</div>}
            {rows.map((r) => (
              <div key={r.key} role="listitem" className={`tools-row ${cur?.key === r.key ? 'on' : ''} ${r.enabled ? '' : 'off'}`}>
                {r.toggle ? (
                  <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.enabled ? 'Désactiver' : 'Activer'} ${r.name}`} className="tools-switch" onClick={() => void r.toggle!()}>
                    <span />
                  </button>
                ) : (
                  <span className="tools-switch ghost" aria-hidden="true" />
                )}
                <button type="button" className="tools-pick" onClick={() => setSel(r.key)}>
                  <b>{r.name}</b>
                  <span className="tools-src">{r.source}</span>
                  <span className={`tools-state ${r.state.replace(/\s/g, '-')}`}>{r.state}</span>
                  <span className="tools-cost">
                    <i style={{ width: `${(r.tokens / max) * 80}px`, opacity: r.tokens ? 1 : 0 }} />
                    {r.tokens ? k(r.tokens) : '—'}
                  </span>
                  <span className="tools-extra" title={r.extra}>{tab === 'skills' ? '' : r.extra}</span>
                </button>
              </div>
            ))}
          </div>
          )}
        </main>

        {tab !== 'memory' && tab !== 'agents' && cur && inv && <ToolDetail key={cur.key} row={cur} tab={tab} inv={inv} projectId={projectId} />}
        {tab === 'agents' && projectId && (agentSel ?? (agents?.[0] ? { kind: 'file' as const, agent: agents[0] } : null)) && (
          <AgentSide sel={(agentSel ?? { kind: 'file', agent: agents![0] }) as AgentSel} projectId={projectId} projectName={project?.name ?? 'ce projet'} onSel={setAgentSel} onChanged={(keep) => void loadAgents(keep)} />
        )}
        {tab === 'memory' && memCur && projectId && (
          <aside className="tools-side" aria-label={`Souvenir ${memCur.name}`}>
            <MemoryDetail key={memCur.file} m={memCur} projectId={projectId} onChanged={() => loadMem()} />
            <MiniSession
              itemKey={`memory:${projectId}:${memCur.file}`}
              kind="Souvenir"
              name={memCur.name}
              path={mem ? `${mem.dir}\\${memCur.file}` : undefined}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

function ToolDetail({ row, tab, inv, projectId }: { row: Row; tab: Tab; inv: ToolsInventory; projectId?: string }) {
  const mcp = tab === 'mcp' ? inv.mcp.find((m) => `mcp:${m.name}` === row.key) : undefined
  const skill = tab === 'skills' ? inv.skills.find((s) => `skill:${s.name}` === row.key) : undefined
  const kind = tab === 'skills' ? 'Skill' : tab === 'mcp' ? 'Serveur MCP' : 'Agent'
  const openFile = async () => {
    if (!skill?.path) return
    const cfg = await api.configProject()
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const root = norm(cfg.path)
    if (norm(skill.path).startsWith(root + '/')) void api.openInEditor(cfg.id, skill.path.slice(cfg.path.length + 1))
  }
  return (
    <aside className="tools-side" aria-label={`Détail de ${row.name}`}>
      <div className="tools-detail">
        <span className="side-h">{kind} · {row.source}</span>
        <h2 className="tools-name">{row.name}</h2>
        {mcp?.error && <p className="tools-err">{mcp.error}</p>}
        <dl className="tools-facts">
          <div><dt>Coût au démarrage</dt><dd>{row.tokens ? `${row.tokens} tokens` : '—'}</dd></div>
          <div><dt>État</dt><dd>{row.state}</dd></div>
          {skill?.path && <div className="wide"><dt>Fichier</dt><dd className="mono" title={skill.path}>{skill.path}</dd></div>}
        </dl>
        {mcp && mcp.tools.length > 0 && (
          <div className="tools-tools">
            {mcp.tools.slice(0, 12).map((t) => (
              <span key={t.name}>
                <code>{t.name}</code>
                <em className={t.destructive ? 'bad' : t.readOnly ? 'ok' : ''}>{t.destructive ? 'destructif' : t.readOnly ? 'lecture' : 'agit'}</em>
                {t.tokens > 0 && <small>{t.tokens}</small>}
              </span>
            ))}
            {mcp.tools.length > 12 && <small className="muted">+ {mcp.tools.length - 12} autres</small>}
          </div>
        )}
        <div className="tools-acts">
          {row.toggle && <button type="button" className="btn sm" onClick={() => void row.toggle!()}>{row.enabled ? (tab === 'mcp' ? 'Couper pour ce projet' : 'Désactiver') : 'Activer'}</button>}
          {skill?.path && <button type="button" className="btn sm" onClick={() => void openFile()}><Icon name="external" size={14} />Ouvrir le fichier</button>}
          {mcp && projectId && <button type="button" className="btn sm" onClick={() => void api.reconnectMcp(projectId, mcp.name)}><Icon name="restart" size={14} />Reconnecter</button>}
        </div>
      </div>
      <MiniSession itemKey={row.key} kind={kind} name={row.name} path={skill?.path} />
    </aside>
  )
}

const CHIPS: Record<string, string[]> = {
  Skill: ['Explique ce qu’il fait', 'Améliore sa description', 'Teste-le sur un exemple', 'Réduis son coût'],
  'Serveur MCP': ['Pourquoi il échoue ?', 'Quels outils me servent vraiment ?', 'Le configurer pour ce projet'],
  Agent: ['Explique ce qu’il fait', 'Quand l’utiliser ?'],
  Souvenir: ['Est-il encore vrai ?', 'Reformule-le plus court', 'Fusionne les doublons', 'Range-le dans le bon projet']
}

/** Mini-session sur un élément : une vraie session Canopy dans ~/.claude, mémorisée par élément. */
function MiniSession({ itemKey, kind, name, path }: { itemKey: string; kind: string; name: string; path?: string }) {
  const [minis, setMinis] = useState(loadMinis)
  const sid = minis[itemKey]
  const live = useStore((s) => (sid ? s.sessions[sid] : undefined))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      let id = live?.id
      if (!id) {
        const cfg = await api.configProject()
        const s = await api.createSession(cfg.id)
        const st = useStore.getState()
        if (!st.sessions[s.id]) st.apply({ type: 'session:created', session: s })
        id = s.id
        const next = { ...loadMinis(), [itemKey]: id }
        try {
          localStorage.setItem(MINI_KEY, JSON.stringify(next))
        } catch {
          /* stockage indisponible */
        }
        setMinis(next)
        const ctx = `[${kind} « ${name} »${path ? ` — ${path}` : ''}. Avant de modifier un fichier hors du dépôt Git de ~/.claude, garde-en une copie .bak à côté.] `
        await api.send(id, ctx + t)
      } else await api.send(id, t)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tools-mini">
      <div className="side-h tools-mini-h">
        <span className="tools-mini-dot" aria-hidden="true" />Demander à Claude sur {name}
        <span style={{ flex: 1 }} />
        {live && (
          <button type="button" className="icon-btn sm" title="Ouvrir en session complète" aria-label="Ouvrir en session complète" onClick={() => useStore.getState().go({ name: 'session', sessionId: live.id })}>
            <Icon name="expand" size={14} />
          </button>
        )}
      </div>
      {live ? (
        <>
          <div className="tools-chips">
            {(CHIPS[kind] ?? []).map((c) => (
              <button key={c} type="button" onClick={() => void api.send(live.id, c)}>{c}</button>
            ))}
          </div>
          <div className="tools-chat">
            <FocusChat sessionId={live.id} inputId="composer-tools" />
          </div>
        </>
      ) : (
        <div className="tools-mini-start">
          <div className="tools-chips">
            {(CHIPS[kind] ?? []).map((c) => (
              <button key={c} type="button" disabled={busy} onClick={() => void ask(c)}>{c}</button>
            ))}
          </div>
          <form
            className="tools-ask"
            onSubmit={(e) => {
              e.preventDefault()
              void ask(draft)
            }}
          >
            <label className="sr-only" htmlFor="tools-ask">Question à Claude</label>
            <input id="tools-ask" value={draft} placeholder={`Demande à Claude à propos de ${name}…`} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn clay sm" disabled={busy || !draft.trim()} aria-label="Envoyer"><Icon name="send" size={15} /></button>
          </form>
          <p className="small muted">Une session dédiée s’ouvre dans ~/.claude (projet « Config Claude Code ») : elle connaît déjà cet élément.</p>
        </div>
      )}
    </div>
  )
}
