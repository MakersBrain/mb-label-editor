<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Cloud print integration plan

Status: implemented and verified

Date: 2026-08-30

Verification on 2026-08-30 covered the generated OpenAPI snapshot, exact-origin
CORS, broker and agent Rust suites, editor unit/type/build suites, direct-CORS
browser flows, and a real broker-to-agent file capture. The live job completed
13 actions and wrote one 1,947-byte capture; replaying its idempotency key
returned the same job without another write.

## 1. Decision

Add the standalone `mb-print-cloud` service as a third print route beside the
existing local-service and direct-browser routes.

The label editor uses only the cloud HTTPS/JSON API. It does not connect to the
agent gRPC service, enroll agents, configure local transports, or depend on
`mb-control-plane`.

```text
Standalone PWA -------------------------------> mb-print-cloud
Hosted editor -> host authentication/proxy ---> mb-print-cloud
                                                    |
                                                    v
                                             printer agent -> printer
```

Keep the reusable package independent of any product login system. The host
application supplies the cloud endpoint, tenant, and access-token callback, or
supplies an already configured adapter. The standalone PWA may accept the
config-file `print` token for the current browser session, but must not embed or
persist it.

## 2. First-release scope

The first release supports:

- enabling cloud printing only after an explicit PWA or host configuration;
- listing the tenant's published printers;
- showing printer name, model, and online/enabled state;
- selecting one explicit cloud printer;
- submitting the current canonical SDK v4 label with copies and density;
- using the cloud printer's model as the request model;
- polling the submitted job until it becomes terminal;
- showing queued, delivered, running, completed, failed, cancellation, and
  ambiguous-output states;
- requesting cancellation; and
- using the same route from current-label, batch, and La Poste workflows.

Only the current-label action may queue while its selected printer is offline.
Batch and La Poste printing require an online cloud printer in v1 because those
workflows intentionally wait for each label's terminal result before sending
the next one.

Do not add agent enrollment, agent administration, printer publication,
printer pools, automatic failover, event streaming, gRPC-Web, or a general
cloud account/settings system to the editor.

## 3. Authentication and deployment

### Reusable package

Add a small client with injected configuration:

```ts
interface CloudPrintClientOptions {
  baseUrl: string;
  tenantId: string;
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
}
```

`getAccessToken` is evaluated for every request so a host can use its existing
session or short-lived token. The package never writes the returned token to
IndexedDB, local storage, logs, error text, or job recovery records. Supplying
no token is valid when a same-origin authenticated proxy owns authorization.

Also allow applications to construct and pass a `CloudPrintClient` directly.
This keeps MakersBrain-specific tenant lookup and authentication outside the
editor package.

### PWA

The standalone PWA connects directly to `mb-print-cloud` over HTTPS. Its cloud
connection dialog accepts the service URL, tenant ID, and a `print`-only token.
The URL and tenant may be stored as preferences; the token remains in memory
and must be entered again after a page reload. Do not add a "remember cloud
token" control and do not place the token in a Vite environment variable,
built JavaScript, local storage, or IndexedDB.

For this mode, `mb-print-cloud` adds a strict, config-file CORS allowlist for
the exact PWA origins. It must allow `Authorization`, `Content-Type`, and
`Idempotency-Key`, permit the `GET` and `POST` methods and their preflights, and
must not use a wildcard origin.

A product that already has users and sessions may instead expose a same-origin
proxy or inject short-lived credentials through `getAccessToken`. That is an
optional host integration, not a requirement for the standalone deployment.

## 4. Contract prerequisite

Before generating editor types, add the configured CORS allowlist and complete
the existing `mb-print-cloud /openapi.json` document. All eight business
operations must have typed request, response, parameter, security, and error
definitions. The editor consumes only:

- `GET /v1/tenants/{tenant}/printers`;
- `POST /v1/tenants/{tenant}/print-jobs`;
- `GET /v1/tenants/{tenant}/print-jobs/{job}`;
- `POST /v1/tenants/{tenant}/print-jobs/{job}/cancel`; and
- the common error response used by those operations.

Generate this contract in `mb-print-cloud` with `utoipa` 5 and `utoipa-axum`
0.2, matching the Rust control-plane dependency family. Derive `ToSchema` for
the request, response, printer, job, and error types; annotate the handlers;
and register them through `utoipa_axum::router::OpenApiRouter` so the executable
routes and documented paths are declared together. Serve the resulting
document at the existing `/openapi.json` endpoint.

Do not retain the current hand-built `serde_json::json!` document, introduce a
second checked-in server-side YAML contract, or copy the control plane's custom
route/spec macro. The cloud service has only eight endpoints, so the standard
`utoipa-axum` route registration is sufficient.

Check the resulting OpenAPI document into
`packages/label-editor/openapi/mb-print-cloud.json` and generate TypeScript
types with the same `openapi-typescript` pattern already used by the remote
asset catalogue. Do not hand-maintain a second set of wire types.

The generated editor client exposes only the four print endpoints above.
Management endpoints remain documented by the service but stay outside the
editor client surface.

Before the editor adapter is implemented, preserve the progress already sent
by the agent instead of discarding it in the broker:

- add `action_count` as a new optional/defaulting field in the v1 `JobStatus`
  protobuf message;
- store `last_completed_action` and `action_count` in SQLite;
- populate them from agent progress and terminal messages; and
- expose them as `lastCompletedAction` and `actionCount` in the cloud job
  response and OpenAPI schema.

This is an additive protocol change. An older agent still reports the existing
`last_completed_action` field and defaults only the new action count to zero.

## 5. Package design

Add these focused modules:

```text
src/lib/cloud-print/client.ts       typed HTTPS calls
src/lib/cloud-print/schema.ts       generated OpenAPI types
src/lib/print/cloud.ts              PrintRoute adapter, job controller, polling
src/lib/components/CloudPrintPanel.svelte
```

Export the client, route, public types, and panel from `src/index.ts`.

### Cloud client

The client exposes only:

```ts
listPrinters(signal?)
submitJob(printerId, request, idempotencyKey, signal?)
getJob(jobId, signal?)
cancelJob(jobId, signal?)
```

It adds the bearer token just before each request and maps HTTP errors to short,
actionable messages:

- `401`: the cloud session or credential is unavailable/expired;
- `403`: the caller lacks tenant print permission;
- `404`: tenant, printer, or job is unavailable;
- `409`: printer disabled, terminal cancellation, or idempotency conflict;
- `413`: label request exceeds the configured cloud limit; and
- network failure: cloud service is currently unreachable.

Error messages may include the cloud error code, but never request bodies,
document contents, bearer tokens, or full server responses.

### Cloud print route

`CloudPrintRoute` implements the existing `PrintRoute` interface so
`BatchPanel` and `LaPostePanel` continue to use their existing sequential print
loop. Its configuration contains the client, the selected cloud printer
callback, `JobJournal`, and a small `CloudPrintJobController`.

The controller is cloud-specific; do not add cloud methods to the shared
`PrintRoute` interface. It exposes only:

```ts
subscribe(listener: (job: CloudPrintJob | undefined) => void): () => void
cancel(jobId: string, signal?: AbortSignal): Promise<CloudPrintJob>
resume(jobId: string, signal?: AbortSignal): Promise<CloudPrintJob>
```

The route publishes the accepted job and every polled update through the
controller. `CloudPrintPanel` subscribes to show the active state and calls the
controller for cancellation or recovery. This avoids duplicating submission
and polling logic in the component.

For each explicit print action it:

1. requires an enabled selected cloud printer;
2. verifies that the selected SDK printer definition matches the cloud
   printer's `model`;
