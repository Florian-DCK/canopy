import { SandboxBanner } from './session/SandboxBanner'
import '../session.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Item } from '../../../shared/types'
import { BrowserTabView } from '../browser/View'
import { Icon } from '../icons'
import { Splitter, useSessionLayout } from '../layout'
import { api, refreshReadOnly, useStore } from '../store'
import { ArtifactTabView, useArtifactTabs } from './Artifacts'
import { Composer } from './Composer'
import { FindBar, JumpDown, jumpUserMessage, ScrollMarks } from './session/Nav'
import { SessionHeader, SessionList, useWidth, WorkPanel } from './session/Chrome'
import { Thread, TodoCard, useTodos } from './session/Thread'

const NO_ITEMS: Item[] = []
/** En dessous, les panneaux se ferment d'office et l'en-tête se compacte. */
const NARROW = 900

/** Défilement collé au bas tant que tu y es ; si tu remontes lire, on ne te ramène pas de force — sauf à l'envoi. */
function useStickyScroll(deps: unknown[]) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }
  useLayoutEffect(() => {
    if (pinned.current) toBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const onScroll = (el: HTMLDivElement) => {
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  const stick = () => {
    pinned.current = true
    requestAnimationFrame(toBottom)
  }
  return { scroller, pinned, toBottom, onScroll, stick }
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useStore((s) => s.sessions[sessionId])
  const items = useStore((s) => s.items[sessionId] ?? NO_ITEMS)
  const project = useStore((s) => s.projects.find((p) => p.id === session?.projectId))
  const layout = useSessionLayout()
  const { active: activeTab } = useArtifactTabs(sessionId)
  const root = useRef<HTMLDivElement>(null)
  const rootW = useWidth(root)
  const narrow = rootW < NARROW
  const todos = useTodos(items, session)

  // Affichage progressif : les 60 derniers messages, 60 de plus en remontant en haut du fil.
  const PAGE = 60
  const [limit, setLimit] = useState(PAGE)
  const [atBottom, setAtBottom] = useState(true)
  const [finding, setFinding] = useState(false)
  const growFrom = useRef<number | null>(null)
  const { scroller, pinned, toBottom, onScroll, stick } = useStickyScroll([items, session?.status, session?.activity])
  const more = () => {
    growFrom.current = scroller.current?.scrollHeight ?? null
    setLimit((l) => l + PAGE)
  }
  useLayoutEffect(() => {
    // Garde le même message sous les yeux quand les précédents s'insèrent au-dessus.
    const el = scroller.current
    if (el && growFrom.current !== null) el.scrollTop += el.scrollHeight - growFrom.current
    growFrom.current = null
  }, [limit, scroller])
  useLayoutEffect(() => {
    pinned.current = true
    toBottom()
    setLimit(PAGE)
    setAtBottom(true)
    setFinding(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && scroller.current) {
        e.preventDefault()
        setFinding(true)
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && scroller.current) {
        e.preventDefault()
        jumpUserMessage(scroller.current, e.key === 'ArrowUp' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scroller])

  if (!session || !project) return <div className="main" ref={root} />
  const leftOpen = layout.leftOpen && !narrow
  const rightOpen = layout.rightOpen && !narrow
  // Panneau flottant : la conversation garde sa place, sauf si la carte recouvrirait le fil (760 px centrés).
  const convoW = rootW - (leftOpen ? layout.leftW : 0)
  const panelGap = layout.rightW + 24
  const avoid = rightOpen && (convoW - 760) / 2 < panelGap ? panelGap : 0

  return (
    <div className="main session" ref={root}>
      <SessionHeader session={session} project={project} leftOpen={leftOpen} rightOpen={rightOpen} onToggle={layout.toggle} narrow={narrow} />
      {activeTab === 'browser' ? (
        <BrowserTabView sessionId={session.id} />
      ) : activeTab !== 'session' ? (
        <ArtifactTabView sessionId={session.id} url={activeTab} />
      ) : (
        <div className="cols">
          {leftOpen && (
            <>
              <SessionList project={project} current={session.id} width={layout.leftW} />
              <Splitter side="left" width={layout.leftW} onWidth={(leftW) => layout.update({ leftW })} onClose={() => layout.update({ leftOpen: false })} />
            </>
          )}

          <section className="convo" aria-label="Conversation" style={avoid ? { paddingRight: avoid } : undefined}>
            <div
              className="scroll"
              ref={scroller}
              onScroll={(e) => {
                onScroll(e.currentTarget)
                setAtBottom(pinned.current)
                if (e.currentTarget.scrollTop < 150 && growFrom.current === null) more()
              }}
            >
              {todos && (
                <div className="todo-pin">
                  <TodoCard todos={todos} />
                </div>
              )}
              <div className="thread">
                {items.length === 0 && (
                  <div className="empty-session">
                    <h1 className="h1">Nouvelle session sur {project.name}</h1>
                    <p className="sub">Claude Code démarre dans <span className="mono">{project.path}</span> avec ton CLAUDE.md, tes skills et tes hooks.</p>
                  </div>
                )}
                <SandboxBanner session={session} project={project} items={items} />
                <Thread sessionId={session.id} items={items} limit={limit} onMore={more} writing={session.status === 'run' && session.activity?.kind === 'writing'} />
              </div>
            </div>
            {finding && <FindBar scope={scroller} onClose={() => setFinding(false)} />}
            <ScrollMarks scroller={scroller} />
            {!atBottom && <JumpDown waiting={session.status === 'wait'} onClick={stick} />}
            {session.readOnly ? (
              <div className="composer-wrap">
                <div className="composer ro">
                  <Icon name="readonly" size={18} />
                  <span className="ro-txt">
                    <b>Lecture seule.</b> Cette session tourne dans un terminal : Canopy affiche son transcript sans la piloter.
                  </span>
                  <button type="button" className="btn" onClick={() => refreshReadOnly(session)}><Icon name="restart" size={15} />Actualiser</button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      if (window.confirm('Reprendre cette session dans Canopy ? Ferme-la d’abord dans le terminal pour éviter que deux Claude écrivent dans la même conversation.'))
                        void api.takeOver(session.id)
                    }}
                  >
                    Reprendre ici
                  </button>
                </div>
              </div>
            ) : (
              <Composer sessionId={session.id} onSent={stick} />
            )}
          </section>

          {rightOpen && (
            <div className="panel-float" style={{ width: layout.rightW }}>
              <Splitter side="right" width={layout.rightW} onWidth={(rightW) => layout.update({ rightW })} onClose={() => layout.update({ rightOpen: false })} />
              <WorkPanel session={session} items={items} width={layout.rightW} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Chat réduit de la vue artefact : derniers messages et saisie (l'activité vit dans la saisie). */
export function FocusChat({ sessionId, inputId = 'composer-focus' }: { sessionId: string; inputId?: string }) {
  const session = useStore((s) => s.sessions[sessionId])
  const items = useStore((s) => s.items[sessionId] ?? NO_ITEMS)
  const [limit, setLimit] = useState(20)
  const { scroller, onScroll, stick } = useStickyScroll([items, session?.status, session?.activity])
  if (!session) return null
  return (
    <div className="focus-chat">
      <div className="scroll" ref={scroller} onScroll={(e) => onScroll(e.currentTarget)}>
        <div className="thread focus-thread">
          <Thread sessionId={sessionId} items={items} limit={limit} onMore={() => setLimit((l) => l + 20)} writing={session.status === 'run' && session.activity?.kind === 'writing'} />
        </div>
      </div>
      {!session.readOnly && <Composer sessionId={sessionId} inputId={inputId} onSent={stick} />}
    </div>
  )
}
