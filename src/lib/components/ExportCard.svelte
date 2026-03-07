<script lang="ts">
  import type { ExportOverview } from '$lib/types/models';
  import { formatBytes } from '$utils/game';

  interface Props {
    entry: ExportOverview;
    onSelect: (entry: ExportOverview) => void;
    onRename: (entry: ExportOverview) => void;
    onDelete: (entry: ExportOverview) => void;
  }

  let { entry, onSelect, onRename, onDelete }: Props = $props();
  const playableCount = $derived.by(() =>
    Object.values(entry.modeStats).reduce((total, stats) => total + stats.playableCount, 0)
  );

  const statusLabels = {
    ready: 'Ready',
    importing: 'Importing',
    indexing: 'Indexing',
    failed: 'Needs attention',
    missing: 'Missing files'
  } as const;

  const statusClasses: Record<ExportOverview['status'], string> = {
    ready: 'bg-moss-700/10 text-moss-700',
    importing: 'bg-clay-500/10 text-clay-600',
    indexing: 'bg-clay-500/10 text-clay-600',
    failed: 'bg-danger-500/10 text-danger-500',
    missing: 'bg-ink/5 text-ink/80'
  };
</script>

<div
  role="button"
  tabindex={entry.status === 'ready' ? 0 : -1}
  class="mq-panel mq-card-enter group flex flex-col gap-6 bg-paper-200/72 p-6 text-left transition-all duration-300 hover:border-clay-500/30 hover:shadow-float {entry.status === 'ready' ? 'cursor-pointer' : 'opacity-60'}"
  onclick={() => entry.status === 'ready' && onSelect(entry)}
  onkeydown={(e) => entry.status === 'ready' && (e.key === 'Enter' || e.key === ' ') && onSelect(entry)}
>
  <div class="flex w-full items-start justify-between gap-4">
    <div class="grid gap-1">
      <div class="flex items-center gap-2">
        <h3 class="font-display text-2xl leading-none tracking-tight text-ink">{entry.name}</h3>
      </div>
      <p class="truncate text-sm text-muted/80">{entry.sourceZipName}</p>
    </div>

    <span class={`shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-widest ${statusClasses[entry.status]}`}>
      {statusLabels[entry.status]}
    </span>
  </div>

  <div class="grid w-full grid-cols-3 gap-4 border-y border-paper-300/40 py-5">
    <div class="grid gap-0.5">
      <span class="text-[0.65rem] font-bold uppercase tracking-wider text-muted/60">Photos</span>
      <strong class="text-base text-ink">{entry.photoCount}</strong>
    </div>
    <div class="grid gap-0.5">
      <span class="text-[0.65rem] font-bold uppercase tracking-wider text-muted/60">Playable</span>
      <strong class="text-base text-ink">{playableCount}</strong>
    </div>
    <div class="grid gap-0.5">
      <span class="text-[0.65rem] font-bold uppercase tracking-wider text-muted/60">Size</span>
      <strong class="text-base text-ink">{formatBytes(entry.sizeOnDiskBytes)}</strong>
    </div>
  </div>

  {#if entry.lastError}
    <div class="flex w-full gap-2 rounded-xl bg-danger-500/5 p-3 text-xs text-danger-600">
      <svg class="mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <p>{entry.lastError}</p>
    </div>
  {/if}

  <div class="mt-auto flex w-full items-center justify-between gap-3">
    <div
      class="flex h-10 flex-1 items-center justify-center rounded-full bg-linear-to-r from-clay-500 to-clay-600 text-sm font-bold text-ink shadow-md shadow-clay-500/20 transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-clay-500/30 active:translate-y-0"
      style={entry.status !== 'ready' ? 'opacity: 0.5; pointer-events: none;' : ''}
    >
      Play
    </div>

    <div class="flex gap-1.5" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="presentation">
      <button
        type="button"
        title="Rename"
        class="flex h-10 w-10 items-center justify-center rounded-full border border-paper-300/60 bg-paper-200/82 text-muted hover:border-clay-500/40 hover:text-clay-600 hover:shadow-sm"
        onclick={() => onRename(entry)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
      </button>

      <button
        type="button"
        title="Delete"
        class="flex h-10 w-10 items-center justify-center rounded-full border border-danger-500/20 bg-danger-500/5 text-danger-500 hover:bg-danger-500/10 hover:shadow-sm"
        onclick={() => onDelete(entry)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    </div>
  </div>
</div>
