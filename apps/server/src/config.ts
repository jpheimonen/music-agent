import { resolve, isAbsolute } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  MUSIC_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  MUSIC_LIBRARY_ROOT: z.string().optional(),
  MUSIC_DATA_DIR: z.string().default('./data'),
  YOUTUBE_DATA_API_KEY: z.string().optional(),
  MUSIC_CODEX_HOME: z.string().optional(),
  MUSIC_CODEX_BIN: z.string().optional(),
  MUSIC_STATION_KEXP_URL: z.string().url().optional(),
  MUSIC_STATION_YLE1_URL: z.string().url().optional(),
  MUSIC_STATION_RADIO_HELSINKI_URL: z.string().url().optional(),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  if (parsed.MUSIC_LIBRARY_ROOT && !isAbsolute(parsed.MUSIC_LIBRARY_ROOT)) throw new Error('MUSIC_LIBRARY_ROOT must be absolute');
  for (const key of ['MUSIC_STATION_KEXP_URL','MUSIC_STATION_YLE1_URL','MUSIC_STATION_RADIO_HELSINKI_URL'] as const) {
    const value = parsed[key];
    if (value && (new URL(value).protocol !== 'https:' || new URL(value).username || new URL(value).password)) throw new Error(`${key} must be credential-free HTTPS`);
  }
  return { port: parsed.MUSIC_PORT, libraryRoot: parsed.MUSIC_LIBRARY_ROOT, dataDir: resolve(parsed.MUSIC_DATA_DIR), codexHome: resolve(parsed.MUSIC_CODEX_HOME ?? resolve(parsed.MUSIC_DATA_DIR, 'codex-home')), codexBin: parsed.MUSIC_CODEX_BIN, youtubeKey: parsed.YOUTUBE_DATA_API_KEY, youtubeConfigured: Boolean(parsed.YOUTUBE_DATA_API_KEY), stationOverrides: { kexp: parsed.MUSIC_STATION_KEXP_URL, yle1: parsed.MUSIC_STATION_YLE1_URL, 'radio-helsinki': parsed.MUSIC_STATION_RADIO_HELSINKI_URL } };
}
export type Config = ReturnType<typeof loadConfig>;
