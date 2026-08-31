# Development Cloudflare Tunnel and local printing implementation plan

## Status and objective

Status: reusable implementation and local acceptance complete; the approved
dev1 Access email is stored in Infisical and the human CLI login is verified.
Dev1 activation is waiting for the operator-generated asset API key, followed
by the reviewed infrastructure apply and real-browser qualification. The dated
qualification record is maintained in the developer-tunnels environment. This
document is not evidence that the public route has been deployed or qualified.

Publish the Dockerized label editor at
`https://labels.dev1.makersbrain.net` through the existing outbound-only
developer workspace tunnel while preserving local printing through
`http://127.0.0.1:9847`.

The result must provide all of the following:

- an HTTPS, Cloudflare Access-protected editor route;
- a working asset catalogue without sending a remote browser to its own port
  `8766`;
- local printer pairing and printing from the HTTPS editor after the browser's
  Local Network Access consent flow;
- no public route, reverse proxy, or non-loopback bind for the printer API;
- exact-origin CORS, PNA compatibility, origin-bound grants, and a documented
  rollback.

The first target is `dev1`. The implementation should derive the workspace
name instead of baking `dev1` into reusable modules so that `dev2` through
`dev4` can adopt the same pattern later.

Cloudflare Access protects network delivery, first installation, updates, and
online API traffic. It cannot revoke an application shell that an authorized
user has already installed into the browser's offline cache. That is an
intentional consequence of the existing offline-PWA requirement: device and
browser-profile security remain responsible for cached application code and
locally stored label documents.

## Existing capabilities to preserve

This work extends mechanisms that already exist:

- `mb-infra/modules/cloudflare-developer-tunnel` creates a remotely managed,
  outbound-only tunnel, exact DNS records, loopback ingress, and a terminal
  `http_status:404` rule.
- `mb-control-plane/deploy/compose.cloudflare.yml` runs the workspace
  `cloudflared` connector with host networking and a token file.
- the root `compose.yml` publishes the editor on `127.0.0.1:4173`, the asset
  catalogue on `127.0.0.1:8766`, and the optional printer daemon on
  `127.0.0.1:9847`.
- `mb-printer-cli` refuses non-loopback API binds, requires an exact allowed
  origin, emits `Access-Control-Allow-Private-Network: true` for an allowed
  PNA preflight, and issues bearer grants bound to the pairing origin.
- `LocalServicePanel.svelte` already initiates pairing from a user action and
  explains that Local Network Access may need to be granted.

Do not replace these controls with a tunneled printer endpoint, wildcard CORS,
ambient cookies, an unauthenticated local API, or a second independently
managed developer tunnel.

## Target request paths

```text
Browser
  |
  | HTTPS + Cloudflare Access
  v
labels.dev1.makersbrain.net
  |
  | existing dev1 Cloudflare Tunnel
  v
127.0.0.1:4173 -> label-editor nginx
  |                  |
  | static PWA       | /v1/* on the Docker network
  |                  v
  |               asset-catalog:8766
  |
  | browser fetch, never through Cloudflare
  v
127.0.0.1:9847 -> mb-printer API -> local/network printer
```

The `/v1/*` namespace on the editor origin is assigned to the asset catalogue.
The local printer API remains a different origin at `127.0.0.1:9847` and is
never reverse proxied by editor nginx.

## Security invariants

Treat these as release gates rather than preferences:

1. `labels.<workspace>.makersbrain.net` is protected by a Cloudflare Access
   application restricted to the assigned developer and approved reviewers.
2. The Access application exists before its DNS route can become reachable.
3. Tunnel ingress points only to `http://127.0.0.1:<label-editor-port>` and the
   ingress list still ends in `http_status:404`.
4. No tunnel ingress, DNS record, Docker port, or nginx location exposes port
   `9847`.
5. The printer API continues to bind only to IPv4/IPv6 loopback and rejects a
   non-loopback `Host` independently of CORS.
6. Printer CORS uses exact origins. `*`, suffix matching, and reflected origins
   are forbidden.
7. Pairing grants remain bearer tokens bound to the requesting origin. Moving
   from the local editor URL to the HTTPS URL requires a new pairing.
