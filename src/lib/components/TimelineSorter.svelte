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

  function getMarkerToneClass(mediaId: string): string {
    const tone = statusMap[mediaId] ?? 'neutral';
    if (tone === 'correct') {
      return 'border-moss-600/60 bg-paper-100/95 text-moss-900 shadow-[0_18px_32px_rgba(74,116,88,0.2)]';
    }
    if (tone === 'incorrect') {
      return 'border-danger-500/45 bg-paper-100/95 text-ink shadow-[0_18px_32px_rgba(182,72,72,0.18)]';
    }
    if (mediaId === selectedId) {
      return 'border-clay-500/80 bg-paper-100/95 text-ink shadow-[0_18px_32px_rgba(184,107,62,0.22)]';
    }
    if (isLocked(mediaId)) {
      return 'border-moss-300/75 bg-paper-100/95 text-ink shadow-[0_18px_32px_rgba(74,116,88,0.14)]';
    }
    return 'border-paper-300/80 bg-paper-100/95 text-ink shadow-[0_14px_28px_rgba(47,36,27,0.2)]';
  }

  function getMarkerStemClass(mediaId: string): string {
    const tone = statusMap[mediaId] ?? 'neutral';
    if (tone === 'correct') {
      return 'bg-moss-400 shadow-[0_0_16px_rgba(145,177,120,0.75)]';
    }
    if (tone === 'incorrect') {
      return 'bg-danger-400 shadow-[0_0_16px_rgba(220,108,108,0.72)]';
    }
    if (mediaId === selectedId) {
      return 'bg-sun-300 shadow-[0_0_18px_rgba(236,196,95,0.82)]';
    }
    if (isLocked(mediaId)) {
      return 'bg-sun-300 shadow-[0_0_18px_rgba(236,196,95,0.82)]';
    }
    return 'bg-sun-300 shadow-[0_0_18px_rgba(236,196,95,0.82)]';
  }

  function getMarkerTipClass(mediaId: string): string {
    const tone = statusMap[mediaId] ?? 'neutral';
    if (tone === 'correct') {
      return 'border-moss-600/60 bg-paper-100/95';
    }
    if (tone === 'incorrect') {
      return 'border-danger-500/45 bg-paper-100/95';
    }
    if (mediaId === selectedId) {
      return 'border-clay-500/80 bg-paper-100/95';
    }
    if (isLocked(mediaId)) {
      return 'border-moss-300/75 bg-paper-100/95';
    }
    return 'border-paper-300/80 bg-paper-100/95';
  }

  function getMarkerCoreClass(mediaId: string): string {
    const tone = statusMap[mediaId] ?? 'neutral';
    if (tone === 'correct') {
      return 'bg-moss-700';
    }
    if (tone === 'incorrect') {
      return 'bg-danger-500';
    }
    if (isLocked(mediaId)) {
      return 'bg-moss-700';
    }
    return mediaId === selectedId ? 'bg-clay-600' : 'bg-clay-500';
  }

  function getCardStyle(mediaId: string): string {
    const position = clampTimelinePosition(positions[mediaId] ?? 0.5);
    const lane = getLane(mediaId);
    const top = isLocked(mediaId) ? 124 + lane * 18 : 16;
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

<section class="mq-panel relative overflow-hidden px-4 pb-6 pt-8 sm:px-6">
  <div class="pointer-events-none absolute inset-x-5 top-0 h-32 bg-linear-to-b from-candy-grape/25 to-transparent"></div>

  <div class="grid gap-3">
    <div class="flex items-center justify-between gap-3 px-1">
      <div>
        <p class="font-display text-xs font-bold uppercase tracking-[0.24em] text-candy-mint">Timeline</p>
        <p class="text-sm leading-6 text-muted">Drag the new photo marker above the line. Locked photos stay below on their true dates.</p>
      </div>
      <div class="rounded-full border-[2px] border-candy-lemon/35 bg-paper-200/82 px-3 py-1.5 font-display text-xs font-bold text-candy-lemon">
        {items.length - getActiveCount()} locked / {getActiveCount()} active
      </div>
    </div>

    <div class="mq-timeline-track relative min-h-[320px] rounded-[1.75rem] border-[3px] border-ink/10 px-3 pb-5 pt-8 sm:px-4">
      <div bind:this={trackElement} class="relative h-[260px]">
        <div class="absolute inset-x-0 top-[120px] h-[3px] rounded-full bg-linear-to-r from-candy-pink via-candy-lemon to-candy-mint opacity-90"></div>

        <div class="absolute inset-x-0 top-[102px] grid grid-cols-6 gap-0">
          {#each getTickTimestamps() as tickTs}
            <div class="relative flex flex-col items-center gap-2">
              <div class="absolute left-1/2 top-0 h-9 w-px -translate-x-1/2 bg-paper-300/90"></div>
              <span class="pt-9 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-muted/70">{tickFormatter.format(new Date(tickTs))}</span>
            </div>
          {/each}
        </div>

        <div class="pointer-events-none absolute inset-x-0 top-[8px] flex justify-center">
          <span class="rounded-full border border-sun-300/40 bg-sun-300/12 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-sun-800">
            New photo above
          </span>
        </div>

        <div class="pointer-events-none absolute inset-x-0 top-[206px] flex justify-center">
          <span class="rounded-full border border-moss-300/40 bg-moss-300/12 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-moss-700">
            Locked photos below
          </span>
        </div>

        {#each items as item}
          {#if isLocked(item.id)}
            <button
              type="button"
              class={`absolute ${item.id === selectedId ? 'z-20' : 'z-10'} -translate-x-1/2 select-none touch-none ${draggingId === item.id ? '' : 'transition-all duration-200'} cursor-default`}
              style={getCardStyle(item.id)}
              onclick={() => onSelect(item.id)}
              aria-pressed={item.id === selectedId}
              aria-label="Placed photo on the timeline"
            >
              <div class={`flex flex-col items-center ${item.id === selectedId ? 'translate-y-[2px]' : ''}`}>
                <div class={`grid h-4 w-4 place-items-center rotate-45 rounded-[4px] border-2 shadow-[0_10px_18px_rgba(47,36,27,0.18)] ${getMarkerTipClass(item.id)}`}>
                  <span class={`block h-1.5 w-1.5 -rotate-45 rounded-full ${getMarkerCoreClass(item.id)}`}></span>
                </div>
                <div class={`h-8 w-[2px] rounded-full ${getMarkerStemClass(item.id)}`}></div>
                <div class={`flex items-center gap-2 rounded-[18px] border px-2.5 py-2 text-left backdrop-blur-sm ${getMarkerToneClass(item.id)}`}>
                  <div class="h-9 w-9 overflow-hidden rounded-[12px] border border-paper-300/70 bg-paper-100/90">
                    <img class="h-full w-full object-cover" src={item.imageUrl} alt={item.filename} draggable="false" />
                  </div>
                  <div class="grid min-w-[5.5rem] gap-0.5 leading-none">
                    <span class="text-[0.52rem] font-bold uppercase tracking-[0.2em] text-moss-700/75">Locked</span>
                    <span class="text-[0.72rem] font-semibold">{getPositionLabel(item)}</span>
                  </div>
                </div>
              </div>
            </button>
          {:else}
            <button
              type="button"
              class={`absolute z-20 -translate-x-1/2 touch-none ${disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
              style={getCardStyle(item.id)}
              onclick={() => onSelect(item.id)}
              onpointerdown={(event) => handlePointerDown(event, item.id)}
              aria-pressed={item.id === selectedId}
              aria-label="Place photo on the timeline"
            >
              <div class={`flex flex-col items-center ${item.id === selectedId ? 'translate-y-[-2px]' : ''}`}>
                <div class={`flex items-center gap-2 rounded-[18px] border px-2.5 py-2 backdrop-blur-sm ${getMarkerToneClass(item.id)}`}>
                  <div class="h-9 w-9 overflow-hidden rounded-[12px] border border-paper-300/70 bg-paper-100/90">
                    <img class="h-full w-full object-cover" src={item.imageUrl} alt={item.filename} draggable="false" />
                  </div>
                  <div class="grid min-w-[4.75rem] gap-0.5 text-left leading-none">
                    <span class="text-[0.52rem] font-bold uppercase tracking-[0.2em] text-muted/70">Place</span>
                    <span class="text-[0.72rem] font-semibold">{getPositionLabel(item)}</span>
                  </div>
                </div>
                <div class={`h-9 w-[2px] rounded-full ${getMarkerStemClass(item.id)}`}></div>
                <div class={`grid h-4 w-4 place-items-center rotate-45 rounded-[4px] border-2 shadow-[0_10px_18px_rgba(47,36,27,0.18)] ${getMarkerTipClass(item.id)}`}>
                  <span class={`block h-1.5 w-1.5 -rotate-45 rounded-full ${getMarkerCoreClass(item.id)}`}></span>
                </div>
              </div>
            </button>
          {/if}
        {/each}
      </div>
    </div>
  </div>
</section>
