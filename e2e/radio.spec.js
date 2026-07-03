import { test, expect } from '@playwright/test';

const STREAM_URL_RE = /live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio|radiofrance|\/accs3\/fip\/test-tone-\d+\.ts/;
const SOUND_URL_RE = /\/sounds\/(?:loading-low|error-low)\.mp3(?:\?.*)?$/;
const SOUND_CACHE_NAME = 'radio-sounds-v2';
const STATION_COUNT = 19;
const HLS_TEST_SEGMENT = Buffer.from(
  'R0AREABC8CUAAcEAAP8B/wAB/IAUSBIBBkZGbXBlZwlTZXJ2aWNlMDF3fEPK//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQAAQAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABAAArASAAHBAADhAPAAD+EA8AC2m8DZ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAMAdQAAB7DH4AAAABwADpgIAFIQAH2GH/8VCAA9/83gIATGF2YzYyLjI4LjEwMgBCIAjBGDj/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FHAQAxeAD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////1CAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHEdAABEAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAEQACsBIAAcEAAOEA8AAP4QDwALabwNn///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQAyB1AAALxa/gAAAAHAANiAgAUhAAndm//xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb0cBADOJAP/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwcR0AREQBC8CUAAcEAAP8B/wAB/IAUSBIBBkZGbXBlZwlTZXJ2aWNlMDF3fEPK//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQAASAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABIAArASAAHBAADhAPAAD+EA8AC2m8DZ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EANAdQAAD9qX4AAAABwADYgIAFIQAL4tX/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb9HAQA1iQD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHEdAABMAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAEwACsBIAAcEAAOEA8AAP4QDwALabwNn///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA2J1AAAT73fgD//////////////////////////////////////////wAAAcAAioCABSEADegN//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHP/xUIABv/whEARgjBz/8VCAAb/8IRAEYIwc//FQgAG//CEQBGCMHA==',
  'base64',
);

// Helper: intercept all radio stream URLs and serve our local test tone instead
async function mockStreams(page) {
  await page.route(STREAM_URL_RE, async (route) => {
    const url = route.request().url();
    if (url.endsWith('.m3u8')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-MEDIA-SEQUENCE:349685',
          '#EXT-X-TARGETDURATION:4',
          '#EXT-X-START:TIME-OFFSET=0',
          '#EXTINF:4.000,',
          '/accs3/fip/test-tone-349685.ts',
          '#EXTINF:4.000,',
          '/accs3/fip/test-tone-349686.ts',
          '#EXTINF:4.000,',
          '/accs3/fip/test-tone-349687.ts',
        ].join('\n'),
      });
      return;
    }

    if (url.includes('/accs3/fip/test-tone-')) {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp2t',
        body: HLS_TEST_SEGMENT,
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      path: 'src/public/sounds/test-tone.mp3',
    });
  });
}

// Helper: intercept streams and respond with an error
async function mockStreamsError(page) {
  await page.route(STREAM_URL_RE, (route) => {
    route.abort('internetdisconnected');
  });
}

// Helper: streams answer only after a delay, so the loading state lasts long
// enough to interact with.
async function mockStreamsDelayed(page, delayMs) {
  await page.route(STREAM_URL_RE, async (route) => {
    await new Promise(r => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      path: 'src/public/sounds/test-tone.mp3',
    });
  });
}

// Helper: streams never answer — the app stays in loading.
async function mockStreamsHang(page) {
  await page.route(STREAM_URL_RE, () => { /* never respond */ });
}

// --- User-facing locators ---
// Tests interact through accessible roles/names and visible text — the same
// things a user (or screen reader) perceives, never ids or CSS classes.
function ui(page) {
  return {
    playButton:     page.getByRole('button', { name: 'Redare' }),
    pauseButton:    page.getByRole('button', { name: 'Pauză' }),
    stopButton:     page.getByRole('button', { name: 'Oprește' }),
    prevButton:     page.getByRole('button', { name: 'Postul anterior' }),
    nextButton:     page.getByRole('button', { name: 'Postul următor' }),
    stationPicker:  page.getByRole('button', { name: 'Alege postul de radio' }),
    posterButton:   page.getByRole('button', { name: 'Deschide selectorul de posturi' }),
    logoButton:     page.getByRole('button', { name: 'Reîncarcă pagina' }),
    stationList:    page.getByRole('listbox', { name: 'Posturi de radio' }),
    stationOptions: page.getByRole('listbox', { name: 'Posturi de radio' }).getByRole('option'),
    loadingMsg:     page.getByText(/Se încarcă/),
    errorMsg:       page.getByText(/Eroare la încărcarea/),
  };
}

