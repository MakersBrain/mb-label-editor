// SPDX-License-Identifier: AGPL-3.0-or-later
import { executePlan } from '@makersbrain/printer-sdk/node';
import {describe,expect,it,vi} from 'vitest';import {adaptSdkProtocolPlan,ContinuousPrintError,DeviceError,DirectPrintRoute,defaultDocument,executeBatch,inspectLaPosteSheet,resolveContinuousDocument,sdkPlanExecutor,selectedDocuments,validateContinuousPrintOptions,type DirectTransport,type PrinterDefinition,type PrinterSdk,type ProtocolPlan} from '../src/index.js';
const printer:PrinterDefinition={id:'p',displayName:'P',dpi:203,protocols:['test'],media:{minWidth:1,maxWidth:100,minHeight:1,maxHeight:100}};
const sdk=(plan?:ProtocolPlan):PrinterSdk=>({validateCanonical:vi.fn(),validate:vi.fn(),render:vi.fn(),exportPng:vi.fn(),exportPdf:vi.fn(),printerDefinitions:async()=>[printer],importFirstPdfPage:vi.fn(),plan:async()=>plan!,executePlan:sdkPlanExecutor(executePlan),inspectLaPoste:vi.fn(),laPosteSlotDocument:vi.fn()});
it('classifies a rejected first write as potentially accepted',async()=>{const transport:DirectTransport={kind:'usb',physicalWriteLimit:64,connect:async()=>{},disconnect:async()=>{},write:async()=>{throw new Error('transfer status unavailable')},subscribe:async()=>{},waitResponse:async()=>new Uint8Array([1])};const route=new DirectPrintRoute(sdk({protocol:'m-series',totalBytes:1,actions:[{type:'write',data:new Uint8Array([1]),chunkable:false,atomic:true,logicalChunkSize:64,delayAfterMs:0}]}),async()=>transport,'usb');const result=await route.print({document:defaultDocument(),printer,copies:1});expect(result.outcome).toBe('outcome-unknown');expect(result.bytesSent).toBe(0)});
describe('printing',()=>{it('serializes and physically chunks direct writes',async()=>{const writes:number[]=[];const transport:DirectTransport={kind:'bluetooth',physicalWriteLimit:4,negotiatedAttMtu:7,connect:async()=>{},disconnect:async()=>{},write:async data=>{writes.push(data.length)},subscribe:async()=>{},waitResponse:async()=>new Uint8Array()};const route=new DirectPrintRoute(sdk({protocol:'m-series',totalBytes:10,actions:[{type:'write',data:new Uint8Array(10),chunkable:true,atomic:false,logicalChunkSize:8,delayAfterMs:0}]}),async()=>transport,'bluetooth');const result=await route.print({document:defaultDocument(),printer,copies:1});expect(result.outcome).toBe('completed');expect(writes).toEqual([4,4,2])});it('marks an ambiguous accepted write as outcome unknown',async()=>{let count=0;const transport:DirectTransport={kind:'usb',physicalWriteLimit:4,connect:async()=>{},disconnect:async()=>{},write:async()=>{if(count++)throw new Error('gone')},subscribe:async()=>{},waitResponse:async()=>new Uint8Array()};const route=new DirectPrintRoute(sdk({protocol:'m-series',totalBytes:8,actions:[{type:'write',data:new Uint8Array(8),chunkable:true,atomic:false,logicalChunkSize:4,delayAfterMs:0}]}),async()=>transport,'usb');expect((await route.print({document:defaultDocument(),printer,copies:1})).outcome).toBe('outcome-unknown')})});
it('keeps Brother USB commands whole, chunks raster at 64 bytes, and tolerates absent status',async()=>{const writes:number[]=[];const transport:DirectTransport={kind:'usb',physicalWriteLimit:64,commandWriteLimit:1024,connect:async()=>{},disconnect:async()=>{},write:async data=>{writes.push(data.length)},subscribe:async()=>{},waitResponse:async()=>{throw new DeviceError('response-timeout','no status')}};const route=new DirectPrintRoute(sdk({protocol:'brother',totalBytes:330,actions:[{type:'write',data:new Uint8Array(200),chunkable:false,atomic:true,logicalChunkSize:200,delayAfterMs:0},{type:'wait-response',channel:'printer',timeoutMs:1,validate:'brother-status32'},{type:'write',data:new Uint8Array(130),chunkable:true,atomic:false,logicalChunkSize:1024,delayAfterMs:0}]}),async()=>transport,'usb');const result=await route.print({document:defaultDocument(),printer,copies:1});expect(result.outcome).toBe('completed');expect(writes).toEqual([200,64,64,2])});
it('adapts sibling SDK action names without losing pacing',()=>{const plan=adaptSdkProtocolPlan('m-series',[{action:'raster-write',bytes:[1,2,3],logical_chunk:128,delay_after_each_physical_write_ms:20},{action:'wait-for-response',timeout_ms:500,fallback_delay_ms:500,validation:'any-notification'}]);expect(plan.totalBytes).toBe(3);expect(plan.actions).toEqual([{type:'write',data:new Uint8Array([1,2,3]),chunkable:true,atomic:false,logicalChunkSize:128,delayAfterMs:20},{type:'wait-response',channel:'printer',timeoutMs:500,fallbackDelayMs:500,validate:'any-notification'}])});
describe('La Poste workflow',()=>{it('normalizes SHEET and preserves slot order',async()=>{const fake=sdk();fake.inspectLaPoste=async(_,format)=>{expect(format).toBe('L24A_SHEET');return [{id:'b',sourcePage:2,slot:1,occupied:true,widthMm:63.5,heightMm:33.9,preview:{width:1,height:1,rgba:new Uint8Array()}},{id:'a',sourcePage:1,slot:3,occupied:true,widthMm:63.5,heightMm:33.9,preview:{width:1,height:1,rgba:new Uint8Array()}}]};fake.laPosteSlotDocument=async(_,__,slot)=>({...defaultDocument(),id:slot.id});const inspection=await inspectLaPosteSheet(fake,new Uint8Array(),'SHEET');expect((await selectedDocuments(fake,inspection)).map(doc=>doc.id)).toEqual(['a','b'])})});
it('queries printer status through the status plan and decodes the reply',async()=>{const writes:number[][]=[];const reply=new Uint8Array(32);reply.set([0x80,0x20,0x42]);reply[10]=62;reply[11]=0x0b;reply[17]=29;const transport:DirectTransport={kind:'usb',physicalWriteLimit:64,commandWriteLimit:1024,connect:async()=>{},disconnect:async()=>{},write:async data=>{writes.push([...data])},subscribe:async()=>{},waitResponse:async()=>reply};
  const fake=sdk();fake.statusPlan=async()=>({protocol:'brother',totalBytes:3,actions:[{type:'write',data:new Uint8Array([0x1b,0x69,0x53]),chunkable:false,atomic:true,logicalChunkSize:3,delayAfterMs:0},{type:'wait-response',channel:'printer',timeoutMs:3000,validate:'brother-status32'}]});
  fake.parseStatus=async(definition,frames)=>{const data=frames[frames.length-1];return{protocol:'brother',mediaWidthMm:data[10],mediaLengthMm:data[17],mediaType:'die-cut',errors:[],raw:frames}};
  const route=new DirectPrintRoute(fake,async()=>transport,'usb');
  const status=await route.queryStatus(printer);
  expect(writes).toEqual([[0x1b,0x69,0x53]]);expect(status.mediaWidthMm).toBe(62);expect(status.mediaLengthMm).toBe(29)});
