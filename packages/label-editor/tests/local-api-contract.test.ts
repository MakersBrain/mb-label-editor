// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import wire from './fixtures/local-api-v1-wire.json';
import {
  defaultDocument,
  LocalApiPrintRoute,
  resolveContinuousDocument,
  type PrinterDefinition,
} from '../src/index.js';
import { EditorDatabase, isLocalApiJobDetails, JobJournal } from '../src/index.js';
const printer: PrinterDefinition = {
  id: 'm110',
  displayName: 'M110',
  dpi: 203,
  protocols: ['m110'],
  media: { minWidth: 1, maxWidth: 100, minHeight: 1, maxHeight: 100 },
};
const connection = {
  id: 'desk',
  model: 'm110',
  status: 'ready',
  transport: { kind: 'tcp' as const, address: 'printer.local:9100' },
};
afterEach(() => vi.unstubAllGlobals());
it('locks the shared v1 wire fixture to hosted-PWA preflight and camelCase fields', () => {
  expect(Object.keys(wire.pairResponse)).toEqual(['grantId', 'token', 'expiresAt']);
  expect(wire.jobRequest).toHaveProperty('printerId', 'm110');
  expect(wire.completedJob).toMatchObject({
    terminal: true,
    outcome: 'completed',
    lastCompletedAction: 4,
    bytesSent: 128,
  });
  expect(wire.preflight).toMatchObject({
    requestHeaders: 'authorization,content-type,idempotency-key',
    privateNetwork: true,
  });
});
describe('mb-printer local API contract', () => {
  it('pairs with the service camelCase grant contract', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ secret: 'once' });
      return new Response(JSON.stringify({ grantId: 'grant-1', token: 'token-1', expiresAt: '2026-09-01T00:00:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const grant = await new LocalApiPrintRoute({ token: () => undefined }).pair('once');
    expect(grant).toEqual({ grantId: 'grant-1', token: 'token-1', expiresAt: '2026-09-01T00:00:00Z' });
  });
  it('exchanges an administrator pairing secret without using the stored print grant', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:9847/v1/admin/pair');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({ secret: 'admin-once' });
      return new Response(JSON.stringify({ token: 'admin-token', expiresAt: '2026-09-01T00:10:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const grant = await new LocalApiPrintRoute({ token: () => 'print-token' }).pairAdmin('admin-once');
    expect(grant).toEqual({ token: 'admin-token', expiresAt: '2026-09-01T00:10:00Z' });
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });
  it('uses the documented Brother Wi-Fi review and configure wire forms', async () => {
    const request = {
      ssid: 'Workshop',
      password: 'not-retained',
      encryption: 'aes',
      authentication: 'wpa2-only',
      infrastructure: true,
      wirelessDirect: false,
      reboot: true,
    };
    let call = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      call++;
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer admin-token');
      if (call === 1) {
        expect(url).toBe('http://127.0.0.1:9847/v1/printers/desk/brother/wifi/prepare');
        expect(JSON.parse(String(init?.body))).toEqual(request);
        return new Response(
          JSON.stringify({
            approvalId: 'approval-1',
            expiresAt: 1788250200,
            connection: 'desk',
            device: 'usb-device:04f9:209b:1:2',
            ssid: 'Workshop',
            encryption: 'aes',
            authentication: 'wpa2-only',
            infrastructure: true,
            wirelessDirect: false,
            reboot: true,
            recovery: 'Keep USB available.',
          }),
        );
      }
      expect(url).toBe('http://127.0.0.1:9847/v1/printers/desk/brother/wifi/configure');
      expect(JSON.parse(String(init?.body))).toEqual({ approvalId: 'approval-1', ...request });
      return new Response(
        JSON.stringify({ connection: 'desk', device: 'usb-device:04f9:209b:1:2', applied: true, reboot: true }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const route = new LocalApiPrintRoute({ token: () => 'print-token' });
    const preparation = await route.prepareBrotherWifiConfigure('desk', request, 'admin-token');
    expect(preparation).toEqual({
      approvalId: 'approval-1',
      expiresAt: 1788250200,
      recovery: 'Keep USB available.',
      summary: {
        connection: 'desk',
        device: 'usb-device:04f9:209b:1:2',
        ssid: 'Workshop',
        encryption: 'aes',
        authentication: 'wpa2-only',
        infrastructure: true,
        wirelessDirect: false,
        reboot: true,
      },
    });
    expect(await route.configureBrotherWifi('desk', preparation.approvalId, request, 'admin-token')).toEqual({
      connection: 'desk',
      device: 'usb-device:04f9:209b:1:2',
      applied: true,
      reboot: true,
    });
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ cache: 'no-store' });
  });
  it('submits canonical documents and consumes camelCase job views', async () => {
    let call = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      call++;
      if (call === 1) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ printerId: 'm110', connectionId: 'desk' });
        expect(body).not.toHaveProperty('transport');
        expect(body.document.media.unit).toBe('micrometre');
        expect(body.document).not.toHaveProperty('id');
        expect(new Headers(init?.headers).get('idempotency-key')).toBeTruthy();
        return new Response(
          JSON.stringify({
            id: 'job-1',
            state: 'queued',
            terminal: false,
            lastCompletedAction: -1,
            bytesSent: 0,
            action: 0,
            actions: 5,
            totalBytes: 128,
            phase: 'queued',
          }),
          { status: 202 },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'job-1',
          state: 'completed',
          terminal: true,
          outcome: 'completed',
          lastCompletedAction: 4,
          bytesSent: 128,
          action: 5,
          actions: 5,
          totalBytes: 128,
          phase: 'completed',
          error: null,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetch);
    const progress: unknown[] = [];
    const result = await new LocalApiPrintRoute({ token: () => 'token-1', connection: () => connection }).print({
      document: defaultDocument(),
      printer,
      copies: 1,
      onProgress: (value) => progress.push(value),
    });
    expect(result).toEqual({ outcome: 'completed', lastCompletedAction: 4, bytesSent: 128, error: undefined });
    expect(progress).toContainEqual({ action: 5, actions: 5, bytesSent: 128, totalBytes: 128, phase: 'completed' });
  });
});
it('configures an IPPS connection and reads live printer status', async () => {
  let call = 0;
  const secure = {
    id: 'brother-network',
    model: 'ql-1110nwb',
    status: 'idle',
    transport: { kind: 'ipp' as const, uri: 'ipps://brother.local:631/ipp/print', certificatePem: 'CERT' },
    media: { keyword: 'roll_current_62x0mm', printerState: 'idle' },
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    call++;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
    if (call === 1) {
      expect(url).toBe('http://127.0.0.1:9847/v1/connection');
      expect(JSON.parse(String(init?.body))).toEqual({
        id: 'brother-network',
        model: 'ql-1110nwb',
        transport: secure.transport,
      });
      return new Response(JSON.stringify(secure), { status: 200 });
    }
    expect(url).toBe('http://127.0.0.1:9847/v1/status?connection=brother-network');
    return new Response(JSON.stringify({ connection: secure, connected: true, status: 'idle', media: secure.media }), {
      status: 200,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const route = new LocalApiPrintRoute({ token: () => 'token-1' });
  expect(await route.configureConnection({ id: secure.id, model: secure.model, transport: secure.transport })).toEqual(
    secure,
  );
  expect(await route.connectionStatus(secure.id)).toMatchObject({
    connected: true,
    status: 'idle',
    media: { printerState: 'idle' },
  });
});
it('validates, streams SSE progress, and cancels using authenticated service routes', async () => {
  const calls: string[] = [];
  const completed = {
    id: 'job-1',
    state: 'completed',
    terminal: true,
    outcome: 'completed',
    lastCompletedAction: 1,
    bytesSent: 24,
    action: 2,
    actions: 2,
    totalBytes: 24,
    phase: 'completed',
    error: null,
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
    if (url.endsWith('/documents/validate')) return new Response(JSON.stringify({ valid: true, errors: [] }));
    if (url.endsWith('/events'))
      return new Response(
        `event: progress\ndata: ${JSON.stringify({ ...completed, state: 'running', terminal: false, outcome: null, action: 1, phase: 'running' })}\n\nevent: progress\ndata: ${JSON.stringify(completed)}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    return new Response(
      JSON.stringify({
        ...completed,
        state: 'cancel-requested',
        terminal: false,
        outcome: null,
        phase: 'cancelrequested',
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const route = new LocalApiPrintRoute({ token: () => 'token-1' });
  expect(await route.validate(defaultDocument())).toEqual({ valid: true, errors: [] });
  const progress: unknown[] = [];
  expect(await route.events('job-1', (value) => progress.push(value))).toEqual({
    outcome: 'completed',
    lastCompletedAction: 1,
    bytesSent: 24,
    error: undefined,
  });
  expect(progress).toHaveLength(2);
  expect((await route.cancel('job-1')).outcome).toBe('outcome-unknown');
  expect(calls).toEqual([
    'POST http://127.0.0.1:9847/v1/documents/validate',
    'GET http://127.0.0.1:9847/v1/jobs/job-1/events',
    'POST http://127.0.0.1:9847/v1/jobs/job-1/cancel',
  ]);
});

it('keeps the default API on literal loopback and explains origin and grant failures', async () => {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(url);
    return new Response('', { status: calls.length === 1 ? 403 : 401 });
  });
  vi.stubGlobal('fetch', fetch);
  const route = new LocalApiPrintRoute({ token: () => undefined });
  await expect(route.pair('first')).rejects.toThrow(/exact editor origin.*LABEL_EDITOR_ORIGINS/i);
  await expect(route.pair('second')).rejects.toThrow(/secret expired.*fresh one-time secret/i);
  expect(calls).toEqual(['http://127.0.0.1:9847/v1/pair', 'http://127.0.0.1:9847/v1/pair']);
});

it('bypasses the browser HTTP cache for every loopback API request', async () => {
  const completed = {
    id: 'job-1',
    state: 'completed',
    terminal: true,
    outcome: 'completed',
    lastCompletedAction: 0,
    bytesSent: 1,
    action: 1,
    actions: 1,
    totalBytes: 1,
    phase: 'completed',
    error: null,
  };
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/pair'))
      return new Response(JSON.stringify({ grantId: 'grant-1', token: 'token-1', expiresAt: '2026-09-01T00:00:00Z' }));
    if (url.endsWith('/documents/validate')) return new Response(JSON.stringify({ valid: true, errors: [] }));
    if (url.endsWith('/discovery'))
      return new Response(
        JSON.stringify({
          devices: [
            {
              transport: 'usb',
              address: 'usb:04f9:209b',
              name: 'QL-1110NWB',
              vendor_id: 0x04f9,
              product_id: 0x209b,
              serial_number: 'SERIAL',
            },
          ],
          supportedTransports: ['usb', 'ipp'],
        }),
      );
    if (url.endsWith('/brother/wifi/status'))
      return new Response(
        JSON.stringify({
          connectionId: 'desk one',
          status: {
            connected: true,
            ipAddress: '192.0.2.4',
            ssid: 'Workshop',
            encryption: 'aes',
            authentication: 'wpa2-psk',
            infrastructure: true,
            wirelessDirect: false,
          },
        }),
      );
    if (url.endsWith('/brother/wifi/scan'))
      return new Response(
        JSON.stringify({
          connectionId: 'desk one',
          accessPoints: [{ ssid: 'Workshop', channel: 6, power: -42, encrypted: true, enterprise: false }],
        }),
      );
    if (url.endsWith('/brother/report'))
      return new Response(
        JSON.stringify({ connectionId: 'desk one', redacted: true, sections: { General: { Model: 'QL-1110NWB' } } }),
      );
    if (url.endsWith('/status')) return new Response(JSON.stringify({ connections: [connection] }));
    if (url.includes('/status?connection='))
      return new Response(JSON.stringify({ connection, connected: true, status: 'ready' }));
    if (url.endsWith('/connection')) return new Response(JSON.stringify(connection));
    if (url.endsWith('/events'))
      return new Response(`data: ${JSON.stringify(completed)}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    return new Response(JSON.stringify(completed));
  });
  vi.stubGlobal('fetch', fetch);
  const route = new LocalApiPrintRoute({ token: () => 'token-1', connection: () => connection });
  await route.pair('once');
  await route.validate(defaultDocument());
  await route.connections();
  await route.configureConnection(connection);
  await route.connectionStatus(connection.id);
  const discovery = await route.discover();
  const wifi = await route.brotherWifiStatus('desk one');
  const scan = await route.brotherWifiScan('desk one');
  const report = await route.brotherReport('desk one');
  await route.submit({ document: defaultDocument(), printer, copies: 1 });
  await route.job('job-1');
  await route.cancel('job-1');
  await route.events('job-1', () => {});
  expect(discovery.devices[0]).toMatchObject({ transport: 'usb', vendor_id: 0x04f9, serial_number: 'SERIAL' });
  expect(wifi.status).toMatchObject({ connected: true, ssid: 'Workshop', wirelessDirect: false });
  expect(scan.accessPoints[0]).toEqual({
    ssid: 'Workshop',
    channel: 6,
    power: -42,
    encrypted: true,
    enterprise: false,
  });
  expect(report).toMatchObject({
    connectionId: 'desk one',
    redacted: true,
    sections: { General: { Model: 'QL-1110NWB' } },
  });
  expect(fetch.mock.calls.slice(6, 9).map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
    ['http://127.0.0.1:9847/v1/printers/desk%20one/brother/wifi/status', 'GET'],
    ['http://127.0.0.1:9847/v1/printers/desk%20one/brother/wifi/scan', 'POST'],
    ['http://127.0.0.1:9847/v1/printers/desk%20one/brother/report', 'GET'],
  ]);
  for (const [, init] of fetch.mock.calls.slice(5, 9))
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
  expect(fetch).toHaveBeenCalledTimes(13);
  for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ cache: 'no-store' });
});

