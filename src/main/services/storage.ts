import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { shell } from 'electron';

import { getAppDataRoot } from '../config';

export interface ExportPaths {
  root: string;
  zipPath: string;
  extractedDir: string;
  dbPath: string;
  thumbnailsDir: string;
  manifestPath: string;
}

export function getRootPaths() {
  const root = getAppDataRoot();
  return {
    root,
    exportsDir: path.join(root, 'exports'),
    logsDir: path.join(root, 'logs'),
    appStatePath: path.join(root, 'app-state.json')
  };
}

export function getExportPaths(exportId: string): ExportPaths {
  const { exportsDir } = getRootPaths();
  const root = path.join(exportsDir, exportId);

  return {
    root,
    zipPath: path.join(root, 'source.zip'),
    extractedDir: path.join(root, 'extracted'),
    dbPath: path.join(root, 'index.sqlite'),
    thumbnailsDir: path.join(root, 'thumbnails'),
    manifestPath: path.join(root, 'manifest.json')
  };
}

export async function ensureAppStructure(): Promise<void> {
  const { root, exportsDir, logsDir } = getRootPaths();
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(exportsDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
}

export async function ensureExportStructure(exportId: string): Promise<ExportPaths> {
  const paths = getExportPaths(exportId);
  await fs.mkdir(paths.root, { recursive: true });
  await fs.mkdir(paths.extractedDir, { recursive: true });
  await fs.mkdir(paths.thumbnailsDir, { recursive: true });
  return paths;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function calculateDirectorySize(targetPath: string): Promise<number> {
  const stats = await fs.stat(targetPath);
  if (stats.isFile()) {
    return stats.size;
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await calculateDirectorySize(path.join(targetPath, entry.name));
  }
  return total;
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    let offset = 0;

    do {
      const readResult = await handle.read(buffer, 0, buffer.length, offset);
      bytesRead = readResult.bytesRead;
      offset += bytesRead;
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    await handle.close();
  }

  return hash.digest('hex');
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function removeExportDirectory(exportId: string): Promise<void> {
  const paths = getExportPaths(exportId);
  if (!(await pathExists(paths.root))) {
    return;
  }

  try {
    await shell.trashItem(paths.root);
  } catch {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
}
