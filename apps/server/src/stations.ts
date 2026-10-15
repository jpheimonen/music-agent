import type { Config } from './config.js';
import { stationCatalog, type StationDescriptor, type StationResolution } from '@music/contracts';
import { createHash } from 'node:crypto';

export const stationStreams = {
  kexp: { playbackKind: 'direct-audio', url: 'https://kexp.streamguys1.com/kexp160.aac', provenance: { url: 'https://www.kexp.org/mobile/kexp-livestreams/', type: 'official' } },
  'bbc-radio-4': { playbackKind: 'hls', url: 'https://as-hls-ww-live.akamaized.net/pool_55057080/live/ww/bbc_radio_fourfm/bbc_radio_fourfm.isml/bbc_radio_fourfm-audio%3d96000.norewind.m3u8', provenance: { url: 'https://www.bbc.co.uk/sounds/play/live:bbc_radio_fourfm', type: 'third_party' } },
  yle1: { playbackKind: 'hls', url: 'https://yleradiolive5.akamaized.net/hls/live/20000869/yleradio1/master.m3u8', provenance: { url: 'https://radio.ssishosting.net/RadioListe.asp?L=3', type: 'third_party' } },
  'radio-helsinki': { playbackKind: 'direct-audio', url: 'https://stream.radiohelsinki.fi/stream', provenance: { url: 'https://www.radiohelsinki.fi/yhteystiedot/', type: 'official' } },
  fip: { playbackKind: 'direct-audio', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3?id=radiofrance', provenance: { url: 'https://community.roonlabs.com/t/new-fip-streaming-url/87335', type: 'third_party' } },
  wfmu: { playbackKind: 'direct-audio', url: 'https://stream0.wfmu.org/freeform-128k.mp3', provenance: { url: 'https://wfmu.org/audiostream.shtml', type: 'official' } },
  'nts-1': { playbackKind: 'direct-audio', url: 'https://stream-relay-geo.ntslive.net/stream?client=direct', provenance: { url: 'https://github.com/tiktuk/nts-radio-cli', type: 'third_party' } },
  'nts-2': { playbackKind: 'direct-audio', url: 'https://stream-relay-geo.ntslive.net/stream2?client=direct', provenance: { url: 'https://github.com/tiktuk/nts-radio-cli', type: 'third_party' } },
  'radio-paradise': { playbackKind: 'direct-audio', url: 'https://stream.radioparadise.com/aac-320', provenance: { url: 'https://radioparadise.com/listen/stream-links', type: 'official' } },
  'worldwide-fm': { playbackKind: 'direct-audio', url: 'https://worldwide-fm.radiocult.fm/stream', provenance: { url: 'https://www.worldwidefm.net/about', type: 'official' } },
  // Streams added in October 2026, each checked to play and listed in the public radio-browser directory.
  dublab: { playbackKind: 'direct-audio', url: 'https://dublab.out.airtime.pro/dublab_a', provenance: { url: 'https://www.radio-browser.info/history/0bb84fe1-e899-11e9-a96c-52543be04c81', type: 'third_party' } },
  'refuge-worldwide': { playbackKind: 'direct-audio', url: 'https://streaming.radio.co/s3699c5e49/listen', provenance: { url: 'https://www.radio-browser.info/history/edb81cbf-0645-4944-a376-554b8299ff27', type: 'third_party' } },
  'radio-80000': { playbackKind: 'direct-audio', url: 'https://radio80k.out.airtime.pro/radio80k_a', provenance: { url: 'https://www.radio-browser.info/history/6b4c2748-07ee-11e8-ae97-52543be04c81', type: 'third_party' } },
  'cashmere-radio': { playbackKind: 'direct-audio', url: 'https://cashmereradio.out.airtime.pro/cashmereradio_b', provenance: { url: 'https://www.radio-browser.info/history/20c914bb-ac6f-4bad-8576-7bd269d97d43', type: 'third_party' } },
  'noods-radio': { playbackKind: 'direct-audio', url: 'https://noods-radio.radiocult.fm/stream', provenance: { url: 'https://www.radio-browser.info/history/3f938990-dcbc-4931-be49-0ca558a0976e', type: 'third_party' } },
  'resonance-fm': { playbackKind: 'direct-audio', url: 'https://stream.resonance.fm/resonance', provenance: { url: 'https://www.radio-browser.info/history/fcb3ce76-8f7b-4949-897e-4158b67ed952', type: 'third_party' } },
  'radio-nova': { playbackKind: 'direct-audio', url: 'https://novazz.ice.infomaniak.ch/novazz-128.mp3', provenance: { url: 'https://www.radio-browser.info/history/797a1245-f5b0-4a8c-a450-2d74c3defa6e', type: 'third_party' } },
  'radio-meuh': { playbackKind: 'direct-audio', url: 'https://radiomeuh.ice.infomaniak.ch/radiomeuh-128.mp3', provenance: { url: 'https://www.radio-browser.info/history/960a0f41-0601-11e8-ae97-52543be04c81', type: 'third_party' } },
  oe1: { playbackKind: 'direct-audio', url: 'https://orf-live.ors-shoutcast.at/oe1-q2a', provenance: { url: 'https://www.radio-browser.info/history/657b7b0f-2ef9-45df-9915-4ca4f948c54f', type: 'third_party' } },
  wwoz: { playbackKind: 'direct-audio', url: 'https://wwoz-sc.streamguys1.com/wwoz-hi.mp3', provenance: { url: 'https://www.radio-browser.info/history/960a4ad1-0601-11e8-ae97-52543be04c81', type: 'third_party' } },
  'intergalactic-fm': { playbackKind: 'direct-audio', url: 'https://radio.intergalactic.fm/1', provenance: { url: 'https://www.radio-browser.info/history/eaa07cbe-f03e-11e9-a96c-52543be04c81', type: 'third_party' } },
  'radio-swiss-jazz': { playbackKind: 'direct-audio', url: 'https://stream.srg-ssr.ch/m/rsj/mp3_128', provenance: { url: 'https://www.radio-browser.info/history/2037c9d4-8d99-48f1-b5f1-eb60dc015773', type: 'third_party' } },
} as const;
export type StationKey = keyof typeof stationStreams;
export function stationDescriptors(): StationDescriptor[] {
  return (Object.keys(stationStreams) as StationKey[]).map(stationId => {
    const station = stationStreams[stationId];
    return { stationId, label: stationCatalog[stationId].label, playbackKind: station.playbackKind, availability: 'ready', provenance: station.provenance, lastVerifiedAt: null };
  });
}
export function resolveStation(config: Config, stationId: StationKey): StationResolution {
  const station = stationStreams[stationId];
  const url = config.stationOverrides[stationId] || station.url;
  return { stationId, playbackKind: station.playbackKind, url, expiresAt: null, sourceRevision: createHash('sha256').update(url).digest('hex').slice(0, 16) };
}
