interface ElectronAPI {
  onMediaControl(callback: (command: 'playpause' | 'next' | 'previous') => void): void;
  updatePlaybackState(isPlaying: boolean): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