// Synchronization only (not an assertion): wait until the app finished its
// sound preload so later steps aren't racing page init.
async function waitForSoundBlobs(page) {
  await page.waitForFunction(() =>
    ['loadingNoise', 'errorNoise'].every((id) =>
      document.getElementById(id)?.dataset.blobReady === 'true'
    ),
    { timeout: 10000 },
  );
}

async function blockLateSoundRequests(page) {
  const lateSoundRequests = [];
  await page.route(SOUND_URL_RE, (route) => {
    lateSoundRequests.push(route.request().url());
    route.abort('failed');
  });
  return lateSoundRequests;
}

// A user "hears" a sound — the closest observable signal in a headless test
// is that its <audio> element is actively playing.
async function expectSoundPlaying(page, id) {
  await page.waitForFunction((audioId) => {
    const el = document.getElementById(audioId);
    return Boolean(el && !el.paused);
  }, id, { timeout: 3000 });
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

test.describe('Radio Player E2E', () => {

  test.beforeEach(async ({ page }) => {
    // Block Cloudinary images to speed up tests
    await page.route(/res\.cloudinary\.com/, (route) => {
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) });
    });
  });

  // --- Page load ---

  test('page loads with correct title and idle state', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/Radio Player|Coji/);
    await expect(c.playButton).toBeVisible();
    await expect(c.pauseButton).toBeHidden();
    await expect(c.stopButton).toBeHidden();
  });

  test('play button is focused on first load so Enter starts playback', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await expect(c.playButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(c.pauseButton).toBeFocused({ timeout: 8000 });
  });

  test('all radio station buttons are rendered in selector', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');
    await c.stationPicker.click();
    await expect(c.stationOptions).toHaveCount(STATION_COUNT);
  });

  // --- Play / Pause / Stop ---

  test('clicking play starts playback', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.playButton.click();

    // Playing: pause control appears, loading message gone, live dot in title
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });
    await expect(c.loadingMsg).toBeHidden();
    await expect(page).toHaveTitle(/🔴/);
  });

  test('clicking stop returns to idle', async ({ page }) => {
    const c = ui(page);
    // Delay stream response so loading state lasts long enough to click stop
    await mockStreamsDelayed(page, 2000);
    await page.goto('/');

    await c.playButton.click();
    await expect(c.stopButton).toBeVisible({ timeout: 3000 });

    await c.stopButton.click();
    await expect(c.playButton).toBeVisible();
    await expect(c.stopButton).toBeHidden();
  });

  test('keyboard focus stays in the center playback controls', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.playButton.focus();
    await page.keyboard.press('Enter');
    await expect(c.pauseButton).toBeFocused({ timeout: 8000 });

    await page.keyboard.press('Enter');
    await expect(c.playButton).toBeFocused();
  });

  test('keyboard focus returns to play after stopping from the center control', async ({ page }) => {
    const c = ui(page);
    await mockStreamsDelayed(page, 2000);
    await page.goto('/');

    await c.playButton.focus();
    await page.keyboard.press('Enter');
    await expect(c.stopButton).toBeFocused({ timeout: 3000 });

    await page.keyboard.press('Enter');
    await expect(c.playButton).toBeFocused();
  });

  // --- Station switching ---

  test('clicking next changes station', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveTitle(/Kiss FM/);

    await c.nextButton.click();

    // The next station's name shows up in the title (while loading and playing)
    await expect(page).toHaveTitle(/Europa FM/, { timeout: 8000 });
  });

  test('clicking prev wraps to last station from first', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    // Prev from the first station should wrap to the last one (FIP Radio France)
    await c.prevButton.click();
    await expect(page).toHaveTitle(/FIP/, { timeout: 8000 });
  });

  test('a transient stall on the HLS station does not interrupt playback', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    // Play the HLS station (FIP) the way a user would: pick it from the selector
    await c.stationPicker.click();
    await page.getByRole('option', { name: 'FIP Radio France' }).click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    // Browsers routinely emit 'stalled' between HLS segment fetches even when
    // playback is fine. Simulate that browser-level event and make sure the
    // player does NOT flash into loading/error while audio keeps playing.
    await page.locator('#player').evaluate((player) => {
      player.dispatchEvent(new Event('stalled'));
    });
    await page.waitForTimeout(5500);

    await expect(c.pauseButton).toBeVisible();
    await expect(c.loadingMsg).toBeHidden();
    await expect(c.errorMsg).toBeHidden();
    await expect(page).toHaveTitle(/FIP/);
  });

  test('recovers by itself after the connection drops and comes back (HLS)', async ({ page }) => {
    // Real timings: ~12s of buffer drains, watchdog notices (~6s), retry
    // cycle runs, then recovery reconnects once the network is back.
    test.setTimeout(120_000);
    const c = ui(page);

    // Same mock as mockStreams, plus a switch that simulates the connection
    // dropping: every stream request just hangs.
    let connectionDown = false;
    await page.route(STREAM_URL_RE, async (route) => {
      if (connectionDown) return; // nothing answers anymore
      const url = route.request().url();
      if (url.endsWith('.m3u8')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          body: [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-MEDIA-SEQUENCE:349685',
            '#EXT-X-TARGETDURATION:4',
            '#EXT-X-START:TIME-OFFSET=0',
            '#EXTINF:4.000,',
            '/accs3/fip/test-tone-349685.ts',
            '#EXTINF:4.000,',
            '/accs3/fip/test-tone-349686.ts',
            '#EXTINF:4.000,',
            '/accs3/fip/test-tone-349687.ts',
          ].join('\n'),
        });
        return;
      }
      if (url.includes('/accs3/fip/test-tone-')) {
        await route.fulfill({ status: 200, contentType: 'video/mp2t', body: HLS_TEST_SEGMENT });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', path: 'src/public/sounds/test-tone.mp3' });
    });

    await page.goto('/');
    await c.stationPicker.click();
    await page.getByRole('option', { name: 'FIP Radio France' }).click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    // The connection drops: playlist refreshes and segments stop answering.
    // The buffered audio drains, playback silently freezes — the app must
    // notice on its own (no 'error' event fires in this scenario).
    connectionDown = true;
    await expect(page).toHaveTitle(/⏳|❤️‍🩹/, { timeout: 45000 });

    // The connection comes back — the app must recover without any click
    connectionDown = false;
    await expect(c.pauseButton).toBeVisible({ timeout: 45000 });
    await expect(page).toHaveTitle(/🔴/);
    await expect(page).toHaveTitle(/FIP/);
  });

  // --- Station selector UI ---

  test('selecting a station from dropdown starts playing it', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.stationPicker.click();
    await expect(c.stationList).toBeVisible();

    await page.getByRole('option', { name: 'Europa FM' }).click();

    // Selector closes and the chosen station starts playing
    await expect(c.stationList).toBeHidden();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveTitle(/Europa FM/);
  });

  test('clicking outside closes the selector', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');

    await c.stationPicker.click();
    await expect(c.stationList).toBeVisible();

    // Click on body (outside selector)
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(c.stationList).toBeHidden();
  });

  test('Escape closes the selector after opening it with the mouse', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');

    await c.stationPicker.click();
    await expect(c.stationList).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(c.stationList).toBeHidden();
  });

  test('keyboard arrows navigate the selector after opening it with the mouse', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.stationPicker.click();
    await expect(c.stationList).toBeVisible();
    await expect(c.stationOptions.first()).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveTitle(/Europa/, { timeout: 8000 });
    await expect(c.stationPicker).toBeFocused();
  });

  test('opening selector focuses the selected station', async ({ page }) => {
    const c = ui(page);
    await page.addInitScript(() => {
      localStorage.setItem('lastRadioIndex', '2');
    });
    await page.goto('/');

    await c.stationPicker.click();
    await expect(c.stationList).toBeVisible();
    await expect(c.stationOptions.nth(2)).toBeFocused();
  });

  test('ArrowDown keeps the closed selector available for remote focus navigation', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');

    await c.stationPicker.focus();
    await page.keyboard.press('ArrowDown');

    await expect(c.stationList).toBeHidden();
  });

  test('keyboard users can open and navigate the selector from the poster', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await expect(c.posterButton).toHaveAttribute('aria-expanded', 'false');
    await c.posterButton.focus();
    await page.keyboard.press('Enter');
    await expect(c.stationList).toBeVisible();
    await expect(c.posterButton).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveTitle(/Europa/, { timeout: 8000 });
    await expect(c.posterButton).toHaveAttribute('aria-expanded', 'false');
    await expect(c.posterButton).toBeFocused();
  });

  test('keyboard users can reload the page from the logo', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');

    await c.logoButton.focus();

    await Promise.all([
      page.waitForEvent('load'),
      page.keyboard.press('Enter'),
    ]);

    // Back to a fresh idle page
    await expect(c.playButton).toBeVisible();
  });

  test('keyboard users can select a station and dismiss without changing selection', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    await c.stationPicker.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveTitle(/Europa/, { timeout: 8000 });
    await expect(c.stationPicker).toBeFocused();

    await c.stationPicker.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');

    // Dismissing without choosing keeps the current station
    await expect(page).toHaveTitle(/Europa/);
  });

  test('ArrowLeft and ArrowRight close the open selector', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');

    await c.stationPicker.focus();
    await page.keyboard.press('Enter');
    await expect(c.stationList).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(c.stationList).toBeHidden();
    await expect(c.stationPicker).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(c.stationList).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(c.stationList).toBeHidden();
    await expect(c.stationPicker).toBeFocused();
  });

  // --- Error state ---

  test('shows error state when stream fails', async ({ page }) => {
    const c = ui(page);
    await mockStreamsError(page);
    await page.goto('/');

    await c.playButton.click();

    // Should eventually show error message (after retry cycle)
    // Retry cycle: loading(6s) + retry delay(3s) + loading(6s) = ~15s worst case
    await expect(c.errorMsg).toBeVisible({ timeout: 25000 });

    // In error state, stop button is visible (error/recovering both show stop)
    await expect(c.stopButton).toBeVisible();
  });

  // --- localStorage persistence ---

  test('saves and restores last played station', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);
    await page.goto('/');

    // Open selector and pick "Digi FM" (3rd station, index 2)
    await c.stationPicker.click();
    await page.getByRole('option', { name: 'Digi FM' }).click();

    // Wait for playing state — the station is only remembered once it plays
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    await page.reload();

    // The restored station shows in the title while idle, ready to play
    await expect(page).toHaveTitle(/Digi FM/, { timeout: 5000 });
    await expect(c.playButton).toBeVisible();
  });

  test('ignores invalid saved station index', async ({ page }) => {
    const c = ui(page);
    await page.addInitScript(() => {
      localStorage.setItem('lastRadioIndex', '999');
    });
    await page.goto('/');

    await expect(c.playButton).toBeVisible();
    await expect(page).toHaveTitle(/Coji Radio Player/);

    await c.stationPicker.click();
    await expect(c.stationOptions).toHaveCount(STATION_COUNT);
  });

  // --- Loading / Error messages ---

  test('loading message appears during stream connection', async ({ page }) => {
    const c = ui(page);
    // Streams never answer — the app stays in the loading state
    await mockStreamsHang(page);
    await page.goto('/');

    await c.playButton.click();

    await expect(c.loadingMsg).toBeVisible({ timeout: 3000 });
    await expect(c.loadingMsg).toContainText('Kiss FM');
  });

  // --- Accessibility ---

  test('all control buttons have aria-labels', async ({ page }) => {
    await page.goto('/');

    for (const id of ['playButton', 'pauseButton', 'stopButton', 'prevButton', 'nextButton', 'new_selector__button']) {
      const label = await page.locator(`#${id}`).getAttribute('aria-label');
      expect(label, `${id} should have aria-label`).toBeTruthy();
    }
  });

  test('page has a main landmark', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
  });
});

