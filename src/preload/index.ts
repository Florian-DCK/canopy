import { contextBridge, ipcRenderer } from 'electron'
import type { AppState } from '../shared/state'
import type { AppEvent, AtelierApi, ToastApi, ToastState } from '../shared/types'

const api: AtelierApi = {
  listFiles: (projectId) => ipcRenderer.invoke('files:list', projectId),
  listCommands: (sessionId) => ipcRenderer.invoke('commands:list', sessionId),
  listChecklists: () => ipcRenderer.invoke('checklists:list'),
  getChecklist: (id) => ipcRenderer.invoke('checklists:get', id),
  createChecklist: (projectId, title, items, sessionId) => ipcRenderer.invoke('checklists:create', projectId, title, items, sessionId),
  updateChecklist: (id, ops) => ipcRenderer.invoke('checklists:update', id, ops),
  deleteChecklist: (id) => ipcRenderer.invoke('checklists:delete', id),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  renameProject: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
  createSession: (projectId, model) => ipcRenderer.invoke('session:create', projectId, model),
  listHistory: () => ipcRenderer.invoke('history:list'),
  resumeSession: (projectId, sdkId, title, readOnly, fork) => ipcRenderer.invoke('session:resume', projectId, sdkId, title, readOnly, fork),
  addProjectPath: (path) => ipcRenderer.invoke('projects:addPath', path),
  takeOver: (id) => ipcRenderer.invoke('session:takeover', id),
  setModel: (id, model) => ipcRenderer.invoke('session:model', id, model),
  send: (id, text, attachments) => ipcRenderer.invoke('session:send', id, text, attachments),
  openMedia: (id) => ipcRenderer.invoke('media:open', id),
  openInEditor: (projectId, relPath, line) => ipcRenderer.invoke('editor:open', projectId, relPath, line),
  showMediaInFolder: (id) => ipcRenderer.invoke('media:folder', id),
  interrupt: (id) => ipcRenderer.invoke('session:interrupt', id),
  closeSession: (id) => ipcRenderer.invoke('session:close', id),
  setPermissionMode: (id, mode) => ipcRenderer.invoke('session:mode', id, mode),
  respondPermission: (id, permId, d) => ipcRenderer.invoke('permission:respond', id, permId, d),
  answerQuestion: (id, itemId, a) => ipcRenderer.invoke('question:answer', id, itemId, a),
  backgroundTask: (id, toolUseId) => ipcRenderer.invoke('task:background', id, toolUseId),
  stopTask: (id, taskId) => ipcRenderer.invoke('task:stop', id, taskId),
  toolsInventory: (projectId, force) => ipcRenderer.invoke('tools:inventory', projectId, force),
  setSkillEnabled: (name, enabled) => ipcRenderer.invoke('tools:skill', name, enabled),
  setMcpEnabled: (projectId, name, enabled) => ipcRenderer.invoke('tools:mcp', projectId, name, enabled),
  listAgents: (projectId) => ipcRenderer.invoke('agents:list', projectId),
  saveAgent: (projectId, agent, oldPath) => ipcRenderer.invoke('agents:save', projectId, agent, oldPath),
  deleteAgent: (path) => ipcRenderer.invoke('agents:delete', path),
  setAgentEnabled: (projectId, name, enabled) => ipcRenderer.invoke('agents:enable', projectId, name, enabled),
  draftAgent: (text) => ipcRenderer.invoke('agents:draft', text),
  reconnectMcp: (projectId, name) => ipcRenderer.invoke('tools:reconnect', projectId, name),
  listMemory: (projectId) => ipcRenderer.invoke('memory:list', projectId),
  writeMemory: (projectId, file, raw) => ipcRenderer.invoke('memory:write', projectId, file, raw),
  forgetMemory: (projectId, file) => ipcRenderer.invoke('memory:forget', projectId, file),
  moveMemory: (projectId, file, to) => ipcRenderer.invoke('memory:move', projectId, file, to),
  configProject: () => ipcRenderer.invoke('tools:configProject'),
  taskOutput: (id, itemId) => ipcRenderer.invoke('task:output', id, itemId),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  setCurrentView: (sessionId) => ipcRenderer.send('view:current', sessionId),
  onEvent: (cb) => {
    const h = (_: unknown, e: AppEvent, seq: number) => cb(e, seq)
    ipcRenderer.on('atelier:event', h)
    return () => ipcRenderer.removeListener('atelier:event', h)
  },
  onSnapshot: (cb) => {
    const h = (_: unknown, s: AppState) => cb(s)
    ipcRenderer.on('atelier:snapshot', h)
    return () => ipcRenderer.removeListener('atelier:snapshot', h)
  },
  snapshot: () => ipcRenderer.invoke('state:snapshot'),
  daemonStatus: () => ipcRenderer.invoke('daemon:status'),
  onDaemon: (cb) => {
    const h = (_: unknown, s: { connected: boolean; outdated: boolean; busy: boolean }) => cb(s)
    ipcRenderer.on('atelier:daemon', h)
    return () => ipcRenderer.removeListener('atelier:daemon', h)
  },
  restartDaemon: (force) => ipcRenderer.invoke('daemon:restart', force),
  windowState: () => ipcRenderer.invoke('win:state'),
  onWindowState: (cb) => {
    const h = (_: unknown, s: { maximized: boolean; focused: boolean }) => cb(s)
    ipcRenderer.on('win:state', h)
    return () => ipcRenderer.removeListener('win:state', h)
  },
  windowControl: (action) => ipcRenderer.send('win:control', action),
  getNotif: () => ipcRenderer.invoke('notif:get'),
  setNotif: (patch) => ipcRenderer.invoke('notif:set', patch),
  silenceNotif: (minutes) => ipcRenderer.invoke('notif:silence', minutes),
  unmuteProject: (projectId) => ipcRenderer.invoke('notif:unmute', projectId),
  onNotifSettings: (cb) => {
    const h = () => cb()
    ipcRenderer.on('notif:changed', h)
    return () => ipcRenderer.removeListener('notif:changed', h)
  },
  onOpenNotifSettings: (cb) => {
    const h = () => cb()
    ipcRenderer.on('notif:open-settings', h)
    return () => ipcRenderer.removeListener('notif:open-settings', h)
  },
  onBrowserRequest: (cb) => {
    const h = (_: unknown, req: Parameters<typeof cb>[0]) => cb(req)
    ipcRenderer.on('browser:request', h)
    return () => ipcRenderer.removeListener('browser:request', h)
  },
  browserResult: (id, r) => ipcRenderer.send('browser:result', id, r),
  onUiRequest: (cb) => {
    const h = (_: unknown, req: Parameters<typeof cb>[0]) => cb(req)
    ipcRenderer.on('ui:request', h)
    return () => ipcRenderer.removeListener('ui:request', h)
  },
  uiResult: (id, r) => ipcRenderer.send('ui:result', id, r),
  voiceStart: (voice) => ipcRenderer.invoke('voice:start', voice),
  companionSet: (state) => ipcRenderer.send('companion:set', state),
  companionResume: () => ipcRenderer.invoke('companion:resume'),
  showWindow: () => ipcRenderer.send('win:show'),
  actStop: () => ipcRenderer.send('act:stop'),
  voiceDuck: (on, factor) => ipcRenderer.send('voice:duck', on, factor),
  getCompanionPrefs: () => ipcRenderer.invoke('companion:prefs'),
  setCompanionPrefs: (p) => ipcRenderer.invoke('companion:prefs', p),
  companionResetPosition: () => ipcRenderer.send('companion:reset-position'),
  onCompanionCommand: (cb) => {
    const h = (_: unknown, c: Parameters<typeof cb>[0]) => cb(c)
    ipcRenderer.on('companion:command', h)
    return () => ipcRenderer.removeListener('companion:command', h)
  },
  voiceStop: () => ipcRenderer.invoke('voice:stop')
}

const toast: ToastApi = {
  onState: (cb) => {
    const h = (_: unknown, s: ToastState) => cb(s)
    ipcRenderer.on('toasts:state', h)
    return () => ipcRenderer.removeListener('toasts:state', h)
  },
  action: (a) => ipcRenderer.send('toasts:action', a),
  size: (height) => ipcRenderer.send('toasts:size', height),
  drag: (phase, x, y) => ipcRenderer.send('companion:drag', phase, x, y),
  companion: (c) => ipcRenderer.send('companion:command', c),
  mouse: (inside) => ipcRenderer.send('toasts:mouse', inside),
  onLook: (cb) => {
    const h = (_: unknown, title: string) => cb(title)
    ipcRenderer.on('companion:look', h)
    return () => ipcRenderer.removeListener('companion:look', h)
  },
  ready: () => ipcRenderer.send('toasts:ready')
}

contextBridge.exposeInMainWorld('atelier', api)
contextBridge.exposeInMainWorld('atelierToast', toast)
