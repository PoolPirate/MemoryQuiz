<script lang="ts">
  import { browser } from '$app/environment';

  import type { GeoPoint } from '$types/models';

  interface Props {
    guess?: GeoPoint | null;
    answer?: GeoPoint | null;
    allowedRadiusKm?: number;
    disabled?: boolean;
    onSelect: (point: GeoPoint) => void;
    onConfirm?: () => void;
  }

  type PanelState = 'preview' | 'expanded' | 'result';

  const DEFAULT_CENTER: [number, number] = [10, 20];
  const DEFAULT_ZOOM = 1.8;
  const GUESS_ZOOM = 6;
  const RESULT_PADDING = 80;
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const ATTRIBUTION_TEXT = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

  let { guess = null, answer = null, allowedRadiusKm, disabled = false, onSelect, onConfirm }: Props = $props();

  let panelState = $state<PanelState>('preview');
  let mapHost = $state<HTMLDivElement | null>(null);
  let map = $state<any>(null);
  let mapReady = $state(false);
  let mapError = $state('');
  let maplibreModule = $state<any>(null);

  let guessMarker = $state<any>(null);
  let answerMarker = $state<any>(null);
  let hadAnswerForReset = $state(false);

  function normalizeLng(lng: number) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
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

  function createMarkerElement(color: string, size: number, label: string) {
    const el = document.createElement('div');
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = '50%';
    el.style.background = color;
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
    el.style.cursor = 'pointer';
    el.setAttribute('aria-label', label);
    return el;
  }

  function radiusKmToMeters(km: number) {
    return km * 1000;
  }

  function createCircleGeoJSON(center: GeoPoint, radiusKm: number, steps = 64): GeoJSON.Feature {
    const coords: [number, number][] = [];
    const earthRadius = 6371;
    const angularRadius = radiusKm / earthRadius;
    const centerLat = (center.lat * Math.PI) / 180;
    const centerLng = (center.lng * Math.PI) / 180;

    for (let i = 0; i <= steps; i++) {
      const bearing = (2 * Math.PI * i) / steps;
      const lat = Math.asin(
        Math.sin(centerLat) * Math.cos(angularRadius) +
        Math.cos(centerLat) * Math.sin(angularRadius) * Math.cos(bearing)
      );
      const lng = centerLng + Math.atan2(
        Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(centerLat),
        Math.cos(angularRadius) - Math.sin(centerLat) * Math.sin(lat)
      );

      coords.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI]);
    }

    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coords] }
    };
  }

  function fitToBothPoints(mapInstance: any, a: GeoPoint, b: GeoPoint) {
    const { LngLatBounds } = mapInstance.constructor ? { LngLatBounds: (mapInstance as any).__proto__.constructor.LngLatBounds } : { LngLatBounds: null };

    const sw: [number, number] = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat)];
    const ne: [number, number] = [Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];

    mapInstance.fitBounds([sw, ne], {
      padding: RESULT_PADDING,
      maxZoom: 14,
      duration: 900
    });
  }

  function updateResultLayers(mapInstance: any) {
    if (!mapInstance.getSource) return;

    if (guess && answer) {
      const lineData: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [guess.lng, guess.lat],
            [answer.lng, answer.lat]
          ]
        }
      };

      if (mapInstance.getSource('result-line')) {
        mapInstance.getSource('result-line').setData(lineData);
      }

      if (allowedRadiusKm && answer) {
        const circleData = createCircleGeoJSON(answer, allowedRadiusKm);

        if (mapInstance.getSource('radius-circle')) {
          mapInstance.getSource('radius-circle').setData(circleData);
        }
      }
    } else {
      const emptyLine: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] }
      };
      const emptyPoly: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[]] }
      };

      if (mapInstance.getSource('result-line')) {
        mapInstance.getSource('result-line').setData(emptyLine);
      }

      if (mapInstance.getSource('radius-circle')) {
        mapInstance.getSource('radius-circle').setData(emptyPoly);
      }
    }
  }

  $effect(() => {
    if (answer) {
      panelState = 'result';
    } else if (panelState === 'result') {
      panelState = 'preview';
    }
  });

  $effect(() => {
    if (!browser || !map || !mapReady) {
      return;
    }

    const showingAnswer = !!answer;
    if (hadAnswerForReset && !answer && !guess) {
      map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    }
    hadAnswerForReset = showingAnswer;
  });

  $effect(() => {
    if (!browser || !mapHost) {
      return;
    }

    let disposed = false;
    let localMap: any = null;
    let localGuessMarker: any = null;
    let localAnswerMarker: any = null;
    mapReady = false;
    mapError = '';

    void (async () => {
      try {
        const mgl = await import('maplibre-gl');

        if (disposed || !mapHost) {
          return;
        }

        maplibreModule = mgl;

        localMap = new mgl.Map({
          container: mapHost,
          style: STYLE_URL,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxZoom: 19,
          minZoom: 1
        });

        localMap.addControl(new mgl.NavigationControl({ showCompass: false }), 'top-right');
        localMap.addControl(new mgl.ScaleControl({ maxWidth: 120 }), 'bottom-right');
        localMap.addControl(new mgl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION_TEXT }), 'bottom-left');

        localMap.on('load', () => {
          if (disposed) return;

          localMap.addSource('result-line', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
          });

          localMap.addLayer({
            id: 'result-line-layer',
            type: 'line',
            source: 'result-line',
            paint: {
              'line-color': '#ff6eb4',
              'line-width': 3,
              'line-dasharray': [4, 3],
              'line-opacity': 0.85
            }
          });

          localMap.addSource('radius-circle', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[]] } }
          });

          localMap.addLayer({
            id: 'radius-circle-fill',
            type: 'fill',
            source: 'radius-circle',
            paint: {
              'fill-color': '#5cf0c8',
              'fill-opacity': 0.12
            }
          });

          localMap.addLayer({
            id: 'radius-circle-outline',
            type: 'line',
            source: 'radius-circle',
            paint: {
              'line-color': '#5cf0c8',
              'line-width': 2,
              'line-opacity': 0.55,
              'line-dasharray': [6, 4]
            }
          });

          map = localMap;
          mapReady = true;
        });

        localMap.on('click', (e: any) => {
          if (disabled || panelState === 'preview') {
            return;
          }

          onSelect({ lat: e.lngLat.lat, lng: normalizeLng(e.lngLat.lng) });
        });
      } catch (error) {
        mapError = (error as Error).message;
      }
    })();

    return () => {
      disposed = true;

      if (localGuessMarker) {
        localGuessMarker.remove();
        localGuessMarker = null;
      }

      if (localAnswerMarker) {
        localAnswerMarker.remove();
        localAnswerMarker = null;
      }

      if (localMap) {
        localMap.remove();
      }

      if (map === localMap) {
        map = null;
      }

      guessMarker = null;
      answerMarker = null;
      maplibreModule = null;
      mapReady = false;
    };
  });

  $effect(() => {
    if (!browser || !map || !mapReady || !maplibreModule) {
      return;
    }

    const currentGuess = guess;
    const currentAnswer = answer;
    const isDisabled = disabled;
    const currentAllowedRadius = allowedRadiusKm;
    const currentMap = map;
    const mgl = maplibreModule;

    if (currentGuess) {
      if (guessMarker) {
        guessMarker.setLngLat([currentGuess.lng, currentGuess.lat]);
      } else {
        const el = createMarkerElement('#ff6eb4', 22, 'Your guess');
        const m = new mgl.Marker({ element: el, draggable: !isDisabled && !currentAnswer })
          .setLngLat([currentGuess.lng, currentGuess.lat])
          .addTo(currentMap);

        m.on('dragend', () => {
          const lngLat = m.getLngLat();
          onSelect({ lat: lngLat.lat, lng: normalizeLng(lngLat.lng) });
        });

        guessMarker = m;
      }

      if (currentAnswer) {
        guessMarker.setDraggable(false);
      } else {
        guessMarker.setDraggable(!isDisabled);
      }
    } else {
      if (guessMarker) {
        guessMarker.remove();
        guessMarker = null;
      }
    }

    if (currentAnswer) {
      if (answerMarker) {
        answerMarker.setLngLat([currentAnswer.lng, currentAnswer.lat]);
      } else {
        const el = createMarkerElement('#5cf0c8', 22, 'Correct answer');
        const m = new mgl.Marker({ element: el })
          .setLngLat([currentAnswer.lng, currentAnswer.lat])
          .addTo(currentMap);
        answerMarker = m;
      }
    } else {
      if (answerMarker) {
        answerMarker.remove();
        answerMarker = null;
      }
    }

    updateResultLayers(currentMap);

    if (currentGuess && currentAnswer) {
      fitToBothPoints(currentMap, currentGuess, currentAnswer);
    }
  });

  $effect(() => {
    if (!browser || !map || !mapReady) {
      return;
    }

    setTimeout(() => {
      map.resize();
    }, 350);
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

<svelte:head>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.21.1/dist/maplibre-gl.css" />
</svelte:head>

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

    <div class="relative min-h-0 flex-1 overflow-hidden border-t border-paper-300/12">
      <div bind:this={mapHost} class="world-map-host h-full w-full" aria-label="Interactive map"></div>

      {#if !mapReady && !mapError}
        <div class="pointer-events-none absolute inset-0 grid place-items-center bg-ink/22 backdrop-blur-[1px]">
          <div class="grid gap-3 text-center text-ink/82">
            <div class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-paper-100/18 border-t-paper-100/75"></div>
            <p class="text-sm">Loading map...</p>
          </div>
        </div>
      {/if}

      {#if mapError}
        <div class="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          <div class="max-w-sm rounded-2xl border border-danger-400/30 bg-danger-950/45 px-5 py-4 text-ink shadow-[0_20px_40px_rgba(0,0,0,0.3)]">
            <p class="text-sm font-semibold">The map could not load.</p>
            <p class="mt-1 text-sm text-ink/75">{mapError}</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  :global(.world-map-host .maplibregl-ctrl-attrib) {
    font-size: 10px;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    padding: 2px 8px;
    color: rgba(255, 247, 255, 0.6);
  }

  :global(.world-map-host .maplibregl-ctrl-attrib a) {
    color: rgba(255, 247, 255, 0.7);
  }

  :global(.world-map-host .maplibregl-ctrl-scale) {
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    border-radius: 8px;
    border-color: rgba(255, 247, 255, 0.25);
    color: rgba(255, 247, 255, 0.65);
    font-size: 10px;
    padding: 0 6px;
  }

  :global(.world-map-host .maplibregl-ctrl-group) {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    border: 1px solid rgba(255, 247, 255, 0.12);
    overflow: hidden;
  }

  :global(.world-map-host .maplibregl-ctrl-group button) {
    background: transparent;
    border: none;
    width: 36px;
    height: 36px;
  }

  :global(.world-map-host .maplibregl-ctrl-group button + button) {
    border-top: 1px solid rgba(255, 247, 255, 0.1);
  }

  :global(.world-map-host .maplibregl-ctrl-group button span) {
    filter: invert(1) brightness(0.85);
  }
</style>
