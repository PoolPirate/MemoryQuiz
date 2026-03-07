import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import * as exifr from 'exifr';
import { lookup as lookupMimeType } from 'mime-types';
import sharp from 'sharp';

import type { ImportProgressEvent, MediaIndexRecord } from '../../lib/types/models';

import { logLine } from './logger';
import { hashFile, pathExists } from './storage';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

interface SidecarData {
  photoTakenTime?: { timestamp?: string };
  creationTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number };
  geoDataExif?: { latitude?: number; longitude?: number };
  title?: string;
}

interface ParseOptions {
  exportRoot: string;
  extractedDir: string;
  thumbnailsDir: string;
  onProgress?: (event: ImportProgressEvent) => void;
}

interface ParsedMedia extends MediaIndexRecord {
  representativeWeight: number;
}

export async function parseTakeoutMedia(options: ParseOptions): Promise<MediaIndexRecord[]> {
  const files = await walkDirectory(options.extractedDir);
  const imageFiles = files.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  const jsonFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === '.json');
  const sidecarMap = new Map<string, string>();

  for (const jsonFile of jsonFiles) {
    const relative = path.relative(options.extractedDir, jsonFile).replaceAll('\\', '/');
    sidecarMap.set(normalizeSidecarKey(relative), jsonFile);
  }

  const mediaByHash = new Map<string, ParsedMedia>();

  for (const [index, imageFile] of imageFiles.entries()) {
    try {
      const parsed = await parseSingleImage(imageFile, sidecarMap, options);
      if (!parsed) {
        continue;
      }

      const existing = mediaByHash.get(parsed.contentHash);
      if (existing) {
        existing.albumNames = Array.from(new Set([...existing.albumNames, ...parsed.albumNames]));
        if (parsed.representativeWeight > existing.representativeWeight) {
          mediaByHash.set(parsed.contentHash, {
            ...parsed,
            albumNames: existing.albumNames
          });
        }
      } else {
        mediaByHash.set(parsed.contentHash, parsed);
      }
    } catch (error) {
      await logLine('import-warnings.log', `Failed to parse ${imageFile}: ${(error as Error).message}`);
    }

    if (options.onProgress && imageFiles.length > 0 && index % 10 === 0) {
      options.onProgress({
        stage: 'indexing',
        progress: 0.55 + (index / imageFiles.length) * 0.35,
        message: `Indexing photo ${index + 1} of ${imageFiles.length}`
      });
    }
  }

  const records = Array.from(mediaByHash.values());
  applyBurstPenalties(records);
  return records.sort((left, right) => right.generalScore - left.generalScore);
}

async function parseSingleImage(
  imageFile: string,
  sidecarMap: Map<string, string>,
  options: ParseOptions
): Promise<ParsedMedia | null> {
  const sourceRelativePath = path.relative(options.extractedDir, imageFile).replaceAll('\\', '/');
  const relativePath = path.join('extracted', sourceRelativePath).replaceAll('\\', '/');
  const sidecar = await readSidecar(imageFile, sourceRelativePath, sidecarMap);
  const metadata = await sharp(imageFile).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    return null;
  }

  const contentHash = await hashFile(imageFile);
  const exif = await exifr.parse(imageFile, ['DateTimeOriginal', 'latitude', 'longitude']).catch(() => null);
  const captureTs =
    readTimestamp(sidecar) ??
    (exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.getTime() : null) ??
    (await fs.stat(imageFile)).mtimeMs;
  const geo = readGeo(sidecar, exif);
  const albumName = deriveAlbumName(sourceRelativePath);
  const isScreenshot = /screenshot|screen shot|screen_shot/i.test(path.basename(imageFile));
  const albumNames = albumName ? [albumName] : [];
  const pixels = width * height;
  const meetsResolution = pixels >= 1100 * 700;
  const thumbnailRelativePath = path.join('thumbnails', `${contentHash}.jpg`).replaceAll('\\', '/');

  if (meetsResolution && !(await pathExists(path.join(options.exportRoot, thumbnailRelativePath)))) {
    try {
      await sharp(imageFile)
        .rotate()
        .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(options.exportRoot, thumbnailRelativePath));
    } catch {
      await logLine('import-warnings.log', `Thumbnail generation failed for ${imageFile}`);
    }
  }

  const resolutionBonus = Math.min(18, pixels / 600000);
  const albumBonus = albumNames.length > 0 ? 8 : 0;
  const screenshotPenalty = isScreenshot ? 16 : 0;
  let locationScore = 0;
  let dateScore = 0;
  let generalScore = 10 + albumBonus + resolutionBonus - screenshotPenalty;
  let exclusionReason: string | null = null;

  if (!meetsResolution) {
    exclusionReason = 'low-resolution';
  }

  if (geo) {
    locationScore = Math.max(0, 38 + albumBonus + resolutionBonus - screenshotPenalty);
  }

  if (captureTs) {
    dateScore = Math.max(0, 32 + albumBonus + resolutionBonus - screenshotPenalty);
  }

  if (locationScore === 0 && dateScore === 0 && !exclusionReason) {
    exclusionReason = 'missing-game-metadata';
  }

  generalScore = Math.max(generalScore, locationScore, dateScore);

  return {
    id: randomUUID(),
    contentHash,
    relativePath,
    sourceRelativePath,
    filename: path.basename(imageFile),
    mimeType: lookupMimeType(imageFile) || 'image/jpeg',
    width,
    height,
    captureTs,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    albumNames,
    thumbnailRelativePath,
    locationScore,
    dateScore,
    generalScore,
    exclusionReason,
    burstKey: buildBurstKey(captureTs, geo),
    representativeWeight: generalScore + resolutionBonus
  };
}

