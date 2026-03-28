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
  class="mq-panel mq-card-enter group grid gap-5 p-6 transition-transform duration-300 hover:-rotate-[0.35deg] hover:scale-[1.01]"
  style={`background: linear-gradient(165deg, color-mix(in srgb, var(--color-paper-100) 92%, transparent), color-mix(in srgb, var(--color-paper-200) 88%, transparent)), radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, ${accent} 55%, transparent), transparent 62%);`}
>
  <div>
    <p class="font-display text-xs font-bold uppercase tracking-[0.2em] text-candy-mint/90">Game mode</p>
    <h3 class="mt-2 font-display text-[1.85rem] leading-none tracking-tight text-ink drop-shadow-[0_2px_0_color-mix(in_srgb,var(--color-pop)_35%,transparent)]">
      {title}
    </h3>
    <p class="mt-2 text-sm leading-7 text-muted">{subtitle}</p>
  </div>

  <div class="grid gap-3 sm:grid-cols-3">
    <div class="mq-metric-card">
      <span class="text-xs font-bold uppercase tracking-wider text-muted">Playable photos</span>
      <strong class="font-display text-[1.15rem] text-candy-lemon">{count}</strong>
    </div>

    <div class="mq-metric-card">
      <span class="text-xs font-bold uppercase tracking-wider text-muted">Active streak</span>
      <strong class="font-display text-[1.15rem] text-candy-mint">{activeStreak}</strong>
    </div>

    <div class="mq-metric-card">
      <span class="text-xs font-bold uppercase tracking-wider text-muted">Best streak</span>
      <strong class="font-display text-[1.15rem] text-candy-pink">{bestStreak}</strong>
    </div>
  </div>

  <button class="mq-btn-primary w-full sm:w-auto" disabled={disabled} onclick={onPlay}>
    {disabled ? 'Need more photos' : activeStreak > 0 ? `Continue streak (${activeStreak})` : 'Start round'}
  </button>
</article>
