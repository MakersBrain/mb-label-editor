// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs');
const wasm = require(process.argv[2]);
const fixture = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const documentJson = JSON.stringify(fixture.document);
if (wasm.validateDocument(documentJson) !== '[]') throw new Error('WASM validation diverged');
if (Buffer.from(wasm.renderPacked(documentJson)).toString('hex') !== fixture.expectedPackedHex) throw new Error('WASM raster diverged');
if (!Buffer.from(wasm.renderPng(documentJson)).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('WASM PNG diverged');
if (!Buffer.from(wasm.renderPdf(documentJson)).subarray(0, 8).equals(Buffer.from('%PDF-1.4'))) throw new Error('WASM PDF diverged');
console.log('Editor Node/WASM exact preview fixture passed');