8. The asset API requires `ASSET_CATALOG_API_KEY` whenever it is reachable
   through the public editor origin. nginx must forward `Authorization`.
9. Cloudflare tunnel tokens, Access service credentials, asset API keys, and
   pairing grants are never committed, printed by a plan, or placed in a build
   argument.
10. The local loopback workflow continues to work when the tunnel is stopped.
11. The service worker never intercepts loopback printer requests and never
    caches `/v1/` asset API responses. Authorization-bearing API responses
    must not become reusable Cache API entries.
12. All active connectors for a workspace tunnel terminate on the assigned
    workspace host. A stale connector on another host would make remotely
    managed ingress intermittently select a machine without the local origin.

## Workstream 1: extend the developer tunnel safely

### Infrastructure changes

In `mb-infra/modules/cloudflare-developer-tunnel/variables.tf`:

- add `labels` to the approved origin-label allowlist;
- add an `access_labels` set restricted to approved interactive labels;
- add a sensitive, validated `access_allowed_emails` set whose non-empty
  requirement is conditional on `access_labels` being non-empty;
- default both Access inputs to empty collections so adopting the module
  change cannot create policy or block existing workspaces before activation;
- validate that every Access label is also present in `origins`.

In `mb-infra/modules/cloudflare-developer-tunnel/main.tf`:

- create a `cloudflare_zero_trust_access_application` for each label in
  `access_labels`, following the provider-v5 pattern already used by
  `cloudflare-service-edge`;
- use a self-hosted application, an eight-hour development session, binding
  cookies, HTTP-only cookies, and an allow policy containing only the supplied
  operator email addresses;
- make service DNS creation depend on the Access applications so the hostname
  cannot briefly become public before its policy exists;
- retain the existing tunnel configuration and final 404 ingress.

In `mb-infra/environments/development/developer-tunnels/variables.tf`:

- add a sensitive `workspace_access_allowed_emails` map of workspace name to
  email set, with the same rejection of placeholders used by the production
  edge root;
- default the map to `{}` while every label-editor feature gate is false;
- reject unknown workspace keys and require a non-empty entry for every
  workspace whose label-editor route is enabled;
- supply it through the protected operator environment, not a committed
  `.tfvars` file.

Store the resulting `TF_VAR_workspace_access_allowed_emails` JSON value in the
infrastructure Infisical project, environment `dev`, path `/`. The existing
`infisical-tofu.sh` injection path supplies it to OpenTofu; do not export the
email map manually, commit it, or duplicate it in a local tfvars file.

In `mb-infra/environments/development/developer-tunnels/main.tf`:

- add `labels = "http://127.0.0.1:${workspace.ports.label_editor}"` to each
  enabled workspace's exact origins only when `label_editor_enabled` is true;
- pass `access_labels = ["labels"]` only for those workspaces;
- pass only `workspace_access_allowed_emails[each.key]` to that workspace's
  module instance. Do not use one global allowlist for every personal
  workspace.

In `mb-infra/environments/development/workspaces.json`:

- bump the strict registry schema from
  `makersbrain.developer-workspaces.v1` to `v2`, because adding required fields
  is a schema change;
- add a `label_editor` port to every workspace allocation: `4173`, `4273`,
  `4373`, and `4473` for `dev1` through `dev4` respectively;
- add a validated `label_editor_enabled` boolean, initially false everywhere;
  enable only dev1 in the final, separately reviewed route-activation change;
- update every consumer or validator of the registry so the schema change is
  explicit rather than silently tolerated.

In the developer-tunnels README:

- add the label editor route to the route table;
- state that Access is mandatory;
- state that the workspace connector must be running before the root label
  stack can be reached;
- add authenticated and unauthenticated verification commands without
  embedding credentials.

### Infrastructure verification

Before apply:

1. Run `tofu fmt -recursive` in `mb-infra`.
2. Run `tofu validate` for the developer-tunnels root through the repository's
   normal encrypted-state environment.
