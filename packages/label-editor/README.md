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