it('reports a missing status reply instead of silently succeeding',async()=>{const transport:DirectTransport={kind:'usb',physicalWriteLimit:64,commandWriteLimit:1024,connect:async()=>{},disconnect:async()=>{},write:async()=>{},subscribe:async()=>{},waitResponse:async()=>{throw new DeviceError('response-timeout','no status')}};
  const fake=sdk();fake.statusPlan=async()=>({protocol:'brother',totalBytes:3,actions:[{type:'write',data:new Uint8Array([0x1b,0x69,0x53]),chunkable:false,atomic:true,logicalChunkSize:3,delayAfterMs:0},{type:'wait-response',channel:'printer',timeoutMs:5,validate:'brother-status32'}]});
  fake.parseStatus=async()=>({protocol:'brother',errors:[],raw:[]});
  const route=new DirectPrintRoute(fake,async()=>transport,'usb');
  await expect(route.queryStatus(printer)).rejects.toThrow(/did not return a status reply/)});
it('collects one frame per Phomemo query and tolerates the ones that go unanswered',async()=>{const answers=new Map([[0x08,[0x1a,0x04,0xa2]],[0x11,[0x1a,0x06,0x88]]]);let pending:number[]|undefined;
  const transport:DirectTransport={kind:'bluetooth',physicalWriteLimit:20,connect:async()=>{},disconnect:async()=>{},write:async data=>{pending=answers.get(data[2])},subscribe:async()=>{},waitResponse:async()=>{const reply=pending;pending=undefined;if(!reply)throw new DeviceError('response-timeout','no notification');return Uint8Array.from(reply)}};
  const fake=sdk();fake.statusPlan=async()=>({protocol:'m110',totalBytes:9,actions:[{type:'subscribe',channel:'printer'},...[0x08,0x12,0x11].flatMap(code=>[{type:'write',data:new Uint8Array([0x1f,0x11,code]),chunkable:false,atomic:true,logicalChunkSize:3,delayAfterMs:0},{type:'wait-response',channel:'printer',timeoutMs:800,fallbackDelayMs:100,validate:'phomemo-notification'}] as const)]});
  fake.parseStatus=async(_,frames)=>({protocol:'m110',battery:frames.length,errors:[],raw:frames});
  const route=new DirectPrintRoute(fake,async()=>transport,'bluetooth');
  expect((await route.queryStatus(printer)).battery).toBe(2)});
