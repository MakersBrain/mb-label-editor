// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('manages multiple external resource connections without persisting tokens', async ({ page }) => {
  const authorizations: (string | undefined)[] = [];
  await page.route('https://assets.example.test/**', async (route) => {
    authorizations.push(route.request().headers().authorization);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 1, pages: 1, revision: 'test' }),
    });
  });

  await page.goto('/');
  await page.locator('.menubar').getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'External resources…' }).click();
  const dialog = page.getByRole('dialog', { name: 'External resources' });
  await expect(dialog.getByText('MakersBrain assets', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Add connection' }).isVisible();
  await dialog.getByLabel('Name').fill('Design library');
  await dialog.getByLabel('Endpoint').fill('https://assets.example.test');
  await dialog.getByLabel('Session token').fill('resource-session-secret');
  await dialog.getByRole('button', { name: 'Add connection' }).click();
  await expect(dialog.getByText('Design library', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Test' }).last().click();
  await expect(dialog.getByText('Design library is reachable.')).toBeVisible();
  expect(authorizations).toEqual(['Bearer resource-session-secret']);

  const stored = await page.evaluate(() => ({
    connections: localStorage.getItem('mb-external-resource-connections-v1'),
    values: Object.values(localStorage),
  }));
  expect(JSON.parse(stored.connections ?? '[]')).toHaveLength(2);
  expect(stored.connections).not.toContain('resource-session-secret');
  expect(stored.values).not.toContain('resource-session-secret');
});
