import { z } from 'zod';

export const mediaId = z.union([z.string().regex(/^local:[a-f0-9]{64}$/), z.string().regex(/^youtube:[A-Za-z0-9_-]{11}$/)]);
export const stationCatalog = {
  kexp: { label: 'KEXP', note: 'Seattle · independent and eclectic', website: 'https://www.kexp.org/' },
  yle1: { label: 'Yle Radio 1', note: 'Helsinki · classical, jazz and culture', website: 'https://yle.fi/aihe/yle-radio-1' },
  'radio-helsinki': { label: 'Radio Helsinki', note: 'Helsinki · alternative and local', website: 'https://www.radiohelsinki.fi/' },
  fip: { label: 'FIP', note: 'Paris · jazz, soul and discoveries from everywhere', website: 'https://www.radiofrance.fr/fip' },
  wfmu: { label: 'WFMU', note: 'Jersey City · freeform, oddities and deep digs', website: 'https://wfmu.org/' },
  'nts-1': { label: 'NTS 1', note: 'London · selectors, underground and global sounds', website: 'https://www.nts.live/' },
  'nts-2': { label: 'NTS 2', note: 'London · another room for adventurous selectors', website: 'https://www.nts.live/' },
  'radio-paradise': { label: 'Radio Paradise', note: 'California · hand-picked rock, folk and beyond', website: 'https://radioparadise.com/' },
  'worldwide-fm': { label: 'Worldwide FM', note: 'London · jazz, soul and underground music worldwide', website: 'https://www.worldwidefm.net/' },
} as const;
export const stationId = z.enum(Object.keys(stationCatalog) as (keyof typeof stationCatalog)[]);
export const source = z.enum(['local', 'youtube']);
export const availability = z.enum(['available', 'unavailable']);
export const artist = z.object({ id: z.string(), displayName: z.string(), confidence: z.enum(['high', 'medium', 'low']), provenance: z.string() });
export const mediaItem = z.object({ id: mediaId, source, title: z.string(), artist: artist.nullable(), album: z.string().optional(), durationSeconds: z.number().nonnegative().optional(), artwork: z.string().url().optional(), availability, attribution: z.string().optional() });
export const apiError = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), requestId: z.string(), details: z.unknown().optional() }) });
export const capabilityState = z.enum(['not_configured', 'scanning', 'ready', 'unavailable', 'error']);
export const capabilities = z.object({ library: z.object({ state: capabilityState, reason: z.string().optional() }), codex: z.object({ state: capabilityState, reason: z.string().optional(), authHomeSource: z.enum(['MUSIC_CODEX_HOME', 'CODEX_HOME', 'user_home']).optional(), synthesisStatus: z.enum(['unavailable', 'current', 'pending', 'failed']).optional() }), youtubeDiscovery: z.object({ state: capabilityState, reason: z.string().optional() }), youtubeEmbed: z.object({ state: capabilityState, reason: z.string().optional() }), stations: z.record(stationId, z.object({ state: capabilityState, reason: z.string().optional() })) });
export const jobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const job = z.object({ id: z.string().uuid(), kind: z.enum(['scan', 'recommendations', 'synthesizeTaste', 'describeArtist', 'youtubeSearch']), status: jobStatus, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), progress: z.number().min(0).max(1).optional(), result: z.unknown().optional(), error: apiError.shape.error.optional(), diagnosticId: z.string().optional() });
export const stationDescriptor = z.object({ stationId, label: z.string(), playbackKind: z.enum(['direct-audio', 'hls']), availability: capabilityState, provenance: z.object({ url: z.string().url(), type: z.enum(['official', 'third_party']) }), lastVerifiedAt: z.string().datetime().nullable() });
export const stationResolution = z.object({ stationId, playbackKind: stationDescriptor.shape.playbackKind, url: z.string().url(), expiresAt: z.null(), sourceRevision: z.string() });
const stationMetadataBase = z.object({ stationId, checkedAt: z.string().datetime(), sourceUrl: z.string().url().nullable() });
export const stationNowPlaying = z.discriminatedUnion('status', [
  stationMetadataBase.extend({ status: z.literal('current'), kind: z.enum(['track', 'programme']), title: z.string().trim().min(1).max(300), artist: z.string().trim().min(1).max(300).nullable(), startedAt: z.string().datetime().nullable(), expiresAt: z.string().datetime() }),
  stationMetadataBase.extend({ status: z.enum(['unavailable', 'unsupported', 'stale']) }),
]);
export const trackPage = z.object({ items: z.array(mediaItem), nextCursor: z.string().nullable(), scanRevision: z.number().int().nonnegative() });
export const scanRequest = z.object({ full: z.boolean().optional() });
export const youtubeResolveRequest = z.object({ input: z.string().min(1).max(2048) });
export const youtubeSearchQuery = z.object({ q: z.string().trim().min(1).max(200) });
export const youtubeSearchResult = z.object({ items: z.array(mediaItem), nextPageToken: z.string().nullable(), emptyReason: z.literal('no_verified_candidates').optional() });
export const reaction = z.enum(['like', 'dislike', 'neutral']);
export const feedbackRequest = z.object({ reaction, expectedRevision: z.number().int().nonnegative(), media: mediaItem.optional() });
export const feedbackResponse = z.object({ mediaId, reaction, feedbackRevision: z.number().int().nonnegative() });
export const taste = z.object({ feedbackRevision: z.number().int().nonnegative(), summaryRevision: z.number().int().nonnegative(), summaryStatus: z.enum(['unavailable', 'current', 'pending', 'failed']), summaryMarkdown: z.string().nullable(), feedback: z.record(z.string(), reaction) });
export const recommendationRequest = z.object({ sessionId: z.string().uuid(), modeEpoch: z.number().int().nonnegative(), source, seedId: mediaId.optional(), queuedIds: z.array(mediaId).max(100), recentIds: z.array(mediaId).max(100), direction: z.string().max(500).optional() });
export const recommendationResult = z.object({ sessionId: z.string().uuid(), modeEpoch: z.number().int().nonnegative(), source, feedbackRevision: z.number().int().nonnegative(), summaryRevision: z.number().int().nonnegative(), items: z.array(z.object({ media: mediaItem, reason: z.string().max(300) })), emptyReason: z.literal('no_verified_candidates').optional() });
export const artistInfo = z.object({ artistKey: z.string(), status: z.enum(['cached', 'pending', 'unavailable', 'failed']), generatedAt: z.string().datetime().optional(), introduction: z.string().optional(), text: z.string().optional(), provenance: z.string().optional(), jobId: z.string().uuid().optional() });
export const jobAccepted = z.object({ jobId: z.string().uuid() });
export type MediaItem = z.infer<typeof mediaItem>;
export type Capabilities = z.infer<typeof capabilities>;
export type Job = z.infer<typeof job>;
export type StationDescriptor = z.infer<typeof stationDescriptor>;
export type StationResolution = z.infer<typeof stationResolution>;
export type StationId = z.infer<typeof stationId>;
export type StationNowPlaying = z.infer<typeof stationNowPlaying>;
export type RecommendationRequest = z.infer<typeof recommendationRequest>;
export type RecommendationResult = z.infer<typeof recommendationResult>;
