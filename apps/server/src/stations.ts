import type { Config } from './config.js';
import type { StationDescriptor, StationResolution } from '@music/contracts';
import { createHash } from 'node:crypto';

const stations = {
  kexp: { label: 'KEXP', playbackKind: 'direct-audio', url: 'https://kexp.streamguys1.com/kexp160.aac', provenance: { url: 'https://www.kexp.org/mobile/kexp-livestreams/', type: 'official' } },
  yle1: { label: 'Yle Radio 1', playbackKind: 'hls', url: 'https://yleradiolive5.akamaized.net/hls/live/20000869/yleradio1/master.m3u8', provenance: { url: 'https://radio.ssishosting.net/RadioListe.asp?L=3', type: 'third_party' } },
  'radio-helsinki': { label: 'Radio Helsinki', playbackKind: 'direct-audio', url: 'https://stream.radiohelsinki.fi/stream', provenance: { url: 'https://www.radiohelsinki.fi/yhteystiedot/', type: 'official' } },
} as const;
export type StationKey = keyof typeof stations;
export function stationDescriptors(): StationDescriptor[] {
  return (Object.keys(stations) as StationKey[]).map(stationId => {
    const station = stations[stationId];
    return { stationId, label: station.label, playbackKind: station.playbackKind, availability: 'ready', provenance: station.provenance, lastVerifiedAt: null };
  });
}
export function resolveStation(config: Config, stationId: StationKey): StationResolution {
  const station = stations[stationId];
  const url = config.stationOverrides[stationId] || station.url;
  return { stationId, playbackKind: station.playbackKind, url, expiresAt: null, sourceRevision: createHash('sha256').update(url).digest('hex').slice(0, 16) };
}
