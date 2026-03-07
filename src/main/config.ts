import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'MemoryQuiz';

export function getAppDataRoot(): string {
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_NAME);
  }

  return path.join(os.homedir(), `.${APP_NAME.toLowerCase()}`);
}

export function isDevelopment(): boolean {
  return !process.env.APP_IS_PACKAGED;
}
