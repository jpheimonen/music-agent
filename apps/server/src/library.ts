import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { parseFile } from 'music-metadata';
import type { MediaItem } from '@music/contracts';

type FileRecord = { path: string; size: number; mtimeMs: number; id: string; item: MediaItem };
type Catalog = { revision: number; root?: string; files: FileRecord[]; diagnostics: string[] };
export class LibraryError extends Error { constructor(public code: string, public status = 503) { super(code); } }
function contained(root: string, candidate: string) { const rel = relative(root, candidate); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); }
export class LibraryService {
  private catalog: Catalog = { revision: 0, files: [], diagnostics: [] };
  private rootReal?: string;
  private scanning = false;
  private failure?: string;
  constructor(private root?: string, private dataDir = './data') {}
  get state() { return !this.root ? { state: 'not_configured' as const, reason: 'Set MUSIC_LIBRARY_ROOT.' } : this.failure ? { state: 'error' as const, reason: this.failure } : this.scanning ? { state: 'scanning' as const } : this.catalog.revision ? { state: 'ready' as const } : { state: 'scanning' as const, reason: 'Initial scan pending.' }; }
  get revision() { return this.catalog.revision; }
  get diagnostics() { return this.catalog.diagnostics; }
  async initialize() {
    if (!this.root) return;
    try { this.rootReal = await realpath(this.root); if (!(await stat(this.rootReal)).isDirectory()) throw Error('not directory'); }
    catch { this.failure = 'Configured library root is unreadable.'; return; }
    try {
      const value = JSON.parse(await readFile(join(this.dataDir, 'library-catalog.json'), 'utf8')) as Catalog;
      if (value.root === this.rootReal && Number.isInteger(value.revision) && Array.isArray(value.files)) this.catalog = value;
    } catch { /* Rebuildable cache absent or corrupt. */ }
  }
  async scan(full: boolean, signal?: AbortSignal, progress?: (value: number) => void) {
    if (!this.rootReal) throw new LibraryError('library_unavailable');
    if (this.scanning) throw new LibraryError('scan_in_progress', 409);
    this.scanning = true;
    const root = this.rootReal;
    try {
      const paths: string[] = []; const diagnostics: string[] = [];
      const walk = async (dir: string) => {
        if (signal?.aborted) throw new LibraryError('cancelled');
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isSymbolicLink()) { diagnostics.push(`Skipped symlink: ${relative(root, path)}`); continue; }
          if (entry.isDirectory()) await walk(path);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp3')) paths.push(path);
        }
      };
      await walk(root);
      const previous = new Map(this.catalog.files.map(file => [file.path, file]));
      const files: FileRecord[] = [];
      for (let i = 0; i < paths.length; i++) {
        if (signal?.aborted) throw new LibraryError('cancelled');
        const path = paths[i];
        try {
          const real = await realpath(path);
          if (!contained(root, real)) throw Error('Outside library root');
          const info = await stat(real);
          const old = previous.get(path);
          if (!full && old && old.size === info.size && old.mtimeMs === info.mtimeMs) { files.push(old); continue; }
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(real)) { if (signal?.aborted) throw new LibraryError('cancelled'); hash.update(chunk); }
          const id = `local:${hash.digest('hex')}`;
          let tags: Awaited<ReturnType<typeof parseFile>> | undefined;
          try { tags = await parseFile(real, { duration: true }); } catch { /* Filename fallback. */ }
          const title = tags?.common.title?.trim() || basename(path, '.mp3');
          const name = tags?.common.artist?.trim();
          const artist = name ? { id: `tag:${name.normalize('NFKC').toLowerCase()}`, displayName: name, confidence: 'medium' as const, provenance: 'id3' } : null;
          const item: MediaItem = { id: id as MediaItem['id'], source: 'local', title, artist, availability: 'available', ...(tags?.common.album ? { album: tags.common.album } : {}), ...(tags?.format.duration ? { durationSeconds: tags.format.duration } : {}) };
          files.push({ path, size: info.size, mtimeMs: info.mtimeMs, id, item });
        } catch (error) { diagnostics.push(`Skipped ${relative(root, path)}: ${error instanceof Error ? error.message : 'unreadable'}`); }
        progress?.((i + 1) / Math.max(paths.length, 1));
      }
      const found = new Set(paths);
      for (const old of this.catalog.files) if (!found.has(old.path)) files.push({ ...old, item: { ...old.item, availability: 'unavailable' } });
      const next: Catalog = { revision: this.catalog.revision + 1, root, files, diagnostics };
      await mkdir(this.dataDir, { recursive: true });
      const temp = join(this.dataDir, `library-catalog-${process.pid}.tmp`);
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, join(this.dataDir, 'library-catalog.json'));
      this.catalog = next; this.failure = undefined;
      return { scanRevision: next.revision, indexedFiles: files.length, diagnostics };
    } catch (error) { if (!(error instanceof LibraryError && error.code === 'cancelled')) this.failure = 'Library scan failed.'; throw error; }
    finally { this.scanning = false; }
  }
  page(q = '', cursor = 0, limit = 50) {
    const unique = new Map<string, MediaItem>();
    for (const file of this.catalog.files) if (!unique.has(file.id)) unique.set(file.id, file.item);
    const normalized = q.trim().toLowerCase();
    const items = [...unique.values()].filter(item => !normalized || `${item.title} ${item.artist?.displayName || ''} ${item.album || ''}`.toLowerCase().includes(normalized)).sort((a,b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return { items: items.slice(cursor, cursor + limit), nextCursor: cursor + limit < items.length ? String(cursor + limit) : null, scanRevision: this.catalog.revision };
  }
  async open(id: string) {
    if (!this.rootReal) throw new LibraryError('library_unavailable');
    for (const record of this.catalog.files.filter(file => file.id === id)) {
      try {
        const real = await realpath(record.path);
        if (!contained(this.rootReal, real)) continue;
        const handle = await open(real, 'r');
        const openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
        if (!contained(this.rootReal, openedPath)) { await handle.close(); continue; }
        const info = await handle.stat();
        if (!info.isFile() || info.size !== record.size || info.mtimeMs !== record.mtimeMs) { await handle.close(); continue; }
        return { handle, size: info.size };
      } catch { /* Try alternative path. */ }
    }
    throw new LibraryError('media_missing', 404);
  }
}
export function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new LibraryError('invalid_range', 416);
  let start: number; let end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) throw new LibraryError('invalid_range', 416); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || size === 0) throw new LibraryError('invalid_range', 416);
  return { start, end: Math.min(end, size - 1) };
}
