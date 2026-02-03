/**
 * Vercel Serverless Function to fetch radio station metadata
 * Extracts currently playing song from Shoutcast/Icecast stream headers
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { station } = req.query;

  if (!station) {
    return res.status(400).json({ error: 'Station parameter is required' });
  }

  // Map station names to their stream URLs
  const stationStreams = {
    'kiss fm': 'https://live.kissfm.ro/kissfm.aacp',
    'europa fm': 'https://astreaming.europafm.ro:8443/europafm_aacp48k',
    'digi fm': 'https://edge76.rcs-rds.ro/digifm/digifm.mp3',
    'magic fm': 'https://live.magicfm.ro/magicfm.aacp',
    'virgin radio românia': 'https://astreaming.virginradio.ro:8443/virgin_aacp_64k',
    'radio românia actualități': 'https://stream4.srr.ro:8443/romania-actualitati',
    'profm': 'https://edge126.rcs-rds.ro/profm/profm.mp3',
    'rock fm': 'https://live.rockfm.ro/rockfm.aacp',
    'radio guerrilla': 'https://live.guerrillaradio.ro:8443/guerrilla.aac',
    'national fm': 'https://asculta.nationalfm.ro:9102/nfm2',
    'dance fm': 'https://edge126.rcs-rds.ro/profm/dancefm.mp3',
    'vibe fm': 'https://live.radiovibefm.eu/8052/stream',
    'radio românia cultural': 'https://stream4.srr.ro:8443/romania-cultural',
    'radio românia muzical': 'https://stream4.srr.ro:8443/romania-muzical',
    'radio pro-b românia': 'https://live.radioprob.ro/8888/live',
    'vanilla radio deep': 'https://stream.vanillaradio.com:8016/stream/stream',
    'vanilla radio smooth': 'https://smooth.vanillaradio.com:8032/live',
    'vanilla radio fresh': 'https://fresh.vanillaradio.com:8028/live'
  };

  const stationName = station.toLowerCase();
  const streamUrl = stationStreams[stationName];

  if (!streamUrl) {
    return res.status(404).json({ 
      error: 'Station not found',
      station: station,
      available: Object.keys(stationStreams)
    });
  }

  try {
    // Fetch stream with Icy-Metadata header to get song info
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(streamUrl, {
      method: 'HEAD', // Use HEAD to avoid downloading the stream
      headers: {
        'Icy-Metadata': '1',
        'User-Agent': 'RadioPlayer/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    // Try to extract metadata from various headers
    const icyName = response.headers.get('icy-name');
    const icyDescription = response.headers.get('icy-description');
    const icyGenre = response.headers.get('icy-genre');
    
    // Note: icy-title is typically only available in the stream body, not HEAD response
    // We'll need to parse it from the stream or use alternative methods
    
    // For now, let's try a GET request with range to get minimal data
    const streamResponse = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'Icy-Metadata': '1',
        'Range': 'bytes=0-16384', // Get first 16KB
        'User-Agent': 'RadioPlayer/1.0'
      },
      signal: controller.signal
    });

    // Parse metadata interval
    const metaint = parseInt(streamResponse.headers.get('icy-metaint') || '0');
    
    if (metaint > 0 && streamResponse.body) {
      // Read the stream to get metadata
      const reader = streamResponse.body.getReader();
      let bytesRead = 0;
      let audioData = new Uint8Array(0);

      while (bytesRead < metaint + 4096) {
        const { done, value } = await reader.read();
        if (done) break;

        const newData = new Uint8Array(audioData.length + value.length);
        newData.set(audioData);
        newData.set(value, audioData.length);
        audioData = newData;
        bytesRead += value.length;

        // Check if we have enough data to read metadata
        if (bytesRead >= metaint) {
          // Skip audio data
          const metadataLengthByte = audioData[metaint];
          const metadataLength = metadataLengthByte * 16;

          if (metadataLength > 0 && audioData.length >= metaint + 1 + metadataLength) {
            // Extract metadata
            const metadataBytes = audioData.slice(metaint + 1, metaint + 1 + metadataLength);
            const metadataString = new TextDecoder('utf-8').decode(metadataBytes);
            
            // Parse StreamTitle
            const streamTitleMatch = metadataString.match(/StreamTitle='([^']*)'/);
            if (streamTitleMatch && streamTitleMatch[1]) {
              const streamTitle = streamTitleMatch[1];
              
              // Parse "Artist - Song" format
              const parts = streamTitle.split(' - ');
              const artist = parts.length > 1 ? parts[0].trim() : null;
              const song = parts.length > 1 ? parts.slice(1).join(' - ').trim() : streamTitle.trim();

              reader.cancel();
              
              return res.status(200).json({
                success: true,
                station: station,
                song: song || null,
                artist: artist || null,
                streamTitle: streamTitle,
                metadata: {
                  name: icyName,
                  description: icyDescription,
                  genre: icyGenre
                }
              });
            }
          }
        }
      }

      reader.cancel();
    }

    // If we couldn't extract metadata, return station info
    return res.status(200).json({
      success: true,
      station: station,
      song: null,
      artist: null,
      streamTitle: null,
      metadata: {
        name: icyName,
        description: icyDescription,
        genre: icyGenre
      },
      message: 'Metadata extraction not available for this station'
    });

  } catch (error) {
    console.error('Error fetching metadata:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      station: station
    });
  }
}