3. converts the label once with the existing `toSdkDocument` function;
4. creates one idempotency key and records it before submission;
5. submits `{ printerId, source: "mb-label-editor", request }`;
6. records the returned cloud job ID;
7. publishes the job through the controller;
8. polls the job every second until terminal or aborted; and
9. maps `lastCompletedAction`, byte counts, action count, and terminal outcome
   to the existing `PrintProgress` and `PrintResult` types.

The request is limited to the canonical document and supported print options:

```json
{
  "printerId": "cloud-printer-id",
  "source": "mb-label-editor",
  "request": {
    "document": {},
    "model": "ql-1110nwb",
    "copies": 1,
    "density": 6
  }
}
```

Omit rotation, fit, DPI, and payload limit so the current cloud/agent defaults
apply. They are not editor controls in v1. Never send a serial path, IPP URI,
Bluetooth address, local connection ID, or other transport data.

Aborting polling does not imply that physical printing stopped. If a cloud job
already exists, show it as still active and offer an explicit cancellation
request. Once cancellation is requested, continue polling long enough to
obtain the authoritative terminal result when the view remains open.

### Idempotency and recovery

Store a typed cloud detail object in the existing job `details`: remote job ID
when known, idempotency key, cloud printer ID, model, copies, and density.
Persist no bearer token.

Before the initial POST, also persist the exact serialized submission body as a
temporary recovery snapshot. The document referenced by `documentId` is
mutable and cannot safely reconstruct an idempotent retry. Delete the snapshot
as soon as the remote job ID is known, or when the user abandons the uncertain
submission. Do not retain request snapshots for normal terminal job history.

- A retry caused by an uncertain submission reuses the recorded idempotency
  key and exact serialized recovery snapshot.
- Poll recovery uses the remote job ID and never submits again.
- "Print again" is a new explicit action with a new idempotency key.
- Never automatically reprint a `cancelled-partial` or `outcome-unknown` job.

The recovery panel should show a cloud job's remote state and provide either
"Resume status check" or "Retry submission" as appropriate. The latter is
available only when no remote job ID was received and the exact recovery
snapshot is still present.

## 6. User interface

Add a **Cloud printers…** item to the Print menu. The panel contains:

- a refresh button;
- one printer selector;
- each printer's display name and model;
- clear Online, Offline, and Disabled labels;
- the latest selected job state;
- Cancel while a job is non-terminal; and
- Print current label.

Offline printers remain selectable because cloud jobs may intentionally queue,
but the action must say **Queue print** rather than imply immediate printing.
Disabled printers cannot be submitted.

When Batch or La Poste is open, disable its cloud print action while the
selected cloud printer is offline and explain that only a single current label
can be queued offline in v1. Do not change the shared workflows to enqueue an
entire batch without waiting for physical outcomes. The PWA can do this without
changing `PrintRoute`: pass no route to those panels while the cloud printer is
offline and render the reason next to the disabled workflow.

Selecting a cloud printer also selects its matching SDK printer definition for
validation and preview. If the editor SDK does not recognize the published
model, show "Unsupported printer model" and disable submission.

Change the app-bar print action from the hard-coded local-service button to a
route selector plus one route-aware action:

```text
Local service | Direct browser | Cloud
Print         | Choose device   | Print / Queue print
```

Show Cloud in the standalone PWA after its URL and tenant are configured; ask
for the session token when connecting. Embedded hosts may hide the route by
omitting cloud configuration. Preserve the existing local service as the
default unless the user chooses Cloud.

State wording must preserve the broker's safety meaning:

- `queued`: stored in cloud; printer agent has not accepted it;
- `delivered`: agent stored the job;
- `running`: printing is in progress;
- `completed`: agent reported completion;
- `cancelled-before-send`: no printer write was reported;
- `cancelled-partial`: some output may exist;
- `outcome-unknown`: inspect the physical printer before printing again; and
- `failed`: show the safe error code and do not claim that retry is safe when
  `writeMayHaveOccurred` is true.

