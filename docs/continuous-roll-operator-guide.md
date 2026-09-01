# Continuous-roll labels: operator guide

## Prepare the label

1. Select the printer model and its installed continuous roll. The editor keeps
   the authored length mode when the roll width changes.
2. Choose **Fixed length** for an exact cut position or **Fit content** to size
   each materialized record from authoritative SDK layout bounds.
3. Keep artwork below the leading safe-margin guide and above the dashed cut
   line. A red overflow is blocking; a safe-margin crossing is a warning.
4. For CSV output, open **Batch printing**, calculate lengths, and review every
   record. **Match longest** makes all labels use the longest valid length.

The consumption estimate separates resolved artwork length, mandatory firmware
feed, and optional operator feed. These values must not be substituted for one
another.

## Cutting and batching

- **After each label** cuts at the printer's configured cadence.
- **After complete batch** is shown only after the active route negotiates a
  native multi-document job contract. The editor never emulates it with a set
  of separate jobs.
- **Do not cut** leaves the roll attached.
- **Chain copies** groups copies under the printer's supported cut counter.

Direct browser, local-service, and cloud jobs use the same resolved canonical
documents and continuous options. Local and cloud recovery retain the exact
serialized submission and idempotency key.

## Recovery

- If cancellation happens before any accepted write, the job is safe to start
  again.
- For `cancelled-partial` or `outcome-unknown`, inspect the printer and roll
  before taking any new action. Do not automatically replay the job.
- Resume local or cloud status from **Job recovery**. Recovery resubmits only a
  byte-identical snapshot when the server did not return a job identifier.
- Clear cover-open, roll-empty, or cutter errors on the printer, refresh status,
  and confirm the installed roll before starting a new explicit job.
