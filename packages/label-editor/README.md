# @makersbrain/label-editor

Reusable Svelte 5 thermal-label editor, strict v4 document adapters, browser
print routes, offline persistence, batch data, and La Poste workflows.

Install with `npm install @makersbrain/label-editor`. The JavaScript package has
no dependency on MakersBrain UI and does not inject global styles.

For the dependency-free standalone theme:

```ts
import { LabelEditor } from '@makersbrain/label-editor';
import '@makersbrain/label-editor/core.css';
import '@makersbrain/label-editor/themes/standalone.css';
```

The legacy `@makersbrain/label-editor/style.css` export combines those two
stylesheets for backwards compatibility.

## Editor composition

`LabelEditor` renders a menu bar, a drawing toolbar, the canvas, and a sidebar
holding Layers and Properties. Everything else — Media & zones, Data, Assets,
Library, Guides — opens as a modal dialog from the `Label` and `View` menus.

Host applications extend the shell through four slots:

```svelte
<LabelEditor {editor} {sdk}>
  <BrandLockup slot="brand" product="Label Editor"/>
  <Menu slot="menu-start" label="File">…</Menu>
  <Menu slot="menu-end" label="Print">…</Menu>
  <svelte:fragment slot="actions">…</svelte:fragment>
  <div slot="sidebar">…</div>
</LabelEditor>
```

External assets use a provider boundary. A host may pass a client directly:

```svelte
<script lang="ts">
  import { AssetCatalogClient, LabelEditor } from '@makersbrain/label-editor';
  const resourceProvider = new AssetCatalogClient({
    baseUrl: 'http://127.0.0.1:8766',
    token: () => sessionStorage.getItem('asset-catalog-token') ?? undefined
  });
</script>

<LabelEditor {editor} {sdk} {resourceProvider}/>
```

`AssetCatalogClient` follows the bundled `mbprint-asset-catalog` OpenAPI
contract. Regenerate its schema after updating the pinned contract with
`npm run generate:asset-catalog`.

Applications that need multiple named endpoints can use
`ExternalResourceConnectionManager`, `assetCatalogProviderFactory`, and
`ExternalResourceConnectionsPanel`. Persist `manager.connections()` and the
selected connection ID, but keep credentials in the manager's session token
store. A future service integrates by implementing `ExternalResourceProvider`
and registering an `ExternalResourceProviderFactory`; the Assets panel and
connection manager do not need provider-specific changes.

For cloud printing, configure the exported `CloudPrintClient` with a tenant and
a token callback, then share one `CloudPrintRoute` between the current-label,
batch, and La Poste workflows. `CloudPrintJobController` publishes job state
and performs explicit cancellation/recovery without adding cloud methods to
the generic `PrintRoute` interface. Tokens are evaluated for each request and
are never persisted by the package. Regenerate its bundled schema with
`npm run generate:cloud-print` after updating the pinned `mb-print-cloud`
contract.

`Menu` and `Modal` are exported so host menus and dialogs match the editor's,
and `insertElement(editor, type)` adds a default element of any insert type.

For MakersBrain products, install `@makersbrain/ui` separately and select the
optional adapter:

```ts
import { LabelEditor } from '@makersbrain/label-editor';
import '@makersbrain/label-editor/core.css';
import '@makersbrain/label-editor/themes/mb-ui.css';
```

The adapter imports MB UI tokens, fonts, foundations, and its Shadcn semantic
variable bridge. The editor consumes only its own `--mble-*` contract, keeping
product branding and generic component-library choices outside editor logic.

Copyright MakersBrain contributors. Licensed under AGPL-3.0-or-later; the full
license is included as `LICENSE`.