Keep server URL, tenant ID, and session token in a small PWA connection dialog,
not in the reusable `CloudPrintPanel`. Do not add editor screens for agent
enrollment, revocation, or other cloud administration.

## 7. Implementation sequence

### Phase 1: contract and client

1. Add and test `mb-print-cloud`'s exact-origin CORS configuration.
2. Add `utoipa` and `utoipa-axum`, derive the wire schemas, and replace the
   hand-built OpenAPI JSON with an `OpenApiRouter` document.
3. Annotate and test all eight business operations, including the four
   editor-facing operations.
4. Preserve and expose `lastCompletedAction` and `actionCount` from the agent
   status contract through SQLite and the job response.
5. Check in the generated contract snapshot and generation script.
6. Implement `CloudPrintClient` with injected auth and fetch.
7. Add contract tests for paths, headers, request bodies, response parsing, and
   safe errors.

Exit condition: a test can list printers, submit a job with an idempotency key,
read it, and cancel it without a Svelte component.

### Phase 2: route, recovery, and panel

1. Implement `CloudPrintJobController` and `CloudPrintRoute` using
   `toSdkDocument` and one-second polling.
2. Add typed cloud recovery details and temporary exact-request snapshots to
   persisted jobs, including snapshot cleanup.
3. Implement `CloudPrintPanel` and state wording.
4. Wire the route into current-label, batch, La Poste, and recovery workflows;
   require an online printer for the two sequential multi-label workflows.
5. Make cloud availability depend on host configuration.

Exit condition: the editor can queue one label to an online or offline cloud
printer, display its authoritative state, cancel it, and safely recover status
after a reload.

### Phase 3: host integration and documentation

1. Add the standalone PWA connection dialog with a session-only token.
2. Document direct CORS configuration and the optional host-proxy pattern in
   the deployment guide and package README.
3. Run an end-to-end test with `mb-print-cloud`, an outbound `mb-printer`
   agent, and the existing capture transport.

Exit condition: one browser action reaches capture through the real broker and
agent, duplicate submission with the same key creates only one cloud job, and
the UI reaches the matching terminal state.

## 8. Tests

Add focused tests for:

- the checked-in OpenAPI contract and generated client;
- token callback evaluation per request and absence from persisted data;
- tenant-scoped URLs and `Idempotency-Key` headers;
- exact canonical v4 request shape with no local transport fields;
- cloud-printer/SDK-model matching;
- online, offline, disabled, and unknown-model printer presentation;
- every cloud job state and terminal outcome mapping;
- `lastCompletedAction` and action-count propagation from agent to editor;
- controller publication, cancellation, and resume behavior;
- polling cleanup when the component unmounts;
- cancellation before delivery and after a possible write;
- uncertain submission recovery with the same idempotency key;
- byte-for-byte recovery snapshot reuse and prompt snapshot deletion;
- reload recovery by remote job ID without resubmission;
- batch and La Poste use of the cloud `PrintRoute`, including their offline
  guard; and
- a browser acceptance path using direct CORS, plus the injected-fetch seam a
  host proxy uses.

The live capture test is required before release, but it does not need to run
in every browser unit-test invocation.

## 9. Release acceptance

The integration is ready when:

- cloud printing requires an explicit standalone connection or host config;
- no long-lived cloud credential is shipped or persisted by the editor;
- an authorized tenant can list only its printers;
- the submitted model always matches the selected cloud printer;
- current-label, batch, and La Poste printing share the cloud route;
- an offline agent leaves the job visibly queued without automatic failover;
- reload resumes status tracking without creating another job;
- uncertain POST recovery reuses the exact original bytes and then removes its
  temporary snapshot;
- cancellation and ambiguous outcomes use the broker's exact safety semantics;
- local service and direct-browser printing continue to pass their existing
  tests; and
- the real cloud-to-agent capture test produces one output for one explicit
  print action.
