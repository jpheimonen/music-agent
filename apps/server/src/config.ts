import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { z } from 'zod';
import type { StationId } from '@music/contracts';

const envSchema = z.object({
  MUSIC_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  MUSIC_LIBRARY_ROOT: z.string().optional(),
  MUSIC_DATA_DIR: z.string().default('./data'),
  MUSIC_CODEX_HOME: z.string().optional(),
  CODEX_HOME: z.string().optional(),
  MUSIC_CODEX_BIN: z.string().optional(),
  MUSIC_YTDLP_BIN: z.string().optional(),
  MUSIC_STATION_KEXP_URL: z.string().url().optional(),
  MUSIC_STATION_YLE1_URL: z.string().url().optional(),
  MUSIC_STATION_RADIO_HELSINKI_URL: z.string().url().optional(),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const dataDir = resolve(repositoryRoot, parsed.MUSIC_DATA_DIR);
  const userHome = userInfo().homedir;
  const selectedCodexHome = parsed.MUSIC_CODEX_HOME || parsed.CODEX_HOME || resolve(userHome, '.codex');
  const codexHomeSource = parsed.MUSIC_CODEX_HOME ? 'MUSIC_CODEX_HOME' : parsed.CODEX_HOME ? 'CODEX_HOME' : 'user_home';
  if (parsed.MUSIC_LIBRARY_ROOT && !isAbsolute(parsed.MUSIC_LIBRARY_ROOT)) throw new Error('MUSIC_LIBRARY_ROOT must be absolute');
  if (parsed.MUSIC_YTDLP_BIN && !isAbsolute(parsed.MUSIC_YTDLP_BIN)) throw new Error('MUSIC_YTDLP_BIN must be absolute');
  for (const key of ['MUSIC_STATION_KEXP_URL','MUSIC_STATION_YLE1_URL','MUSIC_STATION_RADIO_HELSINKI_URL'] as const) {
    const value = parsed[key];
    if (value && (new URL(value).protocol !== 'https:' || new URL(value).username || new URL(value).password)) throw new Error(`${key} must be credential-free HTTPS`);
  }
  const stationOverrides: Partial<Record<StationId, string>> = { kexp: parsed.MUSIC_STATION_KEXP_URL, yle1: parsed.MUSIC_STATION_YLE1_URL, 'radio-helsinki': parsed.MUSIC_STATION_RADIO_HELSINKI_URL };
  return { port: parsed.MUSIC_PORT, libraryRoot: parsed.MUSIC_LIBRARY_ROOT, dataDir, userHome, codexHome: resolve(repositoryRoot, selectedCodexHome), codexHomeSource, codexBin: parsed.MUSIC_CODEX_BIN, ytdlpBin: parsed.MUSIC_YTDLP_BIN, stationOverrides };
}
export type Config = ReturnType<typeof loadConfig>;
