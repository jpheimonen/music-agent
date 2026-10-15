import type { StationId, StationNowPlaying } from '@music/contracts';

export type RadioMetadata = StationNowPlaying | { stationId: StationId; status: 'loading' };

// Own both timers so expiry still clears the title during a slow refresh.
export function watchStationMetadata(
  stationId: StationId,
  receive: (data: RadioMetadata) => void,
  request: (id: StationId, signal: AbortSignal) => Promise<StationNowPlaying>,
  clock = {
    now: Date.now,
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
  },
) {
  const abort = new AbortController();
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  receive({ stationId, status: 'loading' });
  const poll = async () => {
    try {
      const data = await request(stationId, abort.signal);
      if (abort.signal.aborted) return;
      clock.clearTimeout(expiry);
      if (data.stationId !== stationId) throw new Error('Wrong station metadata');
      if (data.status === 'current') {
        const stale = { stationId, status: 'stale' as const, checkedAt: data.checkedAt, sourceUrl: data.sourceUrl };
        const remaining = Date.parse(data.expiresAt) - clock.now();
        receive(remaining > 0 ? data : stale);
        if (remaining > 0) expiry = clock.setTimeout(() => receive(stale), remaining);
      } else receive(data);
      if (data.status === 'unsupported') return;
    } catch {
      if (abort.signal.aborted) return;
      clock.clearTimeout(expiry);
      receive({ stationId, status: 'unavailable', checkedAt: new Date(clock.now()).toISOString(), sourceUrl: null });
    }
    if (!abort.signal.aborted) refresh = clock.setTimeout(() => void poll(), 30_000);
  };
  void poll();
  return () => {
    abort.abort();
    clock.clearTimeout(refresh);
    clock.clearTimeout(expiry);
  };
}
