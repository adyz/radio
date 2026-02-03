# Radio Metadata Feature - Implementation Guide

## Overview
This feature displays the currently playing song information when listening to a radio station. Due to technical limitations (CORS restrictions), the implementation currently uses **mock data** for demonstration purposes.

## Current Implementation

### Mock Data Mode (Default)
- Displays realistic song information that changes periodically
- Rotates through a curated list of popular songs for each station
- Provides immediate visual feedback without external dependencies
- **Set `useMockData = true` in `radioMetadata.js`** (default)

### Real API Mode (Requires Setup)
To enable real song metadata, you need to:
1. Set `useMockData = false` in `radioMetadata.js`
2. Implement one of the solutions below

## Solutions for Real Metadata

### Option 1: Backend Proxy Server (Recommended)
Create a simple backend proxy to avoid CORS issues:

```javascript
// Example: Node.js Express proxy
app.get('/api/metadata/:station', async (req, res) => {
  const station = req.params.station;
  
  // Map station to API endpoint
  const endpoints = {
    'kissfm': 'https://www.kissfm.ro/ajax/current_song.php',
    'europafm': 'https://www.europafm.ro/artist-album-ajax/',
    'magicfm': 'https://www.magicfm.ro/wp-json/songtitle/v1/get',
    // ... add more stations
  };
  
  try {
    const response = await fetch(endpoints[station]);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});
```

Then update `radioMetadata.js` to call your proxy instead of the stations directly.

### Option 2: Serverless Functions (Vercel/Netlify)
Deploy serverless functions to handle API calls:

```javascript
// api/metadata.js (Vercel serverless function)
export default async function handler(req, res) {
  const { station } = req.query;
  
  // Fetch from station API
  const response = await fetch(stationAPIs[station]);
  const data = await response.json();
  
  res.status(200).json(data);
}
```

### Option 3: Station-Specific Chrome Extension
Create a Chrome extension that can bypass CORS restrictions:
- Extension has permission to access all URLs
- Inject content script that fetches metadata
- Send data to the radio player

### Option 4: Web Scraping (Last Resort)
Some stations display current song on their website:
- Scrape the station's website for song info
- Parse HTML to extract song/artist
- Requires backend to avoid CORS

## Known Station APIs

### Working APIs (with CORS enabled)
Currently, most Romanian radio station APIs do NOT have CORS enabled. Here are the endpoints we've identified:

1. **Kiss FM** - `https://www.kissfm.ro/ajax/current_song.php`
2. **Europa FM** - `https://www.europafm.ro/artist-album-ajax/`
3. **Magic FM** - `https://www.magicfm.ro/wp-json/songtitle/v1/get`
4. **ProFM** - `https://www.profm.ro/ajax/current-song`
5. **Rock FM** - `https://www.rockfm.ro/api/now-playing`
6. **Virgin Radio** - `https://www.virginradio.ro/api/now-playing`
7. **Radio Guerrilla** - `https://www.guerrillaradio.ro/api/current-song`

**Note**: These endpoints may not exist or may have changed. Test each one individually.

### Alternative: Shoutcast/Icecast Metadata
Some radio stations use Shoutcast/Icecast servers which include metadata in the stream:
- Listen for `icy-title` headers in the audio stream
- Requires special handling in the audio player
- Can be extracted with a service worker

## Testing the Feature

### With Mock Data (Current)
1. Build the project: `npm run build`
2. Start the server: `npm start`
3. Open the app and play any radio station
4. You should see song information appear below the poster image
5. Song info changes every 15 seconds

### With Real APIs
1. Set `useMockData = false` in `radioMetadata.js`
2. Set up a backend proxy (see Option 1 above)
3. Update API endpoints in the fetch methods
4. Test with different radio stations

## Future Improvements

1. **Real-time Updates**: WebSocket connection for instant metadata updates
2. **Song History**: Show recently played songs
3. **Lyrics Integration**: Display lyrics for current song
4. **Spotify Integration**: Link to Spotify for current song
5. **User Preferences**: Let users choose which metadata to display
6. **Album Artwork**: Display album covers when available
7. **Share Feature**: Share currently playing song on social media

## Troubleshooting

### Song Info Not Appearing
- Check browser console for errors
- Verify `useMockData` is set correctly
- Ensure radio station is playing

### CORS Errors
- This is expected without a proxy
- Implement backend proxy (Option 1)
- Or use mock data mode

### Incorrect Song Info
- Mock data is for demonstration
- Implement real API integration for accurate data

## Architecture

```
┌──────────────────────────┐
│   Radio Player UI        │
│  (index.html)            │
└────────┬─────────────────┘
         │
         │ updates UI
         ▼
┌──────────────────────────┐
│   Main Script            │
│   (script.js)            │
└────────┬─────────────────┘
         │
         │ calls
         ▼
┌──────────────────────────┐
│  Metadata Service        │
│  (radioMetadata.js)      │
└────────┬─────────────────┘
         │
         ├──────────┬───────────────┐
         │          │               │
         ▼          ▼               ▼
    Mock Data   Backend Proxy   Station API
                (if available)  (with CORS)
```

## Contact & Contributions

For questions or improvements to this feature:
- Open an issue in the repository
- Submit a pull request with enhancements
- Contact the maintainer

---

**Last Updated**: February 2026
