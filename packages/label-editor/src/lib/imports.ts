// SPDX-License-Identifier: AGPL-3.0-or-later
import {sha256} from './files.js';import {uuid,type FontResource,type Resource} from './model.js';import type {PrinterSdk} from './print/types.js';
const base64=(bytes:Uint8Array)=>{let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary)};
const bytes=(buffer:ArrayBuffer)=>new Uint8Array(buffer.slice(0));
const nativeImageTypes=['image/png','image/jpeg','image/svg+xml'];
/** Decodes any format the browser understands and re-encodes it as PNG, optionally as a 1-bit halftone. */
async function toPng(data:Uint8Array,mimeType:string,halftone:boolean):Promise<Uint8Array>{
  if(typeof createImageBitmap!=='function')throw new Error(`Unsupported asset type: ${mimeType}`);
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(new Blob([data.slice().buffer as ArrayBuffer],{type:mimeType}))}catch{throw new Error(`Unsupported asset type: ${mimeType}`)}
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext('2d');
  if(!context)throw new Error('Canvas is unavailable.');
  context.fillStyle='#fff';context.fillRect(0,0,bitmap.width,bitmap.height);context.drawImage(bitmap,0,0);bitmap.close();
  if(halftone){const image=context.getImageData(0,0,canvas.width,canvas.height);context.putImageData(ditherImage(image),0,0)}
  return new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
}
/** Floyd-Steinberg dithering, so one-bit thermal rendering keeps detail instead of collapsing to black. */
export function ditherImage(image:ImageData):ImageData{
  const{width,height,data}=image;const gray=new Float32Array(width*height);
  for(let index=0;index<width*height;index+=1){const alpha=data[index*4+3]/255;const luma=.299*data[index*4]+.587*data[index*4+1]+.114*data[index*4+2];gray[index]=luma*alpha+255*(1-alpha)}
  const spread=(x:number,y:number,error:number,factor:number)=>{if(x<0||x>=width||y>=height)return;gray[y*width+x]+=error*factor};
  for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){const index=y*width+x;const value=gray[index]<128?0:255;const error=gray[index]-value;gray[index]=value;spread(x+1,y,error,7/16);spread(x-1,y+1,error,3/16);spread(x,y+1,error,5/16);spread(x+1,y+1,error,1/16)}
  for(let index=0;index<width*height;index+=1){data[index*4]=data[index*4+1]=data[index*4+2]=gray[index];data[index*4+3]=255}
  return image;
}
export async function importAsset(file:File,sdk?:PrinterSdk,dpi=300,options?:{halftone?:boolean}):Promise<{resource:Resource;widthMm?:number;heightMm?:number}> {
  let data:Uint8Array=bytes(await file.arrayBuffer());let mimeType=file.type||mimeFromName(file.name);let name=file.name;let widthMm:number|undefined;let heightMm:number|undefined;
  if(mimeType==='application/pdf'){if(!sdk)throw new Error('Offline PDF import requires the installed printer SDK.');const page=await sdk.importFirstPdfPage(data,dpi);data=page.data;mimeType=page.mimeType;widthMm=page.widthMm;heightMm=page.heightMm}
  if(mimeType==='image/svg+xml'){const source=new TextDecoder().decode(data);if(/(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(source)||/<script\b/i.test(source))throw new Error('SVG must not contain scripts or external resources.')}
  if(!mimeType.startsWith('image/'))throw new Error(`Unsupported asset type: ${mimeType}`);
  const halftone=!!options?.halftone&&mimeType!=='image/svg+xml';
  if(halftone||!nativeImageTypes.includes(mimeType)){data=await toPng(data,mimeType,halftone);mimeType='image/png'}
  if(mimeType==='image/png')name=name.replace(/\.[^.]+$/,'.png');
  const digest=await sha256(new Uint8Array(data).buffer);
  return{resource:{id:uuid(),name,mimeType,sha256:digest,data:base64(data)},widthMm,heightMm};
}
const fontTypes=['font/woff','font/woff2','font/ttf','font/otf','font/collection','application/font-sfnt'];
/** Catalogues commonly serve font files as `application/octet-stream`, so fall back to the name and then to the sfnt signature. */
export function fontMimeType(data:Uint8Array,name='',declared=''):string|undefined{
  if(fontTypes.includes(declared))return declared;
  const named=mimeFromName(name);
  if(fontTypes.includes(named))return named;
  const tag=String.fromCharCode(...data.subarray(0,4));
  if(tag==='wOFF')return 'font/woff';
  if(tag==='wOF2')return 'font/woff2';
  if(tag==='OTTO')return 'font/otf';
  if(tag==='ttcf')return 'font/collection';
  if(tag==='true'||tag==='\u0000\u0001\u0000\u0000')return 'font/ttf';
  return undefined;
}
export async function importFont(file:File,details?:{family?:string;weight?:number;style?:'normal'|'italic'}):Promise<FontResource>{const data=bytes(await file.arrayBuffer());const mimeType=fontMimeType(data,file.name,file.type);if(!mimeType)throw new Error(`Unsupported font type: ${file.type||mimeFromName(file.name)}`);return{id:uuid(),name:file.name,mimeType,sha256:await sha256(new Uint8Array(data).buffer),data:base64(data),family:details?.family??file.name.replace(/\.[^.]+$/,''),weight:details?.weight??400,style:details?.style??'normal'}}
const mimeFromName=(name:string)=>{const extension=name.split('.').pop()?.toLowerCase();return({svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',ttc:'font/collection'} as Record<string,string>)[extension??'']??'application/octet-stream'};
