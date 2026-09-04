import { contextBridge, ipcRenderer } from 'electron'
import type { AgentId, AppSettings, FolderRule, OwnerComment, SpecDriveApi } from '../shared/types'

const api: SpecDriveApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getMcpInfo: () => ipcRenderer.invoke('mcp:info'),
  getProject: (id: string) => ipcRenderer.invoke('projects:get', id),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  connectAgent: (id: AgentId) => ipcRenderer.invoke('agents:connect', id),
  verifyAgent: (id: AgentId) => ipcRenderer.invoke('agents:verify', id),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  readWireframe: (projectId: string, file: string) =>
    ipcRenderer.invoke('wireframe:read', projectId, file),
  readDocument: (projectId: string, file: string) =>
    ipcRenderer.invoke('document:read', projectId, file),
  readImage: (projectId: string, file: string) =>
    ipcRenderer.invoke('document:read-image', projectId, file),
  addImage: (projectId: string, name: string, dataBase64: string) =>
    ipcRenderer.invoke('document:add-image', projectId, name, dataBase64),
  addComment: (projectId: string, target: OwnerComment['target'], text: string) =>
    ipcRenderer.invoke('comment:add', projectId, target, text),
  setSyncAgentsMd: (projectId: string, on: boolean) =>
    ipcRenderer.invoke('project:set-sync-agents-md', projectId, on),
  revealProject: (projectId: string) => ipcRenderer.invoke('project:reveal', projectId),
  rerunChecks: (projectId: string) => ipcRenderer.invoke('project:rerun-checks', projectId),
  listWaiting: () => ipcRenderer.invoke('waiting:list'),
  listFolders: () => ipcRenderer.invoke('folders:list'),
  createFolder: (
    name: string,
    description: string,
    rules: FolderRule[],
    presets: string[],
    parentId?: string | null
  ) => ipcRenderer.invoke('folders:create', name, description, rules, presets, parentId ?? null),
  updateFolder: (id: string, patch: { name?: string; description?: string; parentId?: string | null }) =>
    ipcRenderer.invoke('folders:update', id, patch),
  moveFolder: (id: string, parentId: string | null) =>
    ipcRenderer.invoke('folders:move', id, parentId),
  setFolderRules: (id: string, rules: FolderRule[]) =>
    ipcRenderer.invoke('folders:set-rules', id, rules),
  deleteFolder: (id: string) => ipcRenderer.invoke('folders:delete', id),
  assignProjectFolder: (projectId: string, folderId: string | null) =>
    ipcRenderer.invoke('project:assign-folder', projectId, folderId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch),
  getAbout: () => ipcRenderer.invoke('app:about'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  revealInFinder: (what: 'data' | 'server') => ipcRenderer.invoke('shell:reveal', what),
  onProjectsChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('projects:changed', listener)
    return () => ipcRenderer.removeListener('projects:changed', listener)
  },
  onFullScreenChanged: (cb: (on: boolean) => void) => {
    const listener = (_: unknown, on: boolean): void => cb(on)
    ipcRenderer.on('window:fullscreen', listener)
    return () => ipcRenderer.removeListener('window:fullscreen', listener)
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('specdrive', api)
