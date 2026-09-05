<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# User guide

Create a label with the toolbar, then set exact media dimensions and optional
independent or cloned zones in **Media & zones**. The inspector edits element
geometry, content, resources, overflow, rotation, and zone assignment. Layers,
alignment, distribution, ordering, grouping, snapping, rulers, touch pan/zoom,
and bounded undo/redo are available without a printer.

Import CSV in **Data & templates**, map each text/barcode/QR element to a field,
preview records, and use **Batch** to inspect page/zone placement. Template
expressions use the SDK allowlist only; arbitrary code is never evaluated.
Export the current label as physical-size PNG or PDF, or export a batch PDF.

Documents, autosaves, preferences, templates, recents, favorites, and private
assets stay in browser storage. `.mb-label.json` files are portable v4
documents. `.mb-assets` collections are private imports and are excluded from
public build output. Ambiguous interrupted print jobs require an explicit retry
after inspecting the physical printer.

Use **Library** to explicitly save, list, and reopen labels stored in this
browser. Toolbar controls toggle the grid, rulers, and snapping, set grid
spacing, and create, edit, or remove manual guides. These view preferences are
restored on the next visit.

Hold Shift while resizing to preserve aspect ratio. CSV mappings can apply a
safe allowlisted transform from the Data panel. Media may be clamped to the
selected SDK printer capability. The Library also supports renaming and local
deletion, and private asset collections can be exported back to `.mb-assets`.

The app works offline after its first successful load. Device permission and
local-service pairing cannot be completed offline.

## Getting around the editor

The label fits the window when it opens and after the media changes. The zoom
control in the bottom-right corner of the canvas has a slider, a Fit button and
presets at 50, 100, 200 and 400 percent; any wheel, pinch, slider or preset
switches to manual zoom until you press Shift+1 to fit again. Ctrl+0 (Cmd+0 on
a Mac) is 100 percent, Shift+2 is 200 percent, and Ctrl+= and Ctrl+- step in
and out. Rulers re-tick as you zoom.

The tool rail on the left inserts elements at the visible centre of the label;
a second insert of the same kind steps aside so nothing piles up. Shift+click a
tool, or press R, E, T or L, to arm it: the next drag on the label draws a
rectangle, ellipse, text or line at that size, and Escape puts the tool away.
Double-click a text element to edit it in place; Ctrl+Enter commits and Escape
cancels.

The layer list shows an icon per element kind and a short description taken
from the content (the text, the barcode value, the image name or the group
size) beside the element's name. Double-click a name or press F2 to rename it,
use Raise and Lower or Alt+Arrow to reorder, and the More menu to bring to
front, send to back, duplicate or delete.

With elements selected, the arrow keys nudge by 0.1 mm (1 mm with Shift),
Ctrl+Arrow resizes by the same steps, Ctrl+Alt+Arrow rotates a single element
by one degree and the bracket keys rotate by 15 degrees (one with Shift).
Press ? for the full shortcut list. The status bar under the label shows the
media size, shape and dpi, the pointer position in millimetres, the size and
position of the selection, and the zoom.

## Phones, tablets and wide screens

Below 640 px the menus collapse behind one Menu button, the tool rail runs
along the top, and the side panels rise as a bottom sheet from the Panels
button; tap the dimmed label to close it. Between 640 and 768 px the panels
open as a drawer over the right of the label. On larger screens the panel sits
beside the label and can be dragged to at most half the window. From 1440 px
the layers and properties get their own pinned rail and the tabs hold assets,
data and the printer. Dialogs fill the screen on phones. On touch screens every
control is at least 44 px.

## Appearance

The editor follows the operating system's light or dark preference. A host
page can pin either look by setting `data-theme="light"` or
`data-theme="dark"` on the root element; that choice beats the system
setting in both directions. People who ask their OS for reduced motion get an
editor without transitions.

## Data records

The Data tab can start a sheet from the fields the label already references in
`{{field}}` expressions, or load a small sample CSV, as well as importing your
own CSV. Expand sheet moves the record sheet under the label on desktop or into
a dialog on small screens; edits there update the label at once.

Derived columns compute a value from the other columns with the same
`{{field | transform}}` expressions the label uses, for example
`{{price | number:0}} €` as `price_short`. They evaluate in order, so a later
formula may use an earlier derived column, and they behave like any other
field on the label, in field mapping, in batch output and in the CSV export
(which can leave them out). The sheet shows them read-only with a formula
editor.

## Printing on label sheets

Use **Print → Label sheet…** to place the current label on adhesive sheets for
a general-purpose inkjet or laser printer. This workflow produces a PDF; it does
not send printer-language commands and does not use the thermal print routes.

1. Finish the label design and confirm its width and height.
2. Choose **Current label copies** and enter a copy count, or choose **CSV
   records** to materialize every imported record in its displayed order. CSV
   mode is unavailable until the document contains records. Selecting a subset
   of records is not currently exposed in the panel.
3. Select one of the generic A4 or US Letter grids, or select **Custom grid**.
   A custom grid defines paper size, orientation, rows, columns, label width and
   height, top and left margins, horizontal and vertical gaps, and fill order.
   Invalid grids are rejected, and the document width and height must exactly
   match the selected slot dimensions before export.
4. Select **Rows first** or **Columns first**. Choose the **First unused label**
   by number or click it in the first-sheet preview. Earlier slots on the first
   page are left empty; subsequent pages start at their first slot.
5. Select **Export sheet PDF** to download `label-sheet.pdf`, or **Open print
   PDF** to open the generated PDF in a new tab or window. Opening the PDF does
   not print automatically. If the browser blocks the new window, allow the
   popup for this app or use the download action instead.
6. In the PDF viewer, select the matching A4 or Letter paper, choose **Actual
   size** or **100%**, and disable **Fit to page**, **Shrink oversized pages**,
   or any equivalent scaling option. Test on plain paper before loading label
   stock.

Sheet rasterization is currently fixed at 300 DPI monochrome. The generated PDF
uses the selected paper and slot dimensions, calculated in integer micrometres.
That establishes the software geometry; it does not guarantee that every
printer, driver, paper path, or PDF viewer will place ink at the same physical
position. Non-printable margins, automatic scaling, duplex settings, tray
selection, feed skew, humidity, and repeated-feed tolerances can all affect the
result. Qualify each printer, driver, and stock combination before production
use with the [label-sheet qualification checklist](label-sheet-qualification.md).

The current preset catalogue is generic and contains no branded product claims.
A branded preset may be added only from a verified primary manufacturer
specification that states the paper size, label dimensions, margins, pitch or
gaps, and row/column count. A reseller listing, community template, measured
sample, or similarly named product is not sufficient evidence. Record the
source and revision with the preset and physically qualify it; manufacturer
dimensions still do not guarantee a particular printer's accuracy.

Planning and PDF generation run locally and can work offline after the app and
printer SDK have completed their first successful load and are cached. Opening
or printing the local PDF does not require a cloud print service, although the
browser PDF viewer and operating-system printer driver must already be
available. Browser popup policy applies to **Open print PDF**. Browser download
policy applies to **Export sheet PDF**. Mobile and embedded browsers may offer
fewer paper-size and scaling controls than a desktop PDF viewer.
