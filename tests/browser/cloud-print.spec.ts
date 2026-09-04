// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const printer = (online: boolean) => ({
  id: '4b066d0c-1f58-4149-a802-018714a606dd',
  agentId: 'agent-1',
  displayName: 'Packing desk',
  model: 'm110',
  enabled: true,
  online,
  lastSeenAt: 1,
});
const job = (state: string, terminalOutcome: string | null = null) => ({
  id: 'b5e352b9-bab4-436f-bf81-da069cc164c0',
  printerId: printer(true).id,
  agentId: 'agent-1',
  state,
  terminalOutcome,
  progress: null,
  action: state,
  bytesSent: state === 'completed' ? 64 : 0,
  totalBytes: 64,
  lastCompletedAction: state === 'completed' ? 2 : -1,
  actionCount: 3,
  writeMayHaveOccurred: state === 'completed',
  cancellationRequestedAt: null,
  errorCode: null,
  createdAt: 1,
  deliveredAt: null,
  startedAt: null,
  terminalAt: state === 'completed' ? 2 : null,
});

async function mockCloud(page: Page, online: boolean, submissions: { body: string; key: string | null }[]) {
  await page.route('https://print.example.test/**', async (route) => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type, idempotency-key',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') return await route.fulfill({ status: 200, headers, body: '' });
    if (request.url().endsWith('/printers'))
      return await route.fulfill({ status: 200, headers, body: JSON.stringify([printer(online)]) });
    if (request.method() === 'POST' && request.url().endsWith('/print-jobs')) {
      submissions.push({ body: request.postData() ?? '', key: request.headers()['idempotency-key'] ?? null });
      return await route.fulfill({ status: 202, headers, body: JSON.stringify(job('queued')) });
    }
    if (request.method() === 'GET' && request.url().includes('/print-jobs/'))
      return await route.fulfill({ status: 200, headers, body: JSON.stringify(job('completed', 'completed')) });
    return await route.fulfill({ status: 404, headers, body: JSON.stringify({ error: 'not_found', message: null }) });
  });
}

async function connect(page: Page) {
  await page.goto('/');
  await page.locator('.menubar').getByText('Print', { exact: true }).click();
  await page.getByRole('button', { name: 'Cloud printers…' }).click();
  await page.getByLabel('Cloud service URL').fill('https://print.example.test');
  await page.getByLabel('Tenant ID').fill('tenant-1');
  await page.getByLabel('Print-only token').fill('session-token');
  await page.getByRole('button', { name: 'Connect for this session' }).click();
  await expect(page.getByRole('dialog', { name: 'Cloud printers' })).toBeVisible();
  await page.getByLabel('Published printer').selectOption(printer(true).id);
}

test('standalone PWA submits and polls one cloud label without persisting its token', async ({ page }) => {
  const submissions: { body: string; key: string | null }[] = [];
  await mockCloud(page, true, submissions);
  await connect(page);
  await page.getByRole('button', { name: 'Close Cloud printers' }).click();
  await expect(page.getByLabel('Print route')).toHaveValue('cloud-api');
  await page.locator('.appbar-actions .primary').click();
  await expect(page.locator('footer')).toContainText('Printed 64 bytes');
  expect(submissions).toHaveLength(1);
  expect(submissions[0].key).toBeTruthy();
  const body = JSON.parse(submissions[0].body);
  expect(body.source).toBe('mb-label-editor');
  expect(body.request.document.version).toBe(4);
  expect(body.request.model).toBe('m110');
  expect(body.request).not.toHaveProperty('payloadLimit');
  expect(submissions[0].body).not.toMatch(/transport|connectionId|certificatePem/);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.includes('cloud'))
        .sort(),
    ),
  ).toEqual(['mb-cloud-print-printer', 'mb-cloud-print-tenant', 'mb-cloud-print-url']);
  expect(await page.evaluate(() => Object.values(localStorage).includes('session-token'))).toBe(false);
});

test('offline cloud printer queues only current labels and disables multi-label workflows', async ({ page }) => {
  const submissions: { body: string; key: string | null }[] = [];
  await mockCloud(page, false, submissions);
  await connect(page);
  await page.getByRole('button', { name: 'Close Cloud printers' }).click();
  await expect(page.locator('.appbar-actions .primary')).toHaveText('Queue print');
  await page.locator('.menubar').getByText('Print', { exact: true }).click();
  await page.getByRole('button', { name: 'Batch printing…' }).click();
  await expect(page.getByText('Cloud batch printing requires the selected printer to be online.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print batch' })).toBeDisabled();
});
