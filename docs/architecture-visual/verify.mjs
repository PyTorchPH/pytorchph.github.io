import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const cases = [
  ['session', { token: 'missing' }, '401 · DENIED'],
  ['session', { expired: 'yes' }, '401 · DENIED'],
  ['session', { found: 'no' }, '401 · DENIED'],
  ['rubric', { source: 'other' }, '90 POINTS'],
  ['rubric', { units: 12 }, '240 POINTS'],
  ['rubric', { published: 'no' }, 'NO RUBRIC'],
  ['ranking', { view: 'pending' }, 'Dan › Bea › Cal › Ana'],
  ['ranking', { bea: 0 }, 'Cal › Ana › Dan › Bea'],
  ['tiers', { rank: 1 }, 'T4 I · 100%'],
  ['tiers', { rank: 12 }, 'T1 III · 0%'],
  ['tiers', { positive: 'no' }, 'UNRANKED'],
  ['streak', { pattern: 'grace' }, '4 WEEKS'],
  ['streak', { pattern: 'gap' }, '3 WEEKS'],
  ['streak', { pattern: 'old' }, '0 WEEKS'],
  ['review', { self: 'yes' }, '403 · DENIED'],
  ['review', { pending: 'no' }, '409 · CONFLICT'],
  ['review', { decision: 'scraper_defect' }, '400 · BAD ORIGIN'],
  ['review', { decision: 'scraper_defect', origin: 'extension' }, 'PENDING / DISPUTED'],
  ['mtls', { ca: 'no' }, 'TRANSPORT DENIED'],
  ['mtls', { pin: 'no' }, 'TRANSPORT DENIED'],
  ['freshness', { skew: 60 }, 'FRESH CONTEXT ✓'],
  ['freshness', { skew: -60 }, 'FRESH CONTEXT ✓'],
  ['freshness', { skew: 61 }, 'CONTEXT DENIED'],
  ['freshness', { skew: -61 }, 'CONTEXT DENIED'],
  ['freshness', { purpose: 'unknown' }, 'CONTEXT DENIED'],
  ['consent', { consent: 'no' }, 'UNAVAILABLE'],
  ['consent', { consent: 'no', visible: 'yes' }, 'NAME AVAILABLE ✓'],
  ['consent', { exists: 'no' }, 'UNAVAILABLE'],
  ['photo', { bytes: 384 }, 'BOUNDED WEBP ✓'],
  ['photo', { bytes: 385 }, 'PHOTO REJECTED'],
  ['photo', { dimensions: 'pixels' }, 'PHOTO REJECTED'],
  ['photo', { dimensions: 'wide' }, 'PHOTO REJECTED'],
  ['photo', { quality: 'retry' }, 'BOUNDED WEBP ✓'],
  ['photo', { quality: 'fail' }, 'PHOTO REJECTED'],
  ['idempotence', { request: 'same' }, 'SAFE RETRY ✓'],
  ['idempotence', { request: 'conflict' }, '409 · CONFLICT'],
  ['idempotence', { writes: 'no' }, '503 · DISABLED'],
  ['photo-access', { route: 'self' }, 'PHOTO AVAILABLE ✓'],
  ['photo-access', { route: 'self', owner: 'no' }, 'PHOTO UNAVAILABLE'],
  ['photo-access', { visible: 'yes' }, 'PHOTO AVAILABLE ✓'],
  ['capacity', { pool: 'tls', requests: 80 }, '64 ACTIVE · 16 WAIT'],
  ['startup', { fault: 'public' }, 'NO LISTENER'],
  ['startup', { fault: 'db' }, 'NO LISTENER'],
  ['startup', { fault: 'credentials' }, 'NO LISTENER'],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL('./', import.meta.url);
  await page.goto(new URL('algorithms.html', base).href);
  const ids = await page.locator('[data-lab]').evaluateAll(nodes => nodes.map(node => node.dataset.lab));
  assert.equal(ids.length, 14);

  async function choose(id) {
    await page.locator(`[data-lab="${id}"]`).click();
    await page.waitForFunction(id => activeLab.id === id, id);
    // Each case starts with fresh defaults, even when the selected lab is unchanged.
    await page.evaluate(() => chooseLab());
  }

  async function setInput(key, value) {
    await page.locator(`#input-${key}`).evaluate((element, value) => {
      element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }

  async function finish() {
    await page.locator('#scrub').evaluate(element => {
      element.value = element.max;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  for (const id of ids) {
    await choose(id);
    assert.equal(await page.locator('.step').count(), 6, id);
    await finish();
    assert.notEqual(await page.locator('#result').textContent(), 'SINUSUNDAN…', id);
  }
  for (const [id, inputs, expected] of cases) {
    await choose(id);
    for (const [key, value] of Object.entries(inputs)) await setInput(key, value);
    await finish();
    assert.equal(await page.locator('#result').textContent(), expected, `${id} ${JSON.stringify(inputs)}`);
  }

  await choose('ranking');
  await page.locator('#play').click();
  await page.waitForFunction(() => cursor >= 1);
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').textContent(), '▶ Patakbuhin');
  await page.locator('#restart').click();
  await page.locator('.step').nth(2).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#counter').textContent(), '3/6');
  await page.locator('#focus').click();
  assert.notEqual(await page.locator('#canvas').getAttribute('viewBox'), '0 0 1100 470');
  await page.locator('#fit').click();
  assert.equal(await page.locator('#canvas').getAttribute('viewBox'), '0 0 1100 470');

  await page.setViewportSize({ width: 390, height: 844 });
  await choose('photo');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(Number((await page.locator('#canvas').getAttribute('viewBox')).split(' ')[2]), 360);
  await page.locator('#next').click();
  assert.equal(await page.locator('#counter').textContent(), '2/6');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  assert.equal(await page.locator('#play').textContent(), '▶ Patakbuhin');

  await page.goto(new URL('index.html#security', base).href);
  await page.locator('.node').filter({ hasText: 'mTLS boundary' }).click();
  await page.locator('#algorithm-link').click();
  await page.waitForFunction(() => activeLab.id === 'mtls');
  assert.deepEqual(errors, []);
  console.log(`PASS: 14 labs, ${cases.length} scenarios; playback, keyboard, focus/fit, mobile, reduced-motion default, navigation; no browser errors.`);
} finally {
  await browser.close();
}
