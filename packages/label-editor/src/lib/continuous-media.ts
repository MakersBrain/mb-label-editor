// SPDX-License-Identifier: AGPL-3.0-or-later
import { cloneDocument, type Bounds, type ContinuousMediaSettingsV1, type LabelDocument, type Media } from './model.js';

export const RESOLVED_LABEL_DOCUMENT: unique symbol = Symbol('makersbrain.resolved-label-document');
export const CONTINUOUS_LAYOUT_VERSION = 'continuous-layout-v1';
export const GENERIC_CONTINUOUS_LIMITS: ContinuousMediaLimits = Object.freeze({
  minimumLengthMm: 0.1,
  maximumLengthMm: 1_000,
  source: 'generic-export',
});

export interface ResolutionStamp {
  sourceFingerprint: string;
  recordIndex?: number;
  layoutVersion: string;
  qualifiedPrinterModel?: string;
}

export type ResolvedLabelDocument = LabelDocument & { readonly [RESOLVED_LABEL_DOCUMENT]: ResolutionStamp };

export interface MeasuredElementBounds {
  instanceId: string;
  sourceElementId: string;
  zoneId?: string;
  bounds: Bounds;
}

export interface DocumentMeasurement {
  elements: MeasuredElementBounds[];
  contentBounds?: Bounds;
  layoutVersion: string;
}

export interface DocumentMeasurer {
  measure(document: LabelDocument): Promise<DocumentMeasurement>;
}

export interface ContinuousMediaLimits {
  minimumLengthMm: number;
  maximumLengthMm: number;
  source: 'printer' | 'generic-export';
  printerModel?: string;
}

export type ContinuousWarningCode =
  | 'continuous.content_before_leading_margin'
  | 'continuous.content_after_cut_line'
  | 'continuous.empty_content'
  | 'continuous.not_printer_qualified';
export interface ContinuousMediaWarning {
  code: ContinuousWarningCode;
  severity: 'warning' | 'information';
  message: string;
}

export type ContinuousErrorCode =
  | 'continuous.invalid_width'
  | 'continuous.invalid_fixed_length'
  | 'continuous.invalid_length_range'
  | 'continuous.content_exceeds_maximum'
  | 'continuous.invalid_printable_bounds'
  | 'continuous.invalid_zone'
  | 'continuous.measurement_unavailable'
  | 'continuous.unresolved_document';

export class ContinuousMediaError extends Error {
  constructor(
    readonly code: ContinuousErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContinuousMediaError';
  }
}

export interface ContinuousResolution {
  document: ResolvedLabelDocument;
  contentBounds?: Bounds;
  naturalLengthMm: number;
  resolvedLengthMm: number;
  warnings: ContinuousMediaWarning[];
}

export function defaultContinuousSettings(document: LabelDocument): ContinuousMediaSettingsV1 {
  return {
    version: 1,
    lengthMode: 'fixed',
    fixedLengthMm: document.media.height,
    leadingMarginMm: 2,
    trailingMarginMm: 2,
    batchLengthMode: 'per-record',
  };
}

const settingsCache = new WeakMap<object, ContinuousMediaSettingsV1>();
/** Effective roll settings for a document. Memoised per media object so reactive consumers see a stable value; treat the result as read-only. */
export function continuousSettings(document: LabelDocument): ContinuousMediaSettingsV1 {
  const key = document.media.continuousSettings ?? document.media;
  let settings = settingsCache.get(key);
  if (!settings) {
    settings = structuredClone(document.media.continuousSettings ?? defaultContinuousSettings(document));
    settingsCache.set(key, settings);
  }
  return settings;
}

export function isResolvedLabelDocument(document: LabelDocument): document is ResolvedLabelDocument {
  return Object.hasOwn(document, RESOLVED_LABEL_DOCUMENT);
}

export function resolutionStamp(document: LabelDocument): ResolutionStamp | undefined {
  return isResolvedLabelDocument(document) ? document[RESOLVED_LABEL_DOCUMENT] : undefined;
}

export function assertDocumentReadyForOutput(document: LabelDocument): asserts document is ResolvedLabelDocument {
  if (document.media.shape === 'continuous' && !isResolvedLabelDocument(document)) {
    throw new ContinuousMediaError(
      'continuous.unresolved_document',
      'Continuous labels must be prepared before rendering, export, or printing.',
    );
  }
}