3. Run the relevant `mb-infra` Python contract tests.
4. Generate a saved plan through `scripts/safe-tofu-apply.sh`.
5. Inspect the plan and require exactly:
   - one `labels.dev1.makersbrain.net` proxied CNAME;
   - one exact tunnel ingress rule for `127.0.0.1:4173`;
   - one Access application and its named-user allow policy;
   - no tunnel replacement, connector-token rotation, wildcard change, or
     deletion.

Apply only after the local editor origin is healthy. After apply, confirm that
an unauthenticated request is intercepted by Access and never returns the PWA.
Before apply, inspect Cloudflare tunnel connector state and stop or revoke any
stale dev1 connector running anywhere other than the assigned workspace host.

## Workstream 2: publish the editor and asset catalogue as one web origin

### nginx routing

In `mb-label-editor/deploy/nginx.conf`:

- add a `location ^~ /v1/` block that proxies to
  `http://asset-catalog:8766` while preserving the `/v1/...` URI;
- use `^~`: ordinary prefix matching is insufficient because existing regex
  locations for `.woff2`, SVG, and other static files would otherwise capture
  asset API file URLs before they reach the upstream;
- forward `Authorization`, `Host`, `X-Forwarded-Proto`, and
  `X-Forwarded-For`;
- return `Cache-Control: no-store` for the proxied API as defense in depth;
- apply conservative proxy connect/read timeouts;
- do not proxy `/docs`, `/redoc`, or `/healthz`; those remain loopback-only on
  port `8766`;
- keep SPA fallback and immutable asset caching unchanged;
- add this policy to HTML/navigation responses (the responses that create the
  document policy):

  ```text
  Permissions-Policy: local-network=(self), loopback-network=(self)
  ```

Unknown experimental directives may be ignored by older browsers. They must
not cause startup failure or replace existing security headers. Account for
nginx `add_header` inheritance: locations that declare their own cache header
do not inherit a server-level `add_header` on the pinned nginx version. The
policy is mandatory on document responses, not on JS, font, image, or API
responses.

### Service-worker boundary

In `mb-label-editor/apps/pwa/public/sw.js`:

- return without calling `respondWith` for every cross-origin request,
  including `http://127.0.0.1:9847`; Local Network Access must be initiated by
  the active document rather than by the service worker;
- bypass both interception and Cache API storage for same-origin `/v1/`
  requests;
- bypass Cloudflare's `/cdn-cgi/` paths and never cache an Access login,
  challenge, or denial response;
- continue caching only same-origin PWA shell/static GET requests;
- admit a network response to the Cache API only when it is successful,
  unredirected, and its final URL is the requested application URL; an expired
  Access session must not replace the offline shell with a followed login
  response;
- bump the cache version so clients discard any `/v1/` responses that the old
  broad fetch handler may already have stored;
- add tests proving that Authorization-bearing asset responses, printer status
  responses, event streams, and simulated Access redirects cannot enter or
  overwrite the service-worker cache.

The asset catalogue's selected bytes are embedded into label documents by the
editor, so excluding catalogue API responses does not remove offline access to
assets already used in a saved document.

### Compose and build configuration

In the root `compose.yml`, `.env.example`, and Infisical-backed stack launcher:

- introduce `LABEL_EDITOR_PUBLIC_ORIGIN`, defaulting to the local editor URL;
- pass that value as `VITE_ASSET_CATALOG_URL` for the PWA build;
- for the dev1 tunnel, set it to
  `https://labels.dev1.makersbrain.net`, causing asset requests and returned
  root-relative `/v1/...` asset URLs to stay on the editor origin;
- introduce one explicit `LABEL_EDITOR_ORIGINS` value for the printer daemon
  and default it to the two current loopback origins;
- derive the dev1 origin allowlist from the reviewed workspace registry rather
  than accepting it from an ignored `.env`;
- require a non-empty `ASSET_CATALOG_API_KEY` in the tunnel startup path;
- preserve the asset service's loopback host publication for diagnostics;
- add nginx's dependency on a healthy asset catalogue if it is not already
  sufficient for startup ordering.

Do not put `ASSET_CATALOG_API_KEY` into `VITE_*`: it remains a browser-entered
secret stored locally by the editor and sent as an Authorization bearer token.
Cloudflare Access protects initial reachability; the asset key independently
protects the API behind nginx.

