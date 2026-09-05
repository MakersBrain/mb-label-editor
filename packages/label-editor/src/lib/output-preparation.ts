// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  GENERIC_CONTINUOUS_LIMITS,
  continuousSettings,
  documentLayoutFingerprint,
  normalizeContinuousMeasurementError,
  resolveContinuousDocument,
  type ContinuousMediaLimits,
  type ContinuousResolution,
  type DocumentMeasurer,
  type ResolvedLabelDocument,
} from './continuous-media.js';
import { resolveRecord } from './template/derived.js';
import type { DocumentMaterializer } from './materialization.js';
import type { LabelDocument } from './model.js';

export interface OutputPreparationServices {
  materializer?: Pick<DocumentMaterializer, 'materializeRecord'>;
  measurer?: DocumentMeasurer;
}

export interface PrepareDocumentOptions {
  record?: Record<string, string>;
  recordIndex?: number;
  limits?: ContinuousMediaLimits;
  /** Keep template expressions/records in canonical JSON while resolving from the selected record. */
  preserveTemplateSource?: boolean;
}

export interface PreparedDocumentOutput extends ContinuousResolution {
  document: ResolvedLabelDocument;
  materialized: boolean;
}

const measurementCaches = new WeakMap<
  DocumentMeasurer,
  Map<string, Promise<Awaited<ReturnType<DocumentMeasurer['measure']>>>>
>();

export async function prepareDocumentForOutput(
  source: LabelDocument,
  services: OutputPreparationServices = {},
  options: PrepareDocumentOptions = {},
): Promise<PreparedDocumentOutput> {
  const selected = selectedRecord(source, options);
  let document = source;
  let materialized = false;
  if (selected.record) {
    if (!services.materializer) throw new Error('Template output requires the document materializer.');
    document = await services.materializer.materializeRecord(source, selected.record);
    materialized = true;
  }
  const continuous = document.media.shape === 'continuous';
  const fitContent = continuous && continuousSettings(document).lengthMode === 'fit-content';
  const measurement =
    continuous && services.measurer
      ? await cachedMeasurement(document, services.measurer)
      : fitContent
        ? await requireMeasurement(document, services.measurer)
        : undefined;
  const resolution = resolveContinuousDocument(
    options.preserveTemplateSource && materialized ? source : document,
    measurement,
    options.limits ?? GENERIC_CONTINUOUS_LIMITS,
    selected.index,
  );
  return {
    ...resolution,
    materialized,
  };
}

async function requireMeasurement(document: LabelDocument, measurer: DocumentMeasurer | undefined) {
  if (!measurer) return undefined;
  return await cachedMeasurement(document, measurer);
}

async function cachedMeasurement(document: LabelDocument, measurer: DocumentMeasurer) {
  const cache =
    measurementCaches.get(measurer) ?? new Map<string, Promise<Awaited<ReturnType<DocumentMeasurer['measure']>>>>();
  measurementCaches.set(measurer, cache);
  const key = documentLayoutFingerprint(document);
  let pending = cache.get(key);
  if (!pending) {
    pending = measurer.measure(document);
    cache.set(key, pending);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    pending.catch(() => cache.delete(key));
  }
  try {
    return await pending;
  } catch (error) {
    throw normalizeContinuousMeasurementError(error);
  }
}

function selectedRecord(
  document: LabelDocument,
  options: PrepareDocumentOptions,
): { record?: Record<string, string>; index?: number } {
  if (options.record) return { record: options.record, index: options.recordIndex };
  const template = document.template;
  if (!template?.records.length) return {};
  const index = Math.max(0, Math.min(template.currentRecord, template.records.length - 1));
  return { record: resolveRecord(template, template.records[index]), index };
}
