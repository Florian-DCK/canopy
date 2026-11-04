import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/jetbrains-mono'
import './theme.css'
import './palette.css'
import { Palette } from './Palette'
import { api, useStore } from './store'
import { BrowserHost } from './browser/Host'
import { startBrowserAgent } from './browser/agent'
import { startUiAgent } from './uiAgent'
import { Icon } from './icons'
import { TitleBar } from './titlebar'
import { Rail } from './ui'
import { ChecklistsView } from './views/ChecklistsView'
import { Cockpit } from './views/Cockpit'
import { HistoryView } from './views/HistoryView'
import { ViewerOverlay } from './views/Media'
import { ProjectsView } from './views/ProjectsView'
import { ProjectView } from './views/ProjectView'
import { SessionView } from './views/SessionView'
import { TilesView } from './views/TilesView'
import { ToolsView } from './views/ToolsView'
import { VoiceDock, VoiceView } from './voice/VoiceView'
import { SettingsView } from './views/SettingsView'
import { resolve, useTiles } from './tiles'

function App() {
  const view = useStore((s) => s.view)
  const load = useStore((s) => s.loadProjects)
  useEffect(() => {
    void load()
  }, [load])
  // Mosaïque : la session « regardée » est celle de la case active.
  const tileSession = useTiles((t) => (view.name === 'tiles' ? (resolve(t.cells[t.active] ?? null, useStore.getState().sessions)?.id ?? null) : null))
  useEffect(() => {
    api.setCurrentView(view.name === 'session' ? view.sessionId : tileSession)
  }, [view, tileSession])

  return (
    <TitleBar>
    <div className="app">
      <Rail />
      <div className="stage">
        {/* Le bandeau du moteur reste à droite de la barre latérale : celle-ci ne s'interrompt jamais. */}
        <DaemonBanner />
        {view.name === 'cockpit' && <Cockpit />}
        {view.name === 'project' && <ProjectView projectId={view.projectId} />}
        {view.name === 'session' && <SessionView key={view.sessionId} sessionId={view.sessionId} />}
        {view.name === 'projects' && <ProjectsView />}
        {view.name === 'history' && <HistoryView />}
        {view.name === 'checklists' && <ChecklistsView id={view.id} />}
        {view.name === 'tiles' && <TilesView />}
        {view.name === 'tools' && <ToolsView />}
        {view.name === 'voice' && <VoiceView />}
        {view.name === 'settings' && <SettingsView />}
      </div>
      <BrowserHost />
      <ViewerOverlay />
      <VoiceDock />
      <Palette />
    </div>
    </TitleBar>
  )
}

/** Bandeau pleine largeur : moteur injoignable, ou code du moteur reconstruit (redémarrage quand tout est calme). */
function DaemonBanner() {
  const d = useStore((s) => s.daemon)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState(false)
  if (d.connected && !d.outdated) return null
  if (!d.connected)
    return (
      <div className="banner warn" role="status">
        <Icon name="restart" size={15} className="ico-spin" />
        <b>Moteur injoignable</b>
        <span className="banner-txt">Reconnexion automatique… Les sessions continuent si le moteur tourne encore.</span>
      </div>
    )
  if (hidden) return null
  return (
    <div className="banner" role="status">
      <span className="banner-dot" aria-hidden="true" />
      <b>Moteur modifié</b>
      <span className="banner-txt">
        Redémarre-le pour appliquer les changements ; les sessions reprennent là où elles étaient.
        {d.busy && ' Une session travaille ou attend une autorisation.'}
      </span>
      {err && <span className="banner-txt">{err}</span>}
      <span style={{ flex: 1 }} />
      <button type="button" className="btn clay sm" disabled={d.busy} onClick={() => api.restartDaemon().catch((e) => setErr(String(e?.message ?? e)))}>
        Redémarrer le moteur
      </button>
      <button type="button" className="icon-btn sm" aria-label="Masquer" title="Masquer" onClick={() => setHidden(true)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

startBrowserAgent()
startUiAgent()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
