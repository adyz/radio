/**
 * Radio Metadata Service
 * Fetches currently playing song information from various Romanian radio stations
 * 
 * Note: Due to CORS restrictions, most radio station APIs cannot be accessed directly from the browser.
 * This implementation provides multiple approaches:
 * 1. Mock data for demonstration purposes
 * 2. A framework for integrating with station-specific APIs when CORS is resolved
 * 3. Instructions for setting up a backend proxy
 */

class RadioMetadataService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 30000; // 30 seconds cache
    this.updateInterval = null;
    this.currentStation = null;
    this.onMetadataUpdate = null;
    this.useMockData = true; // Set to false when real APIs are available
  }

  /**
   * Start polling for metadata updates
   * @param {string} stationName - Name of the radio station
   * @param {Function} callback - Callback function to handle metadata updates
   */
  startPolling(stationName, callback) {
    this.stopPolling();
    this.currentStation = stationName;
    this.onMetadataUpdate = callback;

    // Fetch immediately
    this.fetchMetadata(stationName);

    // Then poll every 15 seconds
    this.updateInterval = setInterval(() => {
      this.fetchMetadata(stationName);
    }, 15000);
  }

  /**
   * Stop polling for metadata updates
   */
  stopPolling() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.currentStation = null;
  }

  /**
   * Fetch metadata for a radio station
   * @param {string} stationName - Name of the radio station
   */
  async fetchMetadata(stationName) {
    // Check cache first
    const cached = this.getFromCache(stationName);
    if (cached) {
      this.notifyUpdate(cached);
      return cached;
    }

    try {
      let metadata = null;

      if (this.useMockData) {
        // Use mock data for demonstration
        metadata = this.getMockMetadata(stationName);
      } else {
        // Try to fetch real metadata (requires CORS-enabled APIs or backend proxy)
        metadata = await this.tryStationSpecificAPI(stationName);
      }

      if (metadata && metadata.song) {
        this.saveToCache(stationName, metadata);
        this.notifyUpdate(metadata);
        return metadata;
      }

      // Return no metadata available
      const noMetadata = { song: null, artist: null, error: 'Nu sunt disponibile informații despre melodia curentă' };
      this.notifyUpdate(noMetadata);
      return noMetadata;

    } catch (error) {
      console.error('Error fetching metadata:', error);
      const errorMetadata = { song: null, artist: null, error: 'Eroare la obținerea informațiilor' };
      this.notifyUpdate(errorMetadata);
      return errorMetadata;
    }
  }

  /**
   * Get mock metadata for demonstration
   * This rotates through a list of popular Romanian songs
   */
  getMockMetadata(stationName) {
    const mockSongs = {
      'Kiss FM': [
        { song: 'Floare de colț', artist: 'Irina Rimes', album: 'Cosmos' },
        { song: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', album: 'Vida' },
        { song: 'Shape of You', artist: 'Ed Sheeran', album: '÷' },
      ],
      'Europa FM': [
        { song: 'Bella', artist: 'Carla\'s Dreams', album: 'Antiherou' },
        { song: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia' },
        { song: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' },
      ],
      'Magic FM': [
        { song: 'Perfect', artist: 'Ed Sheeran', album: '÷' },
        { song: 'Someone Like You', artist: 'Adele', album: '21' },
        { song: 'Thinking Out Loud', artist: 'Ed Sheeran', album: 'x' },
      ],
      'ProFM': [
        { song: 'Energie', artist: 'Smiley', album: 'Plec' },
        { song: 'Stay', artist: 'The Kid LAROI & Justin Bieber', album: 'F*ck Love 3' },
        { song: 'Heat Waves', artist: 'Glass Animals', album: 'Dreamland' },
      ],
      'Rock FM': [
        { song: 'The Pretender', artist: 'Foo Fighters', album: 'Echoes, Silence, Patience & Grace' },
        { song: 'Seven Nation Army', artist: 'The White Stripes', album: 'Elephant' },
        { song: 'Smells Like Teen Spirit', artist: 'Nirvana', album: 'Nevermind' },
      ],
      'Virgin Radio România': [
        { song: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', album: 'Uptown Special' },
        { song: 'Can\'t Stop the Feeling!', artist: 'Justin Timberlake', album: 'Trolls OST' },
        { song: 'Happy', artist: 'Pharrell Williams', album: 'G I R L' },
      ],
      'Radio Guerrilla': [
        { song: 'Există', artist: 'Subcarpați', album: 'Sunetul Speranței' },
        { song: 'Praf de stele', artist: 'Voltaj', album: 'Live în Bucureşti' },
        { song: 'Amintiri din copilărie', artist: 'Zdob și Zdub', album: 'Ethnomecanica' },
      ],
    };

    const defaultSongs = [
      { song: 'As It Was', artist: 'Harry Styles', album: 'Harry\'s House' },
      { song: 'Anti-Hero', artist: 'Taylor Swift', album: 'Midnights' },
      { song: 'Flowers', artist: 'Miley Cyrus', album: 'Endless Summer Vacation' },
    ];

    const songs = mockSongs[stationName] || defaultSongs;
    const randomIndex = Math.floor(Math.random() * songs.length);
    
    return {
      ...songs[randomIndex],
      cover: null,
      isMock: true // Flag to indicate this is mock data
    };
  }

  /**
   * Try fetching metadata from station-specific APIs
   * Note: These require CORS to be enabled or a backend proxy
   */
  async tryStationSpecificAPI(stationName) {
    const stationHandlers = {
      'Kiss FM': () => this.fetchKissFM(),
      'Europa FM': () => this.fetchEuropaFM(),
      'Magic FM': () => this.fetchMagicFM(),
      'ProFM': () => this.fetchProFM(),
      'Rock FM': () => this.fetchRockFM(),
      'Virgin Radio România': () => this.fetchVirginRadio(),
      'Radio Guerrilla': () => this.fetchGuerrillaRadio(),
    };

    const handler = stationHandlers[stationName];
    if (handler) {
      try {
        return await handler();
      } catch (error) {
        console.log(`Station-specific API failed for ${stationName}:`, error);
      }
    }

    return null;
  }

  /**
   * Fetch Kiss FM metadata
   * Note: Requires CORS or backend proxy
   */
  async fetchKissFM() {
    try {
      const response = await fetch('https://www.kissfm.ro/ajax/current_song.php', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.title) {
          return {
            song: data.title,
            artist: data.artist,
            album: data.album || null,
            cover: data.image || null
          };
        }
      }
    } catch (error) {
      console.log('Kiss FM API failed (likely CORS issue):', error);
    }
    return null;
  }

  /**
   * Fetch Europa FM metadata
   */
  async fetchEuropaFM() {
    try {
      const response = await fetch('https://www.europafm.ro/artist-album-ajax/', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.title) {
          return {
            song: data.title,
            artist: data.artist,
            cover: data.cover_art || null
          };
        }
      }
    } catch (error) {
      console.log('Europa FM API failed:', error);
    }
    return null;
  }

  /**
   * Fetch Magic FM metadata
   */
  async fetchMagicFM() {
    try {
      const response = await fetch('https://www.magicfm.ro/wp-json/songtitle/v1/get', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.song) {
          return {
            song: data.song,
            artist: data.artist,
            cover: data.image || null
          };
        }
      }
    } catch (error) {
      console.log('Magic FM API failed:', error);
    }
    return null;
  }

  /**
   * Fetch ProFM metadata
   */
  async fetchProFM() {
    try {
      const response = await fetch('https://www.profm.ro/ajax/current-song', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.title) {
          return {
            song: data.title,
            artist: data.artist,
            cover: data.image || null
          };
        }
      }
    } catch (error) {
      console.log('ProFM API failed:', error);
    }
    return null;
  }

  /**
   * Fetch Rock FM metadata
   */
  async fetchRockFM() {
    try {
      const response = await fetch('https://www.rockfm.ro/api/now-playing', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.title) {
          return {
            song: data.title,
            artist: data.artist,
            cover: data.artwork || null
          };
        }
      }
    } catch (error) {
      console.log('Rock FM API failed:', error);
    }
    return null;
  }

  /**
   * Fetch Virgin Radio metadata
   */
  async fetchVirginRadio() {
    try {
      const response = await fetch('https://www.virginradio.ro/api/now-playing', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.title) {
          return {
            song: data.title,
            artist: data.artist,
            cover: data.image || null
          };
        }
      }
    } catch (error) {
      console.log('Virgin Radio API failed:', error);
    }
    return null;
  }

  /**
   * Fetch Radio Guerrilla metadata
   */
  async fetchGuerrillaRadio() {
    try {
      const response = await fetch('https://www.guerrillaradio.ro/api/current-song', {
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        const data = await response.json();
        if (data.artist && data.song) {
          return {
            song: data.song,
            artist: data.artist
          };
        }
      }
    } catch (error) {
      console.log('Guerrilla Radio API failed:', error);
    }
    return null;
  }

  /**
   * Save metadata to cache
   */
  saveToCache(stationName, metadata) {
    this.cache.set(stationName, {
      data: metadata,
      timestamp: Date.now()
    });
  }

  /**
   * Get metadata from cache if not expired
   */
  getFromCache(stationName) {
    const cached = this.cache.get(stationName);
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  /**
   * Notify callback of metadata update
   */
  notifyUpdate(metadata) {
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(metadata);
    }
  }
}

export default RadioMetadataService;
