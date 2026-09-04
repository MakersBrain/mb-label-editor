<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { JobJournal } from '../jobs.js';
  import type { EditorDatabase, PersistedJob } from '../persistence/database.js';
  let { database, onRetry = () => {} }: { database: EditorDatabase; onRetry?: (job: PersistedJob) => void } = $props();
  let jobs: PersistedJob[] = $state.raw([]);
  let loaded = $state(false);
  async function refresh() {
    jobs = await new JobJournal(database).recover();
    loaded = true;
  }
  function retry(job: PersistedJob) {
    if (
      job.route !== 'cloud-api' &&
      !confirm(
        'The printer may already have accepted part of this job. Check the physical output. Start a new explicit print attempt?',
      )
    )
      return;
    onRetry(job);
  }
</script>

<section>
  <h2>Recover print jobs</h2>
  {#if !loaded}<button onclick={refresh}>Check interrupted jobs</button>{:else if !jobs.length}<p>
      No ambiguous jobs.
    </p>{:else}<ul>
      {#each jobs as job}<li>
          <strong>{job.state}</strong><small>{new Date(job.createdAt).toLocaleString()} · {job.route}</small
          >{#if job.route === 'cloud-api'}<p>
              Resume the same cloud job or its exact idempotent submission. This does not create a new print attempt.
            </p>
            <button onclick={() => retry(job)}>Resume cloud job</button>{:else}<p>
              The outcome is uncertain. Never assume the label was retracted or automatically replay it.
            </p>
            <button onclick={() => retry(job)}>Inspect & explicitly retry</button>{/if}
        </li>{/each}
    </ul>{/if}
</section>

<style>
  section {
    padding: 0.7rem 0.75rem;
    border-top: 1px solid var(--mble-border, #e5dfd5);
  }
  h2 {
    margin: 0 0 0.5rem;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.75rem;
    font-weight: 600;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    border-left: 3px solid var(--mble-primary, #ed6146);
    padding: 0.4rem;
    margin: 0.4rem 0;
  }
  small {
    display: block;
  }
</style>