### Infisical authentication and secret delivery

Use Infisical according to the identity of the caller:

- a developer starts the local stack with their authenticated Infisical CLI
  user session; the repository stores no personal token or machine credential;
- `scripts/infisical-label-stack.sh` resolves the exact workspace project ID,
  reads only `dev:/application/ASSET_CATALOG_API_KEY` through the v4 API, stages
  it in a mode-restricted directory on `XDG_RUNTIME_DIR`, and removes staging
  on every exit;
- the key reaches Docker Compose only through the child environment. It must
  never appear in argv, `.env`, build arguments, Vite output, Git, test output,
  or a persistent temporary file;
- the key itself is generated by the operator in Infisical. Automation must
  not invent or print a credential on the operator's behalf;
- containers receive only the one application secret they consume and never
  receive an Infisical token.

Do not provision GitHub OIDC merely for local activation. If a specific GitHub
Actions workflow later needs this path, first add a dedicated, delete-protected
machine identity with no organization-wide role and read-only access limited
to the dev1 project and `/application`. Bind OIDC to the exact issuer,
audience, repository ID, repository-owner ID and workflow/environment subject;
use a 15-minute access-token TTL and `permissions: id-token: write`. The
workflow exchanges its GitHub JWT at runtime and stores no Infisical client
secret in GitHub Secrets. Reconcile and test these exact claims before enabling
the consuming job; reject drift rather than broadening trust automatically.

Avoid ambiguous Compose interpolation between `LABEL_EDITOR_PORT` and
`LABEL_EDITOR_PUBLIC_ORIGIN`: document that changing the local port requires
changing the complete origin value as well, and add a rendered-configuration
test for the non-default port case.

### Compose verification

Add a Compose configuration test or documented check that renders both modes:

- local mode resolves editor, asset, and printer origins to the existing
  loopback URLs;
- tunnel mode resolves the asset browser URL and printer allowed origin to the
  exact HTTPS hostname;
- neither rendered configuration exposes `0.0.0.0:9847` or includes a
  cloudflared token in process arguments.

Run `docker compose config --quiet`, build the two application images, start
the stack, and verify both `/` and proxied `/v1/catalog` locally before making
the DNS route live.

## Workstream 3: complete the local-network browser flow

### Printer daemon configuration

No new PNA implementation is expected in `mb-printer-cli`; it already uses
`CorsLayer::allow_private_network(true)` behind an exact-origin preflight
guard. Make only the following scoped changes if tests expose a gap:

- ensure the public HTTPS editor origin reaches the daemon through
  `LABEL_EDITOR_ORIGINS`;
- preserve `GET`, `POST`, and `OPTIONS` plus the Authorization, Content-Type,
  and Idempotency-Key headers;
- preserve `Vary: Origin`;
- never emit `Access-Control-Allow-Private-Network` for a rejected origin.

Update the printer API documentation with the concrete dev hostname and the
requirement to create a new origin-bound pairing grant after switching URLs.

### Editor behavior

Keep Local Network Access initiation behind the existing Pair button. Do not
probe `127.0.0.1` automatically on page load because that would create a
surprising permission prompt.

Refine `LocalServicePanel.svelte` only where needed to provide these states:

1. daemon not running;
2. browser permission not yet granted;
3. browser permission denied;
4. origin rejected by the daemon;
5. pairing secret invalid or expired;
6. paired and ready;
7. saved printer unavailable.

Because browser error reporting may collapse permission denial and connection
refusal into `TypeError: Failed to fetch`, the UI must not claim certainty it
does not have. Its recovery text should tell the user to:

- start the local printer service;
- allow Local Network Access for the editor hostname in browser site settings;
- retry Pair;
- generate a fresh one-time secret if the previous one expired.

Use `navigator.permissions.query({name: "loopback-network"})` only as optional
progressive enhancement. Feature-detect it, tolerate an unknown permission
name, and never make it a prerequisite for pairing. Keep the literal
`http://127.0.0.1:9847/v1` endpoint; it lets the browser classify the target as
loopback without DNS resolution. Add `targetAddressSpace: "loopback"` only if
qualification demonstrates a browser that requires it, and isolate the
experimental Request typing in one helper.