async function readSidecar(
  imageFile: string,
  sourceRelativePath: string,
  sidecarMap: Map<string, string>
): Promise<SidecarData | null> {
  const directPath = `${imageFile}.json`;
  const sourceKey = normalizeSidecarKey(`${sourceRelativePath}.json`);
  const candidate = (await pathExists(directPath)) ? directPath : sidecarMap.get(sourceKey);
  if (!candidate) {
    return null;
  }

  try {
    const raw = await fs.readFile(candidate, 'utf8');
    return JSON.parse(raw) as SidecarData;
  } catch {
    return null;
  }
}

function normalizeSidecarKey(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').toLowerCase();
}

function readTimestamp(sidecar: SidecarData | null): number | null {
  const raw = sidecar?.photoTakenTime?.timestamp ?? sidecar?.creationTime?.timestamp;
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed * 1000 : null;
}

function readGeo(
  sidecar: SidecarData | null,
  exif: { latitude?: number; longitude?: number } | null
): { lat: number; lng: number } | null {
  const candidates = [sidecar?.geoDataExif, sidecar?.geoData];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number') {
      return { lat: candidate.latitude, lng: candidate.longitude };
    }
  }

  if (typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number') {
    return { lat: exif.latitude, lng: exif.longitude };
  }

  return null;
}

function deriveAlbumName(sourceRelativePath: string): string | null {
  const parts = sourceRelativePath.split('/').filter(Boolean);
  const directoryParts = parts.slice(0, -1).filter((part) => !isGenericFolder(part));
  return directoryParts.at(-1) ?? null;
}

function isGenericFolder(value: string): boolean {
  return /^(takeout|google photos|photos from|all photos)$/i.test(value) || /^\d{4}$/.test(value);
}

function buildBurstKey(
  captureTs: number | null | undefined,
  geo: { lat: number; lng: number } | null
): string | null {
  if (!captureTs) {
    return null;
  }

  const timeBucket = Math.floor(captureTs / (1000 * 60 * 15));
  const geoBucket = geo ? `${Math.round(geo.lat * 2) / 2}:${Math.round(geo.lng * 2) / 2}` : 'none';
  return `${timeBucket}:${geoBucket}`;
}

function applyBurstPenalties(records: ParsedMedia[]): void {
  const groups = new Map<string, ParsedMedia[]>();

  for (const record of records) {
    if (!record.burstKey) {
      continue;
    }

    const group = groups.get(record.burstKey) ?? [];
    group.push(record);
    groups.set(record.burstKey, group);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }

    group.sort((left, right) => right.representativeWeight - left.representativeWeight);
    for (const alternate of group.slice(1)) {
      alternate.locationScore = Math.max(0, alternate.locationScore - 18);
      alternate.dateScore = Math.max(0, alternate.dateScore - 18);
      alternate.generalScore = Math.max(0, alternate.generalScore - 14);
      if (!alternate.exclusionReason && alternate.locationScore === 0 && alternate.dateScore === 0) {
        alternate.exclusionReason = 'burst-alternate';
      }
    }
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