export function documentLayoutFingerprint(document: LabelDocument): string {
  return hashStable({
    id: document.id,
    media: document.media,
    elements: document.elements,
    resources: document.resources.map(({ id, sha256 }) => ({ id, sha256 })),
    fonts: document.fonts.map(({ id, sha256 }) => ({ id, sha256 })),
  });
}

/** Resize media without silently discarding its physical non-printable insets. */
export function printableBoundsForResizedMedia(media: Media, width: number, height: number): Bounds {
  const printable = media.printableBounds;
  const rightInset = media.width - printable.x - printable.width;
  const bottomInset = media.height - printable.y - printable.height;
  return {
    x: printable.x,
    y: printable.y,
    width: width - printable.x - rightInset,
    height: height - printable.y - bottomInset,
  };
}

/** Returns authoritative root-media physical bounds; zone offsets are already applied by the SDK. */
export function contentBounds(_document: LabelDocument, measurement: DocumentMeasurement): Bounds | undefined {
  return measuredContentBounds(measurement);
}

/** Validates authored continuous settings independently of layout measurement. */
export function validateContinuousMedia(
  document: LabelDocument,
  limits: ContinuousMediaLimits = GENERIC_CONTINUOUS_LIMITS,
): ContinuousMediaWarning[] {
  validateLimits(limits);
  if (document.media.shape !== 'continuous') return [];
  if (!finitePositive(document.media.width))
    throw new ContinuousMediaError('continuous.invalid_width', 'Continuous roll width must be greater than zero.');
  const settings = continuousSettings(document);
  const minimum = Math.max(limits.minimumLengthMm, settings.preferredMinimumLengthMm ?? limits.minimumLengthMm);
  const maximum = Math.min(limits.maximumLengthMm, settings.preferredMaximumLengthMm ?? limits.maximumLengthMm);
  if (!finitePositive(minimum) || !finitePositive(maximum) || minimum > maximum)
    throw new ContinuousMediaError(
      'continuous.invalid_length_range',
      'Continuous media minimum and maximum lengths are invalid.',
    );
  nonNegative(settings.leadingMarginMm, 'Leading margin');
  nonNegative(settings.trailingMarginMm, 'Trailing margin');
  if (
    settings.lengthMode === 'fixed' &&
    (!finitePositive(settings.fixedLengthMm) || settings.fixedLengthMm < minimum || settings.fixedLengthMm > maximum)
  )
    throw new ContinuousMediaError(
      'continuous.invalid_fixed_length',
      `Fixed cut length must be between ${minimum} and ${maximum} mm.`,
    );
  const printable = document.media.printableBounds;
  const bottomInset = document.media.height - printable.y - printable.height;
  if (![printable.y, bottomInset].every(Number.isFinite) || printable.y < 0 || bottomInset < 0)
    throw new ContinuousMediaError(
      'continuous.invalid_printable_bounds',
      'Continuous media printable bounds contain invalid top or bottom insets.',
    );
  return limits.source === 'generic-export'
    ? [
        {
          code: 'continuous.not_printer_qualified',
          severity: 'information',
          message:
            'Length was checked against generic export limits and must be validated for the destination printer.',
        },
      ]
    : [];
}

