// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { CloudPrintClient, type CloudPrintJob, type CloudPrinter } from '../src/lib/cloud-print/client.js';
import { CloudPrintJobController, CloudPrintRoute, isCloudJobDetails } from '../src/lib/print/cloud.js';
import type { PrinterDefinition } from '../src/lib/print/types.js';
import { EditorDatabase } from '../src/lib/persistence/database.js';
import { JobJournal } from '../src/lib/jobs.js';
import { defaultDocument } from '../src/lib/model.js';

const printer: CloudPrinter = { id: '4b066d0c-1f58-4149-a802-018714a606dd', agentId: 'agent', displayName: 'Packing desk', model: 'm110', enabled: true, online: true };
const definition: PrinterDefinition = { id: 'm110', displayName: 'M110', dpi: 203, protocols: ['phomemo'], media: { minWidth: 10, maxWidth: 50, minHeight: 10, maxHeight: 100 } };
const job = (state: string, terminalOutcome: string | null = null): CloudPrintJob => ({
  id: 'b5e352b9-bab4-436f-bf81-da069cc164c0', printerId: printer.id, agentId: printer.agentId,
  state, terminalOutcome, progress: null, action: state, bytesSent: state === 'completed' ? 42 : 0,
  totalBytes: 42, lastCompletedAction: state === 'completed' ? 3 : -1, actionCount: 4,
  item:0,items:1,copy:0,copies:1,
  writeMayHaveOccurred: state === 'completed', cancellationRequestedAt: null, errorCode: null,
  createdAt: 1, deliveredAt: null, startedAt: null, terminalAt: state === 'completed' ? 2 : null
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('cloud print OpenAPI client and route', () => {
  it('uses the current token and tenant-scoped generated paths', async () => {
    let token = 'first';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response([printer]));
    const client = new CloudPrintClient({ baseUrl: 'https://print.example.test/', tenantId: 'tenant-1', getAccessToken: async () => token, fetch: fetcher });
    expect(await client.listPrinters()).toEqual([printer]);
    let request = fetcher.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://print.example.test/v1/tenants/tenant-1/printers');
    expect(request.headers.get('authorization')).toBe('Bearer first');
    token = 'second';
    await client.listPrinters();
    request = fetcher.mock.calls[1][0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer second');
  });

  it('submits canonical v4 without transport fields and maps terminal progress', async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'POST') { bodies.push(await request.text()); return response(job('queued'), 202); }
      return response(job('completed'));
    });
    const client = new CloudPrintClient({ baseUrl: 'https://print.example.test', tenantId: 'tenant-1', getAccessToken: () => 'token', fetch: fetcher });
    const database = new EditorDatabase();
    const controller = new CloudPrintJobController(client, 0);
    const route = new CloudPrintRoute({ client, printer: () => printer, journal: new JobJournal(database), controller });
    const progress: unknown[] = [];
    const result = await route.print({ document: defaultDocument(), printer: definition, copies: 1, onProgress: value => progress.push(value) });
    expect(result).toEqual({ outcome: 'completed', lastCompletedAction: 3, bytesSent: 42 });
    const wire = JSON.parse(bodies[0]);
    expect(wire.request.document.version).toBe(4);
    expect(wire.request).not.toHaveProperty('payloadLimit');
    expect(JSON.stringify(wire)).not.toMatch(/transport|connectionId|certificatePem/);
    expect(progress.at(-1)).toMatchObject({ action: 4, actions: 4, bytesSent: 42 });
    const persisted = (await new JobJournal(database).recent('cloud-api'))[0];
    expect(isCloudJobDetails(persisted.details) && persisted.details.submission).toBeUndefined();
    expect(persisted.resumable).toBe(false);
  });

  it('reuses the byte-identical snapshot after an uncertain POST', async () => {
    const bodies: string[] = [];
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'POST') {
        bodies.push(await request.text()); attempts++;
        if (attempts === 1) throw new TypeError('network lost after send');
        return response(job('completed'), 202);
      }
      return response(job('completed'));
    });
    const client = new CloudPrintClient({ baseUrl: 'https://print.example.test', tenantId: 'tenant-1', getAccessToken: () => 'token', fetch: fetcher });
    const database = new EditorDatabase();
    const route = new CloudPrintRoute({ client, printer: () => printer, journal: new JobJournal(database), controller: new CloudPrintJobController(client, 0) });
    const document = defaultDocument();
    expect((await route.print({ document, printer: definition, copies: 1 })).outcome).toBe('outcome-unknown');
    const persisted = (await new JobJournal(database).recover()).find(item => item.route === 'cloud-api')!;
    document.title = 'changed after the failed response';
    expect((await route.recover(persisted)).outcome).toBe('completed');
    expect(bodies[1]).toBe(bodies[0]);
    const finished = (await new JobJournal(database).recent('cloud-api')).find(item => item.id === persisted.id)!;
    expect(isCloudJobDetails(finished.details) && finished.details.submission).toBeUndefined();
  });

  it('publishes cancellation and keeps polling for its authoritative outcome', async () => {
    const published: string[] = [];
    let reads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'POST') return response(job('running'));
      reads++;
      return response(reads === 1 ? job('running') : job('cancelled-partial', 'cancelled-partial'));
    });
    const client = new CloudPrintClient({ baseUrl: 'https://print.example.test', tenantId: 'tenant-1', fetch: fetcher });
    const controller = new CloudPrintJobController(client, 0);
    controller.subscribe(value => { if (value) published.push(value.terminalOutcome ?? value.state); });
    const terminal = await controller.cancel(job('running').id);
    expect(terminal.terminalOutcome).toBe('cancelled-partial');
    expect(published).toEqual(['running', 'running', 'cancelled-partial']);
  });

  it('submits multiple documents in one cloud job snapshot',async()=>{
    const bodies:string[]=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const request=input instanceof Request?input:new Request(input,init);if(request.url.endsWith('/openapi.json'))return response({components:{schemas:{ValidatedPrintRequest:{properties:{documents:{},continuous:{}}}}}});if(request.method==='POST'){bodies.push(await request.text());return response(job('completed'),202)}return response(job('completed'))});
    const client=new CloudPrintClient({baseUrl:'https://print.example.test',tenantId:'tenant-1',getAccessToken:()=> 'token',fetch:fetcher});
    expect(await client.negotiateCapabilities()).toEqual({nativeBatch:true,continuousOptions:true});
    const route=new CloudPrintRoute({client,printer:()=>printer,journal:new JobJournal(new EditorDatabase()),controller:new CloudPrintJobController(client,0)});
    const second=defaultDocument();second.media.height=45;second.media.printableBounds.height=45;
    const result=await route.printBatch!({documents:[defaultDocument(),second],printer:definition,copies:1});
    expect(result.outcome).toBe('completed');const wire=JSON.parse(bodies[0]);expect(wire.request).not.toHaveProperty('document');expect(wire.request.documents.map((document:{media:{height:number}})=>document.media.height)).toEqual([30_000,45_000]);
  });
});
