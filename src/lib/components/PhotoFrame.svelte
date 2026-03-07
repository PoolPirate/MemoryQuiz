<script lang="ts">
  import ImageOverlay from './ImageOverlay.svelte';

  interface Props {
    src: string;
    alt: string;
    label?: string | null;
    deleteLabel?: string;
    deleteDisabled?: boolean;
    onDelete?: (() => void) | null;
  }

  let {
    src,
    alt,
    label = null,
    deleteLabel = 'Remove image',
    deleteDisabled = false,
    onDelete = null
  }: Props = $props();
  let showOverlay = $state(false);

  function toggleOverlay(e: MouseEvent) {
    e.stopPropagation();
    showOverlay = !showOverlay;
  }

  function handleDeleteClick(event: MouseEvent) {
    event.stopPropagation();
    onDelete?.();
  }
</script>

<figure class="mq-panel group relative grid gap-3 p-3.5 sm:p-4">
  <div 
    class="relative overflow-hidden rounded-[20px] cursor-pointer"
    onclick={toggleOverlay}
    onkeydown={(e) => e.key === 'Enter' && toggleOverlay(e as any)}
    role="button"
    tabindex="0"
  >
    <img 
      class="h-[min(52vh,420px)] w-full bg-paper-200/78 object-contain transition-transform duration-500 group-hover:scale-[1.02]" 
      {src} 
      {alt} 
      loading="eager" 
    />

    {#if onDelete}
      <button
        type="button"
        class="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300/80 bg-paper-200/78 text-danger-500 shadow-[0_10px_24px_rgba(47,36,27,0.16)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-paper-200/95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-danger-500/35 disabled:cursor-not-allowed disabled:opacity-45 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
        aria-label={deleteLabel}
        title={deleteLabel}
        onclick={handleDeleteClick}
        disabled={deleteDisabled}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
      </button>
    {/if}
    
    <div class="absolute inset-0 flex items-center justify-center bg-ink/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <div 
        class="mq-btn-secondary scale-90 gap-2 px-5 py-2.5 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
        View Full Size
      </div>
    </div>
  </div>

  {#if label}
    <figcaption class="text-center text-sm leading-6 text-muted">{label}</figcaption>
  {/if}
</figure>

{#if showOverlay}
  <ImageOverlay {src} {alt} onClose={() => showOverlay = false} />
{/if}
