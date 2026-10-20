import { z } from 'zod';

export const mediaId = z.union([z.string().regex(/^local:[a-f0-9]{64}$/), z.string().regex(/^youtube:[A-Za-z0-9_-]{11}$/)]);
// A song heard on the radio. The server derives the hash from its artist and title, so the same song gets one ID on every station.
export const radioSongId = z.string().regex(/^radio:[a-f0-9]{64}$/);
// Anything the listener can like or dislike.
export const feedbackId = z.union([mediaId, radioSongId]);
export const stationCatalog = {
  kexp: { label: 'KEXP', note: 'Seattle · independent and eclectic', website: 'https://www.kexp.org/' },
  'bbc-radio-4': { label: 'BBC Radio 4', note: 'London · news, drama, documentaries and conversation', website: 'https://www.bbc.co.uk/sounds/play/live:bbc_radio_fourfm' },
  yle1: { label: 'Yle Radio 1', note: 'Helsinki · classical, jazz and culture', website: 'https://yle.fi/aihe/yle-radio-1' },
  'radio-helsinki': { label: 'Radio Helsinki', note: 'Helsinki · alternative and local', website: 'https://www.radiohelsinki.fi/' },
  fip: { label: 'FIP', note: 'Paris · jazz, soul and discoveries from everywhere', website: 'https://www.radiofrance.fr/fip' },
  wfmu: { label: 'WFMU', note: 'Jersey City · freeform, oddities and deep digs', website: 'https://wfmu.org/' },
  'nts-1': { label: 'NTS 1', note: 'London · selectors, underground and global sounds', website: 'https://www.nts.live/' },
  'nts-2': { label: 'NTS 2', note: 'London · another room for adventurous selectors', website: 'https://www.nts.live/' },
  'radio-paradise': { label: 'Radio Paradise', note: 'California · hand-picked rock, folk and beyond', website: 'https://radioparadise.com/' },
  'worldwide-fm': { label: 'Worldwide FM', note: 'London · jazz, soul and underground music worldwide', website: 'https://www.worldwidefm.net/' },
  dublab: { label: 'dublab', note: 'Los Angeles · future roots radio, freeform and DJ-led', website: 'https://www.dublab.com/' },
  'refuge-worldwide': { label: 'Refuge Worldwide', note: 'Berlin · community radio from dub to deep house', website: 'https://refugeworldwide.com/' },
  'radio-80000': { label: 'Radio 80000', note: 'Munich · non-commercial, eclectic and local', website: 'https://www.radio80k.de/' },
  'cashmere-radio': { label: 'Cashmere Radio', note: 'Berlin · experimental, ambient and outsider sounds', website: 'https://cashmereradio.com/' },
  'noods-radio': { label: 'Noods Radio', note: 'Bristol · freeform shows from the underground', website: 'https://www.noodsradio.com/' },
  'resonance-fm': { label: 'Resonance 104.4 FM', note: 'London · art radio, sound art and odd broadcasts', website: 'https://www.resonancefm.com/' },
  'radio-nova': { label: 'Radio Nova', note: 'Paris · le grand mix of hip-hop, soul, world and electronic', website: 'https://www.nova.fr/' },
  'radio-meuh': { label: 'Radio Meuh', note: 'French Alps · eclectic grooves, funk, soul and electronica', website: 'https://www.radiomeuh.com/' },
  oe1: { label: 'Ö1', note: 'Vienna · classical, jazz, new music and culture', website: 'https://oe1.orf.at/' },
  wwoz: { label: 'WWOZ', note: 'New Orleans · jazz and heritage, from brass bands to blues', website: 'https://www.wwoz.org/' },
  'intergalactic-fm': { label: 'Intergalactic FM', note: 'The Hague · electro, italo and dark disco', website: 'https://www.intergalactic.fm/' },
  'radio-swiss-jazz': { label: 'Radio Swiss Jazz', note: 'Switzerland · jazz around the clock, no talk', website: 'https://www.radioswissjazz.ch/' },
} as const;
export const stationId = z.enum(Object.keys(stationCatalog) as (keyof typeof stationCatalog)[]);
export const source = z.enum(['local', 'youtube']);
export const availability = z.enum(['available', 'unavailable']);
export const artist = z.object({ id: z.string(), displayName: z.string(), confidence: z.enum(['high', 'medium', 'low']), provenance: z.string() });
export const mediaItem = z.object({ id: mediaId, source, title: z.string(), artist: artist.nullable(), album: z.string().optional(), durationSeconds: z.number().nonnegative().optional(), artwork: z.string().url().optional(), availability, attribution: z.string().optional() });
export const apiError = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), requestId: z.string(), details: z.unknown().optional() }) });
export const capabilityState = z.enum(['not_configured', 'scanning', 'ready', 'unavailable', 'error']);
export const capabilities = z.object({ library: z.object({ state: capabilityState, reason: z.string().optional() }), codex: z.object({ state: capabilityState, reason: z.string().optional(), authHomeSource: z.enum(['MUSIC_CODEX_HOME', 'CODEX_HOME', 'user_home']).optional(), synthesisStatus: z.enum(['unavailable', 'current', 'pending', 'failed']).optional() }), youtubeDiscovery: z.object({ state: capabilityState, reason: z.string().optional() }), youtubePlayback: z.object({ state: capabilityState, reason: z.string().optional(), version: z.string().optional() }), stations: z.record(stationId, z.object({ state: capabilityState, reason: z.string().optional() })) });
export const jobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const job = z.object({ id: z.string().uuid(), kind: z.enum(['scan', 'recommendations', 'synthesizeTaste', 'describeArtist', 'youtubeSearch', 'converse']), status: jobStatus, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), progress: z.number().min(0).max(1).optional(), result: z.unknown().optional(), error: apiError.shape.error.optional(), diagnosticId: z.string().optional() });
export const stationDescriptor = z.object({ stationId, label: z.string(), playbackKind: z.enum(['direct-audio', 'hls']), availability: capabilityState, provenance: z.object({ url: z.string().url(), type: z.enum(['official', 'third_party']) }), lastVerifiedAt: z.string().datetime().nullable() });
export const stationResolution = z.object({ stationId, playbackKind: stationDescriptor.shape.playbackKind, url: z.string().url(), expiresAt: z.null(), sourceRevision: z.string() });
const stationMetadataBase = z.object({ stationId, checkedAt: z.string().datetime(), sourceUrl: z.string().url().nullable() });
export const stationNowPlaying = z.discriminatedUnion('status', [
  stationMetadataBase.extend({ status: z.literal('current'), kind: z.enum(['track', 'programme']), title: z.string().trim().min(1).max(300), artist: z.string().trim().min(1).max(300).nullable(), startedAt: z.string().datetime().nullable(), expiresAt: z.string().datetime(), songId: radioSongId.optional() }),
  stationMetadataBase.extend({ status: z.enum(['unavailable', 'unsupported', 'stale']) }),
]);
export const trackPage = z.object({ items: z.array(mediaItem), nextCursor: z.string().nullable(), scanRevision: z.number().int().nonnegative() });
export const scanRequest = z.object({ full: z.boolean().optional() });
export const youtubeResolveRequest = z.object({ input: z.string().min(1).max(2048) });
export const youtubeSearchQuery = z.object({ q: z.string().trim().min(1).max(200) });
export const youtubeSearchResult = z.object({ items: z.array(mediaItem), nextPageToken: z.string().nullable(), emptyReason: z.literal('no_verified_candidates').optional() });
export const reaction = z.enum(['like', 'dislike', 'neutral']);
export const radioSong = z.object({ title: z.string().trim().min(1).max(300), artist: z.string().trim().min(1).max(300).nullable() });
// media describes a local or YouTube track; radioSong describes a song heard on a station.
export const feedbackRequest = z.object({ reaction, expectedRevision: z.number().int().nonnegative(), media: mediaItem.optional(), radioSong: radioSong.optional() });
export const feedbackResponse = z.object({ mediaId: feedbackId, reaction, feedbackRevision: z.number().int().nonnegative() });
export const taste = z.object({ feedbackRevision: z.number().int().nonnegative(), summaryRevision: z.number().int().nonnegative(), summaryStatus: z.enum(['unavailable', 'current', 'pending', 'failed']), summaryMarkdown: z.string().nullable(), feedback: z.record(z.string(), reaction) });
// Songs heard or queued recently, by name, so the DJ doesn't repeat a song that YouTube offers under another video ID.
export const trackName = z.object({ title: z.string().max(300), artist: z.string().max(200).nullable() });
// quick asks for a fast first batch after starting or steering the DJ.
export const recommendationRequest = z.object({ sessionId: z.string().uuid(), modeEpoch: z.number().int().nonnegative(), source, seedId: mediaId.optional(), queuedIds: z.array(mediaId).max(100), recentIds: z.array(mediaId).max(100), recentTracks: z.array(trackName).max(30).optional(), direction: z.string().max(500).optional(), quick: z.boolean().optional() });
export const recommendationResult = z.object({ sessionId: z.string().uuid(), modeEpoch: z.number().int().nonnegative(), source, feedbackRevision: z.number().int().nonnegative(), summaryRevision: z.number().int().nonnegative(), items: z.array(z.object({ media: mediaItem, reason: z.string().max(300) })), emptyReason: z.literal('no_verified_candidates').optional() });
export const artistInfo = z.object({ artistKey: z.string(), status: z.enum(['cached', 'pending', 'unavailable', 'failed']), generatedAt: z.string().datetime().optional(), introduction: z.string().optional(), text: z.string().optional(), provenance: z.string().optional(), jobId: z.string().uuid().optional() });
export const jobAccepted = z.object({ jobId: z.string().uuid() });
// Things the listener told the DJ, in short notes they can read and delete.
export const djNote = z.object({ id: z.string().uuid(), text: z.string().min(1).max(200), createdAt: z.string().datetime() });
export const djMessage = z.object({ id: z.string().uuid(), role: z.enum(['dj', 'you']), text: z.string().min(1).max(1200), at: z.string().datetime(), suggestions: z.array(z.string().min(1).max(80)).max(4).optional(), notesAdded: z.array(djNote).max(5).optional() });
export const djMemory = z.object({ notes: z.array(djNote), conversation: z.array(djMessage) });
// starting: the DJ is already starting music for this message, so the reply should not steer again.
export const djMessageRequest = z.object({ text: z.string().trim().max(1000), mode: z.enum(['chat', 'interview']), djOn: z.boolean(), starting: z.boolean().optional(), nowPlaying: trackName.nullable().optional() });
export const djReply = z.object({ message: djMessage, steer: z.string().max(300).nullable(), interviewDone: z.boolean(), memory: djMemory });
// Your taste in one file, to move it to another machine: the taste files exactly as saved, and the DJ's notes.
// feedbackRevision says which reactions the summary was written from, so an import knows whether it is still current.
export const tasteExport = z.object({
  format: z.literal('music-agent-taste'), schemaVersion: z.literal(1), exportedAt: z.string().datetime(), feedbackRevision: z.number().int().nonnegative(),
  files: z.object({ 'likes.csv': z.string().max(5_000_000), 'dislikes.csv': z.string().max(5_000_000), 'musical_taste.md': z.string().max(100_000) }),
  djNotes: z.array(djNote).max(60),
});
export const tasteImportResult = z.object({ taste, memory: djMemory });
// Skips and finished tracks teach the DJ alongside likes and dislikes.
export const listeningEvent = z.object({ media: mediaItem, outcome: z.enum(['finished', 'skipped']), listenedSeconds: z.number().nonnegative().max(86_400), durationSeconds: z.number().nonnegative().max(86_400).nullable() });
export type MediaItem = z.infer<typeof mediaItem>;
export type Capabilities = z.infer<typeof capabilities>;
export type Job = z.infer<typeof job>;
export type StationDescriptor = z.infer<typeof stationDescriptor>;
export type StationResolution = z.infer<typeof stationResolution>;
export type StationId = z.infer<typeof stationId>;
export type StationNowPlaying = z.infer<typeof stationNowPlaying>;
export type RecommendationRequest = z.infer<typeof recommendationRequest>;
export type RecommendationResult = z.infer<typeof recommendationResult>;
export type DjNote = z.infer<typeof djNote>;
export type DjMessage = z.infer<typeof djMessage>;
export type DjMemory = z.infer<typeof djMemory>;
export type DjMessageRequest = z.infer<typeof djMessageRequest>;
export type RadioSong = z.infer<typeof radioSong>;
export type ListeningEvent = z.infer<typeof listeningEvent>;
export type TasteExport = z.infer<typeof tasteExport>;