it('paces a raster after every physical transport fragment',async()=>{vi.useFakeTimers();const writes:number[]=[];const transport:DirectTransport={kind:'bluetooth',physicalWriteLimit:20,connect:async()=>{},disconnect:async()=>{},write:async data=>{writes.push(data.length)},subscribe:async()=>{},waitResponse:async()=>new Uint8Array()};
  const route=new DirectPrintRoute(sdk({protocol:'m110',totalBytes:256,actions:[{type:'write',data:new Uint8Array(256),chunkable:true,atomic:false,logicalChunkSize:128,delayAfterMs:40}]}),async()=>transport,'bluetooth');
  const printing=route.print({document:defaultDocument(),printer,copies:1});
  await vi.runAllTimersAsync();
  expect((await printing).outcome).toBe('completed');
  // Two 128-byte logical chunks become seven 20-byte writes each. The SDK
  // applies the reference delay to all fourteen physical fragments.
  expect(writes.length).toBe(14);
  expect(performance.now()).toBe(560);vi.useRealTimers()});
it('asks for a streamed plan on serial and a paced one on bluetooth',async()=>{const asked:Record<string,unknown>[]=[];
  const transport=(kind:'serial'|'bluetooth'):DirectTransport=>({kind,physicalWriteLimit:64,connect:async()=>{},disconnect:async()=>{},write:async()=>{},subscribe:async()=>{},waitResponse:async()=>new Uint8Array()});
  const fake=sdk();fake.plan=async(_document,_printer,options)=>{asked.push(options);return{protocol:'m110',totalBytes:0,actions:[]}};
  await new DirectPrintRoute(fake,async()=>transport('serial'),'serial').print({document:defaultDocument(),printer,copies:1});
  await new DirectPrintRoute(fake,async()=>transport('bluetooth'),'bluetooth').print({document:defaultDocument(),printer,copies:1,compressRaster:true});
  expect(asked[0]).toMatchObject({streaming:true,lzo:undefined});
  expect(asked[1]).toMatchObject({streaming:false,lzo:true})});
