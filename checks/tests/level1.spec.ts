import { test, expect } from '@playwright/test';

test.describe('level-1', () => {
  test('Seite antwortet mit HTTP 200', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toContain('text/html');
  });

  test('Titel ist „Levelboard“', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Levelboard');
    expect(await page.title()).toBe('Levelboard');
  });

  test('10 Level-Karten sichtbar', async ({ page }) => {
    await page.goto('/');
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    await expect(board).not.toHaveAttribute('data-state', 'loading');
    const cards = page.getByTestId('level-card');
    await expect(cards).toHaveCount(10);
    for (let i = 0; i < 10; i++) await expect(cards.nth(i)).toBeVisible();
  });

  test('Keine Konsolenfehler', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-state', 'loading');
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('Handy-Ansicht: Karten einspaltig', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-state', 'loading');
    const cards = page.getByTestId('level-card');
    await expect(cards).toHaveCount(10);
    const xs = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const box = await cards.nth(i).boundingBox();
      expect(box).not.toBeNull();
      xs.add(Math.round(box!.x));
    }
    expect(xs.size).toBe(1);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(375);
  });
});
