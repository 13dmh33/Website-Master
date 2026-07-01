// Mobile-viewport homepage screenshot capture, used as input to the vision pass.
// Isolated behind an injectable `chromiumLauncher` so tests never spin up a real browser.

import { chromium } from 'playwright';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

export async function captureScreenshot(url, { chromiumLauncher = chromium } = {}) {
  let browser;
  try {
    browser = await chromiumLauncher.launch();
    const page = await browser.newPage({ viewport: MOBILE_VIEWPORT });
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    const buffer = await page.screenshot({ fullPage: false });
    return { buffer, available: true };
  } catch (err) {
    return { buffer: null, available: false, reason: `screenshot failed: ${err.message}` };
  } finally {
    if (browser) await browser.close();
  }
}
