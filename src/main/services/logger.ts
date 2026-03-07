import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getRootPaths } from './storage';

export async function logLine(filename: string, message: string): Promise<void> {
  const { logsDir } = getRootPaths();
  const timestamp = new Date().toISOString();
  const target = path.join(logsDir, filename);
  await fs.mkdir(logsDir, { recursive: true });
  await fs.appendFile(target, `[${timestamp}] ${message}\n`, 'utf8');
}
