<script lang="ts">
  import { browser } from '$app/environment';

  import type { GeoPoint } from '$types/models';

  interface Props {
    guess?: GeoPoint | null;
    answer?: GeoPoint | null;
    disabled?: boolean;
    onSelect: (point: GeoPoint) => void;
    onConfirm?: () => void;
  }

  interface Tile {
    key: string;
    left: number;
    top: number;
    src: string;
  }

  interface ScreenPoint {
    x: number;
    y: number;
  }

  interface Snapshot {
    tiles: Tile[];
    guessPoint: ScreenPoint | null;
    answerPoint: ScreenPoint | null;
    connectorPath: string;
  }

  const TILE_SIZE = 256;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 17;
  const DEFAULT_ZOOM = 2;
  const DEFAULT_CENTER: GeoPoint = { lat: 20, lng: 10 };
  const PREVIEW_VIEWPORT_WIDTH = 320;
  const PREVIEW_VIEWPORT_HEIGHT = 240;

  let { guess = null, answer = null, disabled = false, onSelect, onConfirm }: Props = $props();

  let expanded = $state(false);
  let expandedViewport = $state<HTMLDivElement | null>(null);
  let expandedWidth = $state(0);
  let expandedHeight = $state(0);
  let expandedSnapshot = $state<Snapshot>({ tiles: [], guessPoint: null, answerPoint: null, connectorPath: '' });
  let zoom = $state(DEFAULT_ZOOM);
  let centerWorldX = $state(0);
  let centerWorldY = $state(0);
  let pointerId = $state<number | null>(null);
  let dragStartX = $state(0);
  let dragStartY = $state(0);
  let dragStartCenterX = $state(0);
  let dragStartCenterY = $state(0);
  let didDrag = $state(false);
  let lastViewportMode = $state<'preview' | 'result' | 'world'>('world');

  function scaleAt(zoomLevel: number) {
    return TILE_SIZE * 2 ** zoomLevel;
  }

  function clampLat(lat: number) {
    return Math.max(-85.05112878, Math.min(85.05112878, lat));
  }

  function normalizeLng(lng: number) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  function project(point: GeoPoint, zoomLevel: number) {
    const scale = scaleAt(zoomLevel);
    const latitude = clampLat(point.lat);
    const x = ((normalizeLng(point.lng) + 180) / 360) * scale;
    const sinLatitude = Math.sin((latitude * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale;

    return { x, y };
  }

  function unproject(x: number, y: number, zoomLevel: number): GeoPoint {
    const scale = scaleAt(zoomLevel);
    const wrappedX = ((x % scale) + scale) % scale;
    const lng = (wrappedX / scale) * 360 - 180;
    const mercator = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(mercator));

    return { lat, lng: normalizeLng(lng) };
  }

  function wrapWorldX(x: number, scale: number) {
    return ((x % scale) + scale) % scale;
  }

  function clampWorldY(y: number, scale: number) {
    return Math.max(0, Math.min(scale, y));
  }

  function setCenter(point: GeoPoint) {
    const projected = project(point, zoom);
    const scale = scaleAt(zoom);
    centerWorldX = wrapWorldX(projected.x, scale);
    centerWorldY = clampWorldY(projected.y, scale);
  }

  function resetToWorldView() {
    zoom = DEFAULT_ZOOM;
    setCenter(DEFAULT_CENTER);
  }

  function getTopLeftWorld(width: number, height: number) {
    return {
      x: centerWorldX - width / 2,
      y: centerWorldY - height / 2
    };
  }

  function screenToLatLng(screenX: number, screenY: number, width: number, height: number) {
    const topLeft = getTopLeftWorld(width, height);
    return unproject(topLeft.x + screenX, topLeft.y + screenY, zoom);
  }

  function fitToResult() {
    const width = expandedWidth || PREVIEW_VIEWPORT_WIDTH;
    const height = expandedHeight || PREVIEW_VIEWPORT_HEIGHT;

    if (!guess || !answer || !width || !height) {
      return;
    }

    const latRange = Math.abs(guess.lat - answer.lat);
    const lngRange = Math.abs(normalizeLng(guess.lng - answer.lng));
    const span = Math.max(latRange, lngRange * 0.7);

    let nextZoom = 4;
    if (span > 130) nextZoom = 1;
    else if (span > 70) nextZoom = 2;
    else if (span > 28) nextZoom = 3;
    else if (span > 11) nextZoom = 4;
    else if (span > 5) nextZoom = 5;
    else if (span > 2) nextZoom = 6;
    else nextZoom = 7;

    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));

    const guessProjected = project(guess, zoom);
    const answerProjected = project(answer, zoom);
    const scale = scaleAt(zoom);
    let answerX = answerProjected.x;

    while (answerX - guessProjected.x > scale / 2) {
      answerX -= scale;
    }

    while (guessProjected.x - answerX > scale / 2) {
      answerX += scale;
    }

    centerWorldX = wrapWorldX((guessProjected.x + answerX) / 2, scale);
    centerWorldY = clampWorldY((guessProjected.y + answerProjected.y) / 2, scale);
  }

  function buildSnapshot(width: number, height: number): Snapshot {
    if (!width || !height) {
      return { tiles: [], guessPoint: null, answerPoint: null, connectorPath: '' };
    }

    const scale = scaleAt(zoom);
    const normalizedCenterX = wrapWorldX(centerWorldX, scale);
    const normalizedCenterY = clampWorldY(centerWorldY, scale);
    const topLeft = {
      x: normalizedCenterX - width / 2,
      y: normalizedCenterY - height / 2
    };
    const tileCount = 2 ** zoom;
    const minTileX = Math.floor(topLeft.x / TILE_SIZE);
    const maxTileX = Math.floor((topLeft.x + width) / TILE_SIZE);
    const minTileY = Math.floor(topLeft.y / TILE_SIZE);
    const maxTileY = Math.floor((topLeft.y + height) / TILE_SIZE);
    const tiles: Tile[] = [];

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) {
        continue;
      }

      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
        const subdomain = ['a', 'b', 'c', 'd'][(wrappedTileX + tileY) % 4];
        tiles.push({
          key: `${zoom}-${width}-${height}-${tileX}-${tileY}`,
          left: tileX * TILE_SIZE - topLeft.x,
          top: tileY * TILE_SIZE - topLeft.y,
          src: `https://${subdomain}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedTileX}/${tileY}.png`
        });
      }
    }

    function screenPointFor(point: GeoPoint): ScreenPoint {
      const projected = project(point, zoom);
      let worldX = projected.x;

      while (worldX - normalizedCenterX > scale / 2) {
        worldX -= scale;
      }

      while (normalizedCenterX - worldX > scale / 2) {
        worldX += scale;
      }

      return {
        x: worldX - topLeft.x,
        y: projected.y - topLeft.y
      };
    }

    const guessPoint = guess ? screenPointFor(guess) : null;
    const answerPoint = answer ? screenPointFor(answer) : null;
    const connectorPath =
      guessPoint && answerPoint ? `M ${guessPoint.x} ${guessPoint.y} L ${answerPoint.x} ${answerPoint.y}` : '';

    return { tiles, guessPoint, answerPoint, connectorPath };
  }

  function openExpandedMap() {
    expanded = true;
  }

  function closeExpandedMap() {
    expanded = false;
  }

  function zoomAt(delta: 1 | -1, anchorX = expandedWidth / 2, anchorY = expandedHeight / 2) {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    if (nextZoom === zoom || !expandedWidth || !expandedHeight) {
      return;
    }

    const focusPoint = screenToLatLng(anchorX, anchorY, expandedWidth, expandedHeight);
    zoom = nextZoom;

    const projectedFocus = project(focusPoint, zoom);
    const scale = scaleAt(zoom);
    centerWorldX = wrapWorldX(projectedFocus.x - (anchorX - expandedWidth / 2), scale);
    centerWorldY = clampWorldY(projectedFocus.y - (anchorY - expandedHeight / 2), scale);
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();

    if (!expandedViewport) {
      return;
    }

    const rect = expandedViewport.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
  }

  function handlePointerDown(event: PointerEvent) {
    if (!expandedViewport || event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    didDrag = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartCenterX = centerWorldX;
    dragStartCenterY = centerWorldY;
    expandedViewport.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (pointerId !== event.pointerId) {
      return;
    }

    const scale = scaleAt(zoom);
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;

    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      didDrag = true;
    }

    centerWorldX = wrapWorldX(dragStartCenterX - deltaX, scale);
    centerWorldY = clampWorldY(dragStartCenterY - deltaY, scale);
  }

  function finishPointer(event: PointerEvent) {
    if (!expandedViewport || pointerId !== event.pointerId) {
      return;
    }

    if (expandedViewport.hasPointerCapture(event.pointerId)) {
      expandedViewport.releasePointerCapture(event.pointerId);
    }

    pointerId = null;

    if (didDrag || disabled) {
      return;
    }

    const rect = expandedViewport.getBoundingClientRect();
    onSelect(screenToLatLng(event.clientX - rect.left, event.clientY - rect.top, expandedWidth, expandedHeight));
  }

  function cancelPointer(event: PointerEvent) {
    if (!expandedViewport || pointerId !== event.pointerId) {
      return;
    }

    if (expandedViewport.hasPointerCapture(event.pointerId)) {
      expandedViewport.releasePointerCapture(event.pointerId);
    }

    pointerId = null;
  }

  function handleDoubleClick(event: MouseEvent) {
    event.preventDefault();

    if (!expandedViewport) {
      return;
    }

    const rect = expandedViewport.getBoundingClientRect();
    zoomAt(1, event.clientX - rect.left, event.clientY - rect.top);
  }

  function handleConfirm() {
    onConfirm?.();
    closeExpandedMap();
  }

  resetToWorldView();

  $effect(() => {
    const nextMode = answer ? 'result' : guess ? 'preview' : 'world';

    if (nextMode === 'result' && lastViewportMode !== 'result') {
      fitToResult();
    } else if (nextMode === 'world' && lastViewportMode !== 'world') {
      resetToWorldView();
    }

    lastViewportMode = nextMode;
    expandedSnapshot = buildSnapshot(expandedWidth, expandedHeight);
  });

  $effect(() => {
    if (!browser || !expanded) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeExpandedMap();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  });
