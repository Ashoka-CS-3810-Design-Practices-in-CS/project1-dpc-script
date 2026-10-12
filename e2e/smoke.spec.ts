import { expect, test } from '@playwright/test';

test('page loads with the right title and no errors', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto('/');
  await expect(page).toHaveTitle('DPC-Script Audio Editor');
  expect(errors).toEqual([]);
});
