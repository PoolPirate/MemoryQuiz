<script lang="ts">
  import type { GeoPoint } from '$types/models';

  interface Props {
    guess?: GeoPoint | null;
    answer?: GeoPoint | null;
    disabled?: boolean;
    onSelect: (point: GeoPoint) => void;
  }

  let { guess = null, answer = null, disabled = false, onSelect }: Props = $props();

  function handleClick(event: MouseEvent) {
    if (disabled) {
      return;
    }

    const target = event.currentTarget as SVGSVGElement;
    const rect = target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const lng = x * 360 - 180;
    const lat = 90 - y * 180;
    onSelect({ lat, lng });
  }

  function toCoords(point: GeoPoint) {
    return {
      x: ((point.lng + 180) / 360) * 1000,
      y: ((90 - point.lat) / 180) * 500
    };
  }
</script>

<div class="map-wrap panel">
  <button type="button" class="map-button" aria-label="World map" onclick={handleClick} disabled={disabled}>
    <svg viewBox="0 0 1000 500">
    <rect width="1000" height="500" rx="28" fill="#7ab5da" />
    {#each Array.from({ length: 11 }, (_, index) => index) as line}
      <line x1={line * 100} y1="0" x2={line * 100} y2="500" stroke="rgba(255,255,255,0.2)" />
    {/each}
    {#each Array.from({ length: 6 }, (_, index) => index + 1) as line}
      <line x1="0" y1={line * 70} x2="1000" y2={line * 70} stroke="rgba(255,255,255,0.2)" />
    {/each}

    <path d="M88 138c42-37 110-53 159-35 25 9 42 28 63 33 18 4 31 2 44 10 21 12 30 42 20 62-15 30-55 50-92 59-28 7-62 13-89 4-26-8-58-33-70-66-11-28-18-50-35-67z" fill="#d8e1b4" />
    <path d="M274 266c18-10 39-3 56 11 18 14 20 31 34 47 14 16 42 15 53 34 9 16 6 40-8 52-23 19-63 23-90 8-25-14-37-44-54-65-17-22-29-56-17-87 4-11 14-21 26-28z" fill="#d8e1b4" />
    <path d="M446 130c34-37 90-54 148-48 31 3 69 15 82 38 11 18 7 35 21 53 20 25 63 37 77 68 12 26 7 66-13 87-31 32-87 47-144 44-56-2-104-23-132-58-24-31-41-77-35-118 4-27 14-47 30-66 17-19 16-15 0 0z" fill="#d8e1b4" />
    <path d="M635 296c22-16 55-18 84-4 20 10 31 30 47 43 22 18 58 20 73 42 18 25 10 64-18 82-31 20-79 20-113 5-33-14-51-43-65-72-14-27-29-71-8-96z" fill="#d8e1b4" />
    <path d="M782 159c19-17 50-21 74-10 16 8 27 24 40 33 19 13 46 14 58 34 10 18 7 43-7 58-19 20-52 25-80 19-33-7-64-27-80-56-13-23-17-58-5-78z" fill="#d8e1b4" />
    <path d="M846 382c17-10 40-10 56 0 17 10 24 32 17 50-10 24-38 36-63 30-21-5-37-24-36-45 0-15 10-28 26-35z" fill="#d8e1b4" />

    {#if answer}
      {@const point = toCoords(answer)}
      <circle cx={point.x} cy={point.y} r="11" fill="#2f8f62" stroke="white" stroke-width="4" />
    {/if}

    {#if guess}
      {@const point = toCoords(guess)}
      <circle cx={point.x} cy={point.y} r="11" fill="#ea7c52" stroke="white" stroke-width="4" />
    {/if}

    {#if answer && guess}
      {@const guessPoint = toCoords(guess)}
      {@const answerPoint = toCoords(answer)}
      <line
        x1={guessPoint.x}
        y1={guessPoint.y}
        x2={answerPoint.x}
        y2={answerPoint.y}
        stroke="rgba(34, 49, 63, 0.35)"
        stroke-dasharray="8 7"
        stroke-width="3"
      />
    {/if}
    </svg>
  </button>
</div>

<style>
  .map-wrap {
    padding: 14px;
  }

  .map-button {
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
  }

  svg {
    width: 100%;
    height: auto;
    display: block;
    cursor: crosshair;
    border-radius: 24px;
  }
</style>
