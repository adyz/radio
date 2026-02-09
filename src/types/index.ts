export interface AudioInstance {
  readonly src: string;
  play(): void;
  stop(): void;
}

export interface PlayerElements {
  readonly player: HTMLAudioElement;
  readonly loadingNoise: HTMLAudioElement;
  readonly errorNoise: HTMLAudioElement;
  readonly loadingMsg: HTMLElement;
  readonly errorMsg: HTMLElement;
  readonly playButton: HTMLButtonElement;
  readonly pauseButton: HTMLButtonElement;
  readonly prevButton: HTMLButtonElement;
  readonly nextButton: HTMLButtonElement;
  readonly posterImage: HTMLElement;
  readonly selectorOpenButton: HTMLButtonElement;
  readonly selectorContent: HTMLElement;
  readonly selectorButtonTemplate: HTMLButtonElement;
}

export type PlayerStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'loading'; readonly stationIndex: number }
  | { readonly state: 'playing'; readonly stationIndex: number }
  | { readonly state: 'error'; readonly stationIndex: number };
