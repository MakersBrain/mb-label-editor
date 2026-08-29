<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Device guide

Use direct Web Bluetooth or WebUSB only from HTTPS or localhost in a supported
Chromium browser. Select the printer definition first, click the browser route,
and approve only the intended device. A permission denial sends no bytes.
Disconnects after a write are reported as partial or outcome-unknown; inspect
the printer before retrying.

For serial, TCP, Classic Bluetooth, native USB/BLE, IPP, Brother status, Wi-Fi,
or ADB-backed private asset import, run `mb-printer api serve` and pair the exact
editor origin. Enter the one-time token in the editor, select a discovered
connection, and print through the authenticated local route. Tokens are bound
to the origin and can be revoked from the service. The editor never silently
chooses a transport or capture file.

Confirm media width, DPI, density, rotation, and head-fit settings before a
hardware run. Validate one copy before batch printing. Hardware acceptance
results belong in the platform matrix; automated mocks do not replace them.