// -------------------------------------------------------------------
// Offline — cached resources
// -------------------------------------------------------------------

test.describe('Offline — cached resources', () => {

  // Must match LABELS in script.js
  const LABELS = {
    appName: 'Coji Radio Player',
    loading: 'Se încarcă...',
    error:   'Eroare',
  };

  // Minimal valid 1×1 PNG so fetch().blob() produces a renderable image
  const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );

  test.beforeEach(async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
  });

  // The poster is the user's main visual feedback — it must render even offline.
  async function expectPosterRendered(page) {
    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });
  }

  // --- Images ---

  test('all 3 status images are fetched on page load so they can work offline', async ({ page }) => {
    const fetchedUrls = [];
    await page.route(/res\.cloudinary\.com/, (route) => {
      fetchedUrls.push(route.request().url());
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
    });

    await page.goto('/');

    for (const text of Object.values(LABELS)) {
      const encoded = encodeURIComponent(text);
      await expect
        .poll(() => fetchedUrls.some(u => u.includes(text) || u.includes(encoded)), {
          message: `should fetch image for "${text}"`,
          timeout: 5000,
        })
        .toBe(true);
    }
  });

  test('error and idle images render offline via SW cache', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);

    await page.goto('/');

    // Play a station, then wait (synchronization only) until the status
    // images actually landed in the cache before cutting the network.
    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });
    await page.waitForFunction(async (count) => {
      const cache = await caches.open('radio-images-v3');
      return (await cache.keys()).length >= count;
    }, STATION_COUNT + 3, { timeout: 10000 });

    await page.context().setOffline(true);

    // --- Error image (nextButton offline → error state) ---
    await c.nextButton.click();
    await expect(c.errorMsg).toBeVisible({ timeout: 3000 });
    await expectPosterRendered(page);

    // --- Idle / default image (stop → idle) ---
    await c.stopButton.click();
    await expect(c.playButton).toBeVisible();
    await expectPosterRendered(page);
  });

  // --- Sounds ---
  // A headless test can't literally *hear* the loading/error feedback, so
  // these observe the closest user-level signals: the sound is actively
  // playing, and no network was needed to play it.

  test('loading sound plays without any sound network request', async ({ page }) => {
    const c = ui(page);
    await mockStreamsHang(page);

    await page.goto('/');
    await waitForSoundBlobs(page);
    const lateSoundRequests = await blockLateSoundRequests(page);

    await c.playButton.click();
    await expect(c.loadingMsg).toBeVisible({ timeout: 3000 });
    await expectSoundPlaying(page, 'loadingNoise');

    expect(lateSoundRequests).toEqual([]);
  });

  test('offline station change plays the error sound, not the loading one', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');
    await waitForSoundBlobs(page);
    await page.context().setOffline(true);

    await c.nextButton.click();
    await expect(c.errorMsg).toBeVisible({ timeout: 3000 });
    await expectSoundPlaying(page, 'errorNoise');

    const loadingPaused = await page.evaluate(() => document.getElementById('loadingNoise').paused);
    expect(loadingPaused).toBe(true);
  });

  test('error sound plays while offline, with no sound network request', async ({ page }) => {
    const c = ui(page);
    await mockStreams(page);

    await page.goto('/');
    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    await waitForSoundBlobs(page);
    const lateSoundRequests = await blockLateSoundRequests(page);

    await page.context().setOffline(true);

    await c.nextButton.click();
    await expect(c.errorMsg).toBeVisible({ timeout: 3000 });

    await expectSoundPlaying(page, 'errorNoise');
    expect(lateSoundRequests).toEqual([]);
  });

  test('loading sound plays while the next station is still connecting', async ({ page }) => {
    const c = ui(page);
    // Stream mock with a flag to simulate slow/stuck response
    let blockStream = false;
    await page.route(
      STREAM_URL_RE,
      async (route) => {
        if (blockStream) return; // never respond → stays in loading
        await route.fulfill({
          status: 200,
          contentType: 'audio/mpeg',
          path: 'src/public/sounds/test-tone.mp3',
        });
      },
    );

    await page.goto('/');
    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    await waitForSoundBlobs(page);
    const lateSoundRequests = await blockLateSoundRequests(page);

    // Block stream so next station stays in loading state
    blockStream = true;

    await c.nextButton.click();
    await expect(c.loadingMsg).toBeVisible({ timeout: 3000 });

    await expectSoundPlaying(page, 'loadingNoise');
    expect(lateSoundRequests).toEqual([]);
  });

  test('sounds and error image work offline without prior play (SW pre-cache)', async ({ page }) => {
    const c = ui(page);
    await page.goto('/');

    // Synchronization only: wait for the SW to activate and pre-cache sounds
    await page.waitForFunction(() =>
      navigator.serviceWorker.ready.then(reg => reg.active !== null),
      { timeout: 10000 }
    );
    await page.waitForFunction(async () => {
      const cache = await caches.open('radio-sounds-v2');
      const keys = await cache.keys();
      return keys.length >= 2;
    }, { timeout: 10000 });

    // Go offline WITHOUT ever pressing play
    await page.context().setOffline(true);

    // Click next — should show the error with sound + image, all from cache
    await c.nextButton.click();
    await expect(c.errorMsg).toBeVisible({ timeout: 3000 });
    await expectPosterRendered(page);
    await expectSoundPlaying(page, 'errorNoise');

    // Stop — should show idle image offline
    await c.stopButton.click();
    await expect(c.playButton).toBeVisible();
    await expectPosterRendered(page);
  });
});

