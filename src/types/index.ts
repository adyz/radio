export interface AudioInstance {
  readonly src: string;
  play(): void;
  stop(): void;
}

export type PlayerStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'loading'; readonly stationIndex: number }
  | { readonly state: 'playing'; readonly stationIndex: number }
  | { readonly state: 'error'; readonly stationIndex: number };