it('persists and reuses the exact local submission after an ambiguous POST', async () => {
  const database = new EditorDatabase();
  const journal = new JobJournal(database);
  const document = defaultDocument();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('connection lost');
    }),
  );
  const route = new LocalApiPrintRoute({ token: () => 'token-1', connection: () => connection, journal });
  expect((await route.print({ document, printer, copies: 2 })).outcome).toBe('outcome-unknown');
  const persisted = (await journal.recover()).find((job) => job.documentId === document.id)!;
  expect(isLocalApiJobDetails(persisted.details)).toBe(true);
  if (!isLocalApiJobDetails(persisted.details)) throw new Error('missing local snapshot');
  const snapshot = persisted.details;
  const submitted = {
    id: 'job-recovered',
    state: 'completed',
    terminal: true,
    outcome: 'completed',
    lastCompletedAction: 1,
    bytesSent: 20,
    action: 2,
    actions: 2,
    totalBytes: 20,
    phase: 'completed',
  };
  const resumed = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(snapshot.idempotencyKey);
    expect(init?.body).toBe(snapshot.requestBody);
    return new Response(JSON.stringify(submitted), { status: 200 });
  });
  vi.stubGlobal('fetch', resumed);
  expect(await route.recover(persisted)).toMatchObject({ outcome: 'completed', bytesSent: 20 });
  expect(resumed).toHaveBeenCalledOnce();
});

