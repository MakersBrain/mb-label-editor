<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { moveElements, resizeElements, rotateElements, type Command } from '../commands.js';
  import { mediaBounds, snapModeForModifiers, snapMove } from '../snapping.js';
  import { elementRootBounds, elementRootOffset } from '../zones.js';
  import { continuousSettings } from '../continuous-media.js';
  import { prepareDocumentForOutput } from '../output-preparation.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import {GestureTracker}from'../gestures.js';
  import type { EditorStore } from '../store.js';
  import type{PrinterDefinition,PrinterSdk}from'../print/types.js';import ThermalPreview from'./ThermalPreview.svelte';
  import type { Bounds, LabelElement, Point } from '../model.js';
  export let editor: EditorStore;
  export let sdk:PrinterSdk|undefined=undefined;
  export let printer:PrinterDefinition|undefined=undefined;
  export let materializer:Pick<DocumentMaterializer,'materializeRecord'>|undefined=undefined;
  let previewDocument:import('../model.js').LabelDocument|undefined;
  let previewError='';
  let previewWarning='';
  let previewGeneration=0;
  type ResizeHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
  const resizeHandles:ResizeHandle[]=['nw','n','ne','e','se','s','sw','w'];
  let drag: { kind: 'move' | 'resize' | 'rotate'; at: Point; current: Point; ids: string[]; element?: LabelElement; bounds?: Bounds; handle?:ResizeHandle } | undefined;
  let dragPreviewDelta:Point={x:0,y:0};
  /** Document with the in-progress resize or rotation applied, so the canvas shows the result before the pointer is released. */
  let dragPreview:import('../model.js').LabelDocument|undefined;
  let mediaElement:HTMLElement|undefined;
  const pxPerMm = 3.7795275591;
  const gestures=new GestureTracker();
  function startDrag(event: PointerEvent, element: LabelElement) {
    if (element.locked) return; const target = event.currentTarget as HTMLElement; target.setPointerCapture(event.pointerId);
    let ids = [element.id]; editor.selection.subscribe((current) => { ids = current.has(element.id) ? [...current] : event.shiftKey ? [...current, element.id] : [element.id]; })();
    editor.select([element.id], event.shiftKey); dragPreviewDelta={x:0,y:0}; drag = { kind: 'move', at: { x: event.clientX, y: event.clientY }, current: { x: event.clientX, y: event.clientY }, ids }; event.stopPropagation();
  }
  function startResize(event: PointerEvent,handle:ResizeHandle) { if (!selectionBounds) return; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag = { kind:'resize', at:{x:event.clientX,y:event.clientY}, current:{x:event.clientX,y:event.clientY}, ids:[...$editor.selection], bounds:structuredClone(selectionBounds),handle }; event.stopPropagation(); }
  function startRotate(event: PointerEvent, element: LabelElement) { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag = { kind:'rotate', at:{x:event.clientX,y:event.clientY}, current:{x:event.clientX,y:event.clientY}, ids:[element.id], element:structuredClone(element) }; event.stopPropagation(); }
  function gestureStart(event:PointerEvent){if(event.target!==event.currentTarget&&!(event.target as HTMLElement).classList.contains('media'))return;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);gestures.start(event.pointerId,{x:event.clientX,y:event.clientY})}
  function moveDrag(event: PointerEvent) { if (!drag){const update=gestures.move(event.pointerId,{x:event.clientX,y:event.clientY});if(update)editor.setView({zoom:Math.max(.25,Math.min(4,$editor.view.zoom*update.zoomFactor)),pan:{x:$editor.view.pan.x+update.panDelta.x,y:$editor.view.pan.y+update.panDelta.y}});return} drag = {...drag,current:{x:event.clientX,y:event.clientY}}; if(drag.kind==='move'){const raw=dragDelta(event);const result=$editor.view.snapping?snapMove($editor.document.elements,new Set(drag.ids),raw,mediaBounds($editor.document),snapOptions(event),$editor.document):{delta:raw,guides:[]};dragPreviewDelta=result.delta;editor.setView({guides:result.guides})}else{const command=transformCommand(event);dragPreview=command?command.apply($editor.document):undefined} }
  function gestureEnd(event:PointerEvent){gestures.end(event.pointerId)}
  function cancelInteraction(event:PointerEvent){gestures.end(event.pointerId);if(drag?.kind==='move')editor.setView({guides:[]});drag=undefined;dragPreviewDelta={x:0,y:0};dragPreview=undefined}
  function clearSelection(event: MouseEvent) {
    if (!(event.target as Element).closest('.element,.selection-box')) editor.clearSelection();
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    const viewport = event.currentTarget as HTMLElement;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1;
    if (event.shiftKey) {
      const delta = (event.deltaX || event.deltaY) * unit;
      editor.setView({ pan: { x: $editor.view.pan.x - delta, y: $editor.view.pan.y } });
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const delta = (event.deltaY || event.deltaX) * unit;
      editor.setView({ pan: { x: $editor.view.pan.x, y: $editor.view.pan.y - delta } });
      return;
    }
    const delta = (event.deltaY || event.deltaX) * unit;
    const zoom = Math.max(.25, Math.min(4, $editor.view.zoom * Math.exp(-delta * .0015)));
    if (zoom === $editor.view.zoom) return;
    const bounds = viewport.getBoundingClientRect();
    const pointer = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
    const ratio = zoom / $editor.view.zoom;
    editor.setView({
      zoom,
      pan: {
        x: $editor.view.pan.x + (pointer.x - $editor.view.pan.x) * (1 - ratio),
        y: $editor.view.pan.y + (pointer.y - $editor.view.pan.y) * (1 - ratio)
      }
    });
  }
  function finishDrag(event: PointerEvent) { if (!drag) return;
    const raw = dragDelta(event);
    if (drag.kind === 'move') { const snapped = $editor.view.snapping ? snapMove($editor.document.elements,new Set(drag.ids),raw,mediaBounds($editor.document),snapOptions(event),$editor.document) : {delta:raw,guides:[]}; if(snapped.delta.x||snapped.delta.y)editor.execute(moveElements(drag.ids,snapped.delta)); editor.setView({guides:[]}); }
    else { const command=transformCommand(event); if(command)editor.execute(command); }
    drag = undefined; dragPreviewDelta={x:0,y:0}; dragPreview=undefined;
  }
  /** Resize or rotation command for the current pointer position, shared by the live preview and the final commit. */
  function transformCommand(event:PointerEvent):Command|undefined{
    if(!drag)return;
    const raw=dragDelta(event);
    if(drag.kind==='resize'&&drag.bounds&&drag.handle){const selected=$editor.document.elements.filter(item=>drag?.ids.includes(item.id));const constrained=selected.some(item=>item.constraints?.some(value=>value.kind==='aspect'));const preserve=event.shiftKey?!constrained:constrained;return resizeElements(drag.ids,resizedBounds(drag.bounds,raw,preserve,drag.handle))}
    if(drag.kind==='rotate'&&drag.element&&mediaElement){const root=elementRootBounds($editor.document,drag.element);const center={x:root.x+root.width/2,y:root.y+root.height/2};const page=mediaElement.getBoundingClientRect();const degrees=Math.atan2(event.clientY-page.top-center.y*pxPerMm*$editor.view.zoom,event.clientX-page.left-center.x*pxPerMm*$editor.view.zoom)*180/Math.PI+90;return rotateElements([drag.element.id],event.shiftKey?Math.round(degrees/15)*15:degrees)}
    return;
  }
  function movesWithDrag(element:LabelElement):boolean{if(drag?.kind!=='move')return false;const moved=new Set(drag.ids);let current:LabelElement|undefined=element;while(current){if(moved.has(current.id))return true;current=current.groupId?$editor.document.elements.find(item=>item.id===current?.groupId):undefined}return false}
  const styleFor = (element: LabelElement,offset:Point,preview:Point|undefined) => {const delta=preview??{x:0,y:0};return `left:${(element.transform.x+offset.x+delta.x)*pxPerMm}px;top:${(element.transform.y+offset.y+delta.y)*pxPerMm}px;width:${element.transform.width*pxPerMm}px;height:${element.transform.height*pxPerMm}px;transform:rotate(${element.transform.rotation}deg);z-index:${element.zIndex}`};
  const boundsStyle = (bounds:Bounds,preview:Point|undefined) => {const delta=preview??{x:0,y:0};return `left:${(bounds.x+delta.x)*pxPerMm}px;top:${(bounds.y+delta.y)*pxPerMm}px;width:${bounds.width*pxPerMm}px;height:${bounds.height*pxPerMm}px`};
  const dragDelta=(event:Pick<PointerEvent,'clientX'|'clientY'>):Point=>({x:(event.clientX-drag!.at.x)/pxPerMm/$editor.view.zoom,y:(event.clientY-drag!.at.y)/pxPerMm/$editor.view.zoom});
  const snapOptions=(event:PointerEvent)=>({grid:$editor.view.gridSize,gridEnabled:$editor.view.showGrid,threshold:1.25/$editor.view.zoom,guides:$editor.view.manualGuides,zones:$editor.document.media.zones,mode:snapModeForModifiers(event)});
  function resizedBounds(bounds:Bounds,delta:Point,preserve:boolean,handle:ResizeHandle):Bounds{
    const west=handle.includes('w'),east=handle.includes('e'),north=handle.includes('n'),south=handle.includes('s');
    let width=Math.max(.1,bounds.width+(east?delta.x:west?-delta.x:0));let height=Math.max(.1,bounds.height+(south?delta.y:north?-delta.y:0));
    if(preserve){const ratio=bounds.width/bounds.height;if((east||west)&&(north||south)){if(Math.abs((width-bounds.width)/bounds.width)>=Math.abs((height-bounds.height)/bounds.height))height=width/ratio;else width=height*ratio}else if(east||west)height=width/ratio;else if(north||south)width=height*ratio}
    const x=west?bounds.x+bounds.width-width:east?bounds.x:bounds.x+(bounds.width-width)/2;const y=north?bounds.y+bounds.height-height:south?bounds.y:bounds.y+(bounds.height-height)/2;
    return{x,y,width,height};
  }
  function boundsOf(elements:LabelElement[],document=$editor.document):Bounds|undefined{if(!elements.length)return;const roots=elements.map(item=>elementRootBounds(document,item));const x=Math.min(...roots.map(item=>item.x));const y=Math.min(...roots.map(item=>item.y));const right=Math.max(...roots.map(item=>item.x+item.width));const bottom=Math.max(...roots.map(item=>item.y+item.height));return{x,y,width:right-x,height:bottom-y}}
  $: displayDocument=dragPreview??$editor.document;
  $: selectionBounds=boundsOf(displayDocument.elements.filter(item=>$editor.selection.has(item.id)&&!item.locked),displayDocument);
  $: rotateElement=$editor.selectedElements.length===1&&$editor.selectedElements[0].type!=='group'?$editor.selectedElements[0]:undefined;
  $: rollSettings=continuousSettings($editor.document);
  $: { $editor.document; rollSettings.lengthMode; rollSettings.fixedLengthMm; rollSettings.leadingMarginMm; rollSettings.trailingMarginMm; printer?.id; void preparePreview(); }
  $: displayHeight=previewDocument?.media.height??$editor.document.media.height;
  async function preparePreview(){const generation=++previewGeneration;if(!sdk){previewDocument=undefined;previewError='';previewWarning='';return}try{const continuous=printer?.continuousMedia;const prepared=await prepareDocumentForOutput($editor.document,{materializer,measurer:sdk.measure?sdk as import('../continuous-media.js').DocumentMeasurer:undefined},{limits:printer?{minimumLengthMm:continuous?.minimumLengthMm??printer.media.minHeight,maximumLengthMm:continuous?.maximumLengthMm??printer.media.maxHeight,source:'printer',printerModel:printer.id}:undefined});if(generation===previewGeneration){previewDocument=prepared.document;previewError='';const warnings=prepared.warnings.filter(item=>item.severity==='warning').map(item=>item.message);if(rollSettings.lengthMode==='fixed'&&prepared.contentBounds&&prepared.contentBounds.y+prepared.contentBounds.height>prepared.resolvedLengthMm&&!warnings.some(item=>item.includes('fixed cut line')))warnings.push('Visible content extends past the fixed cut line.');previewWarning=warnings.join(' ')}}catch(error){if(generation===previewGeneration){previewDocument=undefined;previewWarning='';previewError=error instanceof Error?error.message:String(error)}}}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="viewport" class:with-rulers={$editor.view.showRulers} on:click={clearSelection} on:wheel|nonpassive={wheel} on:pointerdown={gestureStart} on:pointermove={moveDrag} on:pointerup={gestureEnd} on:pointercancel={cancelInteraction} role="application" aria-label="Label canvas">
  {#if $editor.view.showRulers}<div class="ruler horizontal"></div><div class="ruler vertical"></div>{/if}
  <div class="pan" style={`transform:translate(calc(-50% + ${$editor.view.pan.x}px),calc(-50% + ${$editor.view.pan.y}px)) scale(${$editor.view.zoom})`}>
    <div bind:this={mediaElement} class:grid={$editor.view.showGrid} class:continuous={$editor.document.media.shape==='continuous'} class="media" style={`width:${$editor.document.media.width * pxPerMm}px;height:${displayHeight * pxPerMm}px;--grid:${$editor.view.gridSize * pxPerMm}px;border-radius:${$editor.document.media.shape === 'round' ? '50%' : '3px'}`}>
      {#if $editor.document.media.shape==='continuous'}<div class="safe-margin leading" style={`height:${rollSettings.leadingMarginMm*pxPerMm}px`}></div><div class="safe-margin trailing" style={`height:${rollSettings.trailingMarginMm*pxPerMm}px`}></div><div class="cut-line"><span>Cut at {displayHeight.toFixed(2)} mm</span></div>{/if}
      {#if sdk&&previewDocument}<ThermalPreview {sdk} document={previewDocument} zoom={$editor.view.zoom}/>{:else if previewError}<span class="preview-error" title={previewError}>Fit preview unavailable</span>{/if}
      {#if previewWarning}<span class="preview-warning" role="status" title={previewWarning}>{previewWarning}</span>{/if}
      {#each [...displayDocument.elements].sort((a,b) => a.zIndex - b.zIndex) as element (element.id)}
        {#if element.visible && element.type !== 'group'}
          <button type="button" class:selected={$editor.selection.has(element.id)} class:locked={element.locked} class:exact={!!sdk} class="element {element.type}" style={styleFor(element,elementRootOffset(displayDocument,element),movesWithDrag(element)?dragPreviewDelta:undefined)} on:pointerdown={(event) => startDrag(event, element)} on:pointerup={finishDrag} aria-label={element.name}>
            {#if element.type === 'text'}<span style={`font-family:${element.fontFamily};font-size:${element.fontSize}px;text-align:${element.horizontalAlign}`}>{element.text}</span>
            {:else if element.type === 'barcode'}<span class="placeholder">▥ {element.value}</span>
            {:else if element.type === 'qr'}<span class="placeholder">▦</span>
            {:else if element.type === 'image' || element.type === 'svg'}
              {@const resource = $editor.document.resources.find((item) => item.id === element.resourceId)}
              {#if resource}<img class="asset" style={`object-fit:${element.type === 'image' && element.fit === 'stretch' ? 'fill' : element.type === 'image' && element.fit === 'cover' ? 'cover' : 'contain'};filter:${element.type === 'image' && element.invert ? 'invert(1)' : 'none'}`} alt={element.name} src={`data:${resource.mimeType};base64,${resource.data}`}>{:else}<span class="placeholder">Missing asset</span>{/if}
            {:else}<span class="placeholder">{element.type}</span>{/if}
          </button>
        {/if}
      {/each}
      {#if selectionBounds}<div class="selection-box" style={boundsStyle(selectionBounds,drag?.kind==='move'?dragPreviewDelta:undefined)}>{#each resizeHandles as handle}<i class="handle resize {handle}" role="presentation" title={`Resize ${handle}; hold Shift to toggle aspect ratio`} on:pointerdown={(event)=>startResize(event,handle)} on:pointerup={finishDrag}></i>{/each}{#if rotateElement}<i class="handle rotate" role="presentation" title="Rotate; hold Shift for 15° increments" on:pointerdown={(event)=>startRotate(event,rotateElement!)} on:pointerup={finishDrag}>↻</i>{/if}</div>{/if}
      {#each [...$editor.view.manualGuides,...$editor.view.guides] as guide}<div class="guide {guide.axis}" style={`${guide.axis === 'x' ? 'left' : 'top'}:${guide.value * pxPerMm}px`}></div>{/each}
    </div>
    {#if $editor.document.media.shape==='continuous'}<div class="roll-continuation" style={`top:${displayHeight*pxPerMm}px;width:${$editor.document.media.width*pxPerMm}px`} aria-hidden="true"><span>continuous roll</span></div>{/if}
  </div>
</div>

<style>
  .viewport{position:absolute;inset:0;overflow:hidden;min-width:0;min-height:0;background:var(--mble-surface-sunken,#d8ddd8);touch-action:none}.pan{position:absolute;left:50%;top:50%;transform-origin:center}.media{position:relative;background:#fff;box-shadow:0 8px 28px #17231c33;overflow:hidden}.media.grid{background-image:linear-gradient(#1c66471c 1px,transparent 1px),linear-gradient(90deg,#1c66471c 1px,transparent 1px);background-size:var(--grid) var(--grid)}
  .element{position:absolute;margin:0;padding:0;overflow:visible;border:1px dashed transparent;background:transparent;color:#111;transform-origin:center;cursor:move}.element:hover{background:transparent}.element:not(.selected):hover{border-color:var(--mble-border-strong,#948274)}.element.selected{border-color:var(--mble-primary,#ed6146);outline:1px solid white}.element.locked{cursor:not-allowed}.element span{display:flex;width:100%;height:100%;align-items:center;justify-content:center;overflow:hidden}.selection-box{position:absolute;box-sizing:border-box;border:1px solid var(--mble-primary,#ed6146);outline:1px solid white;pointer-events:none;z-index:10000}.handle{position:absolute;display:block;box-sizing:content-box;width:8px;height:8px;background:white;border:1px solid var(--mble-primary,#ed6146);pointer-events:auto;z-index:20}.handle.resize.nw{left:-5px;top:-5px;cursor:nwse-resize}.handle.resize.n{left:calc(50% - 5px);top:-5px;cursor:ns-resize}.handle.resize.ne{right:-5px;top:-5px;cursor:nesw-resize}.handle.resize.e{right:-5px;top:calc(50% - 5px);cursor:ew-resize}.handle.resize.se{right:-5px;bottom:-5px;cursor:nwse-resize}.handle.resize.s{left:calc(50% - 5px);bottom:-5px;cursor:ns-resize}.handle.resize.sw{left:-5px;bottom:-5px;cursor:nesw-resize}.handle.resize.w{left:-5px;top:calc(50% - 5px);cursor:ew-resize}.handle.rotate{top:-18px;left:calc(50% - 5px);cursor:grab;font-size:9px;line-height:8px;color:var(--mble-text,#17231c)}.rectangle,.ellipse,.triangle{border:1px solid #111}.ellipse{border-radius:50%}.triangle{clip-path:polygon(50% 0,100% 100%,0 100%);background:#111}.line{height:1px!important;background:#111}.placeholder{font-size:10px}.ruler{position:absolute;background:var(--mble-surface-muted,#f7f4ed);z-index:3}.ruler.horizontal{height:20px;left:20px;right:0;border-bottom:1px solid var(--mble-border-strong,#aaa)}.ruler.vertical{width:20px;top:20px;bottom:0;border-right:1px solid var(--mble-border-strong,#aaa)}.guide{position:absolute;background:var(--mble-guide,#46a8ed);pointer-events:none}.guide.x{top:0;bottom:0;width:1px}.guide.y{left:0;right:0;height:1px}
  .element.exact:not(.selected) span,.element.exact:not(.selected) .asset{visibility:hidden}
  .asset{width:100%;height:100%;pointer-events:none}
  .media.continuous{border-radius:3px 3px 0 0!important}.safe-margin{position:absolute;left:0;right:0;z-index:2;pointer-events:none;background:repeating-linear-gradient(135deg,#46a8ed12 0 4px,#46a8ed28 4px 5px)}.safe-margin.leading{top:0;border-bottom:1px dotted var(--mble-guide,#46a8ed)}.safe-margin.trailing{bottom:0;border-top:1px dotted var(--mble-guide,#46a8ed)}.cut-line{position:absolute;left:0;right:0;bottom:-1px;z-index:10001;border-bottom:2px dashed var(--mble-danger,#a22929);pointer-events:none}.cut-line span{position:absolute;right:2px;bottom:2px;width:auto;height:auto;padding:1px 3px;background:#fff;color:var(--mble-danger,#a22929);font-size:8px;white-space:nowrap}.roll-continuation{position:absolute;left:0;height:56px;z-index:-1;border:1px solid #b8b8b8;border-top:0;background:linear-gradient(#fffde8cc,#e9e5ce44),repeating-linear-gradient(90deg,#0000 0 8px,#8a856a18 8px 9px);box-sizing:border-box;box-shadow:0 12px 20px #17231c22;color:#777;text-align:center;font-size:8px;pointer-events:none}.roll-continuation span{display:block;margin-top:30px;opacity:.65}
  .preview-error{position:absolute;right:.3rem;bottom:.3rem;z-index:10002;padding:2px 4px;background:#fff;color:var(--mble-danger,#a21);font-size:9px}
  .preview-warning{position:absolute;left:.3rem;bottom:.3rem;z-index:10002;max-width:80%;padding:2px 4px;background:#fff7df;color:var(--mble-danger,#a21);font-size:9px}
  .ruler.horizontal{background-image:repeating-linear-gradient(90deg,transparent 0 18px,var(--mble-text-muted,#59635e) 18px 19px,transparent 19px 37.795px)}
  .ruler.vertical{background-image:repeating-linear-gradient(transparent 0 18px,var(--mble-text-muted,#59635e) 18px 19px,transparent 19px 37.795px)}
</style>
