import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import type { ExportOverview, GameMode, MediaIndexRecord, PendingRoundState } from '../../lib/types/models';

import { getExportPaths } from './storage';

export function openExportDatabase(exportId: string): Database.Database {
  const db = new Database(getExportPaths(exportId).dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL,
      source_relative_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      capture_ts INTEGER,
      lat REAL,
      lng REAL,
      location_score REAL NOT NULL DEFAULT 0,
      date_score REAL NOT NULL DEFAULT 0,
      general_score REAL NOT NULL DEFAULT 0,
      exclusion_reason TEXT,
      burst_key TEXT
    );

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS media_albums (
      media_id TEXT NOT NULL,
      album_id TEXT NOT NULL,
      PRIMARY KEY (media_id, album_id),
      FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE,
      FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      streak INTEGER NOT NULL,
      played_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mode_state (
      mode TEXT PRIMARY KEY,
      best_streak INTEGER NOT NULL DEFAULT 0,
      active_streak INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      seen_media_json TEXT NOT NULL DEFAULT '[]',
      pending_round_json TEXT
    );

    CREATE TABLE IF NOT EXISTS import_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      warning_count INTEGER NOT NULL DEFAULT 0,
      media_count INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );
  `);

  ensureModeStateSchema(db);

  return db;
}

function ensureModeStateSchema(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(mode_state)').all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === 'active_streak')) {
    db.prepare('ALTER TABLE mode_state ADD COLUMN active_streak INTEGER NOT NULL DEFAULT 0').run();
  }

  if (!columns.some((column) => column.name === 'pending_round_json')) {
    db.prepare('ALTER TABLE mode_state ADD COLUMN pending_round_json TEXT').run();
  }
}

export function clearIndexedMedia(db: Database.Database): void {
  db.exec('DELETE FROM media_albums; DELETE FROM albums; DELETE FROM media;');
}

export function writeMediaIndex(db: Database.Database, records: MediaIndexRecord[]): void {
  clearIndexedMedia(db);

  const insertMedia = db.prepare(`
    INSERT INTO media (
      id, content_hash, relative_path, source_relative_path, filename, mime_type,
      width, height, capture_ts, lat, lng,
      location_score, date_score, general_score, exclusion_reason, burst_key
    ) VALUES (
      @id, @contentHash, @relativePath, @sourceRelativePath, @filename, @mimeType,
      @width, @height, @captureTs, @lat, @lng,
      @locationScore, @dateScore, @generalScore, @exclusionReason, @burstKey
    );
  `);
  const insertAlbum = db.prepare('INSERT OR IGNORE INTO albums (id, name) VALUES (?, ?)');
  const findAlbum = db.prepare('SELECT id FROM albums WHERE name = ?');
  const insertMediaAlbum = db.prepare('INSERT OR IGNORE INTO media_albums (media_id, album_id) VALUES (?, ?)');

  const writeAll = db.transaction((items: MediaIndexRecord[]) => {
    for (const item of items) {
      insertMedia.run({
        ...item,
        captureTs: item.captureTs ?? null,
        lat: item.lat ?? null,
        lng: item.lng ?? null,
        exclusionReason: item.exclusionReason ?? null,
        burstKey: item.burstKey ?? null
      });

      for (const albumName of item.albumNames) {
        const albumRow = findAlbum.get(albumName) as { id: string } | undefined;
        let albumId = albumRow?.id;
        if (!albumId) {
          albumId = randomUUID();
          insertAlbum.run(albumId, albumName);
        }
        insertMediaAlbum.run(item.id, albumId);
      }
    }
  });

  writeAll(records);
}

export function recordImportRun(
  db: Database.Database,
  values: { id: string; status: string; warningCount?: number; mediaCount: number; message?: string | null }
): void {
  db.prepare(
    `
      INSERT INTO import_runs (id, started_at, finished_at, status, warning_count, media_count, message)
      VALUES (@id, @startedAt, @finishedAt, @status, @warningCount, @mediaCount, @message)
    `
  ).run({
    id: values.id,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: values.status,
    warningCount: values.warningCount ?? 0,
    mediaCount: values.mediaCount,
    message: values.message ?? null
  });
}

export function getModeState(db: Database.Database, mode: GameMode) {
  const row = db
    .prepare('SELECT best_streak, active_streak, last_played_at, seen_media_json, pending_round_json FROM mode_state WHERE mode = ?')
    .get(mode) as
    | {
        best_streak: number;
        active_streak: number;
        last_played_at: string | null;
        seen_media_json: string;
        pending_round_json: string | null;
      }
    | undefined;

  return {
    bestStreak: row?.best_streak ?? 0,
    activeStreak: row?.active_streak ?? 0,
    lastPlayedAt: row?.last_played_at ?? null,
    seenMediaIds: row ? (JSON.parse(row.seen_media_json) as string[]) : [],
    pendingRound: row?.pending_round_json ? (JSON.parse(row.pending_round_json) as PendingRoundState) : null
  };
}

export function getModeStats(db: Database.Database, mode: GameMode) {
  let playableCount = 0;

  if (mode === 'location') {
    playableCount =
      (db
        .prepare('SELECT COUNT(*) AS count FROM media WHERE exclusion_reason IS NULL AND location_score > 0')
        .get() as { count: number }).count ?? 0;
  } else if (mode === 'older-newer') {
    playableCount =
      (db
        .prepare('SELECT COUNT(*) AS count FROM media WHERE exclusion_reason IS NULL AND date_score > 0 AND capture_ts IS NOT NULL')
        .get() as { count: number }).count ?? 0;
    } else {
      playableCount =
        (db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM media
            WHERE exclusion_reason IS NULL AND date_score > 0 AND capture_ts IS NOT NULL
          `
        )
        .get() as { count: number }).count ?? 0;
  }

  const modeState = getModeState(db, mode);

  return {
    playableCount,
    activeStreak: modeState.activeStreak,
    bestStreak: modeState.bestStreak,
    lastPlayedAt: modeState.lastPlayedAt
  };
}

