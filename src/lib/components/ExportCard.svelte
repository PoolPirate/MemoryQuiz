<script lang="ts">
  import type { ExportOverview } from '$types/models';
  import { formatBytes, formatFriendlyDate } from '$utils/game';

  interface Props {
    entry: ExportOverview;
    highlighted?: boolean;
    onSelect: (entry: ExportOverview) => void;
    onRename: (entry: ExportOverview) => void;
    onReindex: (entry: ExportOverview) => void;
    onDelete: (entry: ExportOverview) => void;
  }

  let { entry, highlighted = false, onSelect, onRename, onReindex, onDelete }: Props = $props();

  const statusLabels = {
    ready: 'Ready to play',
    importing: 'Importing',
    indexing: 'Indexing',
    failed: 'Needs attention',
    missing: 'Missing files'
  } as const;
</script>

<article class:highlighted class="export-card panel card-enter">
  <div class="header-row">
    <div>
      <p class="eyebrow">Savegame</p>
      <h3>{entry.name}</h3>
    </div>
    <span class="pill">{statusLabels[entry.status]}</span>
  </div>

  <div class="meta-grid">
    <div>
      <span>Imported</span>
      <strong>{formatFriendlyDate(entry.importedAt ?? entry.createdAt)}</strong>
    </div>
    <div>
      <span>Photos indexed</span>
      <strong>{entry.photoCount}</strong>
    </div>
    <div>
      <span>Location rounds</span>
      <strong>{entry.modeStats.location.playableCount}</strong>
    </div>
    <div>
      <span>Older vs newer</span>
      <strong>{entry.modeStats['older-newer'].playableCount}</strong>
    </div>
    <div>
      <span>Best streaks</span>
      <strong>{entry.modeStats.location.bestStreak} / {entry.modeStats['older-newer'].bestStreak}</strong>
    </div>
    <div>
      <span>On disk</span>
      <strong>{formatBytes(entry.sizeOnDiskBytes)}</strong>
    </div>
  </div>

  {#if entry.lastError}
    <p class="warning">{entry.lastError}</p>
  {/if}

  <div class="actions">
    <button class="button-primary" onclick={() => onSelect(entry)} disabled={entry.status !== 'ready'}>
      Select export
    </button>
    <button class="button-secondary" onclick={() => onRename(entry)}>Rename</button>
    <button class="button-secondary" onclick={() => onReindex(entry)} disabled={!entry.existsOnDisk}>
      Re-index
    </button>
    <button class="button-danger" onclick={() => onDelete(entry)}>Delete</button>
  </div>
</article>

<style>
  .export-card {
    padding: 22px;
    display: grid;
    gap: 18px;
  }

  .highlighted {
    outline: 3px solid rgba(234, 124, 82, 0.18);
  }

  .header-row {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }

  .eyebrow,
  .meta-grid span {
    margin: 0;
    color: var(--muted);
    font-size: 0.86rem;
  }

  h3 {
    margin: 6px 0 0;
    font-family: var(--font-display);
    font-size: 1.5rem;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  .meta-grid div {
    display: grid;
    gap: 4px;
    padding: 12px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.6);
  }

  .warning {
    margin: 0;
    padding: 12px 14px;
    border-radius: 16px;
    background: rgba(182, 72, 72, 0.12);
    color: var(--danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  @media (max-width: 760px) {
    .meta-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
