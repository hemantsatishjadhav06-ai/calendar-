/** Playwright E2E — golden path with the seeded org (pnpm db:seed) and a mocked network in the API (CONNECTOR_MOCK=1). */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@relay.local');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home/);
});

test('compose, validate and add to queue', async ({ page }) => {
  await page.getByRole('button', { name: 'Create post' }).click();
  const dialog = page.getByRole('dialog', { name: 'New post' });
  await dialog.getByRole('button', { name: /X test/ }).click();                        // channel avatar toggle
  await dialog.getByLabel('Post text').fill('x'.repeat(300));
  await expect(dialog.getByText(/over the 280 limit/)).toBeVisible();                   // live validation
  await expect(dialog.getByRole('button', { name: 'Add to queue' })).toBeDisabled();
  await dialog.getByLabel('Post text').fill('Hello from Playwright https://example.com');
  await expect(dialog.getByText(/contains a link/)).toBeVisible();                       // X cost hint
  await dialog.getByRole('button', { name: 'Add to queue' }).click();
  await expect(page.getByRole('status')).toContainText('Added to queue');
  await page.goto('/all-channels');
  await expect(page.getByRole('article').first()).toContainText('Hello from Playwright');
});

test('queue actions are keyboard reachable', async ({ page }) => {
  await page.goto('/all-channels');
  const card = page.getByRole('article').first();
  await card.getByRole('button', { name: /More actions/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Move to top' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('community keyboard shortcuts', async ({ page }) => {
  await page.goto('/home');
  await page.keyboard.press('g'); await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/community/);
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('every page has no critical axe violations', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  for (const path of ['/home', '/all-channels', '/calendar/week', '/create', '/community', '/insights', '/channels', '/settings', '/billing']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter(v => ['critical', 'serious'].includes(v.impact ?? '')), path).toEqual([]);
  }
});
