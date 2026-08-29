// SPDX-License-Identifier: AGPL-3.0-or-later
export function parseCsv(text: string): { fields: string[]; records: Record<string, string>[] } {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) { const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += character;
  }
  row.push(field); if (row.some(Boolean)) rows.push(row); const fields = rows.shift()?.map((item) => item.trim()) ?? [];
  if (new Set(fields).size !== fields.length || fields.some((item) => !item)) throw new Error('CSV header fields must be unique and non-empty');
  return { fields, records: rows.map((values) => Object.fromEntries(fields.map((name, index) => [name, values[index] ?? '']))) };
}
export function mapCsvFields(records:Record<string,string>[],mapping:Record<string,string>){return records.map(record=>Object.fromEntries(Object.entries(mapping).map(([target,source])=>[target,record[source]??''])))}
