import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { djMessage, djNote, type DjMessage, type DjNote, type ListeningEvent } from '@music/contracts';

const play = z.object({
  mediaId: z.string(), source: z.enum(['local', 'youtube']), title: z.string(), artist: z.string().nullable(),
  outcome: z.enum(['finished', 'skipped']), listenedSeconds: z.number(), durationSeconds: z.number().nullable(), at: z.string().datetime(),
});
const contents = z.object({ schemaVersion: z.literal(1), notes: z.array(djNote), conversation: z.array(djMessage), plays: z.array(play) });
type Contents = z.infer<typeof contents>;
export type Play = z.infer<typeof play>;
// Notes are what the DJ knows about you; the conversation and plays are recent context.
const limits = { notes: 60, conversation: 80, plays: 300 };
const sameText = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

// The DJ's memory of conversations and listening, in MUSIC_DATA_DIR/dj-memory.json.
// Likes and dislikes stay in the taste CSVs.
export class DjMemory {
  private data: Contents = { schemaVersion: 1, notes: [], conversation: [], plays: [] };
  private writes: Promise<unknown> = Promise.resolve();
  private constructor(private path: string) {}

  static async open(dataDir: string) {
    const memory = new DjMemory(join(dataDir, 'dj-memory.json'));
    let raw: string | null = null;
    try { raw = await readFile(memory.path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (raw !== null) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(raw); } catch { /* handled below */ }
      const valid = contents.safeParse(parsed);
      // An unreadable file is set aside rather than overwritten.
      if (valid.success) memory.data = valid.data;
      else await rename(memory.path, join(dataDir, `dj-memory.invalid-${Date.now()}.json`));
    }
    return memory;
  }

  get notes(): DjNote[] { return this.data.notes; }
  get conversation(): DjMessage[] { return this.data.conversation; }
  recentPlays(limit: number): Play[] { return this.data.plays.slice(-limit); }
  snapshot() { return { notes: this.data.notes, conversation: this.data.conversation }; }

  private save(change: (data: Contents) => Contents) {
    const write = this.writes.then(async () => {
      const next = change(this.data);
      const temp = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, this.path);
      this.data = next;
    });
    this.writes = write.catch(() => {});
    return write;
  }

  // Saves one exchange: your message (if any), the DJ's reply and the notes it learned.
  async recordExchange(exchange: { you: string | null; reply: string; suggestions: string[]; addNotes: string[]; removeNoteIds: string[] }) {
    const at = new Date().toISOString();
    let message!: DjMessage;
    await this.save(data => {
      const kept = data.notes.filter(note => !exchange.removeNoteIds.includes(note.id));
      const added = exchange.addNotes
        .map(text => text.trim().slice(0, 200)).filter(Boolean)
        .filter((text, index, all) => !kept.some(note => sameText(note.text, text)) && all.findIndex(other => sameText(other, text)) === index)
        .slice(0, 5)
        .map(text => ({ id: randomUUID(), text, createdAt: at }));
      message = {
        id: randomUUID(), role: 'dj', text: exchange.reply.trim().slice(0, 1200), at,
        ...(exchange.suggestions.length ? { suggestions: exchange.suggestions.map(text => text.trim().slice(0, 80)).filter(Boolean).slice(0, 4) } : {}),
        ...(added.length ? { notesAdded: added } : {}),
      };
      const yours: DjMessage[] = exchange.you ? [{ id: randomUUID(), role: 'you', text: exchange.you.slice(0, 1200), at }] : [];
      return { ...data, notes: [...kept, ...added].slice(-limits.notes), conversation: [...data.conversation, ...yours, message].slice(-limits.conversation) };
    });
    return message;
  }

  replaceNotes(notes: DjNote[]) { return this.save(data => ({ ...data, notes: notes.slice(-limits.notes) })); }
  removeNote(id: string) { return this.save(data => ({ ...data, notes: data.notes.filter(note => note.id !== id) })); }
  clearConversation() { return this.save(data => ({ ...data, conversation: [] })); }

  recordPlay(event: ListeningEvent) {
    const entry: Play = {
      mediaId: event.media.id, source: event.media.source, title: event.media.title.slice(0, 300), artist: event.media.artist?.displayName.slice(0, 200) ?? null,
      outcome: event.outcome, listenedSeconds: Math.round(event.listenedSeconds), durationSeconds: event.durationSeconds === null ? null : Math.round(event.durationSeconds), at: new Date().toISOString(),
    };
    return this.save(data => ({ ...data, plays: [...data.plays, entry].slice(-limits.plays) }));
  }
}