export function resolveContinuousDocument(
  document: LabelDocument,
  measurement?: DocumentMeasurement,
  limits: ContinuousMediaLimits = GENERIC_CONTINUOUS_LIMITS,
  recordIndex?: number,
): ContinuousResolution {
  validateLimits(limits);
  if (!finitePositive(document.media.width))
    throw new ContinuousMediaError('continuous.invalid_width', 'Continuous roll width must be greater than zero.');
  const copy = cloneDocument(document) as ResolvedLabelDocument;
  const warnings: ContinuousMediaWarning[] = validateContinuousMedia(document, limits);
  const settings = continuousSettings(document);
  const effectiveMinimum = Math.max(
    limits.minimumLengthMm,
    settings.preferredMinimumLengthMm ?? limits.minimumLengthMm,
  );
  const effectiveMaximum = Math.min(
    limits.maximumLengthMm,
    settings.preferredMaximumLengthMm ?? limits.maximumLengthMm,
  );
  if (!finitePositive(effectiveMinimum) || !finitePositive(effectiveMaximum) || effectiveMinimum > effectiveMaximum) {
    throw new ContinuousMediaError(
      'continuous.invalid_length_range',
      'Continuous media minimum and maximum lengths are invalid.',
    );
  }

  let bounds: Bounds | undefined;
  let naturalLength = document.media.height;
  let resolvedLength = document.media.height;
  if (document.media.shape === 'continuous') {
    copy.media.continuousSettings = settings;
    if (settings.lengthMode === 'fixed') {
      if (!finitePositive(settings.fixedLengthMm))
        throw new ContinuousMediaError(
          'continuous.invalid_fixed_length',
          'Fixed cut length must be greater than zero.',
        );
      naturalLength = roundMillimetres(settings.fixedLengthMm);
      if (naturalLength < effectiveMinimum || naturalLength > effectiveMaximum) {
        throw new ContinuousMediaError(
          'continuous.invalid_fixed_length',
          `Fixed cut length must be between ${effectiveMinimum} and ${effectiveMaximum} mm.`,
        );
      }
      resolvedLength = naturalLength;
      if (measurement) {
        bounds = measuredContentBounds(measurement);
        if (bounds && bounds.y + bounds.height > resolvedLength)
          warnings.push({
            code: 'continuous.content_after_cut_line',
            severity: 'warning',
            message: 'Visible content extends past the fixed cut line.',
          });
      }
    } else {
      if (!measurement)
        throw new ContinuousMediaError(
          'continuous.measurement_unavailable',
          'Fit content requires authoritative SDK layout measurement.',
        );
      bounds = measuredContentBounds(measurement);
      if (!bounds) {
        naturalLength = effectiveMinimum;
        warnings.push({
          code: 'continuous.empty_content',
          severity: 'information',
          message: 'The empty continuous label uses its minimum length.',
        });
      } else {
        naturalLength = roundMillimetres(
          bounds.y + bounds.height + nonNegative(settings.trailingMarginMm, 'Trailing margin'),
        );
        if (bounds.y < nonNegative(settings.leadingMarginMm, 'Leading margin')) {
          warnings.push({
            code: 'continuous.content_before_leading_margin',
            severity: 'warning',
            message: 'Visible content crosses the leading safe margin.',
          });
        }
      }
      if (naturalLength > effectiveMaximum) {
        throw new ContinuousMediaError(
          'continuous.content_exceeds_maximum',
          `Content requires ${naturalLength.toFixed(3)} mm, exceeding the ${effectiveMaximum.toFixed(3)} mm maximum.`,
        );
      }
      resolvedLength = roundMillimetres(Math.max(naturalLength, effectiveMinimum));
    }
  }

  updateMediaLength(copy, resolvedLength);
  const stamp: ResolutionStamp = {
    sourceFingerprint: fingerprint(document, measurement, settings, limits),
    recordIndex,
    layoutVersion: measurement?.layoutVersion ?? CONTINUOUS_LAYOUT_VERSION,
    qualifiedPrinterModel: limits.source === 'printer' ? limits.printerModel : undefined,
  };
  attachResolutionStamp(copy, stamp);
  return {
    document: copy,
    contentBounds: bounds,
    naturalLengthMm: naturalLength,
    resolvedLengthMm: resolvedLength,
    warnings,
  };
}

export function resolveContinuousBatch(
  documents: LabelDocument[],
  measurements: Array<DocumentMeasurement | undefined>,
  mode: ContinuousMediaSettingsV1['batchLengthMode'],
  limits: ContinuousMediaLimits = GENERIC_CONTINUOUS_LIMITS,
): ContinuousResolution[] {
  if (documents.length !== measurements.length)
    throw new Error('Each continuous batch document requires a matching measurement entry.');
  const results = documents.map((document, index) =>
    resolveContinuousDocument(document, measurements[index], limits, index),
  );
  if (mode === 'per-record' || !results.length) return results;
  const longest = Math.max(...results.map((result) => result.resolvedLengthMm));
  return results.map((result, index) => {
    if (result.resolvedLengthMm === longest) return result;
    const resized = cloneDocument(result.document) as ResolvedLabelDocument;
    updateMediaLength(resized, longest);
    attachResolutionStamp(resized, {
      sourceFingerprint: `${fingerprint(documents[index], measurements[index], continuousSettings(documents[index]), limits)}:uniform:${longest}`,
      recordIndex: index,
      layoutVersion: measurements[index]?.layoutVersion ?? CONTINUOUS_LAYOUT_VERSION,
      qualifiedPrinterModel: limits.source === 'printer' ? limits.printerModel : undefined,
    });
    return { ...result, document: resized, resolvedLengthMm: longest };
  });
}