it('reuses one explicit connection for status and printing until disconnect',async()=>{const connect=vi.fn(async()=>{});const disconnect=vi.fn(async()=>{});const reply=new Uint8Array(32);reply.set([0x80,0x20,0x42]);const transport:DirectTransport={kind:'serial',physicalWriteLimit:512,connect,disconnect,write:async()=>{},subscribe:async()=>{},waitResponse:async()=>reply};const fake=sdk({protocol:'brother',totalBytes:0,actions:[]});fake.statusPlan=async()=>({protocol:'brother',totalBytes:0,actions:[{type:'wait-response',channel:'printer',timeoutMs:100,validate:'brother-status32'}]});fake.parseStatus=async(_printer,frames)=>({protocol:'brother',errors:[],raw:frames});const route=new DirectPrintRoute(fake,async()=>transport,'serial');await route.connect();expect(route.connected).toBe(true);await route.queryStatus(printer);await route.print({document:defaultDocument(),printer,copies:1});expect(connect).toHaveBeenCalledOnce();expect(disconnect).not.toHaveBeenCalled();await route.disconnect();expect(route.connected).toBe(false);expect(disconnect).toHaveBeenCalledOnce()});

it('stops a shared batch immediately on an ambiguous outcome', async () => {
  const print = vi.fn()
    .mockResolvedValueOnce({ outcome: 'completed', lastCompletedAction: 1, bytesSent: 10 })
    .mockResolvedValueOnce({ outcome: 'outcome-unknown', lastCompletedAction: 0, bytesSent: 2 });
  const route = { id: 'test', label: 'Test', isSupported: () => true, print };
  const result = await executeBatch({ documents: [defaultDocument(), defaultDocument(), defaultDocument()], route, printer, copies: 1 });
  expect(result).toMatchObject({ completed: 1, result: { outcome: 'outcome-unknown' } });
  expect(print).toHaveBeenCalledTimes(2);
});

it('never emulates cut-after-job with separate print jobs', async () => {
  const print = vi.fn();
  const route = { id: 'test', label: 'Test', isSupported: () => true, print };
  await expect(executeBatch({ documents: [defaultDocument(), defaultDocument()], route, printer, copies: 1, continuous: { cutMode: 'after-job', extraFeedBeforeMm: 0, extraFeedAfterMm: 0, chainCopies: false } })).rejects.toThrow(/native batch support/i);
  expect(print).not.toHaveBeenCalled();
});

it('uses stable capability error codes before continuous bytes can be sent', () => {
  const document=defaultDocument();document.media.shape='continuous';
  const resolved=resolveContinuousDocument(document).document;
  const options={cutMode:'after-job' as const,extraFeedBeforeMm:0,extraFeedAfterMm:0,chainCopies:false};
  expect(()=>validateContinuousPrintOptions(resolved,printer,options)).toThrowError(expect.objectContaining({code:'continuous.unsupported_printer'} satisfies Partial<ContinuousPrintError>));
  expect(()=>validateContinuousPrintOptions(resolved,printer,undefined)).toThrowError(expect.objectContaining({code:'continuous.unsupported_printer'} satisfies Partial<ContinuousPrintError>));
  const continuousPrinter:PrinterDefinition={...printer,continuousMedia:{supported:true,minimumLengthMm:.1,maximumLengthMm:100,minimumExtraFeedMm:0,maximumExtraFeedMm:0,cutModes:['after-each'],automaticCutter:true,supportsChainedRaster:false}};
  expect(()=>validateContinuousPrintOptions(resolved,continuousPrinter,options)).toThrowError(expect.objectContaining({code:'continuous.cut_mode_unsupported'} satisfies Partial<ContinuousPrintError>));
  expect(()=>validateContinuousPrintOptions(resolved,continuousPrinter,{...options,cutMode:'after-each',extraFeedAfterMm:1})).toThrowError(expect.objectContaining({code:'continuous.feed_out_of_range'} satisfies Partial<ContinuousPrintError>));
});

