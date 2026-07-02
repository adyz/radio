import { test, expect } from '@playwright/test';

const STREAM_URL_RE = /live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio|radiofrance/;
const SOUND_URL_RE = /\/sounds\/(?:loading-low|error-low)\.mp3(?:\?.*)?$/;
const SOUND_CACHE_NAME = 'radio-sounds-v1';

// Helper: intercept all radio stream URLs and serve our local test tone instead
async function mockStreams(page) {
  await page.route(STREAM_URL_RE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      path: 'src/sounds/test-tone.mp3',
    });
  });
}

// Helper: intercept streams and respond with an error
async function mockStreamsError(page) {
  await page.route(STREAM_URL_RE, (route) => {
    route.abort('internetdisconnected');
  });
}

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

async function expectSoundPlayingFromBlob(page, id) {
  await page.waitForFunction((audioId) => {
    const el = document.getElementById(audioId);
    return Boolean(el && !el.paused && el.src.startsWith('blob:'));
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
    await page.goto('/');
    await expect(page).toHaveTitle(/Radio Player|Coji/);
    await expect(page.locator('#playButton')).toBeVisible();
    await expect(page.locator('#pauseButton')).toBeHidden();
    await expect(page.locator('#stopButton')).toBeHidden();
  });

  test('play button is focused on first load so Enter starts playback', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    await expect(page.getByLabel('Redare')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Pauză')).toBeFocused({ timeout: 8000 });
  });

  test('all radio station buttons are rendered in selector', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Alege postul de radio').click();
    await expect(page.getByRole('listbox', { name: 'Posturi de radio' }).getByRole('option')).toHaveCount(19);
  });

  // --- Play / Pause / Stop ---

  test('clicking play starts loading, then plays', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    await page.locator('#playButton').click();

    // Should transition to loading → show stop button
    await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });

    // Wait for playing state (stop button stays visible while playing)
    // The poster image should update away from idle
    await expect(page.locator('#posterImage img')).not.toHaveAttribute(
      'src', /Coji%20Radio%20Player/, { timeout: 8000 }
    );
  });

  test('clicking stop returns to idle', async ({ page }) => {
    // Delay stream response so loading state lasts long enough to click stop
    await page.route(STREAM_URL_RE, async (route) => {
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        path: 'src/sounds/test-tone.mp3',
      });
    });
    await page.goto('/');

    await page.locator('#playButton').click();
    await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });

    await page.locator('#stopButton').click();
    await expect(page.locator('#playButton')).toBeVisible();
    await expect(page.locator('#stopButton')).toBeHidden();
  });

  test('keyboard focus stays in the center playback controls', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    await page.getByLabel('Redare').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Pauză')).toBeFocused({ timeout: 8000 });

    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Redare')).toBeFocused();
  });

  test('keyboard focus returns to play after stopping from the center control', async ({ page }) => {
    await page.route(STREAM_URL_RE, async (route) => {
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        path: 'src/sounds/test-tone.mp3',
      });
    });
    await page.goto('/');

    await page.getByLabel('Redare').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Oprește')).toBeFocused({ timeout: 3000 });

    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Redare')).toBeFocused();
  });

  // --- Station switching ---

  test('clicking next changes station', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    // Start playing and wait for playing state (poster shows station name)
    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    // Get initial poster (now shows actual station name, not loading text)
    const initialSrc = await page.locator('#posterImage img').getAttribute('src');

    // Click next
    await page.locator('#nextButton').click();

    // Wait for poster to change to a different station
    await expect(page.locator('#posterImage img')).not.toHaveAttribute('src', initialSrc, { timeout: 8000 });
  });

  test('clicking prev wraps to last station from first', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    // Click prev — should wrap from station 0 to station 18 (last = FIP Radio France)
    await page.locator('#prevButton').click();

    // Wait for poster to update to last station
    await expect(page.locator('#posterImage img')).toHaveAttribute('src', /FIP/, { timeout: 8000 });
  });

  // --- Station selector UI ---

  test('selecting a station from dropdown starts playing it', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    // Open selector
    await page.locator('#new_selector__button').click();
    await expect(page.locator('#new_selector__content')).toBeVisible();

    // Pick "Europa FM" (2nd station)
    await page.getByRole('option', { name: 'Europa FM' }).click();

    // Selector should close
    await expect(page.locator('#new_selector__content')).toBeHidden();

    // Should be loading/playing
    await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });
  });

  test('clicking outside closes the selector', async ({ page }) => {
    await page.goto('/');

    await page.locator('#new_selector__button').click();
    await expect(page.locator('#new_selector__content')).toBeVisible();

    // Click on body (outside selector)
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#new_selector__content')).toBeHidden();
  });

  test('Escape closes the selector after opening it with the mouse', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Alege postul de radio').click();
    await expect(page.locator('#new_selector__content')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#new_selector__content')).toBeHidden();
  });

  test('keyboard arrows navigate the selector after opening it with the mouse', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    const stationPicker = page.getByLabel('Alege postul de radio');
    const poster = page.locator('#posterImage img');
    const options = page.getByRole('listbox', { name: 'Posturi de radio' }).getByRole('option');

    await stationPicker.click();
    await expect(page.locator('#new_selector__content')).toBeVisible();
    await expect(options.first()).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(poster).toHaveAttribute('src', /Europa/, { timeout: 8000 });
    await expect(stationPicker).toBeFocused();
  });

  test('opening selector focuses the selected station', async ({ page }) => {
    await page.goto('/');

    const stationPicker = page.getByLabel('Alege postul de radio');
    const options = page.getByRole('listbox', { name: 'Posturi de radio' }).getByRole('option');

    await page.evaluate(() => localStorage.setItem('lastRadioIndex', '2'));
    await page.reload();

    await stationPicker.click();
    await expect(page.locator('#new_selector__content')).toBeVisible();
    await expect(options.nth(2)).toBeFocused();
  });

  test('ArrowDown keeps the closed selector available for remote focus navigation', async ({ page }) => {
    await page.goto('/');

    const stationPicker = page.getByLabel('Alege postul de radio');
    const selector = page.locator('#new_selector__content');

    await stationPicker.focus();
    await page.keyboard.press('ArrowDown');

    await expect(selector).toBeHidden();
  });

  test('keyboard users can open and navigate the selector from the poster', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    const poster = page.locator('#posterImage img');
    const posterButton = page.getByRole('button', { name: 'Deschide selectorul de posturi', exact: true });

    await expect(posterButton).toHaveAttribute('aria-expanded', 'false');
    await posterButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#new_selector__content')).toBeVisible();
    await expect(posterButton).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(poster).toHaveAttribute('src', /Europa/, { timeout: 8000 });
    await expect(posterButton).toHaveAttribute('aria-expanded', 'false');
    await expect(posterButton).toBeFocused();
  });

  test('keyboard users can reload the page from the logo', async ({ page }) => {
    await page.goto('/');

    const logoButton = page.getByLabel('Reîncarcă pagina');
    await logoButton.focus();

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.keyboard.press('Enter'),
    ]);

    await expect(page).toHaveURL(/\/$/);
  });

  test('keyboard users can select a station and dismiss without changing selection', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    const stationPicker = page.getByLabel('Alege postul de radio');
    const poster = page.locator('#posterImage img');

    await stationPicker.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(poster).toHaveAttribute('src', /Europa/, { timeout: 8000 });
    await expect(stationPicker).toBeFocused();

    await stationPicker.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');

    await expect(poster).toHaveAttribute('src', /Europa/);
  });

  test('ArrowLeft and ArrowRight close the open selector', async ({ page }) => {
    await page.goto('/');

    const stationPicker = page.getByLabel('Alege postul de radio');

    await stationPicker.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#new_selector__content')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#new_selector__content')).toBeHidden();
    await expect(stationPicker).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#new_selector__content')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#new_selector__content')).toBeHidden();
    await expect(stationPicker).toBeFocused();
  });

  // --- Error state ---

  test('shows error state when stream fails', async ({ page }) => {
    await mockStreamsError(page);
    await page.goto('/');

    await page.locator('#playButton').click();

    // Should eventually show error message (after retry cycle)
    // Retry cycle: loading(6s) + retry delay(3s) + loading(6s) = ~15s worst case
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 25000 });

    // In error state, stop button is visible (error/recovering both show stop)
    await expect(page.locator('#stopButton')).toBeVisible();
  });

  // --- localStorage persistence ---

  test('saves and restores last played station', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    // Open selector and pick "Digi FM" (3rd station, index 2)
    await page.getByLabel('Alege postul de radio').click();
    await page.getByRole('option', { name: 'Digi FM' }).click();

    // Wait for playing state — saveLastIndex is called only when playing starts
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    // Reload page
    await page.reload();

    // Poster should show Digi FM (restored from localStorage, idle shows station title)
    await expect(page.locator('#posterImage img')).toHaveAttribute('src', /Digi/, { timeout: 5000 });
  });

  test('ignores invalid saved station index', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('lastRadioIndex', '999');
    });
    await page.goto('/');

    await expect(page.locator('#playButton')).toBeVisible();
    await expect(page.locator('#posterImage img')).toHaveAttribute('src', /Coji%20Radio%20Player/);

    await page.getByLabel('Alege postul de radio').click();
    await expect(page.getByRole('listbox', { name: 'Posturi de radio' }).getByRole('option')).toHaveCount(19);
  });

  // --- Loading / Error messages ---

  test('loading message appears during stream connection', async ({ page }) => {
    // Use a slow route to keep it in loading state
    await page.route(/live\.kissfm/, (route) => {
      // Never respond — stays in loading
      // (Playwright will clean up when test ends)
    });
    await page.goto('/');

    await page.locator('#playButton').click();

    await expect(page.locator('#loadingMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });
    expect(await page.locator('#loadingMsg').innerText()).toContain('Kiss FM');
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
    await expect(page.locator('main')).toBeVisible();
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

  // --- Images ---

  test('all 3 status images are pre-cached on page load', async ({ page }) => {
    const fetchedUrls = [];
    await page.route(/res\.cloudinary\.com/, (route) => {
      fetchedUrls.push(route.request().url());
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    for (const text of Object.values(LABELS)) {
      const encoded = encodeURIComponent(text);
      expect(fetchedUrls.some(u => u.includes(text) || u.includes(encoded)),
        `should fetch image for "${text}"`).toBe(true);
    }
  });

  test('error and idle images render offline via SW cache', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
    await mockStreams(page);

    await page.goto('/');

    // Play a station so images have time to be cached via Cache API / SW
    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(2000);

    await page.context().setOffline(true);

    // --- Error image (nextButton offline → error state) ---
    await page.locator('#nextButton').click();
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    // Image should still load offline (served from SW cache)
    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });

    // --- Idle / default image (stop → idle with no restored station) ---
    await page.locator('#stopButton').click();
    await expect(page.locator('#playButton')).toBeVisible();

    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });
  });

  // --- Sounds ---

  test('preloads loading and error sounds into blob memory on page load', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));

    await page.goto('/');
    await waitForSoundBlobs(page);

    const blobStates = await page.evaluate(() => ({
      loading: document.getElementById('loadingNoise').dataset.blobReady,
      error: document.getElementById('errorNoise').dataset.blobReady,
    }));

    expect(blobStates).toEqual({ loading: 'true', error: 'true' });
  });

  test('loading sound uses preloaded blob on first play without late sound network', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
    await page.route(STREAM_URL_RE, () => {
      // Keep the stream pending so the app remains in loading state.
    });

    await page.goto('/');
    await waitForSoundBlobs(page);
    const lateSoundRequests = await blockLateSoundRequests(page);

    await page.locator('#playButton').click();
    await expect(page.locator('#loadingMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });
    await expectSoundPlayingFromBlob(page, 'loadingNoise');

    expect(lateSoundRequests).toEqual([]);
  });

  test('offline station change stops loading warmup when error sound starts', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));

    await page.goto('/');
    await waitForSoundBlobs(page);
    await page.context().setOffline(true);

    await page.locator('#nextButton').click();
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });
    await expectSoundPlayingFromBlob(page, 'errorNoise');

    const loadingPaused = await page.evaluate(() => document.getElementById('loadingNoise').paused);
    expect(loadingPaused).toBe(true);
  });

  test('error sound plays offline from preloaded blob', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
    await mockStreams(page);

    await page.goto('/');
    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    await waitForSoundBlobs(page);
    const lateSoundRequests = await blockLateSoundRequests(page);

    await page.context().setOffline(true);

    // nextButton → offline → error → errorSound.play() from blob
    await page.locator('#nextButton').click();
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    await expectSoundPlayingFromBlob(page, 'errorNoise');
    expect(lateSoundRequests).toEqual([]);
  });

  test('loading sound plays from preloaded blob', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));

    // Stream mock with a flag to simulate slow/stuck response
    let blockStream = false;
    await page.route(
      STREAM_URL_RE,
      async (route) => {
        if (blockStream) return; // never respond → stays in loading
        await route.fulfill({
          status: 200,
          contentType: 'audio/mpeg',
          path: 'src/sounds/test-tone.mp3',
        });
      },
    );

    await page.goto('/');
    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    await waitForSoundBlobs(page);
    const lateSoundRequests = await blockLateSoundRequests(page);

    // Block stream so next station stays in loading state
    blockStream = true;

    await page.locator('#nextButton').click();
    await expect(page.locator('#loadingMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    await expectSoundPlayingFromBlob(page, 'loadingNoise');
    expect(lateSoundRequests).toEqual([]);
  });

  test('sounds and error image work offline without prior play (SW pre-cache)', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));

    await page.goto('/');

    // Wait for SW to activate and pre-cache sounds
    await page.waitForFunction(() =>
      navigator.serviceWorker.ready.then(reg => reg.active !== null),
      { timeout: 10000 }
    );
    // Give SW time to finish cache.addAll in install event
    await page.waitForFunction(async () => {
      const cache = await caches.open('radio-sounds-v1');
      const keys = await cache.keys();
      return keys.length >= 2;
    }, { timeout: 10000 });

    // Go offline WITHOUT ever pressing play
    await page.context().setOffline(true);

    // Click next — should trigger error state with sound + image from cache
    await page.locator('#nextButton').click();
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    // Error image should render offline
    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });

    // Error sound should play (from SW cache or blob)
    await page.waitForTimeout(500);
    const errorPlaying = await page.evaluate(() => {
      const el = document.getElementById('errorNoise');
      return !el.paused;
    });
    expect(errorPlaying).toBe(true);

    // Stop — should show idle image offline
    await page.locator('#stopButton').click();
    await expect(page.locator('#playButton')).toBeVisible();

    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });
  });
});

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
