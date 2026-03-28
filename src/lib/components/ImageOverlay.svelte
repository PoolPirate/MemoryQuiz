<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  interface Props {
    src: string;
    alt: string;
    onClose: () => void;
  }

  let { src, alt, onClose }: Props = $props();

  let scale = $state(1);
  let translateX = $state(0);
  let translateY = $state(0);
  let isDragging = $state(false);
  let startX = 0;
  let startY = 0;

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = 0.15;
    const newScale = Math.max(0.5, Math.min(8, scale + (delta > 0 ? factor : -factor) * scale));
    
    // Simple zoom for now
    scale = newScale;
    
    // If scaled back to 1 or less, reset translation
    if (scale <= 1) {
      translateX = 0;
      translateY = 0;
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (scale <= 1) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function reset() {
    scale = 1;
    translateX = 0;
    translateY = 0;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mouseup', handleMouseUp);
    // Prevent scrolling on body
    document.body.style.overflow = 'hidden';
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('mouseup', handleMouseUp);
    document.body.style.overflow = '';
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[100] flex items-center justify-center bg-linear-to-br from-pop/95 via-paper-100/92 to-pop/90 backdrop-blur-md"
  transition:fade={{ duration: 200 }}
  onclick={onClose}
>
  <div
    class="relative h-full w-full overflow-hidden flex items-center justify-center {scale > 1 ? 'cursor-move' : 'cursor-default'}"
    onwheel={handleWheel}
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onclick={(e) => e.stopPropagation()}
  >
    <img
      {src}
      {alt}
      class="h-full w-full select-none object-contain transition-transform duration-75 ease-out shadow-2xl"
      style="transform: translate({translateX}px, {translateY}px) scale({scale});"
      draggable="false"
    />
  </div>

  <button
    class="absolute right-6 top-6 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-pop bg-candy-pink/30 text-ink shadow-[4px_4px_0_var(--color-pop)] transition-all hover:scale-110 hover:bg-candy-mint/30 active:scale-95"
    onclick={onClose}
    aria-label="Close"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  </button>
  
  <div class="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-6 rounded-full border-[3px] border-pop bg-linear-to-r from-candy-pink/25 via-candy-mint/20 to-candy-lemon/25 px-8 py-3.5 font-display text-sm font-bold text-ink shadow-[6px_6px_0_var(--color-pop)] backdrop-blur-xl">
    <div class="flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
      <span>Scroll to Zoom</span>
    </div>
    <div class="h-4 w-[1px] bg-paper-200/20"></div>
    <div class="flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
      <span>Drag to Pan</span>
    </div>
    <div class="h-4 w-[1px] bg-paper-200/20"></div>
    <button 
      onclick={reset} 
      class="text-candy-pink transition-colors hover:text-candy-mint hover:underline hover:decoration-candy-mint underline-offset-4"
    >
      Reset View
    </button>
  </div>
</div>
