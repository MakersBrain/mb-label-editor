// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe,expect,it } from 'vitest';
import { addElement,alignElements,defaultDocument,distributeElements,DocumentHistory,groupElements,moveElements,removeElements,type LabelElement } from '../src/index.js';
const shape=(id:string,x:number):LabelElement=>({id,name:id,type:'rectangle',transform:{x,y:1,width:5,height:5,rotation:0},zIndex:x,visible:true,locked:false,strokeWidth:.2,filled:false});
describe('editor commands and history',()=>{
  it('undoes and redoes immutable edits',()=>{const original=defaultDocument('2026-01-01T00:00:00Z');const history=new DocumentHistory(original);history.execute(addElement(shape('a',2)));history.execute(moveElements(['a'],{x:3,y:4}));expect(history.document.elements[0].transform.x).toBe(5);expect(history.undo().document.elements[0].transform.x).toBe(2);expect(history.redo().document.elements[0].transform.x).toBe(5);expect(original.elements).toHaveLength(0)});
  it('aligns, distributes, groups, and removes selections',()=>{let doc=defaultDocument();doc.elements=[shape('a',0),shape('b',10),shape('c',30)];doc=alignElements(['a','b','c'],'top').apply(doc);doc=distributeElements(['a','b','c'],'horizontal').apply(doc);expect(doc.elements[1].transform.x).toBe(15);doc=groupElements(['a','b']).apply(doc);const group=doc.elements.find(item=>item.type==='group');expect(group&&group.type==='group'&&group.childIds).toEqual(['a','b']);doc=removeElements(['a']).apply(doc);expect(doc.elements.some(item=>item.id==='a')).toBe(false)});
});
