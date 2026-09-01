// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { defaultDocument } from '../../packages/label-editor/src/lib/model.js';
import { LocalApiPrintRoute } from '../../packages/label-editor/src/lib/print/local-api.js';
import { resolveContinuousDocument } from '../../packages/label-editor/src/lib/continuous-media.js';
import type { PrinterDefinition } from '../../packages/label-editor/src/lib/print/types.js';

const origin = 'http://127.0.0.1:4173';
const cliRoot = [resolve(import.meta.dirname, '../../../mb-printer-cli'), resolve(import.meta.dirname, '../../../../../mb-printer-cli')]
  .find(path => existsSync(join(path, 'Cargo.toml'))) ?? resolve(import.meta.dirname, '../../../mb-printer-cli');
const binary = join(cliRoot, 'target/debug/mb-printer');

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No ephemeral port');
  await new Promise<void>((ok) => server.close(() => ok()));
  return address.port;
}
async function waitUntilReady(baseUrl: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`mb-printer exited early with ${child.exitCode}`);
    try { await fetch(`${baseUrl}/capabilities`, { headers: { origin } }); return; } catch { /* starting */ }
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('mb-printer API did not become ready');
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([once(child, 'exit'), new Promise((_, reject) => setTimeout(() => reject(new Error('mb-printer did not stop')), 5000))]);
}

test('real CLI process supports pairing, preflight, jobs, restart, and revocation', async () => {
  test.setTimeout(240_000);
  if (!existsSync(binary)) execFileSync('cargo', ['build', '--manifest-path', join(cliRoot, 'Cargo.toml'), '--bin', 'mb-printer'], { stdio: 'pipe' });
  const directory = await mkdtemp(join(tmpdir(), 'mb-editor-local-api-'));
  const config = join(directory, 'config.json');
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}/v1`;
  await writeFile(config, JSON.stringify({ api_port: port, allowed_origins: [origin], max_request_bytes: 8_388_608, max_document_bytes: 6_291_456, max_recent_jobs: 100, printer_defaults: {} }));
  const pairOutput = execFileSync(binary, ['--config', config, 'service', 'pair', '--expires-seconds', '120'], { encoding: 'utf8' });
  const secret = pairOutput.trim().split(/\s+/).at(-1); expect(secret).toBeTruthy();
  let service: ChildProcess | undefined;
  const start = async () => { service = spawn(binary, ['--config', config, 'service', 'run', '--bind', '127.0.0.1', '--port', String(port)], { stdio: 'pipe' }); await waitUntilReady(base, service); };
  try {
    await start();
    const preflight = await fetch(`${base}/jobs`, { method: 'OPTIONS', headers: {
      origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type', 'access-control-request-private-network': 'true'
    } });
    expect(preflight.ok).toBe(true);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');

    let token: string | undefined; let connection: import('../../packages/label-editor/src/lib/print/local-api.js').LocalApiConnection | undefined;
    const route = new LocalApiPrintRoute({ baseUrl: base, token: () => token, origin, connection: () => connection });
    const grant = await route.pair(secret!); token = grant.token;
    connection = await route.configureConnection({ id: 'acceptance-file', model: 'm200', transport: { kind: 'file', path: join(directory, 'printer.capture') } });
    expect(grant.grantId).toBeTruthy(); expect(new Date(grant.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await route.validate(defaultDocument())).valid).toBe(true);

    // The editor's 50 mm default media exceeds the M110's 48 mm print head.
    // Exercise a model whose declared head can physically accept that document.
    const request = { document: defaultDocument(), printer: { id: 'm200', name: 'M200', dpi: 203 }, copies: 1 };
    const submitted = await route.submit(request);
    const progress: string[] = [];
    const terminal = await route.events(submitted.id, (event) => progress.push(event.phase));
    expect(terminal?.outcome).toBe('completed');
    expect((await route.job(submitted.id)).terminal).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
    expect((await route.print(request)).outcome).toBe('completed');

    const negotiated=await route.negotiateCapabilities();expect(negotiated.features).toContain('native-document-batch');
    connection=await route.configureConnection({id:'continuous-file',model:'ql-1110nwb',transport:{kind:'file',path:join(directory,'continuous.capture')}});
    const source=defaultDocument();source.media.shape='continuous';source.media.width=62;source.media.height=30;source.media.printableBounds={x:0,y:0,width:62,height:30};
    const limits={minimumLengthMm:25.4,maximumLengthMm:3000,source:'printer' as const,printerModel:'ql-1110nwb'};
    const first=resolveContinuousDocument(source,undefined,limits).document;
    source.media.height=45;source.media.printableBounds.height=45;
    const second=resolveContinuousDocument(source,undefined,limits).document;
    const ql:PrinterDefinition={id:'ql-1110nwb',displayName:'Brother QL-1110NWB',dpi:300,protocols:['brother'],media:{minWidth:1,maxWidth:103.6,minHeight:25.4,maxHeight:3000},continuousMedia:{supported:true,minimumLengthMm:25.4,maximumLengthMm:3000,minimumExtraFeedMm:0,maximumExtraFeedMm:0,cutModes:['after-each','after-job','none'],automaticCutter:true,supportsChainedRaster:true,requiredFeedBeforeMm:0,requiredFeedAfterMm:0}};
    const batchProgress:{item:number;items:number;copy:number;copies:number;current:{action:number;bytesSent:number}}[]=[];
    expect((await route.printBatch!({documents:[first,second],printer:ql,copies:1,continuous:{cutMode:'after-job',extraFeedBeforeMm:0,extraFeedAfterMm:0,chainCopies:true},onProgress:value=>batchProgress.push(value)})).outcome).toBe('completed');
    // File transport may complete the full batch between the service's 250 ms
    // status polls. The terminal snapshot must still identify the final item;
    // action-by-action transitions are covered deterministically in the CLI.
    expect(batchProgress.at(-1)?.item).toBe(1);
    expect(batchProgress.at(-1)?.items).toBe(2);
    expect(batchProgress.at(-1)?.copy).toBe(0);
    expect(batchProgress.at(-1)?.copies).toBe(1);
    expect(batchProgress.at(-1)?.current.bytesSent).toBeGreaterThan(0);
    connection=await route.configureConnection({id:'acceptance-file',model:'m200',transport:{kind:'file',path:join(directory,'printer.capture')}});

    const cancellable = await route.submit({ ...request, copies: 8 });
    const cancelResult = await route.cancel(cancellable.id);
    expect(['cancelled-before-send', 'cancelled-partial', 'outcome-unknown', 'completed']).toContain(cancelResult.outcome);

    await stop(service); service = undefined;
    await start();
    expect((await route.validate(defaultDocument())).valid).toBe(true);
    const recovered = await fetch(`${base}/jobs/${submitted.id}`, { headers: { origin, authorization: `Bearer ${token}` } });
    expect(recovered.status).toBe(200); expect((await recovered.json() as { terminal: boolean }).terminal).toBe(true);

    await stop(service); service = undefined;
    execFileSync(binary, ['--config', config, 'service', 'grant', 'revoke', grant.grantId], { stdio: 'pipe' });
    await start();
    await expect(route.validate(defaultDocument())).rejects.toThrow('revoked');
  } finally {
    await stop(service);
    await rm(directory, { recursive: true, force: true });
  }
});
