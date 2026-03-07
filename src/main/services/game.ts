import path from 'node:path';

import type {
  GameMode,
  LocationRound,
  OlderVsNewerRound,
  PendingRoundState,
  TimelineRoundMedia,
  TimelineSortRound
} from '../../lib/types/models';
import { getAllowedRadiusKm } from '../../lib/utils/game';

import {
  deleteMediaRecord,
  getModeState,
  getTimelineBounds,
  openExportDatabase,
  saveRunResult as persistRunResult,
  saveSeenMediaIds as persistSeenMediaIds
} from './database';
import { getExportPaths, removeExportMediaFile } from './storage';

interface MediaRow {
  id: string;
  relative_path: string;
  filename: string;
  capture_ts: number | null;
  lat: number | null;
  lng: number | null;
  location_score: number;
  date_score: number;
}

interface TimelineMediaRow extends MediaRow {
  capture_ts: number;
}

export async function createLocationRound(
  exportId: string,
  sessionSeenIds: string[],
  streak: number
): Promise<LocationRound | null> {
  const db = openExportDatabase(exportId);
  try {
    const modeState = getModeState(db, 'location');
    const rows = db
      .prepare(
        `
          SELECT id, relative_path, filename, capture_ts, lat, lng, location_score, date_score
          FROM media
          WHERE exclusion_reason IS NULL AND location_score > 0 AND lat IS NOT NULL AND lng IS NOT NULL
        `
      )
      .all() as MediaRow[];

    const pendingRound = restorePendingLocationRound(exportId, rows, modeState.pendingRound, streak);
    if (pendingRound) {
      return pendingRound;
    }

    const candidates = filterRecent(rows, [...modeState.seenMediaIds, ...sessionSeenIds]);
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
  sessionSeenIds: string[]
): Promise<OlderVsNewerRound | null> {
  const db = openExportDatabase(exportId);
  try {
    const modeState = getModeState(db, 'older-newer');
    const rows = db
      .prepare(
        `
          SELECT id, relative_path, filename, capture_ts, lat, lng, location_score, date_score
          FROM media
          WHERE exclusion_reason IS NULL AND date_score > 0 AND capture_ts IS NOT NULL
        `
      )
      .all() as MediaRow[];

    const pendingRound = restorePendingOlderVsNewerRound(exportId, rows, modeState.pendingRound);
    if (pendingRound) {
      return pendingRound;
    }

    const candidates = filterRecent(rows, [...modeState.seenMediaIds, ...sessionSeenIds]);
    const pool = candidates.length >= 2 ? candidates : rows;

    if (pool.length < 2) {
      return null;
    }

    const first = pickFromPool(pool);
    const remaining = first ? pool.filter((row) => row.id !== first.id) : [];
    const second = pickFromPool(remaining);

    if (!first || !second || first.capture_ts == null || second.capture_ts == null) {
      return null;
    }

    const pair: [MediaRow, MediaRow] = Math.random() > 0.5 ? [first, second] : [second, first];
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

export async function createTimelineSortRound(
  exportId: string,
  _sessionSeenIds: string[],
  currentMediaIds: string[]
): Promise<TimelineSortRound | null> {
  const db = openExportDatabase(exportId);

  try {
    const modeState = getModeState(db, 'timeline-sort');
    const rows = db
      .prepare(
        `
          SELECT id, relative_path, filename, capture_ts, lat, lng, location_score, date_score
          FROM media
          WHERE exclusion_reason IS NULL AND date_score > 0 AND capture_ts IS NOT NULL
        `
      )
      .all() as MediaRow[];
    const timelineRows = buildTimelineRows(rows);

    if (timelineRows.length < 2) {
      return null;
    }

    const bounds = getTimelineBounds(db);
    const rangeStartTs = bounds.firstCaptureTs ?? timelineRows[0].capture_ts;
    const rangeEndTs = bounds.lastCaptureTs ?? timelineRows[timelineRows.length - 1].capture_ts;

    if (currentMediaIds.length === 0) {
      const pendingRound = restorePendingTimelineSortRound(
        exportId,
        timelineRows,
        modeState.pendingRound,
        rangeStartTs,
        rangeEndTs
      );

      if (pendingRound) {
        return pendingRound;
      }
    }

    if (currentMediaIds.length > 0) {
      const currentRows = getRowsByIds(timelineRows, currentMediaIds);
      if (currentRows.length !== currentMediaIds.length) {
        return null;
      }

      const blockedIds = new Set(currentMediaIds);
      const blockedTimestamps = getTimelineTimestamps(currentRows);
      const nextRow = pickRandomTimelineRow(timelineRows, blockedIds, blockedTimestamps);

      if (!nextRow) {
        return null;
      }

      return {
        mode: 'timeline-sort',
        rangeStartTs,
        rangeEndTs,
        items: [...currentRows, nextRow]
          .sort((left, right) => left.capture_ts - right.capture_ts)
          .map((row) => mapTimelineMediaCard(exportId, row)),
        newlyAddedId: nextRow.id
      };
    }

    const starters = pickStartingTimelineRows(timelineRows);

    if (starters.length < 2) {
      return null;
    }

    return {
      mode: 'timeline-sort',
      rangeStartTs,
      rangeEndTs,
      items: starters
        .slice()
        .sort((left, right) => left.capture_ts - right.capture_ts)
        .map((row) => mapTimelineMediaCard(exportId, row)),
      newlyAddedId: starters[starters.length - 1]?.id ?? starters[0].id
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

export async function saveSeenMediaIds(
  exportId: string,
  mode: GameMode,
  streak: number,
  seenMediaIds: string[],
  pendingRound: PendingRoundState | null = null
) {
  const db = openExportDatabase(exportId);
  try {
    persistSeenMediaIds(db, mode, streak, seenMediaIds, pendingRound);
  } finally {
    db.close();
  }
}

export async function deleteMedia(exportId: string, mediaId: string): Promise<void> {
  const db = openExportDatabase(exportId);
  let relativePath = '';

  try {
    relativePath = deleteMediaRecord(db, mediaId);
  } finally {
    db.close();
  }

  await removeExportMediaFile(exportId, relativePath);
}

function filterRecent<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const blocked = new Set(ids.slice(-40));
  return rows.filter((row) => !blocked.has(row.id));
}

function restorePendingLocationRound(
  exportId: string,
  rows: MediaRow[],
  pendingRound: PendingRoundState | null,
  streak: number
): LocationRound | null {
  if (!pendingRound || pendingRound.mode !== 'location') {
    return null;
  }

  const row = rows.find((candidate) => candidate.id === pendingRound.mediaId);
  if (!row || row.lat == null || row.lng == null) {
    return null;
  }

  return {
    mode: 'location',
    media: mapMediaCard(exportId, row),
    allowedRadiusKm: getAllowedRadiusKm(streak),
    answer: {
      lat: row.lat,
      lng: row.lng
    }
  };
}

function restorePendingOlderVsNewerRound(
  exportId: string,
  rows: MediaRow[],
  pendingRound: PendingRoundState | null
): OlderVsNewerRound | null {
  if (!pendingRound || pendingRound.mode !== 'older-newer') {
    return null;
  }

  const left = rows.find((candidate) => candidate.id === pendingRound.leftId);
  const right = rows.find((candidate) => candidate.id === pendingRound.rightId);

  if (!left || !right || left.capture_ts == null || right.capture_ts == null) {
    return null;
  }

  const gapDays = Math.round(Math.abs(left.capture_ts - right.capture_ts) / (24 * 60 * 60 * 1000));

  return {
    mode: 'older-newer',
    left: {
      ...mapMediaCard(exportId, left),
      captureTs: left.capture_ts
    },
    right: {
      ...mapMediaCard(exportId, right),
      captureTs: right.capture_ts
    },
    correctSide: left.capture_ts > right.capture_ts ? 'left' : 'right',
    gapDays
  };
}

function restorePendingTimelineSortRound(
  exportId: string,
  rows: TimelineMediaRow[],
  pendingRound: PendingRoundState | null,
  rangeStartTs: number,
  rangeEndTs: number
): TimelineSortRound | null {
  if (!pendingRound || pendingRound.mode !== 'timeline-sort') {
    return null;
  }

  const pendingRows = getRowsByIds(rows, pendingRound.itemIds);
  if (pendingRows.length !== pendingRound.itemIds.length || pendingRows.length < 2) {
    return null;
  }

  return {
    mode: 'timeline-sort',
    rangeStartTs,
    rangeEndTs,
    items: pendingRows
      .slice()
      .sort((left, right) => left.capture_ts - right.capture_ts)
      .map((row) => mapTimelineMediaCard(exportId, row)),
    newlyAddedId: pendingRound.newlyAddedId
  };
}

function pickFromPool<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return items[Math.floor(Math.random() * items.length)];
}

function buildTimelineRows(rows: MediaRow[]): TimelineMediaRow[] {
  return rows
    .filter((row): row is TimelineMediaRow => row.capture_ts != null)
    .map((row) => ({
      ...row,
      capture_ts: row.capture_ts
    }))
    .sort((left, right) => left.capture_ts - right.capture_ts);
}

function getRowsByIds(rows: TimelineMediaRow[], ids: string[]): TimelineMediaRow[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => rowsById.get(id)).filter((row): row is TimelineMediaRow => Boolean(row));
}

function pickStartingTimelineRows(rows: TimelineMediaRow[]): TimelineMediaRow[] {
  if (rows.length < 2) {
    return [];
  }

  const first = pickFromPool(rows);
  if (!first) {
    return [];
  }

  const second = pickRandomTimelineRow(rows, new Set([first.id]), new Set([first.capture_ts]));

  if (!second) {
    return [];
  }

  return [first, second];
}

function pickRandomTimelineRow(
  rows: TimelineMediaRow[],
  blockedIds: Set<string>,
  blockedTimestamps: Set<number>
): TimelineMediaRow | null {
  return pickFromPool(rows.filter((row) => !blockedIds.has(row.id) && !blockedTimestamps.has(row.capture_ts))) ?? null;
}

function getTimelineTimestamps(rows: TimelineMediaRow[]): Set<number> {
  return new Set(rows.map((row) => row.capture_ts));
}

function mapMediaCard(exportId: string, row: MediaRow) {
  const exportRoot = getExportPaths(exportId).root;
  const imagePath = path.join(exportRoot, row.relative_path);

  return {
    id: row.id,
    filename: row.filename,
    imageUrl: toMediaUrl(imagePath),
    captureDateLabel: row.capture_ts ? new Date(row.capture_ts).toLocaleDateString() : null,
    locationLabel:
      row.lat != null && row.lng != null
        ? `${Math.abs(row.lat).toFixed(1)}deg${row.lat >= 0 ? 'N' : 'S'}, ${Math.abs(row.lng).toFixed(1)}deg${row.lng >= 0 ? 'E' : 'W'}`
        : null
  };
}

function mapTimelineMediaCard(exportId: string, row: TimelineMediaRow): TimelineRoundMedia {
  return {
    ...mapMediaCard(exportId, row),
    captureTs: row.capture_ts
  };
}

function toMediaUrl(filePath: string): string {
  return `memoryquiz-media://${encodeURIComponent(filePath)}`;
}
