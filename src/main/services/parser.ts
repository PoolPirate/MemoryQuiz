import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';

import * as exifr from 'exifr';
import { lookup as lookupMimeType } from 'mime-types';
import sharp from 'sharp';

import type { ImportProgressEvent, MediaIndexRecord } from '../../lib/types/models';

import { logLine } from './logger';
import { hashFile } from './storage';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const JSON_SUFFIX = '.json';
const INDEXING_CONCURRENCY = Math.max(1, Math.min(4, availableParallelism()));

interface SidecarData {
  photoTakenTime?: { timestamp?: string };
  creationTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number };
  geoDataExif?: { latitude?: number; longitude?: number };
  title?: string;
}

interface ParseOptions {
  extractedDir: string;
  onProgress?: (event: ImportProgressEvent) => void;
}

export interface ParseTakeoutResult {
  records: MediaIndexRecord[];
  sourceImageCount: number;
  issues: string[];
}

interface ParsedMedia extends MediaIndexRecord {
  representativeWeight: number;
}

export async function parseTakeoutMedia(options: ParseOptions): Promise<ParseTakeoutResult> {
  const files = await walkDirectory(options.extractedDir);
  const imageFiles = files.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  const jsonFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === JSON_SUFFIX);
  const sidecarMap = buildSidecarMap(options.extractedDir, imageFiles, jsonFiles);
  const issues: string[] = [];

  const mediaByHash = new Map<string, ParsedMedia>();
  const parsedResults = new Array<ParsedMedia | null>(imageFiles.length).fill(null);
  const workerCount = Math.min(imageFiles.length, INDEXING_CONCURRENCY);
  let nextIndex = 0;
  let completedCount = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= imageFiles.length) {
          return;
        }

        const imageFile = imageFiles[index];
        if (!imageFile) {
          continue;
        }

        try {
          parsedResults[index] = await parseSingleImage(imageFile, sidecarMap, options);
        } catch (error) {
          const issue = `Failed to parse ${path.basename(imageFile)}: ${(error as Error).message}`;
          issues.push(issue);
          await logLine('import-warnings.log', `${issue} (${imageFile})`);
        } finally {
          completedCount += 1;
          reportIndexingProgress(options.onProgress, completedCount, imageFiles.length);
        }
      }
    })
  );

  for (const parsed of parsedResults) {
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
  }

  const records = Array.from(mediaByHash.values());
  applyBurstPenalties(records);
  return {
    records: records.sort((left, right) => right.generalScore - left.generalScore),
    sourceImageCount: imageFiles.length,
    issues
  };
}

async function parseSingleImage(
  imageFile: string,
  sidecarMap: Map<string, string>,
  options: ParseOptions
): Promise<ParsedMedia | null> {
  const sourceRelativePath = path.relative(options.extractedDir, imageFile).replaceAll('\\', '/');
  const relativePath = path.join('extracted', sourceRelativePath).replaceAll('\\', '/');
  const sidecar = await readSidecar(sourceRelativePath, sidecarMap);
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
    (exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.getTime() : null);
  const geo = readGeo(sidecar, exif);
  const albumName = deriveAlbumName(sourceRelativePath);
  const isScreenshot = /screenshot|screen shot|screen_shot/i.test(path.basename(imageFile));
  const albumNames = albumName ? [albumName] : [];
  const pixels = width * height;
  const meetsResolution = pixels >= 1100 * 700;

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
    locationScore,
    dateScore,
    generalScore,
    exclusionReason,
    burstKey: buildBurstKey(captureTs, geo),
    representativeWeight: generalScore + resolutionBonus
  };
}

function reportIndexingProgress(
  onProgress: ParseOptions['onProgress'],
  completedCount: number,
  totalCount: number
): void {
  if (!onProgress || totalCount === 0) {
    return;
  }

  onProgress({
    stage: 'indexing',
    progress: 0.55 + (completedCount / totalCount) * 0.35,
    message: `Indexing photo ${completedCount} of ${totalCount}`
  });
}

async function readSidecar(
  sourceRelativePath: string,
  sidecarMap: Map<string, string>
): Promise<SidecarData | null> {
  const candidate = sidecarMap.get(normalizeSidecarKey(sourceRelativePath));
  if (!candidate) {
    return null;
  }

  return readSidecarFile(candidate);
}

function buildSidecarMap(extractedDir: string, imageFiles: string[], jsonFiles: string[]): Map<string, string> {
  const sidecarFilesByDirectory = new Map<string, Array<{ normalizedName: string; filePath: string }>>();

  for (const jsonFile of jsonFiles) {
    const relativePath = path.relative(extractedDir, jsonFile).replaceAll('\\', '/');
    const normalizedRelativePath = normalizeSidecarKey(relativePath);
    const directory = path.posix.dirname(normalizedRelativePath);
    const filename = path.posix.basename(normalizedRelativePath);
    const bucket = sidecarFilesByDirectory.get(directory) ?? [];
    bucket.push({ normalizedName: filename, filePath: jsonFile });
    sidecarFilesByDirectory.set(directory, bucket);
  }

  const sidecarMap = new Map<string, string>();

  for (const imageFile of imageFiles) {
    const relativePath = path.relative(extractedDir, imageFile).replaceAll('\\', '/');
    const normalizedRelativePath = normalizeSidecarKey(relativePath);
    const directory = path.posix.dirname(normalizedRelativePath);
    const filename = path.posix.basename(normalizedRelativePath);
    const candidates = sidecarFilesByDirectory.get(directory) ?? [];
    const matchedSidecar = findMatchingSidecar(filename, candidates);

    if (matchedSidecar) {
      sidecarMap.set(normalizedRelativePath, matchedSidecar.filePath);
    }
  }

  return sidecarMap;
}

function findMatchingSidecar(
  imageFilename: string,
  candidates: Array<{ normalizedName: string; filePath: string }>
): { normalizedName: string; filePath: string } | null {
  const matches = candidates.filter((candidate) =>
    candidate.normalizedName.startsWith(imageFilename) && candidate.normalizedName.endsWith(JSON_SUFFIX)
  );

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => left.normalizedName.length - right.normalizedName.length || left.normalizedName.localeCompare(right.normalizedName));
  return matches[0] ?? null;
}

async function readSidecarFile(filePath: string): Promise<SidecarData | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
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
    if (hasUsableCoordinates(candidate)) {
      return { lat: candidate.latitude, lng: candidate.longitude };
    }
  }

  if (hasUsableCoordinates(exif)) {
    return { lat: exif.latitude, lng: exif.longitude };
  }

  return null;
}

function hasUsableCoordinates(value: { latitude?: number; longitude?: number } | null | undefined): value is {
  latitude: number;
  longitude: number;
} {
  if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) {
    return false;
  }

  return !(value.latitude === 0 && value.longitude === 0);
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
