import type {
  AppOverview,
  ExportOverview,
  GameMode,
  ImportPreview,
  ImportProgressEvent,
  LocationRound,
  OlderVsNewerRound
} from './models';

export interface MemoryQuizApi {
  getAppOverview(): Promise<AppOverview>;
  openTakeoutLink(): Promise<void>;
  pickImportZip(): Promise<ImportPreview | null>;
  importZip(filePath: string, allowDuplicate?: boolean): Promise<ExportOverview>;
  selectExport(exportId: string): Promise<void>;
  renameExport(exportId: string, name: string): Promise<ExportOverview>;
  deleteExport(exportId: string): Promise<void>;
  reindexExport(exportId: string): Promise<ExportOverview>;
  getModeOverview(exportId: string): Promise<ExportOverview>;
  createLocationRound(
    exportId: string,
    sessionSeenIds: string[],
    streak: number
  ): Promise<LocationRound | null>;
  createOlderVsNewerRound(
    exportId: string,
    sessionSeenIds: string[],
    streak: number
  ): Promise<OlderVsNewerRound | null>;
  saveRunResult(exportId: string, mode: GameMode, streak: number, seenMediaIds: string[]): Promise<void>;
  onImportProgress(listener: (event: ImportProgressEvent) => void): () => void;
}
