<script lang="ts">
  interface Props {
    title: string;
    subtitle: string;
    count: number;
    activeStreak: number;
    bestStreak: number;
    disabled?: boolean;
    accent: string;
    onPlay: () => void;
  }

  let { title, subtitle, count, activeStreak, bestStreak, disabled = false, accent, onPlay }: Props = $props();
</script>

<article
  class="mq-panel mq-card-enter grid gap-5 p-6"
  style={`background: linear-gradient(180deg, color-mix(in srgb, var(--color-paper-100) 94%, #000 6%), color-mix(in srgb, var(--color-paper-200) 84%, #000 16%)), linear-gradient(135deg, color-mix(in srgb, ${accent} 74%, #0f1623 26%), transparent);`}
>
  <div>
    <p class="text-sm font-medium text-muted">Game mode</p>
    <h3 class="mt-2 font-display text-[1.7rem] leading-none tracking-tight text-ink">{title}</h3>
    <p class="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
  </div>

  <div class="grid gap-3 sm:grid-cols-3">
    <div class="mq-metric-card">
      <span class="text-sm font-medium text-muted">Playable photos</span>
      <strong class="text-[1.02rem] text-ink">{count}</strong>
    </div>

    <div class="mq-metric-card">
      <span class="text-sm font-medium text-muted">Active streak</span>
      <strong class="text-[1.02rem] text-ink">{activeStreak}</strong>
    </div>

    <div class="mq-metric-card">
      <span class="text-sm font-medium text-muted">Best streak</span>
      <strong class="text-[1.02rem] text-ink">{bestStreak}</strong>
    </div>
  </div>

  <button class="mq-btn-primary w-full sm:w-auto" disabled={disabled} onclick={onPlay}>
    {disabled ? 'Need more photos' : activeStreak > 0 ? `Continue streak (${activeStreak})` : 'Start round'}
  </button>
</article>
