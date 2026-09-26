import { test, expect } from '@playwright/test';

test.describe('Root URL redirect', () => {
  test('unauthenticated user visiting / is redirected to /login', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login\/?$/);
  });
});
