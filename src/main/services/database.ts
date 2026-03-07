import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import type { ExportOverview, GameMode, MediaIndexRecord } from '../../lib/types/models';

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
      thumbnail_relative_path TEXT,
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
      last_played_at TEXT,
      seen_media_json TEXT NOT NULL DEFAULT '[]'
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

  return db;
}

export function clearIndexedMedia(db: Database.Database): void {
  db.exec('DELETE FROM media_albums; DELETE FROM albums; DELETE FROM media;');
}

export function writeMediaIndex(db: Database.Database, records: MediaIndexRecord[]): void {
  clearIndexedMedia(db);

  const insertMedia = db.prepare(`
    INSERT INTO media (
      id, content_hash, relative_path, source_relative_path, filename, mime_type,
      width, height, capture_ts, lat, lng, thumbnail_relative_path,
      location_score, date_score, general_score, exclusion_reason, burst_key
    ) VALUES (
      @id, @contentHash, @relativePath, @sourceRelativePath, @filename, @mimeType,
      @width, @height, @captureTs, @lat, @lng, @thumbnailRelativePath,
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
        thumbnailRelativePath: item.thumbnailRelativePath ?? null,
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
  values: { id: string; status: string; mediaCount: number; message?: string | null }
): void {
  db.prepare(
    `
      INSERT INTO import_runs (id, started_at, finished_at, status, media_count, message)
      VALUES (@id, @startedAt, @finishedAt, @status, @mediaCount, @message)
    `
  ).run({
    id: values.id,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: values.status,
    mediaCount: values.mediaCount,
    message: values.message ?? null
  });
}

export function getModeState(db: Database.Database, mode: GameMode) {
  const row = db
    .prepare('SELECT best_streak, last_played_at, seen_media_json FROM mode_state WHERE mode = ?')
    .get(mode) as { best_streak: number; last_played_at: string | null; seen_media_json: string } | undefined;

  return {
    bestStreak: row?.best_streak ?? 0,
    lastPlayedAt: row?.last_played_at ?? null,
    seenMediaIds: row ? (JSON.parse(row.seen_media_json) as string[]) : []
  };
}

export function getModeStats(db: Database.Database, mode: GameMode) {
  const whereClause = mode === 'location' ? 'location_score > 0' : 'date_score > 0';
  const playableCount =
    (db.prepare(`SELECT COUNT(*) AS count FROM media WHERE exclusion_reason IS NULL AND ${whereClause}`).get() as {
      count: number;
    }).count ?? 0;
  const modeState = getModeState(db, mode);

  return {
    playableCount,
    bestStreak: modeState.bestStreak,
    lastPlayedAt: modeState.lastPlayedAt
  };
}

export function getPhotoCount(db: Database.Database): number {
  return ((db.prepare('SELECT COUNT(*) AS count FROM media').get() as { count: number }).count ?? 0);
}

export function saveRunResult(
  db: Database.Database,
  mode: GameMode,
  streak: number,
  seenMediaIds: string[]
): void {
  const now = new Date().toISOString();
  const currentState = getModeState(db, mode);
  const nextSeen = [...currentState.seenMediaIds, ...seenMediaIds].slice(-200);

  db.prepare('INSERT INTO scores (id, mode, streak, played_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    mode,
    streak,
    now
  );

  db.prepare(
    `
      INSERT INTO mode_state (mode, best_streak, last_played_at, seen_media_json)
      VALUES (@mode, @bestStreak, @lastPlayedAt, @seenMediaJson)
      ON CONFLICT(mode) DO UPDATE SET
        best_streak = MAX(best_streak, excluded.best_streak),
        last_played_at = excluded.last_played_at,
        seen_media_json = excluded.seen_media_json
    `
  ).run({
    mode,
    bestStreak: Math.max(streak, currentState.bestStreak),
    lastPlayedAt: now,
    seenMediaJson: JSON.stringify(nextSeen)
  });
}

export function decorateOverview(base: ExportOverview, db: Database.Database): ExportOverview {
  return {
    ...base,
    photoCount: getPhotoCount(db),
    modeStats: {
      location: getModeStats(db, 'location'),
      'older-newer': getModeStats(db, 'older-newer')
    }
  };
}