### Grant lifecycle

- Generate the one-time pairing secret from the local CLI after opening the
  HTTPS editor.
- Pair from `https://labels.dev1.makersbrain.net` so the stored grant records
  that exact origin.
- Store only the returned grant in that browser profile, using the existing
  local persistence.
- Revoke obsolete loopback-origin grants when they are no longer needed.
- Confirm that a token paired from one origin is rejected when presented from
  another origin.

## Workstream 4: automated tests

### Printer API tests

Extend the Rust router and real-process tests with
`https://labels.dev1.makersbrain.net`:

- allowed OPTIONS preflight returns the exact allow-origin and private-network
  headers;
- an unlisted `https://labels.dev2.makersbrain.net` origin is rejected;
- a visually similar suffix or prefix hostname is rejected;
- a valid public-origin grant works from the same origin;
- that grant fails from the loopback editor origin and another dev workspace;
- a non-loopback Host remains rejected even with an allowed Origin;
- PNA response headers are absent on rejected preflights.

Retain the existing localhost cases so tunnel support cannot weaken local
development.

### Label editor tests

Extend the unit/component tests to cover:

- pairing starts only after the button is activated;
- `Failed to fetch` produces actionable but non-diagnostic recovery text;
- HTTP 403 is reported as an origin/configuration denial;
- a successful new grant replaces the previous local token;
- the local API base URL remains loopback and is not derived from the public
  editor hostname.

Extend browser tests to check:

- the deployed nginx response contains the restrictive Permissions-Policy;
- `/v1/catalog` is same-origin and carries the asset bearer token;
- the service worker does not intercept cross-origin local printer requests;
- the service worker and ordinary HTTP cache do not retain `/v1/` responses;
- the service worker does not cache pairing secrets;
- an expired-Access redirect or challenge cannot overwrite the cached PWA
  shell;
- offline PWA startup does not probe localhost or trigger a permission prompt.

### Infrastructure tests

Add static/plan assertions that:

- `labels` is an approved exact developer service label;
- every registry workspace receives a unique allocated label-editor port;
- labels is included in `access_labels` exactly when that workspace's
  `label_editor_enabled` flag is true;
- the printer API port is absent from tunnel ingress;
- the terminal 404 rule remains last;
- arbitrary hostnames and non-loopback origins continue to fail validation.

## Workstream 5: real-browser qualification

Hermetic CORS tests do not exercise the browser's address-space calculation or
permission UI. Qualification against the actual HTTPS route is mandatory.

### Preflight diagnostic

With the daemon running and the HTTPS origin configured, send an OPTIONS
request to `127.0.0.1:9847/v1/status` with:

```text
Origin: https://labels.dev1.makersbrain.net
Access-Control-Request-Method: GET
Access-Control-Request-Private-Network: true
```

Require HTTP success, the exact allow-origin value, and
`Access-Control-Allow-Private-Network: true`. Repeat with an unlisted origin and
require rejection.

### Browser matrix

Qualify current stable Chrome/Chromium, Firefox, and Safari on supported
desktop platforms. For each browser record:

- whether a Local/Private Network Access prompt appears;
- grant, deny, retry, and reset-site-permission behavior;
- initial pairing and grant persistence across reload;
- status probe, one harmless validation request, and one operator-approved
  physical test label;
- behavior with the daemon stopped;
- behavior when Cloudflare Access expires and is renewed;
- browser console/network diagnostics with secrets redacted.

For Chromium, also run one pass with its strict/blocking Local Network Access
mode when that mode is not already the stable default. Do not weaken browser
security flags to obtain a pass.

A browser that cannot reach the loopback API must show the recovery message
and leave WebUSB, Web Bluetooth, PDF export, and cloud printing usable. Do not
tunnel port `9847` as a compatibility workaround.

## Delivery units and verification commands

Keep activation separate from reusable code so an ordinary infrastructure
apply cannot accidentally publish unfinished application work:

1. **Label editor change:** nginx `/v1/` proxy, document policy,
   service-worker boundary and cache migration, UX refinements, and tests.
