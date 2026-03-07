import type {
  AppOverview,
  ExportOverview,
  GameMode,
  ImportPreview,
  ImportResult,
  ImportProgressEvent,
  LocationRound,
  MediaCard,
  OlderVsNewerRound,
  PendingRoundState,
  TimelineSortRound
} from './models';

export interface MemoryQuizApi {
  getAppOverview(): Promise<AppOverview>;
  openTakeoutLink(): Promise<void>;
  pickImportZip(): Promise<string | null>;
  previewImportZip(filePath: string): Promise<ImportPreview>;
  importZip(preview: ImportPreview, libraryName: string, allowDuplicate?: boolean): Promise<ImportResult>;
  selectExport(exportId: string): Promise<void>;
  renameExport(exportId: string, name: string): Promise<ExportOverview>;
  deleteExport(exportId: string): Promise<void>;
  getModeOverview(exportId: string): Promise<ExportOverview>;
  createLocationRound(
    exportId: string,
    sessionSeenIds: string[],
    streak: number
  ): Promise<LocationRound | null>;
  createOlderVsNewerRound(
    exportId: string,
    sessionSeenIds: string[]
  ): Promise<OlderVsNewerRound | null>;
  createTimelineSortRound(
    exportId: string,
    sessionSeenIds: string[],
    currentMediaIds: string[]
  ): Promise<TimelineSortRound | null>;
  deleteMedia(exportId: string, mediaId: MediaCard['id']): Promise<void>;
  saveRunResult(exportId: string, mode: GameMode, streak: number, seenMediaIds: string[]): Promise<void>;
  saveSeenMediaIds(
    exportId: string,
    mode: GameMode,
    streak: number,
    seenMediaIds: string[],
    pendingRound?: PendingRoundState | null
  ): Promise<void>;
  onImportProgress(listener: (event: ImportProgressEvent) => void): () => void;
}