function measuredContentBounds(measurement: DocumentMeasurement): Bounds | undefined {
  const bounds = measurement.contentBounds ?? unionBounds(measurement.elements.map((item) => item.bounds));
  if (!bounds) return undefined;
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width < 0 ||
    bounds.height < 0
  ) {
    throw new ContinuousMediaError(
      'continuous.measurement_unavailable',
      'The SDK returned invalid measured content bounds.',
    );
  }
  return structuredClone(bounds);
}

function unionBounds(bounds: Bounds[]): Bounds | undefined {
  if (!bounds.length) return undefined;
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

function updateMediaLength(document: LabelDocument, height: number): void {
  if (!finitePositive(height))
    throw new ContinuousMediaError(
      'continuous.invalid_fixed_length',
      'Resolved media length must be greater than zero.',
    );
  const oldHeight = document.media.height;
  const printable = document.media.printableBounds;
  const topInset = printable.y;
  const bottomInset = oldHeight - printable.y - printable.height;
  const nextPrintableHeight = height - topInset - bottomInset;
  if (
    ![topInset, bottomInset, nextPrintableHeight].every(Number.isFinite) ||
    topInset < 0 ||
    bottomInset < 0 ||
    nextPrintableHeight <= 0
  ) {
    throw new ContinuousMediaError(
      'continuous.invalid_printable_bounds',
      'Continuous media printable bounds cannot preserve their top and bottom insets at the resolved length.',
    );
  }
  document.media.height = height;
  document.media.printableBounds.height = nextPrintableHeight;
}

function roundMillimetres(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function validateLimits(limits: ContinuousMediaLimits): void {
  if (
    !finitePositive(limits.minimumLengthMm) ||
    !finitePositive(limits.maximumLengthMm) ||
    limits.minimumLengthMm > limits.maximumLengthMm
  ) {
    throw new ContinuousMediaError(
      'continuous.invalid_length_range',
      'Continuous media capability limits are invalid.',
    );
  }
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
function attachResolutionStamp(document: ResolvedLabelDocument, stamp: ResolutionStamp): void {
  Object.defineProperty(document, RESOLVED_LABEL_DOCUMENT, {
    value: Object.freeze(stamp),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}
function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new ContinuousMediaError('continuous.invalid_length_range', `${label} must be zero or greater.`);
  return value;
}
function fingerprint(
  document: LabelDocument,
  measurement: DocumentMeasurement | undefined,
  settings: ContinuousMediaSettingsV1,
  limits: ContinuousMediaLimits,
): string {
  return hashStable({ layout: documentLayoutFingerprint(document), settings, limits, measurement });
}

export function normalizeContinuousMeasurementError(error: unknown): ContinuousMediaError {
  if (error instanceof ContinuousMediaError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid zone|zone cycle|group or zone cycle|clone.zone|clone zone/i.test(message)) {
    return new ContinuousMediaError(
      'continuous.invalid_zone',
      `Continuous layout contains an invalid zone or clone reference: ${message}`,
    );
  }
  return new ContinuousMediaError(
    'continuous.measurement_unavailable',
    `Authoritative continuous-media measurement failed: ${message}`,
  );
}
/** FNV-1a over the stable serialisation; two 32-bit lanes keep the digest 16 hex characters without BigInt per byte. */
function hashStable(value: unknown): string {
  const input = stableStringify(value);
  let low = 0x811c9dc5;
  let high = 0x811c9dc5 ^ 0x5bd1e995;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    low = Math.imul(low ^ code, 16777619);
    high = Math.imul(high ^ ((code * 31) & 0xffff), 16777619);
  }
  return (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