it('preserves capability-checked continuous options in the local-service wire snapshot', async () => {
  const definition: PrinterDefinition = {
    id: 'ql',
    displayName: 'QL',
    dpi: 300,
    protocols: ['brother'],
    media: { minWidth: 1, maxWidth: 100, minHeight: 25.4, maxHeight: 1000 },
    continuousMedia: {
      supported: true,
      minimumLengthMm: 25.4,
      maximumLengthMm: 1000,
      minimumExtraFeedMm: 0,
      maximumExtraFeedMm: 0,
      cutModes: ['after-each', 'none'],
      automaticCutter: true,
      supportsChainedRaster: false,
    },
  };
  const source = defaultDocument();
  source.media.shape = 'continuous';
  const document = resolveContinuousDocument(source, undefined, {
    minimumLengthMm: 25.4,
    maximumLengthMm: 1000,
    source: 'printer',
    printerModel: 'ql',
  }).document;
  let body: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: 'job',
          state: 'queued',
          terminal: false,
          lastCompletedAction: -1,
          bytesSent: 0,
          action: 0,
          actions: 1,
          totalBytes: 1,
          phase: 'queued',
        }),
        { status: 202 },
      );
    }),
  );
  await new LocalApiPrintRoute({ token: () => 'token', connection: () => ({ ...connection, model: 'ql' }) }).submit({
    document,
    printer: definition,
    copies: 1,
    continuous: { cutMode: 'none', extraFeedBeforeMm: 0, extraFeedAfterMm: 0, chainCopies: false },
  });
  expect(body.continuous).toEqual({ cutMode: 'none', extraFeedBeforeMm: 0, extraFeedAfterMm: 0, chainCopies: false });
});