export function getPhotoCount(db: Database.Database): number {
  return ((db.prepare('SELECT COUNT(*) AS count FROM media').get() as { count: number }).count ?? 0);
}

export function getTimelineBounds(db: Database.Database): {
  firstCaptureTs: number | null;
  lastCaptureTs: number | null;
} {
  const row = db
    .prepare(
      `
        SELECT
          MIN(capture_ts) AS firstCaptureTs,
          MAX(capture_ts) AS lastCaptureTs
        FROM media
        WHERE exclusion_reason IS NULL AND date_score > 0 AND capture_ts IS NOT NULL
      `
    )
    .get() as { firstCaptureTs: number | null; lastCaptureTs: number | null } | undefined;

  return {
    firstCaptureTs: row?.firstCaptureTs ?? null,
    lastCaptureTs: row?.lastCaptureTs ?? null
  };
}

export function deleteMediaRecord(db: Database.Database, mediaId: string): string {
  const row = db.prepare('SELECT relative_path FROM media WHERE id = ?').get(mediaId) as
    | { relative_path: string }
    | undefined;

  if (!row) {
    throw new Error('Photo not found in this library.');
  }

  const deleteRecord = db.transaction((id: string) => {
    db.prepare('DELETE FROM media WHERE id = ?').run(id);

    const modeRows = db.prepare('SELECT mode, seen_media_json, pending_round_json FROM mode_state').all() as Array<{
      mode: GameMode;
      seen_media_json: string;
      pending_round_json: string | null;
    }>;
    const updateModeState = db.prepare('UPDATE mode_state SET seen_media_json = ?, pending_round_json = ? WHERE mode = ?');

    for (const modeRow of modeRows) {
      const nextSeenIds = (JSON.parse(modeRow.seen_media_json) as string[]).filter((seenId) => seenId !== id);
      const pendingRound = modeRow.pending_round_json
        ? (JSON.parse(modeRow.pending_round_json) as PendingRoundState)
        : null;
      updateModeState.run(
        JSON.stringify(nextSeenIds),
        serializePendingRound(removeDeletedMediaFromPendingRound(pendingRound, id)),
        modeRow.mode
      );
    }

    db.prepare('DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM media_albums)').run();
  });

  deleteRecord(mediaId);
  return row.relative_path;
}

