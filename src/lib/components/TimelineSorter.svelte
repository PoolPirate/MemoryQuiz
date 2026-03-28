<script lang="ts">
  import { clampTimelinePosition } from '$utils/game';

  type PlacementTone = 'correct' | 'incorrect' | 'neutral';

  interface TimelineItem {
    id: string;
    filename: string;
    imageUrl: string;
    captureTs: number;
  }

  interface Props {
    items: TimelineItem[];
    positions: Record<string, number>;
    selectedId?: string | null;
    newlyAddedId?: string | null;
    lockedIds?: string[];
    rangeStartTs: number;
    rangeEndTs: number;
    disabled?: boolean;
    revealAnswer?: boolean;
    statusMap?: Record<string, PlacementTone>;
    onMove: (mediaId: string, position: number) => void;
    onSelect: (mediaId: string) => void;
  }

  let {
    items,
    positions,
    selectedId = null,
    newlyAddedId = null,
    lockedIds = [],
    rangeStartTs,
    rangeEndTs,
    disabled = false,
    revealAnswer = false,
    statusMap = {},
    onMove,
    onSelect
  }: Props = $props();

  const tickFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
  const cardDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  let trackElement = $state<HTMLDivElement | null>(null);
  let draggingId = $state<string | null>(null);

  function isLocked(mediaId: string): boolean {
    const unlockedIds = items
      .map((item) => item.id)
      .filter((id) => !lockedIds.includes(id));

    if (revealAnswer && newlyAddedId && statusMap[newlyAddedId] === 'correct') {
      return true;
    }

    if (unlockedIds.length <= 1) {
      return lockedIds.includes(mediaId);
    }

    const preferredUnlockedId =
      (newlyAddedId && unlockedIds.includes(newlyAddedId) ? newlyAddedId : unlockedIds[0]) ?? null;
    return mediaId !== preferredUnlockedId;
  }

  function getActiveCount(): number {
    return items.filter((item) => !isLocked(item.id)).length;
  }

  function updatePosition(mediaId: string, clientX: number) {
    if (!trackElement || isLocked(mediaId)) {
      return;
    }

    const bounds = trackElement.getBoundingClientRect();
    const nextPosition = clampTimelinePosition((clientX - bounds.left) / bounds.width);
    onMove(mediaId, nextPosition);
  }

  function handlePointerDown(event: PointerEvent, mediaId: string) {
    if (disabled || isLocked(mediaId)) {
      return;
    }

    draggingId = mediaId;
    onSelect(mediaId);
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    updatePosition(mediaId, event.clientX);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!draggingId || disabled) {
      return;
    }

    updatePosition(draggingId, event.clientX);
  }

  function handlePointerUp() {
    draggingId = null;
  }

  function getLane(mediaId: string): number {
    const group = items
      .filter((item) => isLocked(item.id) === isLocked(mediaId))
      .slice()
      .sort((left, right) => (positions[left.id] ?? 0.5) - (positions[right.id] ?? 0.5))
      .map((item) => item.id);
    const index = group.indexOf(mediaId);
    return index >= 0 ? index % 2 : 0;
  }

  function getMarkerShellClass(mediaId: string): string {
    const tone = statusMap[mediaId] ?? 'neutral';
    if (tone === 'correct') {
      return 'ring-1 ring-moss-400/70';
    }
    if (tone === 'incorrect') {
      return 'ring-1 ring-danger-400/60';
    }
    if (mediaId === selectedId) {
      return 'ring-1 ring-candy-lemon/80';
    }
    if (isLocked(mediaId)) {
      return 'ring-1 ring-paper-300/50';
    }
    return 'ring-1 ring-paper-300/40';
  }

  function getStatusDotClass(mediaId: string): string {
    const tone = statusMap[mediaId] ?? 'neutral';
    if (tone === 'correct') return 'bg-moss-400';
    if (tone === 'incorrect') return 'bg-danger-400';
    if (mediaId === selectedId) return 'bg-candy-lemon';
    if (isLocked(mediaId)) return 'bg-moss-500';
    return 'bg-clay-400';
  }

  function getCardStyle(mediaId: string): string {
    const position = clampTimelinePosition(positions[mediaId] ?? 0.5);
    const lane = getLane(mediaId);
    const top = isLocked(mediaId) ? 122 + lane * 22 : 12 + lane * 10;
    return `left: ${position * 100}%; top: ${top}px;`;
  }

  function getPositionLabel(item: TimelineItem): string {
    if (isLocked(item.id) || revealAnswer) {
      return cardDateFormatter.format(new Date(item.captureTs));
    }

    const estimatedTs = rangeStartTs + (rangeEndTs - rangeStartTs) * clampTimelinePosition(positions[item.id] ?? 0.5);
    return cardDateFormatter.format(new Date(estimatedTs));
  }

  function getTickTimestamps(): number[] {
    const tickCount = 6;
    if (rangeEndTs <= rangeStartTs) {
      return [rangeStartTs];
    }

    return Array.from({ length: tickCount }, (_, index) => {
      const progress = index / (tickCount - 1);
      return rangeStartTs + (rangeEndTs - rangeStartTs) * progress;
    });
  }
</script>

<svelte:window onpointermove={handlePointerMove} onpointerup={handlePointerUp} onpointercancel={handlePointerUp} />