it('submits a continuous document array as one native local-service batch', async () => {
  const definition: PrinterDefinition = {
    id: 'ql-1110nwb',
    displayName: 'QL-1110NWB',
    dpi: 300,
    protocols: ['brother'],
    media: { minWidth: 1, maxWidth: 103.6, minHeight: 25.4, maxHeight: 3000 },
    continuousMedia: {
      supported: true,
      minimumLengthMm: 25.4,
      maximumLengthMm: 3000,
      minimumExtraFeedMm: 0,
      maximumExtraFeedMm: 0,
      cutModes: ['after-each', 'after-job', 'none'],
      automaticCutter: true,
      supportsChainedRaster: true,
    },
  };
  const source = defaultDocument();
  source.media.shape = 'continuous';
  source.media.width = 62;
  source.media.height = 30;
  source.media.printableBounds = { x: 0, y: 0, width: 62, height: 30 };
  const first = resolveContinuousDocument(source, undefined, {
    minimumLengthMm: 25.4,
    maximumLengthMm: 3000,
    source: 'printer',
    printerModel: definition.id,
  }).document;
  const second = resolveContinuousDocument(
    {
      ...source,
      media: { ...source.media, height: 45, printableBounds: { ...source.media.printableBounds, height: 45 } },
    },
    undefined,
    { minimumLengthMm: 25.4, maximumLengthMm: 3000, source: 'printer', printerModel: definition.id },
  ).document;
  let body: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities'))
        return new Response(
          JSON.stringify({
            service: 'mb-printer',
            version: '1',
            api: 'v1',
            features: ['continuous-options', 'native-document-batch'],
          }),
        );
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: 'batch',
          state: 'completed',
          terminal: true,
          outcome: 'completed',
          lastCompletedAction: 9,
          bytesSent: 200,
          action: 10,
          actions: 10,
          totalBytes: 200,
          phase: 'completed',
        }),
        { status: 202 },
      );
    }),
  );
  const route = new LocalApiPrintRoute({
    token: () => 'token',
    connection: () => ({ ...connection, model: definition.id }),
  });
  expect((await route.negotiateCapabilities()).features).toContain('native-document-batch');
  const result = await route.printBatch!({
    documents: [first, second],
    printer: definition,
    copies: 1,
    continuous: { cutMode: 'after-job', extraFeedBeforeMm: 0, extraFeedAfterMm: 0, chainCopies: true },
  });
  expect(result.outcome).toBe('completed');
  expect(body).not.toHaveProperty('document');
  expect((body.documents as Array<{ media: { height: number } }>).map((document) => document.media.height)).toEqual([
    30_000, 45_000,
  ]);
  expect(body.continuous).toMatchObject({ cutMode: 'after-job', chainCopies: true });
});
