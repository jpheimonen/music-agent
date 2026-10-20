import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { feedbackId, reaction, type MediaItem, type RadioSong } from '@music/contracts';

const names = ['likes.csv', 'dislikes.csv', 'musical_taste.md'] as const;
type Name = typeof names[number];
const header = 'schema_version,media_id,source,title,artist,recorded_at\r\n';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sources = ['local', 'youtube', 'radio'] as const;
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
// Stations differ in case and spacing, so those don't make a new song.
export const radioSongId = (song: RadioSong) => `radio:${digest(`${normalized(song.artist ?? '')}\n${normalized(song.title)}`)}`;
const manifestSchema = z.object({ schemaVersion: z.literal(1), feedbackRevision: z.number().int().nonnegative(), summaryRevision: z.number().int().nonnegative(), basedOnFeedbackRevision: z.number().int().nonnegative().nullable(), hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)), receipts: z.record(z.string(), z.object({ fingerprint: z.string(), mediaId: z.string(), reaction, feedbackRevision: z.number().int().nonnegative() })) });
type Manifest = z.infer<typeof manifestSchema>;
const journalSchema = z.object({ id: z.string().uuid(), base: manifestSchema, next: manifestSchema, after: z.record(z.string(), z.string()) });
type Journal = z.infer<typeof journalSchema>;
type Row = { mediaId: string; source: 'local' | 'youtube' | 'radio'; title: string; artist: string; recordedAt: string };
type State = { manifest: Manifest; files: Record<Name, string>; likes: Map<string, Row>; dislikes: Map<string, Row> };

export class TasteError extends Error {
  constructor(public code: 'revision_conflict' | 'external_file_change' | 'storage_unavailable' | 'invalid_import', message: string) { super(message); }
}

function csvCells(input: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let ended = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; ended = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || ended) throw new Error('Malformed CSV quoting');
      quoted = true;
    } else if (c === ',') { row.push(cell); cell = ''; ended = false; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; ended = false; }
    else if (c === '\r' && input[i + 1] === '\n') { /* CRLF handled by LF */ }
    else { if (ended) throw new Error('Malformed CSV quoting'); cell += c; }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || ended) { row.push(cell); rows.push(row); }
  return rows;
}
function parseCsv(input: string): Map<string, Row> {
  const rows = csvCells(input);
  if (rows.shift()?.join(',') !== header.trim()) throw new Error('Unsupported CSV header');
  const found = new Map<string, Row>();
  for (const cells of rows) {
    if (cells.length !== 6 || cells[0] !== '1') throw new Error('Unsupported CSV row');
    const [, id, source, title, artist, recordedAt] = cells;
    feedbackId.parse(id);
    if (!(sources as readonly string[]).includes(source) || !id.startsWith(`${source}:`) || !title || !Number.isFinite(Date.parse(recordedAt)) || new Date(recordedAt).toISOString() !== recordedAt) throw new Error('Invalid CSV row');
    if (found.has(id)) throw new Error('Duplicate feedback media ID');
    found.set(id, { mediaId: id, source: source as Row['source'], title, artist, recordedAt });
  }
  return found;
}
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function writeCsv(rows: Map<string, Row>) {
  return header + [...rows.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId)).map(r => ['1', r.mediaId, r.source, r.title, r.artist, r.recordedAt].map(quote).join(',') + '\r\n').join('');
}
function summaryFrontmatter(markdown: string) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error('Invalid taste Markdown front matter');
  const fields = Object.fromEntries(match[1].split('\n').map(line => { const at = line.indexOf(':'); if (at < 1) throw new Error('Invalid taste front matter'); return [line.slice(0, at), line.slice(at + 1).trim()]; }));
  if (fields.schema_version !== '1' || !/^\d+$/.test(fields.summary_revision) || !/^(\d+|null)$/.test(fields.based_on_feedback_revision) || !Number.isFinite(Date.parse(fields.generated_at))) throw new Error('Invalid taste front matter');
  return { revision: Number(fields.summary_revision), basedOn: fields.based_on_feedback_revision === 'null' ? null : Number(fields.based_on_feedback_revision) };
}
function markdown(revision: number, basedOn: number | null, body: string) {
  return `---\nschema_version: 1\nsummary_revision: ${revision}\nbased_on_feedback_revision: ${basedOn ?? 'null'}\ngenerated_at: ${new Date().toISOString()}\n---\n${body.trim()}\n`;
}
async function atomicFile(path: string, contents: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(contents, 'utf8'); await fd.sync(); } finally { await fd.close(); }
  await rename(temp, path);
}
async function syncDir(dir: string) { try { const fd = await open(dir, constants.O_RDONLY); try { await fd.sync(); } finally { await fd.close(); } } catch { /* Directory fsync is unavailable on some filesystems. */ } }
async function maybeRead(path: string) { try { return await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } }

export class TasteRepository {
  private state!: State;
  private lockFd: Awaited<ReturnType<typeof open>> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private synthesis: 'idle' | 'pending' | 'failed' = 'idle';
  private poisoned = false;
  private constructor(public readonly dataDir: string) {}

  static async open(dataDir: string) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const repo = new TasteRepository(dataDir);
    try {
      repo.lockFd = await open(join(dataDir, '.taste.lock'), 'wx', 0o600);
      await repo.lockFd.writeFile(`${process.pid}\n`); await repo.lockFd.sync();
    } catch (e) {
      if (repo.lockFd) { await repo.lockFd.close(); repo.lockFd = null; await rm(join(dataDir, '.taste.lock'), { force: true }); }
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        const owner = Number((await maybeRead(join(dataDir, '.taste.lock')))?.trim());
        if (Number.isSafeInteger(owner) && owner > 0 && owner !== process.pid) {
          let alive = true;
          try { process.kill(owner, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
          if (!alive) {
            await rm(join(dataDir, '.taste.lock'));
            try {
              repo.lockFd = await open(join(dataDir, '.taste.lock'), 'wx', 0o600);
              await repo.lockFd.writeFile(`${process.pid}\n`); await repo.lockFd.sync();
            } catch (retryError) {
              if (repo.lockFd) { await repo.lockFd.close(); repo.lockFd = null; await rm(join(dataDir, '.taste.lock'), { force: true }); }
              throw new TasteError('storage_unavailable', `Taste lock could not be acquired: ${String(retryError)}`);
            }
          }
        }
      }
      if (!repo.lockFd) throw new TasteError('storage_unavailable', `Taste directory is already in use or inaccessible: ${String(e)}`);
    }
    try { await repo.initialize(); return repo; } catch (e) { await repo.close(); throw e; }
  }
  async close() { if (this.lockFd) { await this.lockFd.close(); this.lockFd = null; await rm(join(this.dataDir, '.taste.lock'), { force: true }); } }
  private async initialize() {
    await this.recover();
    const fileValues = await Promise.all(names.map(name => maybeRead(join(this.dataDir, name))));
    const manifestText = await maybeRead(join(this.dataDir, 'taste-manifest.json'));
    if (fileValues.every(v => v === null) && manifestText === null) {
      const files = { 'likes.csv': header, 'dislikes.csv': header, 'musical_taste.md': markdown(0, null, '') };
      const manifest: Manifest = { schemaVersion: 1, feedbackRevision: 0, summaryRevision: 0, basedOnFeedbackRevision: null, hashes: Object.fromEntries(names.map(n => [n, digest(files[n])])), receipts: {} };
      for (const name of names) await atomicFile(join(this.dataDir, name), files[name]);
      await atomicFile(join(this.dataDir, 'taste-manifest.json'), JSON.stringify(manifest)); await syncDir(this.dataDir);
      this.state = this.validate(files, manifest); return;
    }
    if (fileValues.some(v => v === null)) throw new TasteError('storage_unavailable', 'Taste files are incomplete. Restore them before starting.');
    const files = Object.fromEntries(names.map((n, i) => [n, fileValues[i]])) as Record<Name, string>;
    if (manifestText === null) {
      // A validated offline import is backed up before introducing revisions.
      const provisional: Manifest = { schemaVersion: 1, feedbackRevision: 0, summaryRevision: 0, basedOnFeedbackRevision: null, hashes: Object.fromEntries(names.map(n => [n, digest(files[n])])), receipts: {} };
      const front = summaryFrontmatter(files['musical_taste.md']);
      provisional.summaryRevision = front.revision; provisional.basedOnFeedbackRevision = front.basedOn;
      provisional.feedbackRevision = front.basedOn ?? 0;
      this.validate(files, provisional);
      await this.backup(files);
      await atomicFile(join(this.dataDir, 'taste-manifest.json'), JSON.stringify(provisional)); await syncDir(this.dataDir);
      this.state = this.validate(files, provisional); return;
    }
    const manifest = manifestSchema.parse(JSON.parse(manifestText));
    if (names.some(n => digest(files[n]) !== manifest.hashes[n])) {
      // Offline edits are imported only after full validation and backup.
      const updated: Manifest = { ...manifest, feedbackRevision: manifest.feedbackRevision + 1, hashes: Object.fromEntries(names.map(n => [n, digest(files[n])])), receipts: {} };
      const front = summaryFrontmatter(files['musical_taste.md']);
      updated.summaryRevision = front.revision; updated.basedOnFeedbackRevision = front.basedOn;
      this.validate(files, updated); await this.backup(files);
      await atomicFile(join(this.dataDir, 'taste-manifest.json'), JSON.stringify(updated)); await syncDir(this.dataDir);
      this.state = this.validate(files, updated); return;
    }
    this.state = this.validate(files, manifest);
  }
  private validate(files: Record<Name, string>, manifest: Manifest): State {
    const likes = parseCsv(files['likes.csv']), dislikes = parseCsv(files['dislikes.csv']);
    for (const id of likes.keys()) if (dislikes.has(id)) throw new Error('Feedback exists in both CSV files');
    const front = summaryFrontmatter(files['musical_taste.md']);
    if (front.revision !== manifest.summaryRevision || front.basedOn !== manifest.basedOnFeedbackRevision || (front.basedOn !== null && front.basedOn > manifest.feedbackRevision)) throw new Error('Taste summary revision mismatch');
    return { files, manifest, likes, dislikes };
  }
  private async backup(files: Record<Name, string>) {
    const backup = join(this.dataDir, 'taste-last-known-good'); await mkdir(backup, { recursive: true, mode: 0o700 });
    for (const name of names) await atomicFile(join(backup, name), files[name]); await syncDir(backup);
  }
  private async recover() {
    const raw = await maybeRead(join(this.dataDir, 'taste-pending.json'));
    if (raw === null) return;
    let tx: Journal;
    try { tx = journalSchema.parse(JSON.parse(raw)); } catch { throw new TasteError('storage_unavailable', 'Malformed taste journal. Preserve the data directory for manual recovery.'); }
    if (tx.after['taste-manifest.json'] !== JSON.stringify(tx.next)) throw new TasteError('storage_unavailable', 'Invalid taste journal manifest.');
    for (const [name, image] of Object.entries(tx.after)) if (![...names, 'taste-manifest.json'].includes(name) || (name !== 'taste-manifest.json' && digest(image) !== tx.next.hashes[name])) throw new TasteError('storage_unavailable', 'Invalid taste journal after-image.');
    const recoveredFiles = {} as Record<Name, string>;
    for (const name of names) {
      const current = await maybeRead(join(this.dataDir, name));
      const hash = current === null ? null : digest(current);
      if (hash !== tx.base.hashes[name] && hash !== tx.next.hashes[name]) throw new TasteError('storage_unavailable', `Conflicting ${name} during taste recovery.`);
      const target = tx.after[name] ?? current;
      if (target === null || target === undefined || digest(target) !== tx.next.hashes[name]) throw new TasteError('storage_unavailable', `Incomplete ${name} taste recovery image.`);
      recoveredFiles[name] = target;
    }
    this.validate(recoveredFiles, tx.next);
    const currentManifest = await maybeRead(join(this.dataDir, 'taste-manifest.json'));
    if (currentManifest !== null) {
      const parsed = manifestSchema.parse(JSON.parse(currentManifest));
      if (JSON.stringify(parsed) !== JSON.stringify(tx.base) && JSON.stringify(parsed) !== JSON.stringify(tx.next)) throw new TasteError('storage_unavailable', 'Conflicting taste manifest during recovery.');
    }
    for (const [name, image] of Object.entries(tx.after)) await atomicFile(join(this.dataDir, name), image);
    await syncDir(this.dataDir); await rm(join(this.dataDir, 'taste-pending.json')); await syncDir(this.dataDir);
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run); this.chain = next.catch(() => {}); return next;
  }
  private async ensureUnchanged() {
    if (this.poisoned || await maybeRead(join(this.dataDir, 'taste-pending.json')) !== null) throw new TasteError('storage_unavailable', 'Taste commit needs restart recovery before another write.');
    for (const name of names) if (digest((await maybeRead(join(this.dataDir, name))) ?? '') !== this.state.manifest.hashes[name]) throw new TasteError('external_file_change', `External change to ${name}; restart to validate and import.`);
    const raw = await maybeRead(join(this.dataDir, 'taste-manifest.json'));
    if (!raw || JSON.stringify(manifestSchema.parse(JSON.parse(raw))) !== JSON.stringify(this.state.manifest)) throw new TasteError('external_file_change', 'External change to taste manifest; restart to inspect.');
  }
  private async commit(files: Record<Name, string>, manifest: Manifest) {
    const after: Record<string, string> = {};
    for (const name of names) if (files[name] !== this.state.files[name]) after[name] = files[name];
    after['taste-manifest.json'] = JSON.stringify(manifest);
    const tx: Journal = { id: randomUUID(), base: this.state.manifest, next: manifest, after };
    this.validate(files, manifest);
    await atomicFile(join(this.dataDir, 'taste-pending.json'), JSON.stringify(tx)); await syncDir(this.dataDir);
    try {
      for (const [name, image] of Object.entries(after)) await atomicFile(join(this.dataDir, name), image);
      await syncDir(this.dataDir); await rm(join(this.dataDir, 'taste-pending.json')); await syncDir(this.dataDir);
      this.state = this.validate(files, manifest);
    } catch (e) { this.poisoned = true; throw new TasteError('storage_unavailable', `Taste commit interrupted; restart to recover: ${String(e)}`); }
  }
  snapshot(ids?: string[]) {
    const { manifest, likes, dislikes, files } = this.state;
    const feedback: Record<string, 'like' | 'dislike'> = {};
    for (const id of ids ?? [...new Set([...likes.keys(), ...dislikes.keys()])]) { if (likes.has(id)) feedback[id] = 'like'; else if (dislikes.has(id)) feedback[id] = 'dislike'; }
    const body = files['musical_taste.md'].replace(/^---\n[\s\S]*?\n---\n/, '');
    const summaryStatus = this.synthesis === 'failed' ? 'failed' : this.synthesis === 'pending' || manifest.basedOnFeedbackRevision !== manifest.feedbackRevision ? 'pending' : 'current';
    return { feedbackRevision: manifest.feedbackRevision, summaryRevision: manifest.summaryRevision, summaryStatus, summaryMarkdown: body.trim() ? body : null, feedback };
  }
  agentContext(limit = 40) {
    const entries = [
      ...[...this.state.likes.values()].map(row => ({ ...row, reaction: 'like' as const })),
      ...[...this.state.dislikes.values()].map(row => ({ ...row, reaction: 'dislike' as const })),
    ];
    return entries.sort((a,b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0,limit).map(({mediaId,source,title,artist,reaction}) => ({mediaId,source,title:title.slice(0,120),artist:artist.slice(0,100),reaction}));
  }
  setSynthesisStatus(status: 'idle' | 'pending' | 'failed') { this.synthesis = status; }
  async react(input: { mediaId: string; reaction: z.infer<typeof reaction>; expectedRevision: number; idempotencyKey: string; media?: MediaItem; radioSong?: RadioSong }) {
    return this.serialize(async () => {
      feedbackId.parse(input.mediaId); reaction.parse(input.reaction);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new Error('Invalid idempotency key');
      const fingerprint = digest(JSON.stringify({ mediaId: input.mediaId, reaction: input.reaction, expectedRevision: input.expectedRevision, media: input.media ?? null, radioSong: input.radioSong ?? null }));
      const receipt = this.state.manifest.receipts[input.idempotencyKey];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new TasteError('revision_conflict', 'Idempotency key was used for a different reaction.');
        return { mediaId: receipt.mediaId, reaction: receipt.reaction, feedbackRevision: receipt.feedbackRevision };
      }
      if (input.expectedRevision !== this.state.manifest.feedbackRevision) throw new TasteError('revision_conflict', 'Feedback revision changed; fetch current taste before retrying.');
      await this.ensureUnchanged();
      const likes = new Map(this.state.likes), dislikes = new Map(this.state.dislikes);
      const previous = likes.get(input.mediaId) ?? dislikes.get(input.mediaId);
      likes.delete(input.mediaId); dislikes.delete(input.mediaId);
      if (input.reaction !== 'neutral') {
        const source = input.mediaId.split(':')[0] as Row['source'];
        if (input.media && (input.media.id !== input.mediaId || input.media.source !== source)) throw new Error('Media identity mismatch');
        if (input.radioSong && radioSongId(input.radioSong) !== input.mediaId) throw new Error('Radio song identity mismatch');
        const described = input.media ? { title: input.media.title, artist: input.media.artist?.displayName ?? '' } : input.radioSong ? { title: input.radioSong.title, artist: input.radioSong.artist ?? '' } : null;
        // A radio song has no other record of its name, so it must arrive with it.
        if (source === 'radio' && !described && !previous) throw new Error('A radio song reaction needs the song title');
        const row: Row = { mediaId: input.mediaId, source, title: described?.title ?? previous?.title ?? input.mediaId, artist: described?.artist ?? previous?.artist ?? '', recordedAt: new Date().toISOString() };
        (input.reaction === 'like' ? likes : dislikes).set(input.mediaId, row);
      }
      const files = { ...this.state.files, 'likes.csv': writeCsv(likes), 'dislikes.csv': writeCsv(dislikes) };
      const nextRevision = this.state.manifest.feedbackRevision + 1;
      const receipts = { ...this.state.manifest.receipts, [input.idempotencyKey]: { fingerprint, mediaId: input.mediaId, reaction: input.reaction, feedbackRevision: nextRevision } };
      const manifest: Manifest = { ...this.state.manifest, feedbackRevision: nextRevision, hashes: Object.fromEntries(names.map(n => [n, digest(files[n])])), receipts };
      await this.commit(files, manifest);
      return { mediaId: input.mediaId, reaction: input.reaction, feedbackRevision: nextRevision };
    });
  }
  // The taste files exactly as saved, and the feedback revision the summary's based_on_feedback_revision refers to.
  exportFiles() { return { feedbackRevision: this.state.manifest.feedbackRevision, files: { ...this.state.files } }; }
  // Replaces all taste with files exported from another machine. Revisions keep counting up from this
  // machine's, and the summary stays current only if it was current where it was exported.
  async replaceAll(input: { files: Record<Name, string>; feedbackRevision: number }) {
    return this.serialize(async () => {
      let summary: ReturnType<typeof summaryFrontmatter>;
      try {
        const likes = parseCsv(input.files['likes.csv']), dislikes = parseCsv(input.files['dislikes.csv']);
        for (const id of likes.keys()) if (dislikes.has(id)) throw new Error('A song is both liked and disliked');
        summary = summaryFrontmatter(input.files['musical_taste.md']);
      } catch (e) { throw new TasteError('invalid_import', `The taste file is not valid: ${(e as Error).message}.`); }
      await this.ensureUnchanged();
      const feedbackRevision = this.state.manifest.feedbackRevision + 1, summaryRevision = this.state.manifest.summaryRevision + 1;
      const basedOn = summary.revision > 0 && summary.basedOn === input.feedbackRevision ? feedbackRevision : null;
      const body = input.files['musical_taste.md'].replace(/^---\n[\s\S]*?\n---\n/, '');
      const files = { 'likes.csv': input.files['likes.csv'], 'dislikes.csv': input.files['dislikes.csv'], 'musical_taste.md': markdown(summaryRevision, basedOn, body) };
      const manifest: Manifest = { ...this.state.manifest, feedbackRevision, summaryRevision, basedOnFeedbackRevision: basedOn, hashes: Object.fromEntries(names.map(n => [n, digest(files[n])])) };
      await this.commit(files, manifest); this.synthesis = 'idle'; return this.snapshot();
    });
  }
  // Trusted Codex boundary: generated narrative only, never explicit feedback rows.
  async commitSummary(input: { body: string; basedOnFeedbackRevision: number; expectedSummaryRevision: number }) {
    return this.serialize(async () => {
      if (input.basedOnFeedbackRevision !== this.state.manifest.feedbackRevision || input.expectedSummaryRevision !== this.state.manifest.summaryRevision) throw new TasteError('revision_conflict', 'Stale taste synthesis; regenerate from current feedback.');
      if (input.body.length > 20000 || /<\/?[A-Za-z][^>]*>/.test(input.body)) throw new Error('Invalid taste summary');
      await this.ensureUnchanged();
      const summaryRevision = this.state.manifest.summaryRevision + 1;
      const files = { ...this.state.files, 'musical_taste.md': markdown(summaryRevision, input.basedOnFeedbackRevision, input.body) };
      const manifest: Manifest = { ...this.state.manifest, summaryRevision, basedOnFeedbackRevision: input.basedOnFeedbackRevision, hashes: Object.fromEntries(names.map(n => [n, digest(files[n])])) };
      await this.commit(files, manifest); this.synthesis = 'idle'; return this.snapshot();
    });
  }
}
