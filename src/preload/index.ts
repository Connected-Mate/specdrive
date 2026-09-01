import { contextBridge, ipcRenderer } from 'electron'
import type { AgentId, OwnerComment, SpecDriveApi } from '../shared/types'

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
  exportProject: (projectId: string) => ipcRenderer.invoke('project:export', projectId),
  onProjectsChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('projects:changed', listener)
    return () => ipcRenderer.removeListener('projects:changed', listener)
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('specdrive', api)