<section>
  <div class="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
    <p class="max-w-xl text-sm text-muted">
      Drag the movable marker along the rail. Locked memories sit on their real dates below the line.
    </p>
    <p class="text-xs font-semibold text-muted/70">
      <span class="text-moss-700">{items.length - getActiveCount()} fixed</span>
      <span class="text-muted/40"> · </span>
      <span class="text-clay-300">{getActiveCount()} draggable</span>
    </p>
  </div>

  <div class="relative">
    <div
      bind:this={trackElement}
      class="relative mx-auto min-h-[300px] w-full"
    >
      <div class="pointer-events-none absolute inset-x-4 top-5 flex justify-between text-[0.65rem] font-bold uppercase tracking-[0.2em] text-muted/55 sm:inset-x-6">
        <span>Earlier</span>
        <span>Later</span>
      </div>

      <div class="pointer-events-none absolute left-1/2 top-[72px] z-0 -translate-x-1/2 sm:top-[76px]">
        <span class="rounded-full border border-sun-300/35 bg-sun-300/10 px-3 py-1 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-sun-900/90">
          Place new photo here
        </span>
      </div>

      <div class="pointer-events-none absolute left-1/2 top-[214px] z-0 -translate-x-1/2 sm:top-[222px]">
        <span class="rounded-full border border-moss-400/35 bg-moss-500/10 px-3 py-1 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-moss-700">
          Locked timeline
        </span>
      </div>

      <div class="absolute inset-x-4 top-[118px] z-[1] h-[4px] rounded-full bg-linear-to-r from-candy-pink via-candy-lemon to-candy-mint opacity-95 shadow-[0_0_24px_rgba(255,110,180,0.35)] sm:inset-x-8 sm:top-[124px]"></div>

      <div class="absolute inset-x-2 top-[108px] z-[1] grid grid-cols-6 gap-0 sm:inset-x-6">
        {#each getTickTimestamps() as tickTs}
          <div class="flex flex-col items-center gap-1">
            <div class="h-6 w-px bg-paper-300/80"></div>
            <span class="text-center text-[0.65rem] font-bold uppercase tracking-[0.14em] text-muted/75">{tickFormatter.format(new Date(tickTs))}</span>
          </div>
        {/each}
      </div>

      <div class="relative z-[2] h-[300px]">
        {#each items as item}
          {#if isLocked(item.id)}
            <button
              type="button"
              class={`absolute ${item.id === selectedId ? 'z-30' : 'z-20'} w-[max-content] min-w-[7.5rem] max-w-[11rem] -translate-x-1/2 select-none touch-none ${draggingId === item.id ? '' : 'transition-[top,left] duration-200 ease-out'} cursor-default`}
              style={getCardStyle(item.id)}
              onclick={() => onSelect(item.id)}
              aria-pressed={item.id === selectedId}
              aria-label="Placed photo on the timeline"
            >
              <div class={`flex flex-col items-center gap-1 ${item.id === selectedId ? 'translate-y-px' : ''}`}>
                <div class={`h-2 w-2 rounded-full ${getStatusDotClass(item.id)} shadow-[0_0_12px_currentColor]`}></div>
                <div class="h-7 w-px rounded-full bg-linear-to-b from-sun-300/90 to-moss-400/70"></div>
                <div
                  class={`flex w-full items-center gap-2 rounded-xl bg-paper-100/85 p-1.5 ${getMarkerShellClass(item.id)}`}
                >
                  <div class="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-paper-200/80">
                    <img class="h-full w-full object-cover" src={item.imageUrl} alt={item.filename} draggable="false" />
                  </div>
                  <div class="grid min-w-0 flex-1 gap-0.5 text-left leading-tight">
                    <span class="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-moss-700/85">Locked</span>
                    <span class="truncate text-[0.78rem] font-semibold text-ink">{getPositionLabel(item)}</span>
                  </div>
                </div>
              </div>
            </button>
          {:else}
            <button
              type="button"
              class={`absolute z-30 w-[max-content] min-w-[7.5rem] max-w-[11rem] -translate-x-1/2 touch-none ${disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} ${draggingId === item.id ? '' : 'transition-[top,left] duration-200 ease-out'}`}
              style={getCardStyle(item.id)}
              onclick={() => onSelect(item.id)}
              onpointerdown={(event) => handlePointerDown(event, item.id)}
              aria-pressed={item.id === selectedId}
              aria-label="Place photo on the timeline"
            >
              <div class={`flex flex-col items-center gap-1 ${item.id === selectedId ? '-translate-y-0.5' : ''}`}>
                <div
                  class={`flex w-full items-center gap-2 rounded-xl bg-paper-100/85 p-1.5 ${getMarkerShellClass(item.id)}`}
                >
                  <div class="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-paper-200/80">
                    <img class="h-full w-full object-cover" src={item.imageUrl} alt={item.filename} draggable="false" />
                  </div>
                  <div class="grid min-w-0 flex-1 gap-0.5 text-left leading-tight">
                    <span class="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-muted/80">Place</span>
                    <span class="truncate text-[0.78rem] font-semibold text-ink">{getPositionLabel(item)}</span>
                  </div>
                </div>
                <div class="h-8 w-px rounded-full bg-linear-to-b from-clay-400/90 to-sun-300/85"></div>
                <div class={`h-2 w-2 rounded-full ${getStatusDotClass(item.id)} shadow-[0_0_12px_currentColor]`}></div>
              </div>
            </button>
          {/if}
        {/each}
      </div>
    </div>
  </div>
</section>
