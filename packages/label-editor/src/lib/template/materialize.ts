// SPDX-License-Identifier: AGPL-3.0-or-later
import { cloneDocument, type LabelDocument } from '../model.js'; import { evaluateTemplate } from './evaluate.js';
export function materializeRecord(document: LabelDocument, recordIndex: number, options: { locale?: string; now?: Date } = {}): LabelDocument {
  const record=document.template?.records[recordIndex]; if(!record)throw new Error(`Unknown template record ${recordIndex}`); const result=cloneDocument(document); result.elements.forEach(element=>{if(element.type==='text')element.text=evaluateTemplate(element.text,{record,...options});else if(element.type==='barcode'||element.type==='qr')element.value=evaluateTemplate(element.value,{record,...options})});delete result.template;return result;
}
export function materializeBatch(document: LabelDocument, options: { locale?: string; now?: Date } = {}) { return (document.template?.records??[]).map((_,index)=>materializeRecord(document,index,options)); }
