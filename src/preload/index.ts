import { contextBridge, ipcRenderer } from 'electron';

import type { MemoryQuizApi } from '../lib/types/ipc';

const api: MemoryQuizApi = {
  getAppOverview: () => ipcRenderer.invoke('memoryquiz:get-app-overview'),
  openTakeoutLink: () => ipcRenderer.invoke('memoryquiz:open-takeout-link'),
  pickImportZip: () => ipcRenderer.invoke('memoryquiz:pick-import-zip'),
  previewImportZip: (filePath) => ipcRenderer.invoke('memoryquiz:preview-import-zip', filePath),
  importZip: (preview, libraryName, allowDuplicate) =>
    ipcRenderer.invoke('memoryquiz:import-zip', preview, libraryName, allowDuplicate),
  selectExport: (exportId) => ipcRenderer.invoke('memoryquiz:select-export', exportId),
  renameExport: (exportId, name) => ipcRenderer.invoke('memoryquiz:rename-export', exportId, name),
  deleteExport: (exportId) => ipcRenderer.invoke('memoryquiz:delete-export', exportId),
  getModeOverview: (exportId) => ipcRenderer.invoke('memoryquiz:get-mode-overview', exportId),
  createLocationRound: (exportId, sessionSeenIds, streak) =>
    ipcRenderer.invoke('memoryquiz:create-location-round', exportId, sessionSeenIds, streak),
  createOlderVsNewerRound: (exportId, sessionSeenIds) =>
    ipcRenderer.invoke('memoryquiz:create-older-newer-round', exportId, sessionSeenIds),
  createTimelineSortRound: (exportId, sessionSeenIds, currentMediaIds) =>
    ipcRenderer.invoke('memoryquiz:create-timeline-sort-round', exportId, sessionSeenIds, currentMediaIds),
  deleteMedia: (exportId, mediaId) => ipcRenderer.invoke('memoryquiz:delete-media', exportId, mediaId),
  saveRunResult: (exportId, mode, streak, seenMediaIds) =>
    ipcRenderer.invoke('memoryquiz:save-run-result', exportId, mode, streak, seenMediaIds),
  saveSeenMediaIds: (exportId, mode, streak, seenMediaIds, pendingRound) =>
    ipcRenderer.invoke('memoryquiz:save-seen-media-ids', exportId, mode, streak, seenMediaIds, pendingRound),
  onImportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on('memoryquiz:import-progress', handler);
    return () => ipcRenderer.removeListener('memoryquiz:import-progress', handler);
  }
};

contextBridge.exposeInMainWorld('memoryQuiz', api);
