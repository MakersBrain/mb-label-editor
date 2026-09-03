// SPDX-License-Identifier: AGPL-3.0-or-later
import { toSdkPlanActions, type ProtocolExecutionProgress, type ProtocolExecutionResult, type ProtocolExecutionTransport, type ProtocolPlan, type ProtocolPlanExecutor } from './types.js';

/** Transport contract of the WebAssembly plan executor: the editor's transport plus a release hook. */
export interface SdkExecutionTransport extends ProtocolExecutionTransport { disconnect(signal?: AbortSignal): Promise<void> }
export interface SdkReferenceTiming { additionalDelayMs?: number; unsafeDiagnosticReductionMs?: number }
/** Signature of `executePlan` exported by the mb-printer-wasm web and node packages. */
export type SdkExecutePlan = (planJson: string, transport: SdkExecutionTransport, timing: SdkReferenceTiming, signal: AbortSignal | null | undefined, onProgress?: (progress: ProtocolExecutionProgress) => void) => Promise<ProtocolExecutionResult>;

/** Source commit reported for plans the editor assembled itself rather than received from the SDK. */
export const EDITOR_PLAN_SOURCE = 'mb-label-editor';

/** Serializes an editor plan back into the SDK wire format the Rust executor parses. */
export function toSdkPlanJson(plan: ProtocolPlan): string {
  return JSON.stringify({ protocol: plan.protocol, source_commit: plan.sdkSourceCommit ?? EDITOR_PLAN_SOURCE, actions: plan.sdkActions ?? toSdkPlanActions(plan) });
}

/**
 * Adapts the SDK's WebAssembly executor to the editor's plan executor contract.
 * Connection lifetime stays with the print route, so the executor's disconnect hook is a no-op.
 */
export function sdkPlanExecutor(execute: SdkExecutePlan, timing: SdkReferenceTiming = {}): ProtocolPlanExecutor {
  return async (plan, transport, progress, signal) => {
    const owned: SdkExecutionTransport = {
      payloadLimit: transport.payloadLimit,
      ...(transport.commandPayloadLimit === undefined ? {} : { commandPayloadLimit: transport.commandPayloadLimit }),
      subscribeNotifications: (abort) => transport.subscribeNotifications(abort),
      write: (bytes, abort, kind) => transport.write(bytes, abort, kind),
      waitForResponse: (timeoutMs, abort) => transport.waitForResponse(timeoutMs, abort),
      async disconnect() {},
    };
    const result = await execute(toSdkPlanJson(plan), owned, timing, signal, progress ? (state) => progress({ lastCompletedAction: state.lastCompletedAction, bytesWritten: state.bytesWritten, potentiallyAcceptedWrite: state.potentiallyAcceptedWrite }) : undefined);
    return { status: result.status, lastCompletedAction: result.lastCompletedAction, bytesWritten: result.bytesWritten, potentiallyAcceptedWrite: result.potentiallyAcceptedWrite, ...(result.errorCode ? { errorCode: result.errorCode } : {}), ...(result.error ? { error: result.error } : {}) };
  };
}
