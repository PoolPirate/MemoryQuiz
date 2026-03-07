import { promises as fs } from 'node:fs';

import type { AppState, ExportRegistryEntry } from '../../lib/types/models';

import { getRootPaths, pathExists, writeJsonFile } from './storage';

function getDefaultState(): AppState {
  return {
    exports: [],
    lastSelectedExportId: null,
    updatedAt: new Date().toISOString()
  };
}

export async function loadAppState(): Promise<AppState> {
  const { appStatePath } = getRootPaths();
  if (!(await pathExists(appStatePath))) {
    return getDefaultState();
  }

  try {
    const raw = await fs.readFile(appStatePath, 'utf8');
    const parsed = JSON.parse(raw) as AppState;
    return {
      ...getDefaultState(),
      ...parsed,
      exports: Array.isArray(parsed.exports) ? parsed.exports : []
    };
  } catch {
    return getDefaultState();
  }
}

export async function saveAppState(state: AppState): Promise<void> {
  const nextState = {
    ...state,
    updatedAt: new Date().toISOString()
  };
  await writeJsonFile(getRootPaths().appStatePath, nextState);
}

export async function upsertRegistryEntry(entry: ExportRegistryEntry): Promise<void> {
  const state = await loadAppState();
  const existingIndex = state.exports.findIndex((candidate) => candidate.id === entry.id);

  if (existingIndex >= 0) {
    state.exports[existingIndex] = entry;
  } else {
    state.exports.unshift(entry);
  }

  await saveAppState(state);
}

export async function removeRegistryEntry(exportId: string): Promise<void> {
  const state = await loadAppState();
  state.exports = state.exports.filter((entry) => entry.id !== exportId);
  if (state.lastSelectedExportId === exportId) {
    state.lastSelectedExportId = null;
  }
  await saveAppState(state);
}

export async function setLastSelectedExport(exportId: string | null): Promise<void> {
  const state = await loadAppState();
  state.lastSelectedExportId = exportId;
  await saveAppState(state);
}
