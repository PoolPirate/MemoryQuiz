import path from 'node:path';

import type { GameMode, LocationRound, OlderVsNewerRound } from '../../lib/types/models';
import { getDateGapThresholdDays, getAllowedRadiusKm } from '../../lib/utils/game';

import { getModeState, openExportDatabase, saveRunResult as persistRunResult } from './database';
import { getExportPaths } from './storage';

interface MediaRow {
  id: string;
  relative_path: string;
  thumbnail_relative_path: string | null;
  filename: string;
  capture_ts: number | null;
  lat: number | null;
  lng: number | null;
  location_score: number;
  date_score: number;
}

export async function createLocationRound(
  exportId: string,
  sessionSeenIds: string[],
  streak: number
): Promise<LocationRound | null> {
  const db = openExportDatabase(exportId);
  try {
    const rows = db
      .prepare(
        `
          SELECT id, relative_path, thumbnail_relative_path, filename, capture_ts, lat, lng, location_score, date_score
          FROM media
          WHERE exclusion_reason IS NULL AND location_score > 0 AND lat IS NOT NULL AND lng IS NOT NULL
        `
      )
      .all() as MediaRow[];

    const candidates = filterRecent(rows, [...sessionSeenIds, ...getModeState(db, 'location').seenMediaIds]);
    const pool = (candidates.length >= 1 ? candidates : rows).sort(
      (left, right) => right.location_score - left.location_score
    );
    const chosen = pickFromPool(pool.slice(0, Math.max(6, Math.ceil(pool.length * 0.4))));

    if (!chosen || chosen.lat == null || chosen.lng == null) {
      return null;
    }

    return {
      mode: 'location',
      media: mapMediaCard(exportId, chosen),
      allowedRadiusKm: getAllowedRadiusKm(streak),
      answer: {
        lat: chosen.lat,
        lng: chosen.lng
      }
    };
  } finally {
    db.close();
  }
}

export async function createOlderVsNewerRound(
  exportId: string,
  sessionSeenIds: string[],
  streak: number
): Promise<OlderVsNewerRound | null> {
  const db = openExportDatabase(exportId);
  try {
    const rows = db
      .prepare(
        `
          SELECT id, relative_path, thumbnail_relative_path, filename, capture_ts, lat, lng, location_score, date_score
          FROM media
          WHERE exclusion_reason IS NULL AND date_score > 0 AND capture_ts IS NOT NULL
        `
      )
      .all() as MediaRow[];
    const filtered = filterRecent(rows, [...sessionSeenIds, ...getModeState(db, 'older-newer').seenMediaIds]);
    const candidates = filtered.length >= 2 ? filtered : rows;

    if (candidates.length < 2) {
      return null;
    }

    const thresholdDays = getDateGapThresholdDays(streak);
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    let pair: [MediaRow, MediaRow] | null = null;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const left = pickFromPool(candidates);
      const right = pickFromPool(candidates.filter((row) => row.id !== left?.id));
      if (!left || !right || left.capture_ts == null || right.capture_ts == null) {
        continue;
      }

      if (Math.abs(left.capture_ts - right.capture_ts) >= thresholdMs) {
        pair = Math.random() > 0.5 ? [left, right] : [right, left];
        break;
      }
    }

    if (!pair) {
      const sorted = [...candidates].sort((left, right) => (left.capture_ts ?? 0) - (right.capture_ts ?? 0));
      pair = [sorted[0], sorted.at(-1)!];
    }

    const [left, right] = pair;
    const gapDays = Math.round(Math.abs((left.capture_ts ?? 0) - (right.capture_ts ?? 0)) / (24 * 60 * 60 * 1000));

    return {
      mode: 'older-newer',
      left: {
        ...mapMediaCard(exportId, left),
        captureTs: left.capture_ts ?? 0
      },
      right: {
        ...mapMediaCard(exportId, right),
        captureTs: right.capture_ts ?? 0
      },
      correctSide: (left.capture_ts ?? 0) > (right.capture_ts ?? 0) ? 'left' : 'right',
      gapDays
    };
  } finally {
    db.close();
  }
}

export async function saveRunResult(exportId: string, mode: GameMode, streak: number, seenMediaIds: string[]) {
  const db = openExportDatabase(exportId);
  try {
    persistRunResult(db, mode, streak, seenMediaIds);
  } finally {
    db.close();
  }
}

function filterRecent(rows: MediaRow[], ids: string[]): MediaRow[] {
  const blocked = new Set(ids.slice(-40));
  return rows.filter((row) => !blocked.has(row.id));
}

function pickFromPool<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return items[Math.floor(Math.random() * items.length)];
}

function mapMediaCard(exportId: string, row: MediaRow) {
  const exportRoot = getExportPaths(exportId).root;
  const imagePath = path.join(exportRoot, row.relative_path);
  const thumbnailPath = row.thumbnail_relative_path
    ? path.join(exportRoot, row.thumbnail_relative_path)
    : imagePath;

  return {
    id: row.id,
    filename: row.filename,
    imageUrl: toMediaUrl(imagePath),
    thumbnailUrl: toMediaUrl(thumbnailPath),
    captureDateLabel: row.capture_ts ? new Date(row.capture_ts).toLocaleDateString() : null,
    locationLabel:
      row.lat != null && row.lng != null
        ? `${Math.abs(row.lat).toFixed(1)}°${row.lat >= 0 ? 'N' : 'S'}, ${Math.abs(row.lng).toFixed(1)}°${row.lng >= 0 ? 'E' : 'W'}`
        : null
  };
}

function toMediaUrl(filePath: string): string {
  return `memoryquiz-media://${encodeURIComponent(filePath)}`;
}
