export const SEARCH_RUNTIME_VERSION: string;
export const SEARCH_SCHEMA: string;
export type SearchEvidence = { videoId: string; canonicalWatchUrl: string; searchResultUrl: string; resultTitle: string | null; searchEventId: string; eventQuery: string | null; whyRelevant: string };
export function canonicalVideoUrl(raw: unknown): { videoId: string; canonicalWatchUrl: string } | null;
export class SearchEvidenceError extends Error { code: string; constructor(code: string); }
export class SearchEvidenceCollector {
  constructor(runtimeVersion: string);
  completed: number;
  bytes: number;
  members: Map<string, Omit<SearchEvidence, 'whyRelevant'>>;
  add(event: unknown): void;
  candidates(final: unknown): SearchEvidence[];
}
