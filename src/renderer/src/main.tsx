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
import { ViewSwitcher } from './ViewSwitcher'
import { SettingsView } from './views/SettingsView'
import { Setup, useSetupGate } from './views/Setup'
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
        <SetupBanner />
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
      <ViewSwitcher />
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

/** Lancements suivants (planche 43) : une fonction cochée ne peut pas marcher tant que l'installation n'est pas finie. */
function SetupBanner() {
  const { status, ignored, ignore, reopen } = useSetupGate()
  if (ignored || !status || !status.done || status.legacy || !status.features) return null
  const f = status.features
  const p = status.permissions
  const mac = status.platform === 'darwin'
  const why: string[] = []
  if (f.voice && !status.voice.installed) why.push('la voix n’est pas installée')
  if (mac && (f.companion || f.capture) && p.screen !== 'granted') why.push('l’Enregistrement de l’écran n’est pas autorisé')
  if (mac && f.companion && p.accessibility !== 'granted') why.push('l’Accessibilité n’est pas autorisée')
  if (!why.length) return null
  return (
    <div className="banner" role="status">
      <span className="banner-dot" aria-hidden="true" />
      <b>Installation à finir</b>
      <span className="banner-txt">{why.join(' ; ')}.</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="btn clay sm" onClick={() => void reopen()}>Régler</button>
      <button type="button" className="btn ghost sm" onClick={ignore}>Ignorer</button>
    </div>
  )
}

/** Le setup ne s'affiche que si le statut est connu et done=false ; sinon (inconnu, erreur) l'app normale. */
function Root() {
  const show = useSetupGate((g) => g.show)
  const refresh = useSetupGate((g) => g.refresh)
  const preview = useSetupGate((g) => g.preview)
  const closePreview = useSetupGate((g) => g.closePreview)
  useEffect(() => void refresh(), [refresh])
  if (show) return <TitleBar><Setup key={preview ? 'preview' : 'setup'} preview={preview} onDone={preview ? closePreview : () => void refresh()} /></TitleBar>
  return <App />
}

startBrowserAgent()
startUiAgent()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
