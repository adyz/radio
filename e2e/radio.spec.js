import { test, expect } from '@playwright/test';

// Helper: intercept all radio stream URLs and serve our local test tone instead
async function mockStreams(page) {
  await page.route(/live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      path: 'src/sounds/test-tone.mp3',
    });
  });
}

// Helper: intercept streams and respond with an error
async function mockStreamsError(page) {
  await page.route(/live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio/, (route) => {
    route.abort('connectionfailed');
  });
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

  test('all radio station buttons are rendered in selector', async ({ page }) => {
    await page.goto('/');
    await page.locator('#new_selector__button').click();
    const buttons = page.locator('#new_selector__content button:not(.hidden)');
    await expect(buttons).toHaveCount(18); // 18 stations
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
    await mockStreams(page);
    await page.goto('/');

    await page.locator('#playButton').click();
    await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });

    await page.locator('#stopButton').click();
    await expect(page.locator('#playButton')).toBeVisible();
    await expect(page.locator('#stopButton')).toBeHidden();
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

    // Click prev — should wrap from station 0 to station 17 (last = Vanilla Radio Fresh)
    await page.locator('#prevButton').click();

    // Wait for poster to update to last station
    await expect(page.locator('#posterImage img')).toHaveAttribute('src', /Vanilla/, { timeout: 8000 });
  });

  // --- Station selector UI ---

  test('selecting a station from dropdown starts playing it', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    // Open selector
    await page.locator('#new_selector__button').click();
    await expect(page.locator('#new_selector__content')).toBeVisible();

    // Pick "Europa FM" (2nd station)
    await page.locator('#new_selector__content button:not(.hidden)').nth(1).click();

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

  // --- Error state ---

  test('shows error state when stream fails', async ({ page }) => {
    await mockStreamsError(page);
    await page.goto('/');

    await page.locator('#playButton').click();

    // Should eventually show error message (after retry cycle)
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 15000 });

    // In error state, stop button is visible (error/recovering both show stop)
    await expect(page.locator('#stopButton')).toBeVisible();
  });

  // --- localStorage persistence ---

  test('saves and restores last played station', async ({ page }) => {
    await mockStreams(page);
    await page.goto('/');

    // Open selector and pick "Digi FM" (3rd station, index 2)
    await page.locator('#new_selector__button').click();
    await page.locator('#new_selector__content button:not(.hidden)').nth(2).click();

    // Wait for playing state — saveLastIndex is called only when playing starts
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    // Reload page
    await page.reload();

    // Poster should show Digi FM (restored from localStorage, idle shows station title)
    await expect(page.locator('#posterImage img')).toHaveAttribute('src', /Digi/, { timeout: 5000 });
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

  // Minimal valid 1×1 PNG so Cache API stores a renderable image
  const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );

  /** Play the default station, wait for playing state, and ensure SW + cache are ready. */
  async function playAndWaitForCache(page) {
    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    await page.evaluate(async () => {
      // SW must be active + controlling the page
      await navigator.serviceWorker.ready;
      // Wait for pre-cache to finish (3 status images in 'radio-status')
      for (let i = 0; i < 50; i++) {
        const cache = await caches.open('radio-status');
        if ((await cache.keys()).length >= 3) return;
        await new Promise(r => setTimeout(r, 100));
      }
    });
  }

  // --- Images ---

  test('all 3 status images are pre-cached on page load', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));

    await page.goto('/');
    // SW controllerchange triggers page reload on first visit — wait for it
    await page.waitForTimeout(2000);

    const urls = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const cache = await caches.open('radio-status');
        const keys = await cache.keys();
        if (keys.length >= 3) return keys.map(r => r.url);
        await new Promise(r => setTimeout(r, 100));
      }
      return (await (await caches.open('radio-status')).keys()).map(r => r.url);
    });

    // Cache API normalizes URLs → spaces become %20
    for (const text of Object.values(LABELS)) {
      const encoded = encodeURIComponent(text);
      expect(urls.some(u => u.includes(encoded)), `cache should contain image for "${text}"`).toBe(true);
    }
  });

  test('error and idle images render offline via SW cache', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
    await mockStreams(page);

    await page.goto('/');
    await playAndWaitForCache(page);

    // Remove all mocks so Cloudinary requests go through the SW
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.context().setOffline(true);

    // --- Error image ---
    // nextButton → playRadio → isOnline()=false → error state immediately
    await page.locator('#nextButton').click();
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    // getAttribute('src') returns the URL with encoded text (encodeURIComponent in cloudinaryImageUrl)
    expect(await page.locator('#posterImage img').getAttribute('src')).toContain(encodeURIComponent(LABELS.error));
    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });

    // --- Idle / default image ---
    // stop → idle (hasRestoredStation=false in fresh context → shows "Coji Radio Player")
    await page.locator('#stopButton').click();
    await expect(page.locator('#playButton')).toBeVisible();

    expect(await page.locator('#posterImage img').getAttribute('src')).toContain(encodeURIComponent(LABELS.appName));
    await page.waitForFunction(() => {
      const img = document.querySelector('#posterImage img');
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });
  });

  // --- Sounds ---

  test('error sound plays offline from preloaded blob', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
    await mockStreams(page);

    await page.goto('/');
    await page.locator('#playButton').click();
    await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

    // Wait for blob preload to finish
    await page.waitForTimeout(2000);

    await page.context().setOffline(true);

    // nextButton → offline → error → errorSound.play() from blob
    await page.locator('#nextButton').click();
    await expect(page.locator('#errorMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    // Give audio time to start
    await page.waitForTimeout(300);

    const { paused, src } = await page.evaluate(() => {
      const el = document.getElementById('errorNoise');
      return { paused: el.paused, src: el.src };
    });

    expect(paused).toBe(false);
    expect(src).toMatch(/^blob:/);
  });

  test('loading sound plays from preloaded blob', async ({ page }) => {
    await page.route(/res\.cloudinary\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));

    // Stream mock with a flag to simulate slow/stuck response
    let blockStream = false;
    await page.route(
      /live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio/,
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

    // Wait for blob preload to finish
    await page.waitForTimeout(2000);

    // Block stream so next station stays in loading state
    blockStream = true;

    await page.locator('#nextButton').click();
    await expect(page.locator('#loadingMsg')).not.toHaveClass(/invisible/, { timeout: 3000 });

    await page.waitForTimeout(300);

    const { paused, src } = await page.evaluate(() => {
      const el = document.getElementById('loadingNoise');
      return { paused: el.paused, src: el.src };
    });

    expect(paused).toBe(false);
    expect(src).toMatch(/^blob:/);
  });
});
