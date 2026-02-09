export interface RadioStation {
  readonly name: string;
  readonly streamUrl: string;
}

export const STATIONS = [
  { name: 'Kiss FM', streamUrl: 'https://live.kissfm.ro/kissfm.aacp' },
  { name: 'Europa FM', streamUrl: 'https://ss.europafm.ro:8443/europafm_aacp48k' },
  { name: 'Digi FM', streamUrl: 'https://edge76.rcs-rds.ro/digifm/digifm.mp3?111' },
  { name: 'Magic FM', streamUrl: 'https://live.magicfm.ro/magicfm.aacp' },
  { name: 'Virgin Radio România', streamUrl: 'https://astreaming.virginradio.ro:8443/virgin_aacp_64k' },
  { name: 'Radio România Actualități', streamUrl: 'https://stream4.srr.ro:8443/romania-actualitati' },
  { name: 'ProFM', streamUrl: 'https://edge126.rcs-rds.ro/profm/profm.mp3?1741968671569' },
  { name: 'Rock FM', streamUrl: 'https://live.rockfm.ro/rockfm.aacp' },
  { name: 'Radio Guerrilla', streamUrl: 'https://live.guerrillaradio.ro:8443/guerrilla.aac' },
  { name: 'National FM', streamUrl: 'https://asculta.nationalfm.ro:9102/nfm2' },
  { name: 'Dance FM', streamUrl: 'https://edge126.rcs-rds.ro/profm/dancefm.mp3?1741969012508' },
  { name: 'Vibe FM', streamUrl: 'https://live.radiovibefm.eu/8052/stream' },
  { name: 'Radio România Cultural', streamUrl: 'https://stream4.srr.ro:8443/romania-cultural' },
  { name: 'Radio România Muzical', streamUrl: 'https://stream4.srr.ro:8443/romania-muzical' },
  { name: 'Radio Pro-B România', streamUrl: 'https://live.radioprob.ro/8888/live' },
  { name: 'Vanilla Radio Deep', streamUrl: 'https://stream.vanillaradio.com:8016/stream/stream' },
  { name: 'Vanilla Radio Smooth', streamUrl: 'https://smooth.vanillaradio.com:8032/live' },
  { name: 'Vanilla Radio Fresh', streamUrl: 'https://fresh.vanillaradio.com:8028/live' },
] as const satisfies readonly RadioStation[];