</script>

<button
  type="button"
  class="group relative block aspect-[4/3] min-h-[150px] w-full overflow-hidden rounded-[20px] border border-paper-300/80 bg-[linear-gradient(145deg,#1b2a42,#132237)] shadow-[0_18px_40px_rgba(6,11,20,0.42)] transition-transform duration-300 hover:scale-[1.03]"
  onclick={openExpandedMap}
  aria-label={disabled ? 'Open result map' : 'Open full map'}
>
  <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(84,120,147,0.24),transparent_42%),linear-gradient(180deg,rgba(22,34,52,0.34),rgba(10,17,29,0.14))]"></div>

  <div class="relative flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-ink">
    <div class="flex h-14 w-14 items-center justify-center rounded-[18px] border border-paper-300/65 bg-paper-200/72 shadow-[0_14px_28px_rgba(60,48,35,0.14)] backdrop-blur-sm transition duration-200 group-hover:scale-[1.03]">
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z"></path>
        <path d="M9 4v13.5"></path>
        <path d="M15 6.5V20"></path>
        <path d="M12 12.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2Z"></path>
      </svg>
    </div>

    <div class="space-y-1">
      <p class="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-ink/70">
        {#if disabled}
          Open result map
        {:else if guess}
          Refine your guess
        {:else}
          Open map
        {/if}
      </p>
    </div>
  </div>

  <div class="pointer-events-none absolute inset-0 bg-linear-to-t from-ink/40 via-transparent to-transparent"></div>
  <div class="pointer-events-none absolute left-3 top-3 rounded-full border border-paper-300/70 bg-paper-200/88 px-3 py-1 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-ink shadow-[0_10px_18px_rgba(60,48,35,0.14)]">
    {#if disabled}
      Result map
    {:else if guess}
      Tap to refine
    {:else}
      Tap to guess
    {/if}
  </div>
</button>

{#if expanded}
  <div class="fixed inset-0 z-40">
    <button type="button" class="absolute inset-0 bg-ink/55 backdrop-blur-sm" aria-label="Close map overlay" onclick={closeExpandedMap}></button>

    <div class="absolute inset-3 z-10 flex flex-col overflow-hidden rounded-[30px] border border-paper-300/65 bg-[rgba(22,35,55,0.96)] p-3 shadow-[0_30px_90px_rgba(7,11,20,0.48)] sm:inset-6 sm:p-4" role="dialog" aria-modal="true" aria-label="Expanded world map">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <p class="text-[0.72rem] font-bold uppercase tracking-[0.22em] text-clay-600/80">LocationGuessr Map</p>
          <p class="text-sm text-muted">
            {#if disabled && guess}
              Compare the orange guess marker with the green answer marker.
            {:else if guess}
              Drag to pan, use the wheel to zoom, and click again if you want to move your pin.
            {:else}
              Pan and zoom around the world, then click once to place your guess.
            {/if}
          </p>
        </div>

        <div class="flex items-center gap-2">
          {#if !disabled}
            <button type="button" class="mq-btn-primary min-w-[150px] px-4 py-2.5 text-sm" onclick={handleConfirm} disabled={!guess}>
              Confirm guess
            </button>
          {/if}
          <button type="button" class="mq-btn-secondary h-10 px-4 py-2" onclick={closeExpandedMap}>
            Close
          </button>
        </div>
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden rounded-[24px] border border-paper-300/70 bg-[#0a1f3c]">
        <div
          bind:this={expandedViewport}
          bind:clientWidth={expandedWidth}
          bind:clientHeight={expandedHeight}
          class="map-surface h-full w-full touch-none select-none"
          role="application"
          aria-label="Interactive world map"
          onwheel={handleWheel}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={finishPointer}
          onpointercancel={cancelPointer}
          ondblclick={handleDoubleClick}
        >
          <div class="pointer-events-none absolute inset-0 overflow-hidden">
            {#each expandedSnapshot.tiles as tile (tile.key)}
              <img
                class="map-tile absolute block h-64 w-64 max-w-none"
                src={tile.src}
                alt=""
                draggable="false"
                loading="eager"
                width="256"
                height="256"
                style={`left:${tile.left}px; top:${tile.top}px;`}
              />
            {/each}
          </div>

    <svg
      viewBox={`0 0 ${Math.max(expandedWidth, 1)} ${Math.max(expandedHeight, 1)}`}
      class="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {#if expandedSnapshot.connectorPath}
        <path d={expandedSnapshot.connectorPath} fill="none" stroke="rgba(47, 36, 27, 0.45)" stroke-width="3" stroke-dasharray="10 8" />
      {/if}

            {#if expandedSnapshot.answerPoint}
              <circle cx={expandedSnapshot.answerPoint.x} cy={expandedSnapshot.answerPoint.y} r="18" fill="rgba(74, 116, 88, 0.22)" />
              <circle cx={expandedSnapshot.answerPoint.x} cy={expandedSnapshot.answerPoint.y} r="10" fill="#4a7458" stroke="var(--color-ink)" stroke-width="4" />
            {/if}

            {#if expandedSnapshot.guessPoint}
              <circle cx={expandedSnapshot.guessPoint.x} cy={expandedSnapshot.guessPoint.y} r="18" fill="rgba(217, 138, 95, 0.2)" />
              <circle cx={expandedSnapshot.guessPoint.x} cy={expandedSnapshot.guessPoint.y} r="10" fill="#d98a5f" stroke="var(--color-ink)" stroke-width="4" />
            {/if}
          </svg>

          <div class="pointer-events-none absolute left-4 top-4 rounded-full border border-paper-300/70 bg-paper-200/90 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-ink shadow-[0_12px_20px_rgba(60,48,35,0.12)]">
            {#if disabled}
              Final reveal
            {:else}
              Pan, zoom, click to place
            {/if}
          </div>

          <div class="absolute right-4 top-4 z-10 flex flex-col gap-2">
            <button type="button" class="map-control-button" onclick={() => zoomAt(1)} aria-label="Zoom in">+</button>
            <button type="button" class="map-control-button" onclick={() => zoomAt(-1)} aria-label="Zoom out">-</button>
          </div>

          <div class="pointer-events-none absolute bottom-4 left-4 max-w-[min(90%,420px)] rounded-[22px] border border-paper-300/70 bg-paper-200/92 px-4 py-3 text-sm text-muted shadow-[0_18px_28px_rgba(60,48,35,0.14)]">
            {#if disabled && guess}
              Orange is your guess, green is the answer.
            {:else if guess}
              Pin set. Click anywhere else on the map if you want to move it.
            {:else}
              Start broad, zoom in, then click once to drop your pin.
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .map-surface {
    position: relative;
    background:
      radial-gradient(circle at top, rgba(16, 30, 52, 0.45), transparent 38%),
      linear-gradient(180deg, #1e2e49, #101d30);
  }

  .map-tile {
    image-rendering: auto;
  }

  [role='application'].map-surface {
    cursor: grab;
  }

  [role='application'].map-surface:active {
    cursor: grabbing;
  }

  .map-control-button {
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid rgba(84, 108, 140, 0.75);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-paper-200) 88%, black 12%);
    color: var(--color-ink);
    font-size: 1.45rem;
    line-height: 1;
    box-shadow: 0 18px 28px rgba(60, 48, 35, 0.14);
  }

  .map-control-button:hover {
    transform: translateY(-1px);
  }
</style>
