import path from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';
import { pathToFileURL } from 'node:url';

import type { ImportPreview } from '../lib/types/models';

import {
  createLocationRound,
  createOlderVsNewerRound,
  createTimelineSortRound,
  deleteMedia,
  saveRunResult,
  saveSeenMediaIds
} from './services/game';
import {
  buildExportOverview,
  deleteExport,
  getAppOverview,
  importZipFile,
  openImportPicker,
  previewImportFile,
  renameExport,
  selectExport
} from './services/import';
import { ensureAppStructure } from './services/storage';

process.env.APP_IS_PACKAGED = app.isPackaged ? '1' : '';

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  await ensureAppStructure();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f4efe2',
    title: 'MemoryQuiz',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  protocol.handle('memoryquiz-media', (request) => {
    const filePath = decodeURIComponent(request.url.replace('memoryquiz-media://', ''));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  ipcMain.handle('memoryquiz:get-app-overview', () => getAppOverview());
  ipcMain.handle('memoryquiz:open-takeout-link', () => shell.openExternal('https://takeout.google.com/'));
  ipcMain.handle('memoryquiz:pick-import-zip', () => openImportPicker());
  ipcMain.handle('memoryquiz:preview-import-zip', (_event, filePath: string) => previewImportFile(filePath));
  ipcMain.handle(
    'memoryquiz:import-zip',
    async (event, preview: ImportPreview, libraryName: string, allowDuplicate?: boolean) =>
      importZipFile(preview, libraryName, allowDuplicate, (progress) => {
        event.sender.send('memoryquiz:import-progress', progress);
      })
  );
  ipcMain.handle('memoryquiz:select-export', (_event, exportId: string) => selectExport(exportId));
  ipcMain.handle('memoryquiz:rename-export', (_event, exportId: string, name: string) => renameExport(exportId, name));
  ipcMain.handle('memoryquiz:delete-export', (_event, exportId: string) => deleteExport(exportId));
  ipcMain.handle('memoryquiz:get-mode-overview', (_event, exportId: string) =>
    getAppOverview().then((overview) => {
      const entry = overview.exports.find((candidate) => candidate.id === exportId);
      if (!entry) {
        throw new Error('Library not found.');
      }
      return buildExportOverview(entry);
    })
  );
  ipcMain.handle('memoryquiz:create-location-round', (_event, exportId: string, seenIds: string[], streak: number) =>
    createLocationRound(exportId, seenIds, streak)
  );
  ipcMain.handle(
    'memoryquiz:create-older-newer-round',
    (_event, exportId: string, seenIds: string[]) => createOlderVsNewerRound(exportId, seenIds)
  );
  ipcMain.handle(
    'memoryquiz:create-timeline-sort-round',
    (_event, exportId: string, seenIds: string[], currentMediaIds: string[]) =>
      createTimelineSortRound(exportId, seenIds, currentMediaIds)
  );
  ipcMain.handle('memoryquiz:delete-media', (_event, exportId: string, mediaId: string) =>
    deleteMedia(exportId, mediaId)
  );
  ipcMain.handle(
    'memoryquiz:save-run-result',
    (_event, exportId: string, mode: 'location' | 'older-newer' | 'timeline-sort', streak: number, seenIds: string[]) =>
      saveRunResult(exportId, mode, streak, seenIds)
  );
  ipcMain.handle(
    'memoryquiz:save-seen-media-ids',
    (
      _event,
      exportId: string,
      mode: 'location' | 'older-newer' | 'timeline-sort',
      streak: number,
      seenIds: string[],
      pendingRound
    ) => saveSeenMediaIds(exportId, mode, streak, seenIds, pendingRound)
  );

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
