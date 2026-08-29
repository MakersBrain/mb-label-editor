<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { moveElements, resizeElement, rotateElements } from '../commands.js';
  import { mediaBounds, snapMove } from '../snapping.js';
  import {GestureTracker}from'../gestures.js';
  import type { EditorStore } from '../store.js';
  import type{PrinterSdk}from'../print/types.js';import ThermalPreview from'./ThermalPreview.svelte';
  import type { LabelElement, Point } from '../model.js';
  export let editor: EditorStore;
  export let sdk:PrinterSdk|undefined=undefined;
  let drag: { kind: 'move' | 'resize' | 'rotate'; at: Point; current: Point; ids: string[]; element?: LabelElement } | undefined;
  const pxPerMm = 3.7795275591;
  const gestures=new GestureTracker();
  function startDrag(event: PointerEvent, element: LabelElement) {
    if (element.locked) return; const target = event.currentTarget as HTMLElement; target.setPointerCapture(event.pointerId);
    let ids = [element.id]; editor.selection.subscribe((current) => { ids = current.has(element.id) ? [...current] : event.shiftKey ? [...current, element.id] : [element.id]; })();
    editor.select([element.id], event.shiftKey); drag = { kind: 'move', at: { x: event.clientX, y: event.clientY }, current: { x: event.clientX, y: event.clientY }, ids }; event.stopPropagation();
  }
  function startHandle(event: PointerEvent, kind: 'resize' | 'rotate', element: LabelElement) { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag = { kind, at: {x:event.clientX,y:event.clientY}, current:{x:event.clientX,y:event.clientY}, ids:[element.id], element:structuredClone(element) }; event.stopPropagation(); }
  function gestureStart(event:PointerEvent){if(event.target!==event.currentTarget&&!(event.target as HTMLElement).classList.contains('media'))return;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);gestures.start(event.pointerId,{x:event.clientX,y:event.clientY})}
  function moveDrag(event: PointerEvent) { if (!drag){const update=gestures.move(event.pointerId,{x:event.clientX,y:event.clientY});if(update)editor.setView({zoom:Math.max(.25,Math.min(4,$editor.view.zoom*update.zoomFactor)),pan:{x:$editor.view.pan.x+update.panDelta.x,y:$editor.view.pan.y+update.panDelta.y}});return} drag = {...drag,current:{x:event.clientX,y:event.clientY}}; if(drag.kind==='move'&&$editor.view.snapping){const raw={x:(event.clientX-drag.at.x)/pxPerMm/$editor.view.zoom,y:(event.clientY-drag.at.y)/pxPerMm/$editor.view.zoom};const result=snapMove($editor.document.elements,new Set(drag.ids),raw,mediaBounds($editor.document),{grid:$editor.view.gridSize,gridEnabled:$editor.view.showGrid,threshold:1.25/$editor.view.zoom,guides:$editor.view.manualGuides});editor.setView({guides:result.guides})} }
  function gestureEnd(event:PointerEvent){gestures.end(event.pointerId)}
  function finishDrag(event: PointerEvent) { if (!drag) return; let zoom = 1; editor.view.subscribe((value) => { zoom = value.zoom; })();
    const raw = { x: (event.clientX - drag.at.x) / pxPerMm / zoom, y: (event.clientY - drag.at.y) / pxPerMm / zoom };
    if (drag.kind === 'move') { const snapped = $editor.view.snapping ? snapMove($editor.document.elements,new Set(drag.ids),raw,mediaBounds($editor.document),{grid:$editor.view.gridSize,gridEnabled:$editor.view.showGrid,threshold:1.25/$editor.view.zoom,guides:$editor.view.manualGuides}) : {delta:raw,guides:[]}; if(snapped.delta.x||snapped.delta.y)editor.execute(moveElements(drag.ids,snapped.delta)); editor.setView({guides:[]}); }
    else if (drag.kind === 'resize' && drag.element) {const width=Math.max(.1,drag.element.transform.width+raw.x);const preserve=event.shiftKey||drag.element.constraints?.some(item=>item.kind==='aspect');editor.execute(resizeElement(drag.element.id,{width,height:preserve?width/(drag.element.transform.width/drag.element.transform.height):drag.element.transform.height+raw.y}));}
    else if (drag.kind === 'rotate' && drag.element) { const center={x:drag.element.transform.x+drag.element.transform.width/2,y:drag.element.transform.y+drag.element.transform.height/2}; const page=(event.currentTarget as HTMLElement).closest('.media')!.getBoundingClientRect(); const degrees=Math.atan2(event.clientY-page.top-center.y*pxPerMm*zoom,event.clientX-page.left-center.x*pxPerMm*zoom)*180/Math.PI+90; editor.execute(rotateElements([drag.element.id],event.shiftKey?Math.round(degrees/15)*15:degrees)); }
    drag = undefined;
  }
  const styleFor = (element: LabelElement) => `left:${element.transform.x * pxPerMm}px;top:${element.transform.y * pxPerMm}px;width:${element.transform.width * pxPerMm}px;height:${element.transform.height * pxPerMm}px;transform:rotate(${element.transform.rotation}deg);z-index:${element.zIndex}`;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="viewport" class:with-rulers={$editor.view.showRulers} on:click={() => editor.clearSelection()} on:pointerdown={gestureStart} on:pointermove={moveDrag} on:pointerup={gestureEnd} on:pointercancel={gestureEnd} role="application" aria-label="Label canvas">
  {#if $editor.view.showRulers}<div class="ruler horizontal"></div><div class="ruler vertical"></div>{/if}
  <div class="pan" style={`transform:translate(calc(-50% + ${$editor.view.pan.x}px),calc(-50% + ${$editor.view.pan.y}px)) scale(${$editor.view.zoom})`}>
    <div class:grid={$editor.view.showGrid} class="media" style={`width:${$editor.document.media.width * pxPerMm}px;height:${$editor.document.media.height * pxPerMm}px;--grid:${$editor.view.gridSize * pxPerMm}px;border-radius:${$editor.document.media.shape === 'round' ? '50%' : '3px'}`}>
      {#if sdk}<ThermalPreview {sdk} document={$editor.document}/>{/if}
      {#each [...$editor.document.elements].sort((a,b) => a.zIndex - b.zIndex) as element (element.id)}
        {#if element.visible && element.type !== 'group'}
          <button type="button" class:selected={$editor.selection.has(element.id)} class:locked={element.locked} class:exact={!!sdk} class="element {element.type}" style={styleFor(element)} on:pointerdown={(event) => startDrag(event, element)} on:pointerup={finishDrag} aria-label={element.name}>
            {#if element.type === 'text'}<span style={`font-family:${element.fontFamily};font-size:${element.fontSize}px;text-align:${element.horizontalAlign}`}>{element.text}</span>
            {:else if element.type === 'barcode'}<span class="placeholder">▥ {element.value}</span>
            {:else if element.type === 'qr'}<span class="placeholder">▦</span>
            {:else if element.type === 'image' || element.type === 'svg'}<span class="placeholder">Image</span>
            {:else}<span class="placeholder">{element.type}</span>{/if}
            {#if $editor.selection.has(element.id) && !element.locked}<i class="handle resize" role="presentation" on:pointerdown={(event)=>startHandle(event,'resize',element)} on:pointerup={finishDrag}></i><i class="handle rotate" role="presentation" on:pointerdown={(event)=>startHandle(event,'rotate',element)} on:pointerup={finishDrag}>↻</i>{/if}
          </button>
        {/if}
      {/each}
      {#each [...$editor.view.manualGuides,...$editor.view.guides] as guide}<div class="guide {guide.axis}" style={`${guide.axis === 'x' ? 'left' : 'top'}:${guide.value * pxPerMm}px`}></div>{/each}
    </div>
  </div>
</div>

<style>
  .viewport{position:absolute;inset:0;overflow:hidden;min-width:0;min-height:0;background:#d8ddd8;touch-action:none}.pan{position:absolute;left:50%;top:50%;transform-origin:center}.media{position:relative;background:#fff;box-shadow:0 8px 28px #17231c33;overflow:hidden}.media.grid{background-image:linear-gradient(#1c66471c 1px,transparent 1px),linear-gradient(90deg,#1c66471c 1px,transparent 1px);background-size:var(--grid) var(--grid)}
  .element{position:absolute;margin:0;padding:0;overflow:visible;border:1px dashed transparent;background:transparent;color:#111;transform-origin:center;cursor:move}.element.selected{border-color:#ed6146;outline:1px solid white}.element.locked{cursor:not-allowed}.element span{display:flex;width:100%;height:100%;align-items:center;justify-content:center;overflow:hidden}.handle{position:absolute;display:block;width:8px;height:8px;background:white;border:1px solid #ed6146;z-index:20}.handle.resize{right:-5px;bottom:-5px;cursor:nwse-resize}.handle.rotate{top:-18px;left:calc(50% - 5px);cursor:grab;font-size:9px;line-height:8px;color:#17231c}.rectangle,.ellipse,.triangle{border:1px solid #111}.ellipse{border-radius:50%}.triangle{clip-path:polygon(50% 0,100% 100%,0 100%);background:#111}.line{height:1px!important;background:#111}.placeholder{font-size:10px}.ruler{position:absolute;background:#f7f4ed;z-index:3}.ruler.horizontal{height:20px;left:20px;right:0;border-bottom:1px solid #aaa}.ruler.vertical{width:20px;top:20px;bottom:0;border-right:1px solid #aaa}.guide{position:absolute;background:#46a8ed;pointer-events:none}.guide.x{top:0;bottom:0;width:1px}.guide.y{left:0;right:0;height:1px}
  .element.exact:not(.selected) span{visibility:hidden}
  .ruler.horizontal{background-image:repeating-linear-gradient(90deg,transparent 0 18px,#59635e 18px 19px,transparent 19px 37.795px)}
  .ruler.vertical{background-image:repeating-linear-gradient(transparent 0 18px,#59635e 18px 19px,transparent 19px 37.795px)}
</style>
