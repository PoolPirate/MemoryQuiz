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

  type FocusTarget = 'default' | 'guess' | 'answer' | 'both';
  type ViewMode = 'world' | 'preview' | 'result';

  const DEFAULT_VIEW = { lat: 20, lng: 10, altitude: 1.55 };
  const MIN_ALTITUDE = 0.72;
  const MAX_ALTITUDE = 2.65;
  const GLOBE_IMAGE_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg';
  const GLOBE_BUMP_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png';

  let { guess = null, answer = null, disabled = false, onSelect, onConfirm }: Props = $props();

  let expanded = $state(false);
  let globeHost = $state<HTMLDivElement | null>(null);
  let globe = $state<any>(null);
  let globeReady = $state(false);
  let globeError = $state('');
  let selectedFocus = $state<FocusTarget>('default');
  let lastViewportMode = $state<ViewMode>('world');

  function normalizeLng(lng: number) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  function getViewMode(): ViewMode {
    return answer ? 'result' : guess ? 'preview' : 'world';
  }

  function clampAltitude(altitude: number) {
    return Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, altitude));
  }

  function toRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  function toDegrees(value: number) {
    return (value * 180) / Math.PI;
  }

  function pointToVector(point: GeoPoint) {
    const lat = toRadians(point.lat);
    const lng = toRadians(point.lng);
    const cosLat = Math.cos(lat);

    return {
      x: cosLat * Math.cos(lng),
      y: Math.sin(lat),
      z: cosLat * Math.sin(lng)
    };
  }

  function midpointOnSphere(points: GeoPoint[]) {
    const total = points.reduce(
      (sum, point) => {
        const vector = pointToVector(point);
        return {
          x: sum.x + vector.x,
          y: sum.y + vector.y,
          z: sum.z + vector.z
        };
      },
      { x: 0, y: 0, z: 0 }
    );
    const length = Math.hypot(total.x, total.y, total.z);

    if (!length) {
      return { lat: points[0]?.lat ?? DEFAULT_VIEW.lat, lng: points[0]?.lng ?? DEFAULT_VIEW.lng };
    }

    return {
      lat: toDegrees(Math.asin(total.y / length)),
      lng: normalizeLng(toDegrees(Math.atan2(total.z, total.x)))
    };
  }

  function angularDistance(a: GeoPoint, b: GeoPoint) {
    const latA = toRadians(a.lat);
    const latB = toRadians(b.lat);
    const lngDelta = toRadians(b.lng - a.lng);
    const cosine =
      Math.sin(latA) * Math.sin(latB) + Math.cos(latA) * Math.cos(latB) * Math.cos(lngDelta);

    return Math.acos(Math.max(-1, Math.min(1, cosine)));
  }

  function getCombinedView(a: GeoPoint, b: GeoPoint) {
    const midpoint = midpointOnSphere([a, b]);
    const distance = angularDistance(a, b);

    return {
      lat: midpoint.lat,
      lng: midpoint.lng,
      altitude: clampAltitude(1.02 + distance * 0.52)
    };
  }

  function resolveFocusTarget(target: FocusTarget) {
    if (target === 'default') {
      return DEFAULT_VIEW;
    }

    if (target === 'guess' && guess) {
      return { lat: guess.lat, lng: guess.lng, altitude: 0.9 };
    }

    if (target === 'answer' && answer) {
      return { lat: answer.lat, lng: answer.lng, altitude: 0.9 };
    }

    if (target === 'both' && guess && answer) {
      return getCombinedView(guess, answer);
    }

    if (answer) {
      return { lat: answer.lat, lng: answer.lng, altitude: 0.98 };
    }

    if (guess) {
      return { lat: guess.lat, lng: guess.lng, altitude: 0.98 };
    }

    return DEFAULT_VIEW;
  }

  function getDefaultFocusTarget(): FocusTarget {
    return guess && answer ? 'both' : guess ? 'guess' : 'default';
  }

  function refreshGlobeData() {
    if (!globe) {
      return;
    }

    const markers = [
      ...(answer
        ? [{ id: 'answer', lat: answer.lat, lng: answer.lng, color: '#5cf0c8', altitude: 0.028, radius: 0.58 }]
        : []),
      ...(guess
        ? [{ id: 'guess', lat: guess.lat, lng: guess.lng, color: '#ff6eb4', altitude: 0.032, radius: 0.62 }]
        : [])
    ];

    globe.pointsData(markers);
    globe.arcsData(
      guess && answer
        ? [
            {
              startLat: guess.lat,
              startLng: guess.lng,
              endLat: answer.lat,
              endLng: answer.lng,
              altitude: 0.2 + angularDistance(guess, answer) * 0.05,
              colors: ['rgba(255, 110, 180, 0.92)', 'rgba(92, 240, 200, 0.92)']
            }
          ]
        : []
    );
  }

  function moveCameraTo(target: FocusTarget, duration = 800) {
    if (!globe) {
      selectedFocus = target;
      return;
    }

    selectedFocus = target;
    globe.pointOfView(resolveFocusTarget(target), duration);
  }

  function handleConfirm() {
    onConfirm?.();
    closeExpandedMap();
  }

  function openExpandedMap() {
    selectedFocus = getDefaultFocusTarget();
    expanded = true;
  }

  function closeExpandedMap() {
    expanded = false;
  }

  function adjustZoom(factor: number) {
    if (!globe) {
      return;
    }

    const pov = globe.pointOfView();
    globe.pointOfView({ ...pov, altitude: clampAltitude(pov.altitude * factor) }, 280);
  }

  resetToCurrentMode();

  function resetToCurrentMode() {
    lastViewportMode = getViewMode();
    selectedFocus = getDefaultFocusTarget();
  }

  $effect(() => {
    const nextMode = getViewMode();

    if (nextMode !== lastViewportMode) {
      lastViewportMode = nextMode;

      if (globe) {
        moveCameraTo(getDefaultFocusTarget(), 900);
      } else {
        selectedFocus = getDefaultFocusTarget();
      }
    }

    refreshGlobeData();
  });

  $effect(() => {
    if (!browser || !expanded || !globeHost) {
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let localGlobe: any = null;
    globeReady = false;
    globeError = '';

    void (async () => {
      try {
        const { default: createGlobe } = await import('globe.gl');

        if (disposed || !globeHost) {
          return;
        }

        localGlobe = new createGlobe(globeHost, { animateIn: false, waitForGlobeReady: false, rendererConfig: { alpha: true, antialias: true } })
          .backgroundColor('rgba(0,0,0,0)')
          .globeImageUrl(GLOBE_IMAGE_URL)
          .bumpImageUrl(GLOBE_BUMP_URL)
          .showAtmosphere(true)
          .atmosphereColor('#e8a4ff')
          .atmosphereAltitude(0.17)
          .pointAltitude('altitude')
          .pointRadius('radius')
          .pointResolution(18)
          .pointColor('color')
          .pointsMerge(false)
          .arcColor('colors')
          .arcAltitude('altitude')
          .arcStroke(0.6)
          .arcDashLength(0.42)
          .arcDashGap(0.16)
          .arcDashAnimateTime(1700);

        localGlobe.onGlobeClick((coords: { lat: number; lng: number } | null) => {
          if (!coords || disabled) {
            return;
          }

          onSelect({ lat: coords.lat, lng: normalizeLng(coords.lng) });
        });

        localGlobe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const controls = localGlobe.controls();
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.rotateSpeed = 0.82;
        controls.zoomSpeed = 0.85;
        controls.minDistance = 165;
        controls.maxDistance = 360;

        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) {
            return;
          }

          localGlobe.width(entry.contentRect.width);
          localGlobe.height(entry.contentRect.height);
        });

        resizeObserver.observe(globeHost);
        globe = localGlobe;
        refreshGlobeData();
        moveCameraTo(selectedFocus, 0);
        globeReady = true;
      } catch (error) {
        globeError = (error as Error).message;
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();

      if (localGlobe?.pauseAnimation) {
        localGlobe.pauseAnimation();
      }

      if (localGlobe?._destructor) {
        localGlobe._destructor();
      }

      if (globeHost) {
        globeHost.innerHTML = '';
      }

      if (globe === localGlobe) {
        globe = null;
      }

      globeReady = false;
    };
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
  class="group relative block aspect-[4/3] min-h-[150px] w-full transition-transform duration-300 hover:scale-[1.03]"
  onclick={openExpandedMap}
  aria-label={disabled ? 'Open result globe' : 'Open globe'}
>

  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-ink drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover:scale-[1.05]" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M2 12h20"></path>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>
</button>

{#if expanded}
  <div class="fixed inset-0 z-40">
    <button type="button" class="absolute inset-0 bg-ink/55 backdrop-blur-sm" aria-label="Close globe overlay" onclick={closeExpandedMap}></button>

    <div class="absolute inset-3 z-10 flex flex-col overflow-hidden rounded-[30px] border border-paper-300/65 bg-[linear-gradient(180deg,rgba(11,20,32,0.98),rgba(14,28,45,0.97))] p-3 shadow-[0_30px_90px_rgba(7,11,20,0.48)] sm:inset-6 sm:p-4" role="dialog" aria-modal="true" aria-label="Expanded 3D globe">
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-[0.72rem] font-bold uppercase tracking-[0.22em] text-ink/65">LocationGuessr Globe</p>
          <p class="text-sm text-ink/78">
            {#if disabled && guess}
              Compare the orange guess marker with the green answer marker. Use the focus chips if one point is on the far side.
            {:else if guess}
              Drag to rotate, use the wheel or +/- to zoom, and click again if you want to move your pin.
            {:else}
              Rotate the globe, zoom in, and click once to place your guess.
            {/if}
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          {#if guess && answer}
            <button type="button" class:selected-focus={selectedFocus === 'both'} class="map-chip" onclick={() => moveCameraTo('both')}>
              Both
            </button>
            <button type="button" class:selected-focus={selectedFocus === 'guess'} class="map-chip" onclick={() => moveCameraTo('guess')}>
              Guess
            </button>
            <button type="button" class:selected-focus={selectedFocus === 'answer'} class="map-chip" onclick={() => moveCameraTo('answer')}>
              Answer
            </button>
          {:else}
            <button type="button" class:selected-focus={selectedFocus === 'default'} class="map-chip" onclick={() => moveCameraTo('default')}>
              Reset view
            </button>
          {/if}

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

      <div class="relative min-h-0 flex-1 overflow-hidden rounded-[24px] border border-paper-300/18 bg-[radial-gradient(circle_at_50%_12%,rgba(123,186,255,0.12),transparent_28%),linear-gradient(180deg,#040b16,#091120_55%,#0b1627)]">
        <div bind:this={globeHost} class="h-full w-full" aria-label="Interactive globe"></div>

        {#if !globeReady && !globeError}
          <div class="pointer-events-none absolute inset-0 grid place-items-center bg-ink/22 backdrop-blur-[1px]">
            <div class="grid gap-3 text-center text-ink/82">
              <div class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-paper-100/18 border-t-paper-100/75"></div>
              <p class="text-sm">Loading globe...</p>
            </div>
          </div>
        {/if}

        {#if globeError}
          <div class="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
            <div class="max-w-sm rounded-[24px] border border-danger-400/30 bg-danger-950/45 px-5 py-4 text-ink shadow-[0_20px_40px_rgba(0,0,0,0.3)]">
              <p class="text-sm font-semibold">The globe could not load.</p>
              <p class="mt-1 text-sm text-ink/75">{globeError}</p>
            </div>
          </div>
        {/if}

        <div class="pointer-events-none absolute left-4 top-4 rounded-full border border-paper-300/24 bg-paper-200/10 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-ink/85 shadow-[0_12px_20px_rgba(0,0,0,0.18)] backdrop-blur-md">
          {#if disabled}
            Final reveal
          {:else}
            Rotate, zoom, click to place
          {/if}
        </div>

        <div class="absolute right-4 top-4 z-10 flex flex-col gap-2">
          <button type="button" class="map-control-button" onclick={() => adjustZoom(0.82)} aria-label="Zoom in">+</button>
          <button type="button" class="map-control-button" onclick={() => adjustZoom(1.2)} aria-label="Zoom out">-</button>
        </div>

        <div class="pointer-events-none absolute bottom-4 left-4 max-w-[min(90%,470px)] rounded-[22px] border border-paper-300/22 bg-paper-200/10 px-4 py-3 text-sm text-ink/84 shadow-[0_18px_28px_rgba(0,0,0,0.2)] backdrop-blur-md">
          {#if disabled && guess}
            Orange is your guess, green is the answer, and the arc shows the distance between them.
          {:else if guess}
            Pin set. Click anywhere else on the globe if you want to move it.
          {:else}
            Start broad, rotate into position, then zoom in and click once to drop your pin.
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .map-control-button {
    width: 2.75rem;
    height: 2.75rem;
    border: 3px solid color-mix(in srgb, var(--color-pop) 80%, transparent);
    border-radius: 999px;
    background: linear-gradient(145deg, color-mix(in srgb, var(--color-candy-pink) 55%, transparent), color-mix(in srgb, var(--color-candy-mint) 45%, transparent));
    color: var(--color-pop);
    font-size: 1.45rem;
    font-weight: 800;
    line-height: 1;
    box-shadow: 4px 4px 0 color-mix(in srgb, var(--color-pop) 85%, transparent);
    backdrop-filter: blur(12px);
  }

  .map-control-button:hover {
    transform: translateY(-1px);
  }

  .map-chip {
    height: 2.35rem;
    border: 2px solid color-mix(in srgb, var(--color-candy-lemon) 45%, transparent);
    border-radius: 999px;
    padding: 0 0.95rem;
    background: color-mix(in srgb, var(--color-paper-200) 55%, transparent);
    color: color-mix(in srgb, var(--color-ink) 88%, transparent);
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    backdrop-filter: blur(12px);
    box-shadow: 3px 3px 0 color-mix(in srgb, var(--color-pop) 75%, transparent);
    transition:
      transform 180ms ease,
      background-color 180ms ease,
      border-color 180ms ease,
      color 180ms ease,
      box-shadow 180ms ease;
  }

  .map-chip:hover {
    transform: translate(-1px, -1px);
    border-color: color-mix(in srgb, var(--color-candy-mint) 55%, transparent);
    background: color-mix(in srgb, var(--color-candy-pink) 18%, transparent);
    box-shadow: 4px 4px 0 color-mix(in srgb, var(--color-pop) 75%, transparent);
  }

  .map-chip.selected-focus {
    border-color: color-mix(in srgb, var(--color-candy-pink) 65%, transparent);
    background: color-mix(in srgb, var(--color-candy-lemon) 22%, transparent);
    color: var(--color-pop);
    box-shadow: 4px 4px 0 color-mix(in srgb, var(--color-pop) 78%, transparent);
  }
</style>
