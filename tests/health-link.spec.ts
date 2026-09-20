import { expect, test } from '@playwright/test';

test('головна сторінка веде на /api/health', async ({ page }, testInfo) => {
  await page.goto('/');

  const link = page.getByRole('link', { name: 'Стан сервісу' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/api/health');

  const shot = testInfo.outputPath('home-health-link.png');
  await page.screenshot({ path: shot, fullPage: true });
  await testInfo.attach('home-health-link', {
    path: shot,
    contentType: 'image/png',
  });
});
