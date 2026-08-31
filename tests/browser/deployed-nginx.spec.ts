// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

const deployedOrigin = process.env.PLAYWRIGHT_BASE_URL;
const assetToken = process.env.ASSET_CATALOG_ACCEPTANCE_TOKEN;

test.describe('deployed label-editor nginx boundary', () => {
  test.skip(!deployedOrigin, 'Set PLAYWRIGHT_BASE_URL to exercise the deployed nginx image.');
  test.skip(!assetToken, 'Set ASSET_CATALOG_ACCEPTANCE_TOKEN to exercise authenticated proxying.');

  test('serves the document policy and authenticated same-origin asset API', async ({ page }) => {
    const navigation = await page.goto('/');
    expect(navigation).not.toBeNull();
    expect(navigation!.headers()['permissions-policy']).toBe(
      'local-network=(self), loopback-network=(self)'
    );

    const result = await page.evaluate(async (token) => {
      const apiUrl = new URL('/v1/catalog', location.href);
      const unauthenticated = await fetch(apiUrl, { cache: 'no-store' });
      const authenticated = await fetch(apiUrl, {
        cache: 'no-store',
        headers: { authorization: `Bearer ${token}` }
      });
      const staticLooking = await fetch(new URL('/v1/not-static.woff2', location.href), {
        cache: 'no-store',
        headers: { authorization: `Bearer ${token}` }
      });
      const cacheKeys = (await Promise.all((await caches.keys()).map(async (name) =>
        (await caches.open(name)).keys()
      ))).flat().map((request) => request.url);
      return {
        unauthenticated: unauthenticated.status,
        authenticated: authenticated.status,
        authenticatedUrl: authenticated.url,
        cacheControl: authenticated.headers.get('cache-control'),
        staticLooking: staticLooking.status,
        staticLookingType: staticLooking.headers.get('content-type'),
        staticLookingCacheControl: staticLooking.headers.get('cache-control'),
        cacheKeys
      };
    }, assetToken);

    expect(result.unauthenticated).toBe(401);
    expect(result.authenticated).toBe(200);
    expect(result.authenticatedUrl).toBe(`${deployedOrigin}/v1/catalog`);
    expect(result.cacheControl).toBe('no-store');
    expect(result.staticLooking).toBe(404);
    expect(result.staticLookingType).toContain('application/json');
    expect(result.staticLookingCacheControl).toBe('no-store');
    expect(result.cacheKeys.some((url) => url.includes('/v1/'))).toBe(false);
  });
});
