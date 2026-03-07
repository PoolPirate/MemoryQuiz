import { contextBridge, ipcRenderer } from 'electron';

import type { MemoryQuizApi } from '../lib/types/ipc';

const api: MemoryQuizApi = {
  getAppOverview: () => ipcRenderer.invoke('memoryquiz:get-app-overview'),
  openTakeoutLink: () => ipcRenderer.invoke('memoryquiz:open-takeout-link'),
  pickImportZip: () => ipcRenderer.invoke('memoryquiz:pick-import-zip'),
  importZip: (filePath, allowDuplicate) => ipcRenderer.invoke('memoryquiz:import-zip', filePath, allowDuplicate),
  selectExport: (exportId) => ipcRenderer.invoke('memoryquiz:select-export', exportId),
  renameExport: (exportId, name) => ipcRenderer.invoke('memoryquiz:rename-export', exportId, name),
  deleteExport: (exportId) => ipcRenderer.invoke('memoryquiz:delete-export', exportId),
  reindexExport: (exportId) => ipcRenderer.invoke('memoryquiz:reindex-export', exportId),
  getModeOverview: (exportId) => ipcRenderer.invoke('memoryquiz:get-mode-overview', exportId),
  createLocationRound: (exportId, sessionSeenIds, streak) =>
    ipcRenderer.invoke('memoryquiz:create-location-round', exportId, sessionSeenIds, streak),
  createOlderVsNewerRound: (exportId, sessionSeenIds, streak) =>
    ipcRenderer.invoke('memoryquiz:create-older-newer-round', exportId, sessionSeenIds, streak),
  saveRunResult: (exportId, mode, streak, seenMediaIds) =>
    ipcRenderer.invoke('memoryquiz:save-run-result', exportId, mode, streak, seenMediaIds),
  onImportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on('memoryquiz:import-progress', handler);
    return () => ipcRenderer.removeListener('memoryquiz:import-progress', handler);
  }
};

contextBridge.exposeInMainWorld('memoryQuiz', api);
