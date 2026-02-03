/**
 * Radio Metadata Service
 * Fetches currently playing song information from various Romanian radio stations
 * 
 * Now uses REAL metadata from Shoutcast/Icecast streams via Vercel serverless function
 * Falls back to mock data if real API is unavailable
 */

class RadioMetadataService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 30000; // 30 seconds cache
    this.updateInterval = null;
    this.currentStation = null;
    this.onMetadataUpdate = null;
    // Using real API at /api/metadata with fallback to mock data
  }

  /**
   * Fetch with timeout
   * @param {string} url - URL to fetch
   * @param {number} timeoutMs - Timeout in milliseconds
   */
  async fetchWithTimeout(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors'
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
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
      // Try to fetch REAL metadata from our Vercel API endpoint
      const response = await this.fetchWithTimeout(
        `/api/metadata?station=${encodeURIComponent(stationName)}`,
        5000 // 5 second timeout for API call (API itself has 5s timeout)
      );

      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.song && data.artist) {
          // We got real metadata!
          const metadata = {
            song: data.song,
            artist: data.artist,
            streamTitle: data.streamTitle,
            source: 'real-api'
          };
          
          this.saveToCache(stationName, metadata);
          this.notifyUpdate(metadata);
          return metadata;
        }
      }

      // If API fails or returns no data, fall back to mock data
      console.log('Real API returned no data, using mock data as fallback');
      const mockMetadata = this.getMockMetadata(stationName);
      this.saveToCache(stationName, mockMetadata);
      this.notifyUpdate(mockMetadata);
      return mockMetadata;

    } catch (error) {
      console.error('Error fetching real metadata, falling back to mock:', error);
      
      // Fallback to mock data on error
      const mockMetadata = this.getMockMetadata(stationName);
      this.saveToCache(stationName, mockMetadata);
      this.notifyUpdate(mockMetadata);
      return mockMetadata;
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
      const response = await this.fetchWithTimeout('https://www.kissfm.ro/ajax/current_song.php');

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
      const response = await this.fetchWithTimeout('https://www.europafm.ro/artist-album-ajax/');

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
      const response = await this.fetchWithTimeout('https://www.magicfm.ro/wp-json/songtitle/v1/get');

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
      const response = await this.fetchWithTimeout('https://www.profm.ro/ajax/current-song');

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
      const response = await this.fetchWithTimeout('https://www.rockfm.ro/api/now-playing');

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
      const response = await this.fetchWithTimeout('https://www.virginradio.ro/api/now-playing');

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
      const response = await this.fetchWithTimeout('https://www.guerrillaradio.ro/api/current-song');

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
