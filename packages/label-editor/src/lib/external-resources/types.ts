// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ExternalResourcePage<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export interface ExternalAsset {
  id: string;
  title: string;
  provider: string;
  category: string;
  kinds: string[];
  previewUrl: string;
  contentUrl: string;
}

export interface ExternalFontFace {
  variant: string;
  familyName?: string | null;
  weight: number;
  style: string;
  format: string;
  fileUrl: string;
}

export interface ExternalFont {
  id: string;
  family: string;
  provider: string;
  category: string;
  availability: string;
  license: string;
  variants: string[];
  faces: ExternalFontFace[];
  previewUrl: string;
}

export interface ExternalResourceSearchOptions {
  query?: string;
  providers?: string[];
  categories?: string[];
  page?: number;
  pageSize?: number;
}

export interface ExternalAssetSearchOptions extends ExternalResourceSearchOptions {
  kinds?: string[];
  tags?: string[];
  styles?: string[];
}

export interface ExternalFontSearchOptions extends ExternalResourceSearchOptions {
  availability?: string[];
}

/** A provider maps its API-specific responses onto the editor's small resource model. */
export interface ExternalResourceProvider {
  readonly connectionId: string;
  readonly kind: string;
  readonly displayName: string;
  searchAssets(options?: ExternalAssetSearchOptions): Promise<ExternalResourcePage<ExternalAsset>>;
  searchFonts(options?: ExternalFontSearchOptions): Promise<ExternalResourcePage<ExternalFont>>;
  cacheFont?(id: string, variants?: string[]): Promise<ExternalFont>;
  /** Category and provider counts for the current query, used to offer filters. */
  assetFacets?(query?: string): Promise<ExternalResourceFacets>;
  fontFacets?(query?: string): Promise<ExternalResourceFacets>;
  fetchBlob(path: string): Promise<Blob>;
}
export interface ExternalFacetValue {
  value: string;
  count: number;
}
export interface ExternalResourceFacets {
  providers: ExternalFacetValue[];
  categories: ExternalFacetValue[];
}

export interface ExternalResourceConnection {
  version: 1;
  id: string;
  name: string;
  providerKind: string;
  endpoint: string;
  enabled: boolean;
}

export interface ExternalResourceProviderFactory {
  readonly kind: string;
  readonly displayName: string;
  create(
    connection: ExternalResourceConnection,
    options: {
      getAccessToken: () => string | undefined;
      fetch?: typeof globalThis.fetch;
    },
  ): ExternalResourceProvider;
}

export interface ExternalResourceProviderSummary {
  kind: string;
  displayName: string;
}
