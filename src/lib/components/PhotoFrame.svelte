<script lang="ts">
  interface Props {
    src: string;
    alt: string;
    label?: string | null;
  }

  let { src, alt, label = null }: Props = $props();
</script>

<figure class="photo-frame panel">
  <img {src} {alt} loading="eager" />
  {#if label}
    <figcaption>{label}</figcaption>
  {/if}
</figure>

<style>
  .photo-frame {
    padding: 14px;
    display: grid;
    gap: 10px;
  }

  img {
    width: 100%;
    height: min(52vh, 420px);
    object-fit: contain;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.7);
  }

  figcaption {
    color: var(--muted);
    text-align: center;
  }
</style>