it('uses the stable native-batch route error code', async () => {
  const route = { id: 'test', label: 'Test', isSupported: () => true, print: vi.fn() };
  await expect(executeBatch({documents:[defaultDocument()],route,printer,copies:1,continuous:{cutMode:'after-job',extraFeedBeforeMm:0,extraFeedAfterMm:0,chainCopies:false}})).rejects.toMatchObject({code:'continuous.batch_route_unsupported'});
});

it('uses one native route call when batch support is available', async () => {
  const print = vi.fn();
  const printBatch = vi.fn(async () => ({ outcome: 'completed' as const, lastCompletedAction: 4, bytesSent: 80 }));
  const route = { id: 'native', label: 'Native', isSupported: () => true, print, printBatch };
  const documents = [defaultDocument(), defaultDocument()];
  const result = await executeBatch({ documents, route, printer, copies: 1, continuous: { cutMode: 'after-job', extraFeedBeforeMm: 0, extraFeedAfterMm: 0, chainCopies: false } });
  expect(result.completed).toBe(2);
  expect(printBatch).toHaveBeenCalledOnce();
  expect(print).not.toHaveBeenCalled();
});

it('direct native batch asks the SDK for one plan and executes it once',async()=>{
  const transport:DirectTransport={kind:'usb',physicalWriteLimit:64,commandWriteLimit:64,connect:async()=>{},disconnect:async()=>{},write:async()=>{},subscribe:async()=>{},waitResponse:async()=>new Uint8Array()};
  const fake=sdk();let plannedHeights:number[]=[];const planBatch=vi.fn(async(documents:Parameters<NonNullable<PrinterSdk['planBatch']>>[0])=>{plannedHeights=documents.map(document=>document.media.height);return{protocol:'brother',totalBytes:1,actions:[{type:'write' as const,data:new Uint8Array([1]),chunkable:false,atomic:true,logicalChunkSize:1,delayAfterMs:0}]}});fake.planBatch=planBatch;
  const route=new DirectPrintRoute(fake,async()=>transport,'usb');const second=defaultDocument();second.media.height=45;second.media.printableBounds.height=45;const documents=[defaultDocument(),second];
  expect((await route.printBatch!({documents,printer,copies:1})).outcome).toBe('completed');expect(planBatch).toHaveBeenCalledOnce();expect(plannedHeights).toEqual([30,45]);
});

it('direct native batch reports document and copy coordinates with action bytes',async()=>{
  const transport:DirectTransport={kind:'usb',physicalWriteLimit:64,commandWriteLimit:64,connect:async()=>{},disconnect:async()=>{},write:async()=>{},subscribe:async()=>{},waitResponse:async()=>new Uint8Array()};
  const actions=Array.from({length:4},()=>[{action:'command-write' as const,name:'ESC i z print information',bytes:[1],atomic:true},{action:'command-write' as const,name:'print',bytes:[2],atomic:true}]).flat();
  const plan=adaptSdkProtocolPlan('brother',actions);const fake=sdk();fake.planBatch=async()=>plan;
  const progress:{item:number;copy:number;current:{bytesSent:number}}[]=[];const route=new DirectPrintRoute(fake,async()=>transport,'usb');
  expect((await route.printBatch!({documents:[defaultDocument(),defaultDocument()],printer,copies:2,onProgress:value=>progress.push(value)})).outcome).toBe('completed');
  expect(progress).toEqual(expect.arrayContaining([expect.objectContaining({item:0,copy:0}),expect.objectContaining({item:0,copy:1}),expect.objectContaining({item:1,copy:0}),expect.objectContaining({item:1,copy:1})]));
  expect(progress.at(-1)?.current.bytesSent).toBe(8)
});
