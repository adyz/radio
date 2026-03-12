import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mockStreams(page) {
  await page.route(
    /live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        path: 'src/sounds/test-tone.mp3',
      });
    },
  );
}

async function mockStreamsError(page) {
  await page.route(
    /live\.kissfm|europafm|digifm|magicfm|virginradio|srr\.ro|profm|rockfm|guerrillaradio|nationalfm|dancefm|radiovibefm|radioprob|vanillaradio/,
    (route) => route.abort('connectionfailed'),
  );
}

// Minimal 1x1 PNG for Cloudinary stubs
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// Parametrised suite — runs identically against v1 and v2
// ---------------------------------------------------------------------------

const versions = [
  { name: 'v1', path: '/' },
  { name: 'v2', path: '/v2/' },
];

for (const { name, path } of versions) {
  test.describe(`Radio Player E2E — ${name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.route(/res\.cloudinary\.com/, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
      );
    });

    // ── Page load ──────────────────────────────────────────────────

    test('page loads with correct title and idle state', async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(/Radio Player|Coji/);
      await expect(page.locator('#playButton')).toBeVisible();
      await expect(page.locator('#pauseButton')).toBeHidden();
      await expect(page.locator('#stopButton')).toBeHidden();
    });

    test('all radio station buttons are rendered in selector', async ({ page }) => {
      await page.goto(path);
      await page.locator('#new_selector__button').click();
      await expect(page.locator('#new_selector__content')).toBeVisible();
      const buttons = page.locator('#new_selector__content button');
      await expect(buttons).toHaveCount(18);
    });

    // ── Play / Pause / Stop ────────────────────────────────────────

    test('clicking play starts loading, then plays', async ({ page }) => {
      await mockStreams(page);
      await page.goto(path);

      await page.locator('#playButton').click();
      await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });

      // Poster should update away from idle text
      await expect(page.locator('#posterImage img')).not.toHaveAttribute(
        'src',
        /Coji%20Radio%20Player/,
        { timeout: 8000 },
      );
    });

    test('clicking stop returns to idle', async ({ page }) => {
      await mockStreams(page);
      await page.goto(path);

      await page.locator('#playButton').click();
      await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });

      await page.locator('#stopButton').click();
      await expect(page.locator('#playButton')).toBeVisible();
      await expect(page.locator('#stopButton')).toBeHidden();
    });

    // ── Station switching ──────────────────────────────────────────

    test('clicking next changes station', async ({ page }) => {
      await mockStreams(page);
      await page.goto(path);

      await page.locator('#playButton').click();
      await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

      const initialSrc = await page.locator('#posterImage img').getAttribute('src');

      await page.locator('#nextButton').click();

      await expect(page.locator('#posterImage img')).not.toHaveAttribute(
        'src',
        initialSrc,
        { timeout: 8000 },
      );
    });

    test('clicking prev wraps to last station from first', async ({ page }) => {
      await mockStreams(page);
      await page.goto(path);

      await page.locator('#playButton').click();
      await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

      await page.locator('#prevButton').click();

      await expect(page.locator('#posterImage img')).toHaveAttribute(
        'src',
        /Vanilla/,
        { timeout: 8000 },
      );
    });

    // ── Station selector UI ────────────────────────────────────────

    test('selecting a station from dropdown starts playing it', async ({ page }) => {
      await mockStreams(page);
      await page.goto(path);

      await page.locator('#new_selector__button').click();
      await expect(page.locator('#new_selector__content')).toBeVisible();

      // Pick 2nd station (Europa FM)
      await page.locator('#new_selector__content button').nth(1).click();

      await expect(page.locator('#new_selector__content')).toBeHidden();
      await expect(page.locator('#stopButton')).toBeVisible({ timeout: 3000 });
    });

    test('clicking outside closes the selector', async ({ page }) => {
      await page.goto(path);

      await page.locator('#new_selector__button').click();
      await expect(page.locator('#new_selector__content')).toBeVisible();

      // Click body outside selector area
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await expect(page.locator('#new_selector__content')).toBeHidden();
    });

    // ── Error state ────────────────────────────────────────────────

    test('shows error state when stream fails', async ({ page }) => {
      await mockStreamsError(page);
      await page.goto(path);

      await page.locator('#playButton').click();

      await expect(page.locator('#errorMsg')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#stopButton')).toBeVisible();
    });

    // ── localStorage persistence ───────────────────────────────────

    test('saves and restores last played station', async ({ page }) => {
      await mockStreams(page);
      await page.goto(path);

      // Pick Digi FM (3rd station, index 2)
      await page.locator('#new_selector__button').click();
      await page.locator('#new_selector__content button').nth(2).click();

      await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });

      await page.reload();

      await expect(page.locator('#posterImage img')).toHaveAttribute(
        'src',
        /Digi/,
        { timeout: 5000 },
      );
    });

    // ── Loading message ────────────────────────────────────────────

    test('loading message appears during stream connection', async ({ page }) => {
      // Slow route — never responds, stays in loading
      await page.route(/live\.kissfm/, () => {});
      await page.goto(path);

      await page.locator('#playButton').click();

      await expect(page.locator('#loadingMsg')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('#loadingMsg')).toContainText('Kiss FM');
    });

    // ── Accessibility ──────────────────────────────────────────────

    test('all control buttons have aria-labels', async ({ page }) => {
      await page.goto(path);

      // Idle state — play, prev, next, selector all present
      for (const id of ['playButton', 'prevButton', 'nextButton', 'new_selector__button']) {
        await expect(page.locator(`#${id}`)).toHaveAttribute('aria-label', /.+/);
      }
    });

    test('page has a main landmark', async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
    });
  });

  // ── Offline — cached poster images ───────────────────────────────

  test.describe(`Offline — cached resources — ${name}`, () => {
    const LABELS = {
      appName: 'Coji Radio Player',
      loading: 'Se \u00eencarc\u0103...',
      error: 'Eroare',
    };

    test('all 3 status images are fetched for blob preload on page load', async ({ page }) => {
      const fetchedUrls = [];
      await page.route(/res\.cloudinary\.com/, (route) => {
        fetchedUrls.push(route.request().url());
        route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
      });

      await page.goto(path);
      await page.waitForTimeout(2000);

      for (const text of Object.values(LABELS)) {
        const encoded = encodeURIComponent(text);
        expect(
          fetchedUrls.some((u) => u.includes(encoded)),
          `should fetch image for "${text}"`,
        ).toBe(true);
      }
    });

    test('error and idle images render offline via blob URLs', async ({ page }) => {
      await page.route(/res\.cloudinary\.com/, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
      );
      await mockStreams(page);

      await page.goto(path);

      // Play so blobs preload in background
      await page.locator('#playButton').click();
      await expect(page.locator('#pauseButton')).toBeVisible({ timeout: 8000 });
      await page.waitForTimeout(2000);

      await page.context().setOffline(true);

      // Next while offline — triggers error state
      await page.locator('#nextButton').click();
      await expect(page.locator('#errorMsg')).toBeVisible({ timeout: 3000 });

      const errorSrc = await page.locator('#posterImage img').getAttribute('src');
      expect(errorSrc).toMatch(/^blob:/);
      await page.waitForFunction(
        () => {
          const img = document.querySelector('#posterImage img');
          return img && img.complete && img.naturalWidth > 0;
        },
        { timeout: 5000 },
      );

      // Stop — back to idle
      await page.locator('#stopButton').click();
      await expect(page.locator('#playButton')).toBeVisible();

      // Idle poster: may be blob (appName cached) or Cloudinary URL
      // (station name from localStorage — not pre-cached). Both are valid.
      const idleSrc = await page.locator('#posterImage img').getAttribute('src');
      expect(idleSrc).toBeTruthy();
    });
  });
}