export function saveRunResult(
  db: Database.Database,
  mode: GameMode,
  streak: number,
  seenMediaIds: string[]
): void {
  const now = new Date().toISOString();
  const currentState = getModeState(db, mode);
  const nextSeen = mergeSeenIds(currentState.seenMediaIds, seenMediaIds);

  db.prepare('INSERT INTO scores (id, mode, streak, played_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    mode,
    streak,
    now
  );

  db.prepare(
    `
      INSERT INTO mode_state (mode, best_streak, active_streak, last_played_at, seen_media_json, pending_round_json)
      VALUES (@mode, @bestStreak, @activeStreak, @lastPlayedAt, @seenMediaJson, @pendingRoundJson)
      ON CONFLICT(mode) DO UPDATE SET
        best_streak = MAX(best_streak, excluded.best_streak),
        active_streak = excluded.active_streak,
        last_played_at = excluded.last_played_at,
        seen_media_json = excluded.seen_media_json,
        pending_round_json = excluded.pending_round_json
    `
  ).run({
    mode,
    bestStreak: Math.max(streak, currentState.bestStreak),
    activeStreak: 0,
    lastPlayedAt: now,
    seenMediaJson: JSON.stringify(nextSeen),
    pendingRoundJson: null
  });
}

export function saveSeenMediaIds(
  db: Database.Database,
  mode: GameMode,
  streak: number,
  seenMediaIds: string[],
  pendingRound: PendingRoundState | null = null
): void {
  const currentState = getModeState(db, mode);
  const nextSeen = mergeSeenIds(currentState.seenMediaIds, seenMediaIds);
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO mode_state (mode, best_streak, active_streak, last_played_at, seen_media_json, pending_round_json)
      VALUES (@mode, @bestStreak, @activeStreak, @lastPlayedAt, @seenMediaJson, @pendingRoundJson)
      ON CONFLICT(mode) DO UPDATE SET
        best_streak = MAX(best_streak, excluded.best_streak),
        active_streak = excluded.active_streak,
        last_played_at = excluded.last_played_at,
        seen_media_json = excluded.seen_media_json,
        pending_round_json = excluded.pending_round_json
    `
  ).run({
    mode,
    bestStreak: Math.max(streak, currentState.bestStreak),
    activeStreak: streak,
    lastPlayedAt: now,
    seenMediaJson: JSON.stringify(nextSeen),
    pendingRoundJson: serializePendingRound(pendingRound)
  });
}

function mergeSeenIds(existingSeenIds: string[], seenMediaIds: string[]): string[] {
  return [...existingSeenIds, ...seenMediaIds].slice(-200);
}

function removeDeletedMediaFromPendingRound(
  pendingRound: PendingRoundState | null,
  mediaId: string
): PendingRoundState | null {
  if (!pendingRound) {
    return null;
  }

  if (pendingRound.mode === 'location') {
    return pendingRound.mediaId === mediaId ? null : pendingRound;
  }

  if (pendingRound.mode === 'older-newer') {
    return pendingRound.leftId === mediaId || pendingRound.rightId === mediaId ? null : pendingRound;
  }

  return pendingRound.itemIds.includes(mediaId) ? null : pendingRound;
}

function serializePendingRound(pendingRound: PendingRoundState | null): string | null {
  return pendingRound ? JSON.stringify(pendingRound) : null;
}

export function decorateOverview(base: ExportOverview, db: Database.Database): ExportOverview {
  return {
    ...base,
    photoCount: getPhotoCount(db),
    modeStats: {
      location: getModeStats(db, 'location'),
      'older-newer': getModeStats(db, 'older-newer'),
      'timeline-sort': getModeStats(db, 'timeline-sort')
    }
  };
}
