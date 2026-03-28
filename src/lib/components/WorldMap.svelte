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
  type PanelState = 'preview' | 'expanded' | 'result';

  const DEFAULT_VIEW = { lat: 20, lng: 10, altitude: 1.55 };
  const MIN_ALTITUDE = 0.72;
  const MAX_ALTITUDE = 2.65;
  const GLOBE_IMAGE_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg';
  const GLOBE_BUMP_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png';

  let { guess = null, answer = null, disabled = false, onSelect, onConfirm }: Props = $props();

  let panelState = $state<PanelState>('preview');
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

  function openExpandedMap() {
    if (panelState === 'result') {
      return;
    }

    panelState = 'expanded';
  }

  function closeExpandedMap() {
    if (panelState === 'expanded') {
      panelState = 'preview';
    }
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
    if (answer) {
      panelState = 'result';
    } else if (panelState === 'result') {
      panelState = 'preview';
    }
  });

  $effect(() => {
    if (!browser || !globeHost) {
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

        localGlobe = new createGlobe(globeHost, {
          animateIn: false,
          waitForGlobeReady: false,
          rendererConfig: { alpha: true, antialias: true }
        })
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
          if (!coords || disabled || panelState === 'preview') {
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
    if (!browser || panelState === 'preview') {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelState === 'expanded') {
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

<div class="pointer-events-none fixed inset-0 z-30">
  {#if panelState === 'expanded'}
    <button
      type="button"
      class="pointer-events-auto absolute inset-x-0 top-0 h-[30dvh] md:hidden"
      aria-label="Close map"
      onclick={closeExpandedMap}
    ></button>
    <button
      type="button"
      class="pointer-events-auto absolute inset-y-0 left-0 hidden w-[30vw] md:block"
      aria-label="Close map"
      onclick={closeExpandedMap}
    ></button>
  {:else if panelState === 'result'}
    <div class="absolute inset-0 bg-ink/60 backdrop-blur-[2px]"></div>
  {/if}

  <div
    class={`pointer-events-auto absolute z-10 flex flex-col overflow-hidden border bg-[linear-gradient(180deg,rgba(11,20,32,0.98),rgba(14,28,45,0.97))] shadow-[0_30px_90px_rgba(7,11,20,0.48)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${panelState === 'preview' ? 'bottom-5 right-5 aspect-[4/3] w-[min(52vw,280px)] min-w-[170px] origin-bottom-right scale-[0.92] rounded-[28px] border-paper-300/45 hover:scale-100 sm:w-[min(32vw,300px)] lg:w-[300px]' : panelState === 'expanded' ? 'inset-x-4 bottom-4 top-[30dvh] rounded-[32px] border-paper-300/65 md:bottom-4 md:left-[30vw] md:right-4 md:top-4' : 'inset-0 rounded-none border-paper-300/65'}`}
    role={panelState === 'preview' ? undefined : 'dialog'}
    aria-modal={panelState === 'preview' ? undefined : 'true'}
    aria-label={panelState === 'result' ? 'Location comparison map' : 'Location guess map'}
  >
    {#if panelState === 'preview'}
      <button
        type="button"
        class="absolute inset-0 z-20 cursor-zoom-in"
        onclick={openExpandedMap}
        aria-label={disabled ? 'Open result map' : 'Open map'}
      ></button>
    {/if}

    {#if panelState === 'expanded' && guess && !disabled && !answer && onConfirm}
      <div class="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <button
          type="button"
          class="mq-btn-primary shadow-lg"
          onclick={() => {
            onConfirm();
            closeExpandedMap();
          }}
        >
          Confirm Guess
        </button>
      </div>
    {/if}

    <div class="relative min-h-0 flex-1 overflow-hidden rounded-b-[28px] border-t border-paper-300/12 bg-[radial-gradient(circle_at_50%_12%,rgba(123,186,255,0.12),transparent_28%),linear-gradient(180deg,#040b16,#091120_55%,#0b1627)]">
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
          <div class="max-w-sm rounded-2xl border border-danger-400/30 bg-danger-950/45 px-5 py-4 text-ink shadow-[0_20px_40px_rgba(0,0,0,0.3)]">
            <p class="text-sm font-semibold">The globe could not load.</p>
            <p class="mt-1 text-sm text-ink/75">{globeError}</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
</style>
