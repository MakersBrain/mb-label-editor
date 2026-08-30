<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Label-sheet qualification checklist

Use this checklist before approving a general-purpose printer for label-sheet
production. Passing software tests demonstrates deterministic PDF geometry. It
does not establish universal physical accuracy. Define tolerances appropriate
to the label stock, artwork safe area, printer, and operational risk.

## Qualification record

Record enough information to reproduce the result:

- date and operator;
- Label Editor and printer SDK version or commit;
- browser and version, operating system, and PDF viewer;
- printer make/model, firmware, connection, and driver version;
- input tray, media type, print quality, and simplex/duplex setting;
- sheet preset ID or every custom-grid value;
- stock manufacturer and product code, lot if relevant, and paper size;
- scaling setting, which must be Actual size or 100%, with fitting disabled;
- acceptance tolerances and the reason they are suitable; and
- attached generated PDF, test artwork, measurements, and photographs or scan.

For a branded preset, also record the primary manufacturer specification URL or
document identifier, publication/revision date, and the dimensions transcribed
from it. Recheck the source when the manufacturer changes the product or
template. Do not qualify a branded preset from a reseller page or an
unverifiable community template.

## Software checks

- Confirm the intended A4 or Letter orientation and PDF page count.
- Confirm rows × columns equals the displayed slots per full sheet.
- Confirm label dimensions, margins, gaps, and final right/bottom edges fit
  within the paper definition.
- Confirm row-first and column-first jobs number and fill slots as selected.
- Confirm the first-unused-label choice skips only the earlier slots on page 1.
- Confirm copies produce the requested count and preserve order across pages.
- For CSV mode, confirm every expected record is materialized once, in displayed
  order, with representative text, barcode, and QR values resolved correctly.
- Inspect the PDF at high zoom for clipping at each slot edge and missing fonts,
  images, barcodes, or QR codes.
- Retain a checksum of the accepted PDF when an exact output artifact matters.

Software acceptance result: pass / fail

Evidence or issue reference:

## Physical checks

1. Create a representative test label with an inset outline, center marks, and
   known measurement references, then print its sheet PDF on plain paper from
   the intended PDF viewer. Select the exact paper size, Actual size or 100%,
   simplex printing, and the intended tray/media type. Disable every fit,
   shrink, expand, borderless enlargement, and poster option.
2. Overlay the plain-paper print on an unused label sheet against a light source.
   Check the first and last label in every row and column. Measure horizontal and
   vertical offsets rather than judging only by eye.
3. Repeat the plain-paper test after the printer has warmed up. Compare first
   page versus later pages and note feed skew or drift.
4. After the plain-paper result is accepted, print one actual sheet using artwork
   with a safe inset. Check adhesion stock feed, toner/ink behavior, clipping,
   rotation, and registration at the sheet corners and center.
5. Test a partially used sheet with a non-zero first slot only if the printer and
   stock manufacturer permit sheets to be re-fed. Inspect the sheet before reuse;
   curled, peeled, damaged, or heat-affected stock should not be re-fed.
6. Test the longest expected multi-page copies or CSV job. Verify record order,
   page transitions, and the physical output count.

Do not introduce a software calibration offset merely to hide an unexplained
driver scaling option. The current workflow does not save printer-specific
calibration profiles. Correct viewer/driver settings first, then document any
remaining deployment-specific limitation.

## Measurement table

| Location | Expected X/Y | Measured X/Y | Offset X/Y | Within chosen tolerance? |
| --- | --- | --- | --- | --- |
| Top-left label | | | | |
| Top-right label | | | | |
| Center label | | | | |
| Bottom-left label | | | | |
| Bottom-right label | | | | |

## Decision

- Qualified printer/driver/stock combination: yes / no
- Approved tolerance: _
- Known limitations and required operator settings: _
- Requalification trigger (driver, firmware, stock, browser, or preset change): _
- Reviewer and approval date: _
