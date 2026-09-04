// SPDX-License-Identifier: AGPL-3.0-or-later
export type AssetVisibility = 'public' | 'private';
export type RedistributionStatus = 'verified' | 'private-only' | 'unavailable';
export interface CatalogueAsset {
  id: string;
  name: string;
  kind: 'icon' | 'frame' | 'font' | 'template';
  category: string;
  tags: string[];
  visibility: AssetVisibility;
  source: string;
  author: string;
  license: string;
  licenseUrl: string;
  sha256: string;
  redistributionStatus: RedistributionStatus;
  mediaType: string;
  dataBase64?: string;
}
const PUBLIC_LICENSES = new Set(['AGPL-3.0-or-later', 'CC0-1.0', 'MIT', 'OFL-1.1', 'Apache-2.0']);
export function validateCatalogue(assets: CatalogueAsset[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const asset of assets) {
    if (!asset.id || ids.has(asset.id)) errors.push(`duplicate or missing id: ${asset.id}`);
    ids.add(asset.id);
    if (!/^[0-9a-f]{64}$/.test(asset.sha256)) errors.push(`${asset.id}: invalid content hash`);
    if (asset.visibility === 'public') {
      if (asset.redistributionStatus !== 'verified') errors.push(`${asset.id}: public asset is not verified`);
      if (!PUBLIC_LICENSES.has(asset.license)) errors.push(`${asset.id}: public license is not allowlisted`);
      if (!asset.source || !asset.author || !asset.licenseUrl) errors.push(`${asset.id}: incomplete provenance`);
    } else if (asset.redistributionStatus !== 'private-only' && asset.redistributionStatus !== 'unavailable')
      errors.push(`${asset.id}: private asset must remain private-only`);
  }
  return errors;
}
export const publishableAssets = (assets: CatalogueAsset[]) => {
  const errors = validateCatalogue(assets);
  if (errors.length) throw new Error(errors.join('\n'));
  return assets.filter((asset) => asset.visibility === 'public' && asset.redistributionStatus === 'verified');
};
export class AssetCatalogue {
  #favorites = new Set<string>();
  constructor(readonly assets: CatalogueAsset[]) {
    const errors = validateCatalogue(assets);
    if (errors.length) throw new Error(errors.join('\n'));
  }
  get categories() {
    return [...new Set(this.assets.map((asset) => asset.category))].sort();
  }
  search(
    options: {
      query?: string;
      category?: string;
      kind?: CatalogueAsset['kind'];
      visibility?: AssetVisibility;
      favorites?: boolean;
    } = {},
  ) {
    const query = options.query?.toLowerCase();
    return this.assets.filter(
      (asset) =>
        (!query || `${asset.name} ${asset.tags.join(' ')}`.toLowerCase().includes(query)) &&
        (!options.category || asset.category === options.category) &&
        (!options.kind || asset.kind === options.kind) &&
        (!options.visibility || asset.visibility === options.visibility) &&
        (!options.favorites || this.#favorites.has(asset.id)),
    );
  }
  favorite(id: string, value = true) {
    if (!this.assets.some((asset) => asset.id === id)) throw new Error(`Unknown asset ${id}`);
    value ? this.#favorites.add(id) : this.#favorites.delete(id);
  }
  isFavorite(id: string) {
    return this.#favorites.has(id);
  }
  download(id: string) {
    const asset = this.assets.find((item) => item.id === id);
    if (!asset) throw new Error(`Unknown asset ${id}`);
    if (asset.visibility === 'public' && asset.redistributionStatus !== 'verified')
      throw new Error('Public asset redistribution is not verified.');
    if (!asset.dataBase64) throw new Error('Asset data is unavailable locally.');
    return Uint8Array.from(atob(asset.dataBase64), (character) => character.charCodeAt(0));
  }
}
