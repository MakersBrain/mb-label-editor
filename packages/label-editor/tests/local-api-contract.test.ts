// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import{afterEach,describe,expect,it,vi}from'vitest';import wire from'./fixtures/local-api-v1-wire.json';import{defaultDocument,LocalApiPrintRoute,type PrinterDefinition}from'../src/index.js';
import { EditorDatabase, isLocalApiJobDetails, JobJournal } from '../src/index.js';
const printer:PrinterDefinition={id:'m110',displayName:'M110',dpi:203,protocols:['m110'],media:{minWidth:1,maxWidth:100,minHeight:1,maxHeight:100}};const connection={id:'desk',model:'m110',status:'ready',transport:{kind:'tcp' as const,address:'printer.local:9100'}};afterEach(()=>vi.unstubAllGlobals());
it('locks the shared v1 wire fixture to hosted-PWA preflight and camelCase fields',()=>{expect(Object.keys(wire.pairResponse)).toEqual(['grantId','token','expiresAt']);expect(wire.jobRequest).toHaveProperty('printerId','m110');expect(wire.completedJob).toMatchObject({terminal:true,outcome:'completed',lastCompletedAction:4,bytesSent:128});expect(wire.preflight).toMatchObject({requestHeaders:'authorization,content-type,idempotency-key',privateNetwork:true})});
describe('mb-printer local API contract',()=>{it('pairs with the service camelCase grant contract',async()=>{const fetch=vi.fn(async(_url:string,init?:RequestInit)=>{expect(JSON.parse(String(init?.body))).toEqual({secret:'once'});return new Response(JSON.stringify({grantId:'grant-1',token:'token-1',expiresAt:'2026-09-01T00:00:00Z'}),{status:200,headers:{'content-type':'application/json'}})});vi.stubGlobal('fetch',fetch);const grant=await new LocalApiPrintRoute({token:()=>undefined}).pair('once');expect(grant).toEqual({grantId:'grant-1',token:'token-1',expiresAt:'2026-09-01T00:00:00Z'})});
it('submits canonical documents and consumes camelCase job views',async()=>{let call=0;const fetch=vi.fn(async(_url:string,init?:RequestInit)=>{call++;if(call===1){const body=JSON.parse(String(init?.body));expect(body).toMatchObject({printerId:'m110',connectionId:'desk'});expect(body).not.toHaveProperty('transport');expect(body.document.media.unit).toBe('micrometre');expect(body.document).not.toHaveProperty('id');expect(new Headers(init?.headers).get('idempotency-key')).toBeTruthy();return new Response(JSON.stringify({id:'job-1',state:'queued',terminal:false,lastCompletedAction:-1,bytesSent:0,action:0,actions:5,totalBytes:128,phase:'queued'}),{status:202})}return new Response(JSON.stringify({id:'job-1',state:'completed',terminal:true,outcome:'completed',lastCompletedAction:4,bytesSent:128,action:5,actions:5,totalBytes:128,phase:'completed',error:null}),{status:200})});vi.stubGlobal('fetch',fetch);const progress:unknown[]=[];const result=await new LocalApiPrintRoute({token:()=> 'token-1',connection:()=>connection}).print({document:defaultDocument(),printer,copies:1,onProgress:value=>progress.push(value)});expect(result).toEqual({outcome:'completed',lastCompletedAction:4,bytesSent:128,error:undefined});expect(progress).toContainEqual({action:5,actions:5,bytesSent:128,totalBytes:128,phase:'completed'})})});
it('configures an IPPS connection and reads live printer status',async()=>{let call=0;const secure={id:'brother-network',model:'ql-1110nwb',status:'idle',transport:{kind:'ipp' as const,uri:'ipps://brother.local:631/ipp/print',certificatePem:'CERT'},media:{keyword:'roll_current_62x0mm',printerState:'idle'}};const fetch=vi.fn(async(url:string,init?:RequestInit)=>{call++;expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');if(call===1){expect(url).toBe('http://127.0.0.1:9847/v1/connection');expect(JSON.parse(String(init?.body))).toEqual({id:'brother-network',model:'ql-1110nwb',transport:secure.transport});return new Response(JSON.stringify(secure),{status:200})}expect(url).toBe('http://127.0.0.1:9847/v1/status?connection=brother-network');return new Response(JSON.stringify({connection:secure,connected:true,status:'idle',media:secure.media}),{status:200})});vi.stubGlobal('fetch',fetch);const route=new LocalApiPrintRoute({token:()=> 'token-1'});expect(await route.configureConnection({id:secure.id,model:secure.model,transport:secure.transport})).toEqual(secure);expect(await route.connectionStatus(secure.id)).toMatchObject({connected:true,status:'idle',media:{printerState:'idle'}})});
it('validates, streams SSE progress, and cancels using authenticated service routes',async()=>{const calls:string[]=[];const completed={id:'job-1',state:'completed',terminal:true,outcome:'completed',lastCompletedAction:1,bytesSent:24,action:2,actions:2,totalBytes:24,phase:'completed',error:null};const fetch=vi.fn(async(url:string,init?:RequestInit)=>{calls.push(`${init?.method??'GET'} ${url}`);expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');if(url.endsWith('/documents/validate'))return new Response(JSON.stringify({valid:true,errors:[]}));if(url.endsWith('/events'))return new Response(`event: progress\ndata: ${JSON.stringify({...completed,state:'running',terminal:false,outcome:null,action:1,phase:'running'})}\n\nevent: progress\ndata: ${JSON.stringify(completed)}\n\n`,{headers:{'content-type':'text/event-stream'}});return new Response(JSON.stringify({...completed,state:'cancel-requested',terminal:false,outcome:null,phase:'cancelrequested'}))});vi.stubGlobal('fetch',fetch);const route=new LocalApiPrintRoute({token:()=> 'token-1'});expect(await route.validate(defaultDocument())).toEqual({valid:true,errors:[]});const progress:unknown[]=[];expect(await route.events('job-1',value=>progress.push(value))).toEqual({outcome:'completed',lastCompletedAction:1,bytesSent:24,error:undefined});expect(progress).toHaveLength(2);expect((await route.cancel('job-1')).outcome).toBe('outcome-unknown');expect(calls).toEqual(['POST http://127.0.0.1:9847/v1/documents/validate','GET http://127.0.0.1:9847/v1/jobs/job-1/events','POST http://127.0.0.1:9847/v1/jobs/job-1/cancel'])});

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
  expect(calls).toEqual([
    'http://127.0.0.1:9847/v1/pair',
    'http://127.0.0.1:9847/v1/pair'
  ]);
});

it('persists and reuses the exact local submission after an ambiguous POST', async () => {
  const database = new EditorDatabase();
  const journal = new JobJournal(database);
  const document = defaultDocument();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection lost'); }));
  const route = new LocalApiPrintRoute({ token: () => 'token-1', connection: () => connection, journal });
  expect((await route.print({ document, printer, copies: 2 })).outcome).toBe('outcome-unknown');
  const persisted = (await journal.recover()).find((job) => job.documentId === document.id)!;
  expect(isLocalApiJobDetails(persisted.details)).toBe(true);
  if (!isLocalApiJobDetails(persisted.details)) throw new Error('missing local snapshot');
  const snapshot = persisted.details;
  const submitted = { id: 'job-recovered', state: 'completed', terminal: true, outcome: 'completed', lastCompletedAction: 1, bytesSent: 20, action: 2, actions: 2, totalBytes: 20, phase: 'completed' };
  const resumed = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(snapshot.idempotencyKey);
    expect(init?.body).toBe(snapshot.requestBody);
    return new Response(JSON.stringify(submitted), { status: 200 });
  });
  vi.stubGlobal('fetch', resumed);
  expect(await route.recover(persisted)).toMatchObject({ outcome: 'completed', bytesSent: 20 });
  expect(resumed).toHaveBeenCalledOnce();
});