// Deliberate white-box exception: a stale-cache regression manifests as the
// WRONG audio playing, which a headless test cannot hear. Inspecting the
// cache contents is the only practical way to guard it.
test.describe('Sound cache versioning', () => {
  test.use({ serviceWorkers: 'block' });

  test('sound preload ignores stale entries from older sound caches', async ({ page }) => {
    await page.goto('/manifest.json');

    await page.evaluate(async (soundCacheName) => {
      await caches.delete(soundCacheName);
      const oldCache = await caches.open('radio-sounds-stale');
      await Promise.all(
        ['loading-low', 'error-low'].map((name) =>
          oldCache.put(
            new URL(`./sounds/${name}.mp3`, location.href).href,
            new Response(`stale-${name}`, { headers: { 'Content-Type': 'audio/mpeg' } }),
          )
        )
      );
    }, SOUND_CACHE_NAME);

    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
    await page.route(SOUND_URL_RE, (route) => {
      const isLoading = route.request().url().includes('loading-low');
      route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: isLoading ? 'fresh-loading' : 'fresh-error',
      });
    });

    await page.goto('/');
    await waitForSoundBlobs(page);

    const cachedBodies = await page.evaluate(async (soundCacheName) => {
      const cache = await caches.open(soundCacheName);
      const loading = await cache.match(new URL('./sounds/loading-low.mp3', location.href).href);
      const error = await cache.match(new URL('./sounds/error-low.mp3', location.href).href);
      return {
        loading: await loading?.text(),
        error: await error?.text(),
      };
    }, SOUND_CACHE_NAME);

    expect(cachedBodies).toEqual({
      loading: 'fresh-loading',
      error: 'fresh-error',
    });
  });
});

