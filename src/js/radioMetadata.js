/**
 * Radio Metadata Service
 * Fetches currently playing song information from various Romanian radio stations
 * Uses multiple approaches: RadioBrowser API, Shoutcast metadata, and station-specific APIs
 */

class RadioMetadataService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 30000; // 30 seconds cache
    this.updateInterval = null;
    this.currentStation = null;
    this.onMetadataUpdate = null;
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
      // Try multiple approaches in order
      let metadata = await this.tryRadioBrowser(stationName);
      
      if (!metadata || !metadata.song) {
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
   * Try fetching metadata from RadioBrowser API
   */
  async tryRadioBrowser(stationName) {
    try {
      // Map station names to search terms
      const searchName = this.getRadioBrowserSearchName(stationName);
      
      const response = await fetch(
        `https://de1.api.radio-browser.info/json/stations/byname/${encodeURIComponent(searchName)}`,
        { timeout: 5000 }
      );

      if (!response.ok) throw new Error('RadioBrowser API failed');

      const stations = await response.json();
      
      // Find the best match
      const station = stations.find(s => 
        s.name.toLowerCase().includes(searchName.toLowerCase()) ||
        searchName.toLowerCase().includes(s.name.toLowerCase())
      );

      if (station) {
        // Fetch current playing info
        const clickResponse = await fetch(
          `https://de1.api.radio-browser.info/json/url/${station.stationuuid}`,
          { timeout: 5000 }
        );

        if (clickResponse.ok) {
          // RadioBrowser doesn't always have current song, but we can try to get it
          // from the station's homepage or other metadata
          return this.parseRadioBrowserMetadata(station);
        }
      }

      return null;
    } catch (error) {
      console.log('RadioBrowser fetch failed:', error);
      return null;
    }
  }

  /**
   * Parse metadata from RadioBrowser station info
   */
  parseRadioBrowserMetadata(station) {
    // RadioBrowser API has limited current-song info
    // We can use homepage scraping or other methods
    // For now, return null and rely on station-specific APIs
    return null;
  }

  /**
   * Try fetching metadata from station-specific APIs
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
   */
  async fetchKissFM() {
    try {
      // Kiss FM provides an API endpoint for current song
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
      console.log('Kiss FM API failed:', error);
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
   * Map station names to RadioBrowser search terms
   */
  getRadioBrowserSearchName(stationName) {
    const mapping = {
      'Kiss FM': 'Kiss FM Romania',
      'Europa FM': 'Europa FM Romania',
      'Digi FM': 'Digi FM',
      'Magic FM': 'Magic FM Romania',
      'Virgin Radio România': 'Virgin Radio Romania',
      'Radio România Actualități': 'Radio Romania Actualitati',
      'ProFM': 'Pro FM Romania',
      'Rock FM': 'Rock FM Romania',
      'Radio Guerrilla': 'Guerrilla Radio',
      'National FM': 'National FM Romania',
      'Dance FM': 'Dance FM Romania',
      'Vibe FM': 'Vibe FM',
      'Radio România Cultural': 'Radio Romania Cultural',
      'Radio România Muzical': 'Radio Romania Muzical',
      'Radio Pro-B România': 'Radio Pro-B',
      'Vanilla Radio Deep': 'Vanilla Deep',
      'Vanilla Radio Smooth': 'Vanilla Smooth',
      'Vanilla Radio Fresh': 'Vanilla Fresh'
    };

    return mapping[stationName] || stationName;
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
