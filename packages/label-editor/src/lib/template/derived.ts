// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DerivedField, TemplateData } from '../model.js';
import { evaluateTemplate, type EvaluationContext } from './evaluate.js';

/** A derived field name: like a CSV header, no braces, pipes or leading @ (reserved for built-ins). */
export const DERIVED_NAME = /^[^\s{}|@][^{}|]*$/;

export function validateDerivedField(
  template: TemplateData,
  field: DerivedField,
  replacing?: string,
): string | undefined {
  const name = field.name.trim();
  if (!DERIVED_NAME.test(name)) return 'Use a plain column name without braces, pipes or a leading @.';
  if (template.fields.includes(name)) return `${name} is already a data column.`;
  if (name !== replacing && (template.derived ?? []).some((item) => item.name === name))
    return `${name} is already a derived column.`;
  if (!field.expression.includes('{{')) return 'The formula needs at least one {{field}} expression.';
  return undefined;
}

/** Every column a record exposes: the data fields, then the derived ones in evaluation order. */
export function allFieldNames(template: TemplateData | undefined): string[] {
  return template ? [...template.fields, ...(template.derived ?? []).map((item) => item.name)] : [];
}

/**
 * One record with its derived columns filled in. Fields evaluate in order, so a
 * later formula may use an earlier derived column. In lenient mode a failing
 * formula yields its error text instead of throwing, for previews that must
 * never take the editor down.
 */
export function resolveRecord(
  template: TemplateData | undefined,
  record: Record<string, string>,
  options: Omit<EvaluationContext, 'record'> & { lenient?: boolean } = {},
): Record<string, string> {
  const derived = template?.derived;
  if (!derived?.length) return record;
  const { lenient, ...context } = options;
  const result: Record<string, string> = { ...record };
  for (const field of derived) {
    try {
      result[field.name] = evaluateTemplate(field.expression, { ...context, record: result });
    } catch (error) {
      if (!lenient) throw error;
      result[field.name] = `\u26a0 ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return result;
}

export function resolvedRecords(
  template: TemplateData | undefined,
  options: Omit<EvaluationContext, 'record'> & { lenient?: boolean } = {},
): Record<string, string>[] {
  return (template?.records ?? []).map((record) => resolveRecord(template, record, options));
}

/** The record currently previewed, resolved leniently so the canvas can always show something. */
export function currentResolvedRecord(
  template: TemplateData | undefined,
  options: Omit<EvaluationContext, 'record'> = {},
): Record<string, string> | undefined {
  const record = template?.records[template.currentRecord];
  return record ? resolveRecord(template, record, { ...options, lenient: true }) : undefined;
}