// The user's core promise: once they pressed play, the app must never sit in
// silence. If the network dies mid-playback the OS pauses the dead stream
// element — the app must treat that as a failure (audible loading → error),
// NOT as the user pressing pause.
test.describe('Offline mid-playback — always audible', () => {

  test('going offline while playing keeps a sound on and recovers by itself', async ({ page }) => {
    test.setTimeout(60_000);
    const c = ui(page);

    let connectionDown = false;
    await page.route(STREAM_URL_RE, async (route) => {
      if (connectionDown) {
        await route.abort('internetdisconnected');
        return;
      }
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', path: 'src/public/sounds/test-tone.mp3' });
    });

    await page.goto('/');
    await waitForSoundBlobs(page);

    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    // The connection drops, and — like on a phone — the OS pauses the dead
    // stream element. (Calling pause() on the element IS the OS behaviour;
    // same environment-simulation approach as the 'stalled' test above.)
    connectionDown = true;
    await page.context().setOffline(true);
    await page.locator('#player').evaluate((el) => el.pause());

    // NOT the paused UI: the app announces the problem (audible retry runs
    // first, then the offline retry lands in error) instead of going mute
    await expect(c.errorMsg).toBeVisible({ timeout: 10000 });
    await expect(c.playButton).toBeHidden();
    await expectSoundPlaying(page, 'errorNoise');

    // The network comes back — the radio recovers with no click
    connectionDown = false;
    await page.context().setOffline(false);
    await expect(c.pauseButton).toBeVisible({ timeout: 45000 });
  });

  test('pausing on purpose stays paused — even if the app is offline', async ({ page }) => {
    test.setTimeout(60_000);
    const c = ui(page);
    await mockStreams(page);

    await page.goto('/');
    await c.playButton.click();
    await expect(c.pauseButton).toBeVisible({ timeout: 8000 });

    await c.pauseButton.click();
    await page.context().setOffline(true);

    // A deliberate pause is respected: play control shows, no error, no sounds
    await expect(c.playButton).toBeVisible();
    await page.waitForTimeout(4000); // enough for any misfired retry to surface
    await expect(c.playButton).toBeVisible();
    await expect(c.errorMsg).toBeHidden();
    await expect(c.loadingMsg).toBeHidden();
  });
});
