// SPDX-License-Identifier: AGPL-3.0-or-later
import { AssetCatalogClient } from '../asset-catalog/client.js';
import type { ExternalResourceProviderFactory } from './types.js';

export const assetCatalogProviderFactory: ExternalResourceProviderFactory = {
  kind: 'mbprint-asset-catalog',
  displayName: 'MakersBrain asset catalog',
  create(connection, options) {
    return new AssetCatalogClient({
      baseUrl: connection.endpoint,
      connectionId: connection.id,
      displayName: connection.name,
      token: options.getAccessToken,
      fetch: options.fetch
    });
  }
};
