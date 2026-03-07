export type ExportStatus = 'ready' | 'importing' | 'indexing' | 'failed' | 'missing';

export type GameMode = 'location' | 'older-newer';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ModeStats {
  playableCount: number;
  bestStreak: number;
  lastPlayedAt?: string | null;
}

export interface ExportRegistryEntry {
  id: string;
  name: string;
  sourceZipName: string;
  sourceZipHash: string;
  createdAt: string;
  updatedAt: string;
  importedAt?: string;
  indexedAt?: string;
  status: ExportStatus;
  lastError?: string | null;
}

export interface ExportOverview extends ExportRegistryEntry {
  sizeOnDiskBytes: number;
  photoCount: number;
  modeStats: Record<GameMode, ModeStats>;
  existsOnDisk: boolean;
}

export interface AppOverview {
  exports: ExportOverview[];
  lastSelectedExportId?: string | null;
  appDataRoot: string;
}

export interface ImportPreview {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  hash: string;
  duplicateOf?: ExportRegistryEntry | null;
}

export interface ImportProgressEvent {
  stage: 'copying' | 'extracting' | 'indexing' | 'finalizing' | 'done' | 'error';
  progress: number;
  message: string;
}

export interface MediaCard {
  id: string;
  filename: string;
  imageUrl: string;
  thumbnailUrl: string;
  captureDateLabel?: string | null;
  locationLabel?: string | null;
}

export interface LocationRound {
  mode: 'location';
  media: MediaCard;
  allowedRadiusKm: number;
  answer: GeoPoint;
}

export interface OlderVsNewerRound {
  mode: 'older-newer';
  left: MediaCard & { captureTs: number };
  right: MediaCard & { captureTs: number };
  correctSide: 'left' | 'right';
  gapDays: number;
}

export interface ScoreSummary {
  mode: GameMode;
  streak: number;
  playedAt: string;
}

export interface AppState {
  exports: ExportRegistryEntry[];
  lastSelectedExportId?: string | null;
  updatedAt: string;
}

export interface MediaIndexRecord {
  id: string;
  contentHash: string;
  relativePath: string;
  sourceRelativePath: string;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  captureTs?: number | null;
  lat?: number | null;
  lng?: number | null;
  albumNames: string[];
  thumbnailRelativePath?: string | null;
  locationScore: number;
  dateScore: number;
  generalScore: number;
  exclusionReason?: string | null;
  burstKey?: string | null;
}
