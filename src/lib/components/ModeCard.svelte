<script lang="ts">
  interface Props {
    title: string;
    subtitle: string;
    count: number;
    bestStreak: number;
    disabled?: boolean;
    accent: string;
    onPlay: () => void;
  }

  let { title, subtitle, count, bestStreak, disabled = false, accent, onPlay }: Props = $props();
</script>

<article class="mode-card panel card-enter" style={`--accent-mode:${accent}`}>
  <div>
    <p class="kicker">Game mode</p>
    <h3>{title}</h3>
    <p>{subtitle}</p>
  </div>

  <div class="stats">
    <div>
      <span>Playable photos</span>
      <strong>{count}</strong>
    </div>
    <div>
      <span>Best streak</span>
      <strong>{bestStreak}</strong>
    </div>
  </div>

  <button class="button-primary" disabled={disabled} onclick={onPlay}>
    {disabled ? 'Need more photos' : 'Start round'}
  </button>
</article>

<style>
  .mode-card {
    padding: 24px;
    display: grid;
    gap: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 249, 242, 0.92)),
      linear-gradient(135deg, color-mix(in srgb, var(--accent-mode), white 70%), transparent);
  }

  .kicker,
  span,
  p {
    color: var(--muted);
  }

  .kicker {
    margin: 0;
    font-size: 0.86rem;
  }

  h3 {
    margin: 8px 0;
    font-family: var(--font-display);
    font-size: 1.7rem;
  }

  p {
    margin: 0;
    line-height: 1.5;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .stats div {
    display: grid;
    gap: 6px;
    padding: 14px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.72);
  }
</style>
