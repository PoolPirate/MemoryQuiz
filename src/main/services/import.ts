import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { dialog } from 'electron';
import unzipper from 'unzipper';

import type {
  AppOverview,
  ExportOverview,
  ExportRegistryEntry,
  ImportPreview,
  ImportProgressEvent
} from '../../lib/types/models';

import { openExportDatabase, decorateOverview, recordImportRun, writeMediaIndex } from './database';
import { logLine } from './logger';
import { parseTakeoutMedia } from './parser';
import { loadAppState, removeRegistryEntry, setLastSelectedExport, upsertRegistryEntry } from './registry';
import {
  calculateDirectorySize,
  ensureAppStructure,
  ensureExportStructure,
  getExportPaths,
  hashFile,
  pathExists,
  removeExportDirectory,
  writeJsonFile
} from './storage';
import { getAppDataRoot } from '../config';

export async function openImportPicker(): Promise<ImportPreview | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Google Photos Takeout zip export',
    properties: ['openFile'],
    filters: [{ name: 'Zip archives', extensions: ['zip'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return previewImportFile(result.filePaths[0]);
}

export async function previewImportFile(filePath: string): Promise<ImportPreview> {
  await ensureAppStructure();
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error('The selected path is not a file.');
  }
  if (stats.size < 64) {
    throw new Error('The selected zip file looks empty.');
  }
  if (path.extname(filePath).toLowerCase() !== '.zip') {
    throw new Error('Please choose a .zip export file.');
  }

  const hash = await hashFile(filePath);
  const state = await loadAppState();
  const duplicateOf = state.exports.find((entry) => entry.sourceZipHash === hash) ?? null;

  return {
    filePath,
    fileName: path.basename(filePath),
    sizeBytes: stats.size,
    hash,
    duplicateOf
  };
}

export async function importZipFile(
  filePath: string,
  allowDuplicate = false,
  onProgress?: (event: ImportProgressEvent) => void
): Promise<ExportOverview> {
  const preview = await previewImportFile(filePath);
  if (preview.duplicateOf && !allowDuplicate) {
    throw new Error('DUPLICATE_IMPORT');
  }

  const exportId = randomUUID();
  const now = new Date().toISOString();
  const entry: ExportRegistryEntry = {
    id: exportId,
    name: path.basename(preview.fileName, '.zip').replace(/[-_]+/g, ' '),
    sourceZipName: preview.fileName,
    sourceZipHash: preview.hash,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    status: 'importing',
    lastError: null
  };

  await upsertRegistryEntry(entry);
  const paths = await ensureExportStructure(exportId);
  await writeManifest(entry);

  try {
    onProgress?.({ stage: 'copying', progress: 0.08, message: 'Copying the zip into MemoryQuiz save storage' });
    await fs.copyFile(preview.filePath, paths.zipPath);

    onProgress?.({ stage: 'extracting', progress: 0.24, message: 'Extracting the Google Photos export' });
    await fs.rm(paths.extractedDir, { recursive: true, force: true });
    await fs.mkdir(paths.extractedDir, { recursive: true });
    await extractZip(paths.zipPath, paths.extractedDir);

    onProgress?.({ stage: 'indexing', progress: 0.52, message: 'Reading photos, sidecars, dates, and locations' });
    const overview = await reindexExport(exportId, onProgress);
    onProgress?.({ stage: 'done', progress: 1, message: 'Import complete - your savegame is ready.' });
    return overview;
  } catch (error) {
    const failedEntry: ExportRegistryEntry = {
      ...entry,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      lastError: (error as Error).message
    };
    await upsertRegistryEntry(failedEntry);
    await writeManifest(failedEntry);
    await logLine('import-errors.log', `Import failed for ${filePath}: ${(error as Error).stack ?? (error as Error).message}`);
    onProgress?.({ stage: 'error', progress: 1, message: `Import failed: ${(error as Error).message}` });
    throw error;
  }
}

export async function reindexExport(
  exportId: string,
  onProgress?: (event: ImportProgressEvent) => void
): Promise<ExportOverview> {
  const state = await loadAppState();
  const existingEntry = state.exports.find((entry) => entry.id === exportId);
  if (!existingEntry) {
    throw new Error('Savegame not found.');
  }

  const indexingEntry: ExportRegistryEntry = {
    ...existingEntry,
    status: 'indexing',
    updatedAt: new Date().toISOString(),
    lastError: null
  };
  await upsertRegistryEntry(indexingEntry);
  await writeManifest(indexingEntry);

  const paths = getExportPaths(exportId);
  const db = openExportDatabase(exportId);

  try {
    await fs.rm(paths.thumbnailsDir, { recursive: true, force: true });
    await fs.mkdir(paths.thumbnailsDir, { recursive: true });

    const mediaRecords = await parseTakeoutMedia({
      exportRoot: paths.root,
      extractedDir: paths.extractedDir,
      thumbnailsDir: paths.thumbnailsDir,
      onProgress
    });

    writeMediaIndex(db, mediaRecords);
    recordImportRun(db, {
      id: randomUUID(),
      status: 'ready',
      mediaCount: mediaRecords.length,
      message: 'Re-index completed successfully.'
    });

    const readyEntry: ExportRegistryEntry = {
      ...indexingEntry,
      status: 'ready',
      indexedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await upsertRegistryEntry(readyEntry);
    await writeManifest(readyEntry);
    onProgress?.({ stage: 'finalizing', progress: 0.94, message: 'Finalizing savegame metadata and stats' });
    return buildExportOverview(readyEntry);
  } catch (error) {
    const failedEntry: ExportRegistryEntry = {
      ...indexingEntry,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      lastError: (error as Error).message
    };
    await upsertRegistryEntry(failedEntry);
    await writeManifest(failedEntry);
    recordImportRun(db, {
      id: randomUUID(),
      status: 'failed',
      mediaCount: 0,
      message: (error as Error).message
    });
    throw error;
  } finally {
    db.close();
  }
}

export async function getAppOverview(): Promise<AppOverview> {
  await ensureAppStructure();
  const state = await loadAppState();
  const exports = await Promise.all(state.exports.map((entry) => buildExportOverview(entry)));

  return {
    exports,
    lastSelectedExportId: state.lastSelectedExportId,
    appDataRoot: getAppDataRoot()
  };
}

export async function buildExportOverview(entry: ExportRegistryEntry): Promise<ExportOverview> {
  const paths = getExportPaths(entry.id);
  const existsOnDisk = await pathExists(paths.root);
  let overview: ExportOverview = {
    ...entry,
    sizeOnDiskBytes: existsOnDisk ? await calculateDirectorySize(paths.root) : 0,
    photoCount: 0,
    modeStats: {
      location: { playableCount: 0, bestStreak: 0, lastPlayedAt: null },
      'older-newer': { playableCount: 0, bestStreak: 0, lastPlayedAt: null }
    },
    existsOnDisk
  };

  if (!existsOnDisk) {
    overview.status = 'missing';
    return overview;
  }

  if (await pathExists(paths.dbPath)) {
    const db = openExportDatabase(entry.id);
    try {
      overview = decorateOverview(overview, db);
    } finally {
      db.close();
    }
  }

  return overview;
}

export async function selectExport(exportId: string): Promise<void> {
  await setLastSelectedExport(exportId);
}

export async function renameExport(exportId: string, name: string): Promise<ExportOverview> {
  const state = await loadAppState();
  const entry = state.exports.find((item) => item.id === exportId);
  if (!entry) {
    throw new Error('Savegame not found.');
  }

  const nextEntry: ExportRegistryEntry = {
    ...entry,
    name: name.trim() || entry.name,
    updatedAt: new Date().toISOString()
  };
  await upsertRegistryEntry(nextEntry);
  await writeManifest(nextEntry);
  return buildExportOverview(nextEntry);
}

export async function deleteExport(exportId: string): Promise<void> {
  await removeExportDirectory(exportId);
  await removeRegistryEntry(exportId);
}

async function writeManifest(entry: ExportRegistryEntry): Promise<void> {
  await writeJsonFile(getExportPaths(entry.id).manifestPath, entry);
}

async function extractZip(zipPath: string, outputDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: outputDir }))
      .on('close', () => resolve())
      .on('error', (error: Error) => reject(error));
  });
}
