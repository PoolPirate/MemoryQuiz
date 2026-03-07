import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { dialog } from 'electron';
import extractZipArchive from 'extract-zip';

import type {
  AppOverview,
  ExportOverview,
  ExportRegistryEntry,
  ImportPreview,
  ImportResult,
  ImportSummary,
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
  purgeExportDirectory,
  removeExportDirectory,
  writeJsonFile
} from './storage';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const JSON_SUFFIX = '.json';

export async function openImportPicker(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Google Photos Takeout zip export',
    properties: ['openFile'],
    filters: [{ name: 'Zip archives', extensions: ['zip'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
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
  preview: ImportPreview,
  libraryName: string,
  allowDuplicate = false,
  onProgress?: (event: ImportProgressEvent) => void
): Promise<ImportResult> {
  const state = await loadAppState();
  const duplicateOf = state.exports.find((entry) => entry.sourceZipHash === preview.hash) ?? null;
  if (duplicateOf && !allowDuplicate) {
    throw new Error('DUPLICATE_IMPORT');
  }

  const exportId = randomUUID();
  const now = new Date().toISOString();
  const entry: ExportRegistryEntry = {
    id: exportId,
    name: libraryName.trim() || path.basename(preview.fileName, '.zip').replace(/[-_]+/g, ' '),
    sourceZipName: preview.fileName,
    sourceZipHash: preview.hash,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    status: 'importing',
    lastError: null
  };

  try {
    const paths = await ensureExportStructure(exportId);

    onProgress?.({ stage: 'copying', progress: 0.08, message: 'Copying the zip into MemoryQuiz app storage' });
    await fs.copyFile(preview.filePath, paths.zipPath);

    onProgress?.({ stage: 'extracting', progress: 0.24, message: 'Extracting the Google Photos export' });
    await fs.rm(paths.extractedDir, { recursive: true, force: true });
    await fs.mkdir(paths.extractedDir, { recursive: true });
    await extractZip(paths.zipPath, paths.extractedDir);
    await fs.rm(paths.zipPath, { force: true });
    onProgress?.({
      stage: 'extracting',
      progress: 0.46,
      message: 'Merging albums into one media folder and removing duplicates'
    });
    await mergeExtractedAlbums(paths.root, paths.extractedDir, onProgress);

    onProgress?.({ stage: 'indexing', progress: 0.52, message: 'Reading photos, sidecars, dates, and locations' });
    const { entry: readyEntry, summary } = await indexExportEntry(entry, onProgress);
    await upsertRegistryEntry(readyEntry);
    await writeManifest(readyEntry);
    const overview = await buildExportOverview(readyEntry);
    onProgress?.({ stage: 'done', progress: 1, message: 'Import complete - your library is ready.' });
    return {
      overview,
      summary
    };
  } catch (error) {
    await Promise.allSettled([purgeExportDirectory(exportId), removeRegistryEntry(exportId)]);
    await logLine(
      'import-errors.log',
      `Import failed for ${preview.filePath}: ${(error as Error).stack ?? (error as Error).message}`
    );
    onProgress?.({ stage: 'error', progress: 1, message: `Import failed: ${(error as Error).message}` });
    throw error;
  }
}

export async function getAppOverview(): Promise<AppOverview> {
  await ensureAppStructure();
  const state = await loadAppState();
  const exports = await Promise.all(state.exports.map((entry) => buildExportOverview(entry)));

  return {
    exports,
    lastSelectedExportId: state.lastSelectedExportId
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
      location: { playableCount: 0, activeStreak: 0, bestStreak: 0, lastPlayedAt: null },
      'older-newer': { playableCount: 0, activeStreak: 0, bestStreak: 0, lastPlayedAt: null },
      'timeline-sort': { playableCount: 0, activeStreak: 0, bestStreak: 0, lastPlayedAt: null }
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
    throw new Error('Library not found.');
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

async function indexExportEntry(
  entry: ExportRegistryEntry,
  onProgress?: (event: ImportProgressEvent) => void
): Promise<{ entry: ExportRegistryEntry; summary: ImportSummary }> {
  const paths = getExportPaths(entry.id);
  const db = openExportDatabase(entry.id);

  try {
    const parsed = await parseTakeoutMedia({
      extractedDir: paths.extractedDir,
      onProgress
    });
    const mediaRecords = parsed.records;
    const summary = buildImportSummary(mediaRecords, parsed.sourceImageCount, parsed.issues);

    writeMediaIndex(db, mediaRecords);
    recordImportRun(db, {
      id: randomUUID(),
      status: 'ready',
      warningCount: summary.issueCount,
      mediaCount: mediaRecords.length,
      message: 'Import completed successfully.'
    });

    onProgress?.({ stage: 'finalizing', progress: 0.94, message: 'Finalizing library metadata and stats' });

    return {
      entry: {
        ...entry,
        status: 'ready',
        indexedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: null
      },
      summary
    };
  } catch (error) {
    recordImportRun(db, {
      id: randomUUID(),
      status: 'failed',
      warningCount: 0,
      mediaCount: 0,
      message: (error as Error).message
    });
    throw error;
  } finally {
    db.close();
  }
}

function buildImportSummary(mediaRecords: Awaited<ReturnType<typeof parseTakeoutMedia>>['records'], sourceImageCount: number, issues: string[]): ImportSummary {
  const withGeoCount = mediaRecords.filter((record) => record.lat != null && record.lng != null).length;
  const withTimestampCount = mediaRecords.filter((record) => record.captureTs != null).length;

  return {
    totalImages: mediaRecords.length,
    sourceImageCount,
    issueCount: issues.length,
    issues,
    withGeoCount,
    withoutGeoCount: mediaRecords.length - withGeoCount,
    withTimestampCount,
    withoutTimestampCount: mediaRecords.length - withTimestampCount
  };
}

async function extractZip(zipPath: string, outputDir: string): Promise<void> {
  try {
    await extractZipArchive(zipPath, { dir: outputDir });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'Z_BUF_ERROR') {
      throw new Error(
        'This zip could not be extracted with the current importer. Please re-download the export or split it into smaller zip files.'
      );
    }

    throw error;
  }
}

async function mergeExtractedAlbums(
  exportRoot: string,
  extractedDir: string,
  onProgress?: (event: ImportProgressEvent) => void
): Promise<void> {
  const mergedDir = path.join(exportRoot, 'extracted-merged');
  await fs.rm(mergedDir, { recursive: true, force: true });
  await fs.mkdir(mergedDir, { recursive: true });

  const files = await walkDirectory(extractedDir);
  const imageFiles = files
    .filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  const sidecarLookup = buildSidecarLookup(
    files.filter((filePath) => path.extname(filePath).toLowerCase() === JSON_SUFFIX)
  );

  const seenHashes = new Set<string>();
  const usedSidecars = new Set<string>();

  for (let index = 0; index < imageFiles.length; index += 1) {
    const imageFile = imageFiles[index];
    if (!imageFile) {
      continue;
    }

    const contentHash = await hashFile(imageFile);
    if (seenHashes.has(contentHash)) {
      continue;
    }

    seenHashes.add(contentHash);

    const targetImagePath = await reserveUniquePath(mergedDir, path.basename(imageFile));
    await moveFile(imageFile, targetImagePath);

    const sidecarPath = findSidecarForImage(imageFile, sidecarLookup);
    if (sidecarPath && !usedSidecars.has(sidecarPath) && (await pathExists(sidecarPath))) {
      usedSidecars.add(sidecarPath);
      const targetSidecarPath = path.join(mergedDir, `${path.basename(targetImagePath)}${JSON_SUFFIX}`);
      await moveFile(sidecarPath, targetSidecarPath);
    }

    if (onProgress) {
      onProgress({
        stage: 'extracting',
        progress: 0.46 + ((index + 1) / imageFiles.length) * 0.04,
        message: `Consolidating album photo ${index + 1} of ${imageFiles.length}`
      });
    }
  }

  await fs.rm(extractedDir, { recursive: true, force: true });
  await fs.rename(mergedDir, extractedDir);
}

function buildSidecarLookup(jsonFiles: string[]): Map<string, Array<{ normalizedName: string; filePath: string }>> {
  const map = new Map<string, Array<{ normalizedName: string; filePath: string }>>();

  for (const jsonFile of jsonFiles) {
    const bucket = map.get(path.dirname(jsonFile)) ?? [];
    bucket.push({ normalizedName: path.basename(jsonFile).toLowerCase(), filePath: jsonFile });
    map.set(path.dirname(jsonFile), bucket);
  }

  return map;
}

function findSidecarForImage(
  imageFile: string,
  sidecarLookup: Map<string, Array<{ normalizedName: string; filePath: string }>>
): string | null {
  const directory = path.dirname(imageFile);
  const imageFilename = path.basename(imageFile).toLowerCase();
  const candidates = sidecarLookup.get(directory) ?? [];
  const matches = candidates.filter(
    (candidate) => candidate.normalizedName.startsWith(imageFilename) && candidate.normalizedName.endsWith(JSON_SUFFIX)
  );

  if (matches.length === 0) {
    return null;
  }

  matches.sort(
    (left, right) => left.normalizedName.length - right.normalizedName.length || left.normalizedName.localeCompare(right.normalizedName)
  );
  return matches[0]?.filePath ?? null;
}

async function reserveUniquePath(directory: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName);

  let candidate = path.join(directory, fileName);
  let suffix = 1;
  while (await pathExists(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix += 1;
  }

  return candidate;
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error;
    }

    await fs.copyFile(sourcePath, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
}

async function walkDirectory(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(nextPath)));
    } else {
      files.push(nextPath);
    }
  }

  return files;
}