2. **Workspace stack change:** root Compose/environment wiring and stack
   documentation. This is owned outside the standalone label-editor package
   even though it builds that package's Dockerfile.
3. **Printer CLI change:** exact-public-origin regression tests and
   documentation. Production code changes only if those tests expose a real
   gap.
4. **Infrastructure foundation change:** workspace-registry v2, unique label
   ports, disabled feature gates, Access-capable tunnel module, and tests.
5. **Infrastructure activation change:** the single dev1 flag transition,
   named Access allowlist, reviewed plan, apply, and qualification evidence.

At minimum, run these repository-native gates before activation:

```sh
# mb-label-editor
npm run check
npm test
npm run test:browser
npm run test:pwa-release

# mb-printer-cli
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings

# mb-infra
python3 -m unittest scripts/test_workspace_registry.py
tofu fmt -check -recursive

# aggregate workspace
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Run `tofu validate` and the encrypted saved-plan/apply workflow in the
repository's normal authenticated environment; do not bypass state encryption
just to make local validation convenient. Record exact command versions and
results in the activation evidence.

## Rollout sequence

1. Land tests and configuration changes with the new public route disabled.
2. Have the operator generate `ASSET_CATALOG_API_KEY` in the dev1 Infisical
   project at `dev:/application`, then build and start the root label stack via
   `scripts/infisical-label-stack.sh`; never copy the key to `.env`.
3. Verify the local editor, same-origin asset proxy, and loopback printer flow.
4. Ensure the existing dev1 workspace connector is healthy; do not start a
   duplicate connector in the label stack.
5. Confirm `label_editor_enabled` is still false and verify that an unrelated
   developer-tunnels apply cannot publish the route.
6. In a dedicated activation change, set dev1 `label_editor_enabled` to true,
   create or verify the Access application and named-user policy, and review
   the encrypted OpenTofu plan.
7. Apply the exact Access application, labels ingress, and DNS record.
8. Confirm a fresh unauthenticated network request is stopped by Access. Also
   record that a previously installed offline PWA remains a local device
   artifact outside Access revocation.
9. Authenticate, open the HTTPS editor, create a fresh pairing secret, accept
   the browser's local-network prompt, and pair.
10. Execute the browser matrix and record evidence in the developer-tunnels
   README or a dated qualification note.
11. Keep the route limited to dev1 until all mandatory acceptance criteria
    pass.

## Rollback

Application rollback does not require destroying the workspace tunnel:

1. stop or revert the root label stack;
2. set dev1 `label_editor_enabled` back to false, which derives removal from
   the developer tunnel origins and `access_labels`;
3. review a plan that deletes only the labels DNS record, ingress rule, and
   Access application;
4. apply through `safe-tofu-apply.sh`;
5. revoke grants issued to `https://labels.dev1.makersbrain.net` if the route
   will not return;
6. verify the local loopback editor and printer workflow still work;
7. retain the workspace connector token and all unrelated dev1 routes.

If only local printing fails, leave the Access-protected editor route in place,
disable or clearly mark the local-service route in the UI, and retain direct
browser and cloud-print alternatives while diagnosing. Never broaden CORS or
publish the printer API during incident response.

## Definition of done

Implementation is complete only when all of these are true:

- fresh installation, online navigation, updates, and API traffic for
  `https://labels.dev1.makersbrain.net` require Cloudflare Access
  authentication; the documented offline-PWA exception is understood;
- the PWA and asset catalogue work through that single origin;
- `127.0.0.1:8766` and `127.0.0.1:9847` remain loopback-only;
- the printer API accepts the exact HTTPS origin and rejects other origins;
- a newly paired, origin-bound grant can validate and print from the HTTPS
  editor;
- denial, daemon-down, expired-pairing, and revoked-grant cases are actionable;
- current automated tests and the real-browser qualification matrix pass;
- no asset API response or loopback printer request is intercepted or retained
  by the service worker;
- no secret appears in Git, image layers, Vite output, process arguments, test
  output, or OpenTofu plan output;
- rollback has been reviewed and removes only the label-editor route.
