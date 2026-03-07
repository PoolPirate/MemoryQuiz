import path from 'node:path';

import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import { pathToFileURL } from 'node:url';

import { createLocationRound, createOlderVsNewerRound, saveRunResult } from './services/game';
import {
  buildExportOverview,
  deleteExport,
  getAppOverview,
  importZipFile,
  openImportPicker,
  reindexExport,
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
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

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
  protocol.handle('memoryquiz-media', (request) => {
    const filePath = decodeURIComponent(request.url.replace('memoryquiz-media://', ''));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  ipcMain.handle('memoryquiz:get-app-overview', () => getAppOverview());
  ipcMain.handle('memoryquiz:open-takeout-link', () => shell.openExternal('https://takeout.google.com/'));
  ipcMain.handle('memoryquiz:pick-import-zip', () => openImportPicker());
  ipcMain.handle('memoryquiz:import-zip', async (event, filePath: string, allowDuplicate?: boolean) =>
    importZipFile(filePath, allowDuplicate, (progress) => {
      event.sender.send('memoryquiz:import-progress', progress);
    })
  );
  ipcMain.handle('memoryquiz:select-export', (_event, exportId: string) => selectExport(exportId));
  ipcMain.handle('memoryquiz:rename-export', (_event, exportId: string, name: string) => renameExport(exportId, name));
  ipcMain.handle('memoryquiz:delete-export', (_event, exportId: string) => deleteExport(exportId));
  ipcMain.handle('memoryquiz:reindex-export', async (event, exportId: string) =>
    reindexExport(exportId, (progress) => {
      event.sender.send('memoryquiz:import-progress', progress);
    })
  );
  ipcMain.handle('memoryquiz:get-mode-overview', (_event, exportId: string) =>
    getAppOverview().then((overview) => {
      const entry = overview.exports.find((candidate) => candidate.id === exportId);
      if (!entry) {
        throw new Error('Savegame not found.');
      }
      return buildExportOverview(entry);
    })
  );
  ipcMain.handle('memoryquiz:create-location-round', (_event, exportId: string, seenIds: string[], streak: number) =>
    createLocationRound(exportId, seenIds, streak)
  );
  ipcMain.handle(
    'memoryquiz:create-older-newer-round',
    (_event, exportId: string, seenIds: string[], streak: number) =>
      createOlderVsNewerRound(exportId, seenIds, streak)
  );
  ipcMain.handle(
    'memoryquiz:save-run-result',
    (_event, exportId: string, mode: 'location' | 'older-newer', streak: number, seenIds: string[]) =>
      saveRunResult(exportId, mode, streak, seenIds)
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
