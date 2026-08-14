import { contextBridge, ipcRenderer } from 'electron'
import type { AgentId, SpecDriveApi } from '../shared/types'

const api: SpecDriveApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getMcpInfo: () => ipcRenderer.invoke('mcp:info'),
  getProject: (id: string) => ipcRenderer.invoke('projects:get', id),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  connectAgent: (id: AgentId) => ipcRenderer.invoke('agents:connect', id),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  readWireframe: (projectId: string, file: string) =>
    ipcRenderer.invoke('wireframe:read', projectId, file),
  readDocument: (projectId: string, file: string) =>
    ipcRenderer.invoke('document:read', projectId, file),
  onProjectsChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('projects:changed', listener)
    return () => ipcRenderer.removeListener('projects:changed', listener)
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('specdrive', api)
