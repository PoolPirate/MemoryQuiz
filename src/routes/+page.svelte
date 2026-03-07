<script lang="ts">
  import { onMount } from 'svelte';

  import ExportCard from '$components/ExportCard.svelte';
  import ModeCard from '$components/ModeCard.svelte';
  import PhotoFrame from '$components/PhotoFrame.svelte';
  import WorldMap from '$components/WorldMap.svelte';
  import type {
    AppOverview,
    ExportOverview,
    GameMode,
    GeoPoint,
    ImportProgressEvent,
    LocationRound,
    OlderVsNewerRound
  } from '$types/models';
  import { formatBytes, haversineKm } from '$utils/game';

  type Screen = 'exports' | 'modes' | 'location' | 'older-newer';

  let appOverview: AppOverview | null = null;
  let loading = true;
  let screen: Screen = 'exports';
  let selectedExport: ExportOverview | null = null;
  let importProgress: ImportProgressEvent | null = null;
  let busyMessage = '';
  let errorMessage = '';

  let currentLocationRound: LocationRound | null = null;
  let currentOlderNewerRound: OlderVsNewerRound | null = null;
  let currentStreak = 0;
  let currentMode: GameMode | null = null;
  let sessionSeenIds: string[] = [];

  let locationGuess: GeoPoint | null = null;
  let locationFeedback:
    | { success: boolean; distanceKm: number; allowedRadiusKm: number; answer: GeoPoint; guess: GeoPoint }
    | null = null;
  let olderFeedback: { success: boolean; correctSide: 'left' | 'right' } | null = null;

  onMount(() => {
    const off = window.memoryQuiz.onImportProgress((event) => {
      importProgress = event;
      busyMessage = event.message;
      if (event.stage === 'done' || event.stage === 'error') {
        setTimeout(() => {
          importProgress = null;
          busyMessage = '';
        }, 1200);
      }
    });

    void refreshOverview();
    return off;
  });

  async function refreshOverview() {
    loading = true;
    errorMessage = '';
    try {
      appOverview = await window.memoryQuiz.getAppOverview();
      if (selectedExport) {
        selectedExport = appOverview.exports.find((entry) => entry.id === selectedExport?.id) ?? selectedExport;
      }
    } catch (error) {
      errorMessage = (error as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleAddExport() {
    errorMessage = '';
    const preview = await window.memoryQuiz.pickImportZip();
    if (!preview) {
      return;
    }

    let allowDuplicate = false;
    if (preview.duplicateOf) {
      allowDuplicate = window.confirm(
        `This zip matches the savegame "${preview.duplicateOf.name}". Press OK to import it anyway as a separate savegame, or Cancel to stop.`
      );
      if (!allowDuplicate) {
        return;
      }
    }

    busyMessage = `Importing ${preview.fileName}`;
    try {
      const imported = await window.memoryQuiz.importZip(preview.filePath, allowDuplicate);
      await refreshOverview();
      await chooseExport(imported.id);
    } catch (error) {
      if ((error as Error).message !== 'DUPLICATE_IMPORT') {
        errorMessage = (error as Error).message;
      }
    }
  }

  async function chooseExport(exportId: string) {
    await window.memoryQuiz.selectExport(exportId);
    selectedExport = await window.memoryQuiz.getModeOverview(exportId);
    screen = 'modes';
    resetGameState();
    await refreshOverview();
  }

  async function handleRename(entry: ExportOverview) {
    const name = window.prompt('Give this savegame a friendly name:', entry.name)?.trim();
    if (!name) {
      return;
    }

    selectedExport = await window.memoryQuiz.renameExport(entry.id, name);
    await refreshOverview();
  }

  async function handleReindex(entry: ExportOverview) {
    if (!window.confirm(`Re-index "${entry.name}" now? This keeps highscores but rebuilds the media library.`)) {
      return;
    }

    busyMessage = `Re-indexing ${entry.name}`;
    selectedExport = await window.memoryQuiz.reindexExport(entry.id);
    await refreshOverview();
  }

  async function handleDelete(entry: ExportOverview) {
    if (!window.confirm(`Delete the savegame "${entry.name}" and all of its imported files?`)) {
      return;
    }

    await window.memoryQuiz.deleteExport(entry.id);
    if (selectedExport?.id === entry.id) {
      selectedExport = null;
      screen = 'exports';
    }
    await refreshOverview();
  }

  function resetGameState() {
    currentStreak = 0;
    currentMode = null;
    sessionSeenIds = [];
    currentLocationRound = null;
    currentOlderNewerRound = null;
    locationGuess = null;
    locationFeedback = null;
    olderFeedback = null;
  }

  async function startMode(mode: GameMode) {
    if (!selectedExport) {
      return;
    }

    resetGameState();
    currentMode = mode;
    screen = mode;
    if (mode === 'location') {
      await loadNextLocationRound();
    } else {
      await loadNextOlderRound();
    }
  }

  async function loadNextLocationRound() {
    if (!selectedExport) {
      return;
    }

    locationGuess = null;
    locationFeedback = null;
    currentLocationRound = await window.memoryQuiz.createLocationRound(
      selectedExport.id,
      sessionSeenIds,
      currentStreak
    );
  }

  async function loadNextOlderRound() {
    if (!selectedExport) {
      return;
    }

    olderFeedback = null;
    currentOlderNewerRound = await window.memoryQuiz.createOlderVsNewerRound(
      selectedExport.id,
      sessionSeenIds,
      currentStreak
    );
  }

  async function submitLocationGuess() {
    if (!selectedExport || !currentLocationRound || !locationGuess) {
      return;
    }

    const distanceKm = haversineKm(locationGuess, currentLocationRound.answer);
    const success = distanceKm <= currentLocationRound.allowedRadiusKm;
    sessionSeenIds = [...sessionSeenIds, currentLocationRound.media.id];
    locationFeedback = {
      success,
      distanceKm,
      allowedRadiusKm: currentLocationRound.allowedRadiusKm,
      answer: currentLocationRound.answer,
      guess: locationGuess
    };

    if (success) {
      currentStreak += 1;
    } else {
      await window.memoryQuiz.saveRunResult(selectedExport.id, 'location', currentStreak, sessionSeenIds);
      selectedExport = await window.memoryQuiz.getModeOverview(selectedExport.id);
      await refreshOverview();
    }
  }

  async function answerOlder(side: 'left' | 'right') {
    if (!selectedExport || !currentOlderNewerRound || olderFeedback) {
      return;
    }

    const success = side === currentOlderNewerRound.correctSide;
    sessionSeenIds = [...sessionSeenIds, currentOlderNewerRound.left.id, currentOlderNewerRound.right.id];
    olderFeedback = {
      success,
      correctSide: currentOlderNewerRound.correctSide
    };

    if (success) {
      currentStreak += 1;
    } else {
      await window.memoryQuiz.saveRunResult(selectedExport.id, 'older-newer', currentStreak, sessionSeenIds);
      selectedExport = await window.memoryQuiz.getModeOverview(selectedExport.id);
      await refreshOverview();
    }
  }

  async function continueGame() {
    if (!selectedExport || !currentMode) {
      return;
    }

    if (currentMode === 'location') {
      if (locationFeedback?.success) {
        await loadNextLocationRound();
      } else {
        screen = 'modes';
      }
      return;
    }

    if (olderFeedback?.success) {
      await loadNextOlderRound();
    } else {
      screen = 'modes';
    }
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (screen === 'older-newer' && currentOlderNewerRound && !olderFeedback) {
      if (event.key === 'ArrowLeft') {
        await answerOlder('left');
      }
      if (event.key === 'ArrowRight') {
        await answerOlder('right');
      }
    }

    if (screen === 'location' && locationGuess && !locationFeedback && event.key === 'Enter') {
      await submitLocationGuess();
    }
  }

  const takeoutSteps = [
    'Open Google Takeout and deselect everything first.',
    'Turn on Google Photos only.',
    'Choose only the albums you want to use in the game.',
    'Create a zip export, download it, then bring it back here.'
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-shell">
  <div class="hero panel card-enter">
    <div class="hero-copy">
      <span class="pill">MemoryQuiz desktop</span>
      <h1 class="section-title">Turn your Google Photos into a playful memory game.</h1>
      <p class="section-copy">
        Import one or more Google Photos Takeout zips, pick a savegame for this session, and see how long
        your memory holds up across maps and timelines.
      </p>
      <div class="hero-actions">
        <button class="button-primary" onclick={handleAddExport}>Add Google Photos export</button>
        <button class="button-secondary" onclick={() => window.memoryQuiz.openTakeoutLink()}>
          Open Google Takeout
        </button>
      </div>
    </div>
    <div class="hero-steps">
      <h2>Quick setup</h2>
      {#each takeoutSteps as step, index}
        <div class="step-card">
          <strong>{index + 1}</strong>
          <span>{step}</span>
        </div>
      {/each}
      {#if appOverview}
        <p class="storage-note">Savegames live in <code>{appOverview.appDataRoot}</code>.</p>
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <div class="flash flash-danger">{errorMessage}</div>
  {/if}

  {#if importProgress}
    <div class="flash flash-info">
      <strong>{importProgress.message}</strong>
      <div class="progress-track"><span style={`width:${Math.round(importProgress.progress * 100)}%`}></span></div>
    </div>
  {/if}

  {#if loading}
    <section class="panel loading-state"><p>Loading MemoryQuiz...</p></section>
  {:else if screen === 'exports'}
    <section class="content-grid">
      <div class="section-header">
        <div>
          <p class="pill">Choose a savegame</p>
          <h2 class="section-title">Pick a Google Photos export for this session.</h2>
        </div>
        <button class="button-secondary" onclick={handleAddExport}>Add another export</button>
      </div>

      {#if !appOverview?.exports.length}
        <div class="empty-state panel card-enter">
          <h3>No exports yet</h3>
          <p>
            Start with a Google Photos Takeout zip. Keep only the albums you want in the game so the photo pool
            feels personal and interesting.
          </p>
          <div class="empty-actions">
            <button class="button-primary" onclick={handleAddExport}>Import a zip export</button>
            <button class="button-secondary" onclick={() => window.memoryQuiz.openTakeoutLink()}>
              Learn on Google Takeout
            </button>
          </div>
        </div>
      {:else}
        <div class="grid exports-grid">
          {#each appOverview?.exports ?? [] as entry}
            <ExportCard
              entry={entry}
              highlighted={entry.id === appOverview?.lastSelectedExportId}
              onSelect={(picked) => chooseExport(picked.id)}
              onRename={handleRename}
              onReindex={handleReindex}
              onDelete={handleDelete}
            />
          {/each}
        </div>
      {/if}
    </section>
  {:else if screen === 'modes' && selectedExport}
    <section class="content-grid">
      <div class="section-header">
        <div>
          <p class="pill">Selected savegame</p>
          <h2 class="section-title">{selectedExport.name}</h2>
          <p class="section-copy">
            {selectedExport.photoCount} photos indexed, {selectedExport.modeStats.location.playableCount} geo-tagged,
            {' '}{selectedExport.modeStats['older-newer'].playableCount} with a reliable date. {formatBytes(selectedExport.sizeOnDiskBytes)} on disk.
          </p>
        </div>
        <button class="button-secondary" onclick={() => (screen = 'exports')}>Back to exports</button>
      </div>

      <div class="grid mode-grid">
        <ModeCard
          title="LocationGuessr"
          subtitle="Tap the world map where you think the photo was taken. The allowed radius shrinks every time you get it right."
          count={selectedExport.modeStats.location.playableCount}
          bestStreak={selectedExport.modeStats.location.bestStreak}
          disabled={selectedExport.modeStats.location.playableCount < 1}
          accent="#3e97c8"
          onPlay={() => startMode('location')}
        />
        <ModeCard
          title="OlderVsNewer"
          subtitle="Choose which photo is more recent. Early rounds are generous, then the timeline gaps tighten up."
          count={selectedExport.modeStats['older-newer'].playableCount}
          bestStreak={selectedExport.modeStats['older-newer'].bestStreak}
          disabled={selectedExport.modeStats['older-newer'].playableCount < 2}
          accent="#e58d4b"
          onPlay={() => startMode('older-newer')}
        />
      </div>
    </section>
  {:else if screen === 'location' && currentLocationRound}
    <section class="play-screen">
      <div class="section-header compact">
        <div>
          <p class="pill">LocationGuessr</p>
          <h2 class="section-title">Streak {currentStreak}</h2>
        </div>
        <button class="button-secondary" onclick={() => (screen = 'modes')}>Exit round</button>
      </div>

      <div class="game-layout">
        <PhotoFrame
          src={currentLocationRound.media.imageUrl}
          alt={currentLocationRound.media.filename}
          label={currentLocationRound.media.captureDateLabel}
        />
        <div class="panel map-panel">
          <div class="map-header">
            <h3>Point to the place</h3>
            <p>Stay inside {currentLocationRound.allowedRadiusKm} km to keep the streak alive.</p>
          </div>
          <WorldMap guess={locationFeedback?.guess ?? locationGuess} answer={locationFeedback?.answer} onSelect={(point) => (locationGuess = point)} />
          <div class="game-actions">
            <button class="button-primary" onclick={submitLocationGuess} disabled={!locationGuess || !!locationFeedback}>
              Lock in guess
            </button>
            {#if locationFeedback}
              <button class="button-secondary" onclick={continueGame}>
                {locationFeedback.success ? 'Next photo' : 'Back to modes'}
              </button>
            {/if}
          </div>
          {#if locationFeedback}
            <div class:success={locationFeedback.success} class:failure={!locationFeedback.success} class="feedback-box">
              <strong>{locationFeedback.success ? 'Nice memory!' : 'Round over.'}</strong>
              <span>
                You were {Math.round(locationFeedback.distanceKm)} km away. The true spot was {currentLocationRound.media.locationLabel ?? 'stored from photo metadata'}.
              </span>
            </div>
          {/if}
        </div>
      </div>
    </section>
  {:else if screen === 'older-newer' && currentOlderNewerRound}
    <section class="play-screen">
      <div class="section-header compact">
        <div>
          <p class="pill">OlderVsNewer</p>
          <h2 class="section-title">Streak {currentStreak}</h2>
        </div>
        <button class="button-secondary" onclick={() => (screen = 'modes')}>Exit round</button>
      </div>

      <div class="grid compare-grid">
        <button class="choice-panel" onclick={() => answerOlder('left')} disabled={!!olderFeedback}>
          <PhotoFrame
            src={currentOlderNewerRound.left.imageUrl}
            alt={currentOlderNewerRound.left.filename}
            label={olderFeedback ? currentOlderNewerRound.left.captureDateLabel : 'Pick if this is newer'}
          />
        </button>
        <button class="choice-panel" onclick={() => answerOlder('right')} disabled={!!olderFeedback}>
          <PhotoFrame
            src={currentOlderNewerRound.right.imageUrl}
            alt={currentOlderNewerRound.right.filename}
            label={olderFeedback ? currentOlderNewerRound.right.captureDateLabel : 'Pick if this is newer'}
          />
        </button>
      </div>

      <div class="panel answer-panel">
        <div>
          <h3>Which photo is more recent?</h3>
          <p>Use left/right arrow keys or click a photo. Current pair gap: about {currentOlderNewerRound.gapDays} days.</p>
        </div>
        {#if olderFeedback}
          <div class:success={olderFeedback.success} class:failure={!olderFeedback.success} class="feedback-box">
            <strong>{olderFeedback.success ? 'Correct - keep going.' : 'Not this time.'}</strong>
            <span>The {olderFeedback.correctSide} photo is the newer one.</span>
          </div>
          <button class="button-secondary" onclick={continueGame}>
            {olderFeedback.success ? 'Next pair' : 'Back to modes'}
          </button>
        {/if}
      </div>
    </section>
  {:else}
    <section class="empty-state panel">
      <h3>Not enough playable photos yet</h3>
      <p>Try re-indexing the export or add a different album set with more dated or geo-tagged images.</p>
      <button class="button-secondary" onclick={() => (screen = 'modes')}>Back to modes</button>
    </section>
  {/if}
</div>

<style>
  .hero {
    padding: clamp(20px, 4vw, 34px);
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.9fr);
    gap: 24px;
    margin-bottom: 24px;
  }

  .hero-copy,
  .hero-steps,
  .section-header,
  .content-grid,
  .play-screen,
  .map-panel,
  .answer-panel {
    display: grid;
    gap: 16px;
  }

  .hero-actions,
  .empty-actions,
  .game-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .hero-steps {
    align-content: start;
  }

  .hero-steps h2,
  .map-header h3,
  .answer-panel h3,
  .empty-state h3 {
    margin: 0;
    font-family: var(--font-display);
  }

  .step-card {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: start;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.64);
  }

  .step-card strong {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-strong);
  }

  .storage-note {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
  }

  .flash {
    margin-bottom: 18px;
    padding: 14px 18px;
    border-radius: 18px;
    box-shadow: var(--shadow);
  }

  .flash-danger {
    background: rgba(182, 72, 72, 0.12);
    color: var(--danger);
  }

  .flash-info {
    background: rgba(122, 181, 218, 0.16);
  }

  .progress-track {
    margin-top: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    overflow: hidden;
  }

  .progress-track span {
    display: block;
    height: 100%;
    background: linear-gradient(135deg, var(--accent), #ffb46a);
    border-radius: inherit;
  }

  .loading-state,
  .empty-state,
  .map-panel,
  .answer-panel {
    padding: 24px;
  }

  .exports-grid,
  .mode-grid,
  .compare-grid {
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  }

  .section-header {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }

  .compact {
    align-items: center;
  }

  .game-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
    gap: 18px;
  }

  .choice-panel {
    padding: 0;
    border: 0;
    background: transparent;
  }

  .feedback-box {
    display: grid;
    gap: 6px;
    padding: 14px 16px;
    border-radius: 18px;
  }

  .success {
    background: rgba(47, 143, 98, 0.12);
    color: var(--success);
  }

  .failure {
    background: rgba(182, 72, 72, 0.12);
    color: var(--danger);
  }

  @media (max-width: 980px) {
    .hero,
    .game-layout,
    .section-header {
      grid-template-columns: 1fr;
    }
  }
</style>
