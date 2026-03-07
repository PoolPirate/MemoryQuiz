<script lang="ts">
  import { onMount, tick } from 'svelte';

  import ExportCard from '$components/ExportCard.svelte';
  import ImageOverlay from '$components/ImageOverlay.svelte';
  import ModeCard from '$components/ModeCard.svelte';
  import PhotoFrame from '$components/PhotoFrame.svelte';
  import TimelineSorter from '$components/TimelineSorter.svelte';
  import WorldMap from '$components/WorldMap.svelte';
  import type {
    AppOverview,
    ExportOverview,
    GameMode,
    GeoPoint,
    ImportPreview,
    ImportProgressEvent,
    LocationRound,
    MediaCard,
    OlderVsNewerRound,
    PendingRoundState,
    TimelineRoundMedia,
    TimelineSortRound
  } from '$lib/types/models';
  import {
    clampTimelinePosition,
    formatBytes,
    getTimelineTimePosition,
    haversineKm
  } from '$utils/game';

  type SetupStep = 'guide' | 'name' | 'preparing' | 'review' | 'importing' | 'result';
  type ImportZipResult = {
    overview: ExportOverview;
    summary: {
      totalImages: number;
      sourceImageCount: number;
      issueCount: number;
      issues: string[];
      withGeoCount: number;
      withoutGeoCount: number;
      withTimestampCount: number;
      withoutTimestampCount: number;
    };
  };
  type MemoryQuizClient = {
    getAppOverview(): Promise<AppOverview>;
    openTakeoutLink(): Promise<void>;
    pickImportZip(): Promise<string | null>;
    previewImportZip(filePath: string): Promise<ImportPreview>;
    importZip(preview: ImportPreview, libraryName: string, allowDuplicate?: boolean): Promise<ImportZipResult>;
    selectExport(exportId: string): Promise<void>;
    renameExport(exportId: string, name: string): Promise<ExportOverview>;
    deleteExport(exportId: string): Promise<void>;
    getModeOverview(exportId: string): Promise<ExportOverview>;
    createLocationRound(
      exportId: string,
      sessionSeenIds: string[],
      streak: number
    ): Promise<LocationRound | null>;
    createOlderVsNewerRound(
      exportId: string,
      sessionSeenIds: string[]
    ): Promise<OlderVsNewerRound | null>;
    createTimelineSortRound(
      exportId: string,
      sessionSeenIds: string[],
      currentMediaIds: string[]
    ): Promise<TimelineSortRound | null>;
    deleteMedia(exportId: string, mediaId: string): Promise<void>;
    saveRunResult(exportId: string, mode: GameMode, streak: number, seenMediaIds: string[]): Promise<void>;
    saveSeenMediaIds(
      exportId: string,
      mode: GameMode,
      streak: number,
      seenMediaIds: string[],
      pendingRound?: PendingRoundState | null
    ): Promise<void>;
    onImportProgress(listener: (event: ImportProgressEvent) => void): () => void;
  };

  let appOverview: AppOverview | null = null;
  let loading = true;
  let errorMessage = '';
  let noticeMessage = '';

  let view: 'menu' | 'modes' | 'playing' = 'menu';
  let activeExport: ExportOverview | null = null;
  let gameMode: GameMode | null = null;
  let locationRound: LocationRound | null = null;
  let olderNewerRound: OlderVsNewerRound | null = null;
  let timelineSortRound: TimelineSortRound | null = null;
  let timelinePlacements: Record<string, number> = {};
  let selectedTimelineMediaId: string | null = null;
  let selectedTimelineMedia: TimelineRoundMedia | null = null;
  let timelineLockedIds: string[] = [];
  let timelineStatusMap: Record<string, 'correct' | 'incorrect' | 'neutral'> = {};

  let sessionSeenIds: string[] = [];
  let pendingRunSave: Promise<void> | null = null;
  let pendingSeenSave: Promise<void> | null = null;
  let streak = 0;
  let roundStatus: 'guessing' | 'result' = 'guessing';
  let lastGuess: GeoPoint | null = null;
  let lastDistanceKm: number | null = null;
  let lastOlderNewerGuess: 'left' | 'right' | null = null;
  let olderNewerFullscreenMedia: MediaCard | null = null;
  let lastTimelineOrderCorrect = false;
  let deletingMediaIds: string[] = [];

  let locationImageViewport: HTMLDivElement | null = null;
  let locationImageScale = 1;
  let locationImageOffsetX = 0;
  let locationImageOffsetY = 0;
  let locationImageDragging = false;
  let locationImagePointerId: number | null = null;
  let locationImageStartX = 0;
  let locationImageStartY = 0;
  let locationImageStartOffsetX = 0;
  let locationImageStartOffsetY = 0;

  let showSetupModal = false;
  let setupStep: SetupStep = 'guide';
  let setupErrorMessage = '';
  let setupLoadingMessage = 'Inspecting the selected zip file...';
  let importPreview: ImportPreview | null = null;
  let importResult: ImportZipResult | null = null;
  let importProgress: ImportProgressEvent | null = null;
  let allowDuplicateImport = false;
  let libraryName = '';
  let libraryNameInput: HTMLInputElement | null = null;
  let isImporting = false;
  let isPreparingImport = false;
  let progressPercent = 0;

  let renamingExport: ExportOverview | null = null;
  let renameValue = '';
  let renameInput: HTMLInputElement | null = null;

  const flashBaseClass =
    'mq-card-enter grid gap-3 rounded-[24px] border px-5 py-4 shadow-[0_12px_26px_rgba(77,61,45,0.08)]';

  const takeoutSteps = [
    {
      title: 'Open Takeout',
      detail: 'Start a fresh export at Google Takeout so you can control exactly which albums end up in this library.'
    },
    {
      title: 'Deselect everything',
      detail: 'Turn every service off first, then enable Google Photos only. That keeps the export small and focused.'
    },
    {
      title: 'Pick albums',
      detail: 'Choose the albums or years you want to play with, and export as a .zip archive.'
    },
    {
      title: 'Download and import',
      detail: 'Back in MemoryQuiz, choose the downloaded zip. The library appears only after the full setup succeeds.'
    }
  ];
  const setupFlowSteps: SetupStep[] = ['guide', 'name', 'preparing', 'review', 'importing', 'result'];
  const timelineDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
  const timelineDetailFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  $: progressPercent = importProgress ? Math.round(importProgress.progress * 100) : 0;
  $: {
    const round = timelineSortRound;
    timelineLockedIds = round
      ? round.items
          .filter(
            (item: TimelineRoundMedia) =>
              (roundStatus === 'result' && lastTimelineOrderCorrect) || item.id !== round.newlyAddedId
          )
          .map((item: TimelineRoundMedia) => item.id)
      : [];
  }
  $: {
    const round = timelineSortRound;
    selectedTimelineMedia = round
      ? round.items.find((item: TimelineRoundMedia) => item.id === selectedTimelineMediaId) ??
        round.items.find((item: TimelineRoundMedia) => item.id === round.newlyAddedId) ??
        round.items[0] ??
        null
      : null;
  }
  $: if (showSetupModal && setupStep === 'name') {
    void focusTextInput(libraryNameInput);
  }
  $: if (renamingExport) {
    void focusTextInput(renameInput);
  }

  function getModeTitle(mode: GameMode | null): string {
    if (mode === 'location') return 'LocationGuessr';
    if (mode === 'older-newer') return 'Older or Newer';
    if (mode === 'timeline-sort') return 'Memory Timeline';
    return 'MemoryQuiz';
  }

  function clampLocationImageOffsets(
    scale: number,
    offsetX: number,
    offsetY: number
  ): { x: number; y: number } {
    const rect = locationImageViewport?.getBoundingClientRect();
    const viewportWidth = rect?.width ?? 0;
    const viewportHeight = rect?.height ?? 0;
    const maxOffsetX = Math.max(0, ((scale - 1) * viewportWidth) / 2);
    const maxOffsetY = Math.max(0, ((scale - 1) * viewportHeight) / 2);

    return {
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, offsetX)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, offsetY))
    };
  }

  function resetLocationImageView() {
    locationImageScale = 1;
    locationImageOffsetX = 0;
    locationImageOffsetY = 0;
    locationImageDragging = false;
    locationImagePointerId = null;
  }

  function zoomLocationImage(nextScale: number, clientX?: number, clientY?: number) {
    const normalizedScale = Math.max(1, Math.min(6, nextScale));
    const rect = locationImageViewport?.getBoundingClientRect();

    if (normalizedScale === 1) {
      resetLocationImageView();
      return;
    }

    if (!rect || locationImageScale === 1 || clientX == null || clientY == null) {
      const clamped = clampLocationImageOffsets(normalizedScale, locationImageOffsetX, locationImageOffsetY);
      locationImageScale = normalizedScale;
      locationImageOffsetX = clamped.x;
      locationImageOffsetY = clamped.y;
      return;
    }

    const cursorX = clientX - rect.left - rect.width / 2;
    const cursorY = clientY - rect.top - rect.height / 2;
    const scaleRatio = normalizedScale / locationImageScale;
    const nextOffsetX = cursorX - (cursorX - locationImageOffsetX) * scaleRatio;
    const nextOffsetY = cursorY - (cursorY - locationImageOffsetY) * scaleRatio;
    const clamped = clampLocationImageOffsets(normalizedScale, nextOffsetX, nextOffsetY);

    locationImageScale = normalizedScale;
    locationImageOffsetX = clamped.x;
    locationImageOffsetY = clamped.y;
  }

  function handleLocationImageWheel(event: WheelEvent) {
    event.preventDefault();
    const deltaScale = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    zoomLocationImage(locationImageScale * deltaScale, event.clientX, event.clientY);
  }

  function handleLocationImagePointerDown(event: PointerEvent) {
    if (locationImageScale <= 1) {
      return;
    }

    locationImageDragging = true;
    locationImagePointerId = event.pointerId;
    locationImageStartX = event.clientX;
    locationImageStartY = event.clientY;
    locationImageStartOffsetX = locationImageOffsetX;
    locationImageStartOffsetY = locationImageOffsetY;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  }

  function handleLocationImagePointerMove(event: PointerEvent) {
    if (!locationImageDragging || locationImagePointerId !== event.pointerId || locationImageScale <= 1) {
      return;
    }

    const deltaX = event.clientX - locationImageStartX;
    const deltaY = event.clientY - locationImageStartY;
    const clamped = clampLocationImageOffsets(
      locationImageScale,
      locationImageStartOffsetX + deltaX,
      locationImageStartOffsetY + deltaY
    );

    locationImageOffsetX = clamped.x;
    locationImageOffsetY = clamped.y;
  }

  function handleLocationImagePointerUp(event: PointerEvent) {
    if (locationImagePointerId !== event.pointerId) {
      return;
    }

    locationImageDragging = false;
    locationImagePointerId = null;
  }

  function getRandomTimelinePosition(): number {
    return clampTimelinePosition(0.12 + Math.random() * 0.76);
  }

  function buildTimelinePlacements(
    items: TimelineRoundMedia[],
    newlyAddedId: string,
    rangeStartTs: number,
    rangeEndTs: number,
    previousPlacements: Record<string, number> = {},
    lockAll = false
  ): Record<string, number> {
    const nextPlacements: Record<string, number> = {};

    for (const item of items) {
      if (lockAll || item.id !== newlyAddedId) {
        nextPlacements[item.id] = getTimelineTimePosition(item.captureTs, rangeStartTs, rangeEndTs);
      } else if (previousPlacements[item.id] != null) {
        nextPlacements[item.id] = clampTimelinePosition(previousPlacements[item.id]);
      } else {
        nextPlacements[item.id] = getRandomTimelinePosition();
      }
    }

    return nextPlacements;
  }

  function getTimelineRoundMedia(mediaId: string | null): TimelineRoundMedia | null {
    if (!timelineSortRound || !mediaId) {
      return null;
    }

    return timelineSortRound.items.find((item: TimelineRoundMedia) => item.id === mediaId) ?? null;
  }

  function formatTimelineDate(timestamp: number): string {
    return timelineDateFormatter.format(new Date(timestamp));
  }

  function formatTimelineDetail(timestamp: number): string {
    return timelineDetailFormatter.format(new Date(timestamp));
  }

  function formatLocationDistance(distanceKm: number): string {
    if (distanceKm < 5) {
      return `${Math.round(distanceKm * 1000)} m`;
    }

    return `${Math.round(distanceKm)} km`;
  }

  function getTimelinePlacementSummary(media: TimelineRoundMedia | null): string {
    const round = timelineSortRound;
    if (!round || !media) {
      return 'Select a photo from the timeline.';
    }

    const isLocked = timelineLockedIds.includes(media.id);
    if (isLocked) {
      return `Locked at ${formatTimelineDate(media.captureTs)}.`;
    }

    const lockedItems = round.items
      .filter((item: TimelineRoundMedia) => item.id !== round.newlyAddedId)
      .slice()
      .sort((left: TimelineRoundMedia, right: TimelineRoundMedia) => left.captureTs - right.captureTs);
    const guessedPosition = timelinePlacements[media.id] ?? 0.5;
    const insertIndex = lockedItems.findIndex(
      (item: TimelineRoundMedia) =>
        guessedPosition < getTimelineTimePosition(item.captureTs, round.rangeStartTs, round.rangeEndTs)
    );

    if (lockedItems.length === 0) {
      return 'Place this photo anywhere on the timeline to start the run.';
    }

    if (insertIndex === 0) {
      return `Currently before ${formatTimelineDate(lockedItems[0].captureTs)}.`;
    }

    if (insertIndex === -1) {
      return `Currently after ${formatTimelineDate(lockedItems[lockedItems.length - 1].captureTs)}.`;
    }

    return `Currently between ${formatTimelineDate(lockedItems[insertIndex - 1].captureTs)} and ${formatTimelineDate(lockedItems[insertIndex].captureTs)}.`;
  }

  function isTimelineOrderCorrect(round: TimelineSortRound, placements: Record<string, number>): boolean {
    const newItem = round.items.find((item: TimelineRoundMedia) => item.id === round.newlyAddedId);
    if (!newItem) {
      return false;
    }

    const lockedItems = round.items
      .filter((item: TimelineRoundMedia) => item.id !== round.newlyAddedId)
      .slice()
      .sort((left: TimelineRoundMedia, right: TimelineRoundMedia) => left.captureTs - right.captureTs);
    const guessedPosition = placements[newItem.id] ?? 0.5;
    const guessedIndex = lockedItems.findIndex(
      (item: TimelineRoundMedia) =>
        guessedPosition < getTimelineTimePosition(item.captureTs, round.rangeStartTs, round.rangeEndTs)
    );
    const normalizedGuessedIndex = guessedIndex === -1 ? lockedItems.length : guessedIndex;
    const actualIndex = lockedItems.filter((item: TimelineRoundMedia) => item.captureTs < newItem.captureTs).length;

    return normalizedGuessedIndex === actualIndex;
  }

  function getTimelineResultTone(): 'correct' | 'incorrect' {
    return lastTimelineOrderCorrect ? 'correct' : 'incorrect';
  }

  function getApi(): MemoryQuizClient {
    return window.memoryQuiz as unknown as MemoryQuizClient;
  }

  async function focusTextInput(input: HTMLInputElement | null) {
    await tick();
    if (!input) {
      return;
    }

    input.focus();
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
  }

  function handleLibraryNameInput(event: Event) {
    libraryName = (event.currentTarget as HTMLInputElement).value;
    if (setupErrorMessage && setupStep === 'name') {
      setupErrorMessage = '';
    }
  }

  onMount(() => {
    const off = getApi().onImportProgress((event) => {
      importProgress = event;
      if (event.stage === 'done') {
        isImporting = false;
      } else if (event.stage === 'error') {
        isImporting = false;
        setupErrorMessage = event.message;
      }
    });

    void refreshOverview();
    return off;
  });

  async function refreshOverview() {
    loading = true;

    try {
      const overview = await getApi().getAppOverview();
      appOverview = overview;

      if (activeExport) {
        activeExport = overview.exports.find((entry) => entry.id === activeExport?.id) ?? null;
      } else if (overview.lastSelectedExportId) {
        activeExport = overview.exports.find((entry) => entry.id === overview.lastSelectedExportId) ?? null;
      }

      if (!activeExport && view !== 'menu') {
        view = 'menu';
        gameMode = null;
        locationRound = null;
        olderNewerRound = null;
        timelineSortRound = null;
      }
    } catch (error) {
      errorMessage = (error as Error).message;
    } finally {
      loading = false;
    }
  }

  function openSetupModal() {
    setupErrorMessage = '';
    setupLoadingMessage = 'Inspecting the selected zip file...';
    importPreview = null;
    importResult = null;
    importProgress = null;
    allowDuplicateImport = false;
    libraryName = '';
    isImporting = false;
    isPreparingImport = false;
    setupStep = 'guide';
    showSetupModal = true;
  }

  function closeSetupModal(force = false) {
    if ((isImporting || isPreparingImport) && !force) {
      return;
    }

    showSetupModal = false;
    setupErrorMessage = '';
    importPreview = null;
    importResult = null;
    importProgress = null;
    allowDuplicateImport = false;
    isImporting = false;
    isPreparingImport = false;
  }

  async function chooseImportFile() {
    setupErrorMessage = '';
    const fallbackStep = importPreview ? 'review' : 'name';

    try {
      const filePath = await getApi().pickImportZip();
      if (!filePath) {
        return;
      }

      isPreparingImport = true;
      setupStep = 'preparing';
      setupLoadingMessage = 'Inspecting the selected zip file and checking for duplicates...';
      await tick();

      const preview = await getApi().previewImportZip(filePath);
      importPreview = preview;
      allowDuplicateImport = false;
      setupStep = 'review';
    } catch (error) {
      setupErrorMessage = (error as Error).message;
      setupStep = fallbackStep;
    } finally {
      isPreparingImport = false;
    }
  }

  async function startImport() {
    if (!importPreview) {
      setupErrorMessage = 'Choose a Google Photos Takeout zip first.';
      return;
    }

    if (!libraryName.trim()) {
      setupErrorMessage = 'Enter a library name before you create it.';
      setupStep = 'name';
      return;
    }

    if (importPreview.duplicateOf && !allowDuplicateImport) {
      setupErrorMessage = 'This zip already exists as a library. Turn on duplicate import if you still want a separate copy.';
      return;
    }

    setupErrorMessage = '';
    errorMessage = '';
    noticeMessage = '';
    isImporting = true;
    setupStep = 'importing';
    importResult = null;
    importProgress = { stage: 'copying', progress: 0.02, message: 'Preparing your library import...' };

    try {
      await tick();
      const imported = await getApi().importZip(importPreview, libraryName.trim(), allowDuplicateImport);
      importResult = imported;
      await getApi().selectExport(imported.overview.id);
      activeExport = imported.overview;
      await refreshOverview();
      view = 'modes';
      setupStep = 'result';
    } catch (error) {
      setupErrorMessage = (error as Error).message;
      setupStep = 'review';
      isImporting = false;
    }
  }

  function finishImportReview() {
    closeSetupModal(true);
  }

  async function enterLibrary(entry: ExportOverview) {
    if (entry.status !== 'ready') {
      return;
    }

    errorMessage = '';
    noticeMessage = '';
    await getApi().selectExport(entry.id);
    activeExport = entry;
    view = 'modes';
  }

  async function startMode(mode: GameMode) {
    if (!activeExport) return;
    await waitForPendingSaves();
    errorMessage = '';
    noticeMessage = '';
    gameMode = mode;
    locationRound = null;
    olderNewerRound = null;
    timelineSortRound = null;
    timelinePlacements = {};
    timelineStatusMap = {};
    selectedTimelineMediaId = null;
    streak = activeExport.modeStats[mode].activeStreak;
    sessionSeenIds = [];
    view = 'playing';
    await nextRound();
  }

  async function nextRound() {
    if (!activeExport || !gameMode) return;

    resetLocationImageView();
    roundStatus = 'guessing';
    lastGuess = null;
    lastDistanceKm = null;
    lastOlderNewerGuess = null;
    olderNewerFullscreenMedia = null;
    lastTimelineOrderCorrect = false;
    timelineStatusMap = {};
    deletingMediaIds = [];

    try {
      if (gameMode === 'location') {
        olderNewerRound = null;
        timelineSortRound = null;
        locationRound = await getApi().createLocationRound(activeExport.id, sessionSeenIds, streak);
        if (!locationRound) {
          errorMessage = 'No more playable photos for this mode.';
          view = 'modes';
        }
      } else if (gameMode === 'older-newer') {
        locationRound = null;
        timelineSortRound = null;
        olderNewerRound = await getApi().createOlderVsNewerRound(activeExport.id, sessionSeenIds);
        if (!olderNewerRound) {
          errorMessage = 'No more playable photos for this mode.';
          view = 'modes';
        }
      } else {
        locationRound = null;
        olderNewerRound = null;

        const nextTimelineRound = await getApi().createTimelineSortRound(
          activeExport.id,
          sessionSeenIds,
          timelineSortRound?.items.map((item: TimelineRoundMedia) => item.id) ?? []
        );

        if (!nextTimelineRound) {
          errorMessage = 'No more playable photos for this mode.';
          view = 'modes';
          timelineSortRound = null;
          timelinePlacements = {};
          selectedTimelineMediaId = null;
          return;
        }

        const previousPlacements = timelinePlacements;
        timelineSortRound = nextTimelineRound;
        timelinePlacements = buildTimelinePlacements(
          nextTimelineRound.items,
          nextTimelineRound.newlyAddedId,
          nextTimelineRound.rangeStartTs,
          nextTimelineRound.rangeEndTs,
          previousPlacements
        );
        selectedTimelineMediaId = nextTimelineRound.newlyAddedId;
      }
    } catch (error) {
      errorMessage = (error as Error).message;
      view = 'modes';
    }
  }

  function handleLocationGuess(point: GeoPoint) {
    if (!locationRound || roundStatus !== 'guessing' || deletingMediaIds.length > 0) return;

    lastGuess = point;
  }

  async function submitLocationGuess() {
    if (!locationRound || !lastGuess || roundStatus !== 'guessing' || deletingMediaIds.length > 0) return;

    noticeMessage = '';

    lastDistanceKm = haversineKm(lastGuess, locationRound.answer);
    roundStatus = 'result';

    const won = lastDistanceKm <= locationRound.allowedRadiusKm;
    if (won) {
      streak += 1;
      sessionSeenIds = [...sessionSeenIds, locationRound.media.id];
      await persistSeenProgress();
    } else {
      void finishRun([locationRound.media.id]);
    }
  }

  async function handleOlderNewerGuess(side: 'left' | 'right') {
    if (!olderNewerRound || roundStatus !== 'guessing' || deletingMediaIds.length > 0) return;

    noticeMessage = '';

    lastOlderNewerGuess = side;
    roundStatus = 'result';

    const won = side === olderNewerRound.correctSide;
    if (won) {
      streak += 1;
      sessionSeenIds = [...sessionSeenIds, olderNewerRound.left.id, olderNewerRound.right.id];
      await persistSeenProgress();
    } else {
      void finishRun([olderNewerRound.left.id, olderNewerRound.right.id]);
    }
  }

  function openOlderNewerFullscreen(media: MediaCard) {
    olderNewerFullscreenMedia = media;
  }

  function closeOlderNewerFullscreen() {
    olderNewerFullscreenMedia = null;
  }

  function handleTimelinePlacement(mediaId: string, position: number) {
    if (!timelineSortRound || roundStatus !== 'guessing' || deletingMediaIds.length > 0) {
      return;
    }

    timelinePlacements = {
      ...timelinePlacements,
      [mediaId]: clampTimelinePosition(position)
    };
  }

  function handleTimelineSelect(mediaId: string) {
    selectedTimelineMediaId = mediaId;
  }

  async function submitTimelineGuess() {
    if (!timelineSortRound || roundStatus !== 'guessing' || deletingMediaIds.length > 0) {
      return;
    }

    noticeMessage = '';
    selectedTimelineMediaId = timelineSortRound.newlyAddedId;
    roundStatus = 'result';
    const won = isTimelineOrderCorrect(timelineSortRound, timelinePlacements);
    lastTimelineOrderCorrect = won;
    timelineStatusMap = {
      [timelineSortRound.newlyAddedId]: getTimelineResultTone()
    };
    const roundSeenIds = timelineSortRound.items.map((item: TimelineRoundMedia) => item.id);

    if (won) {
      timelinePlacements = buildTimelinePlacements(
        timelineSortRound.items,
        timelineSortRound.newlyAddedId,
        timelineSortRound.rangeStartTs,
        timelineSortRound.rangeEndTs,
        timelinePlacements,
        true
      );
      streak += 1;
      sessionSeenIds = [...new Set([...sessionSeenIds, ...roundSeenIds])];
      await persistSeenProgress();
    } else {
      void finishRun(roundSeenIds);
    }
  }

  function hasLostCurrentRound() {
    if (gameMode === 'location') {
      return !!locationRound && roundStatus === 'result' && lastDistanceKm != null && lastDistanceKm > locationRound.allowedRadiusKm;
    }

    if (gameMode === 'older-newer') {
      return (
        !!olderNewerRound &&
        roundStatus === 'result' &&
        lastOlderNewerGuess != null &&
        lastOlderNewerGuess !== olderNewerRound.correctSide
      );
    }

    if (gameMode === 'timeline-sort') {
      return !!timelineSortRound && roundStatus === 'result' && !lastTimelineOrderCorrect;
    }

    return false;
  }

  function canDeleteCurrentRoundMedia() {
    return roundStatus === 'guessing' || hasLostCurrentRound();
  }

  async function handleDeleteRoundMedia(media: MediaCard) {
    const deletingAfterLoss = hasLostCurrentRound();
    if (!activeExport || deletingMediaIds.length > 0 || (!canDeleteCurrentRoundMedia() && !deletingAfterLoss)) {
      return;
    }

    const keepLabel = streak === 1 ? 'keep your streak at 1' : `keep your streak at ${streak}`;
    const confirmMessage = deletingAfterLoss
      ? `Remove "${media.filename}" from "${activeExport.name}"? This round is already over, and the photo will be removed from the library.`
      : `Remove "${media.filename}" from "${activeExport.name}"? This skips the round and will ${keepLabel}.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    errorMessage = '';
    noticeMessage = '';
    deletingMediaIds = [media.id];

    try {
      await getApi().deleteMedia(activeExport.id, media.id);
      activeExport = await getApi().getModeOverview(activeExport.id);
      if (deletingAfterLoss) {
        noticeMessage = `${media.filename} was removed from the library.`;
        exitToModes();
      } else {
        if (gameMode === 'timeline-sort') {
          timelineSortRound = null;
          timelinePlacements = {};
          selectedTimelineMediaId = null;
          timelineStatusMap = {};
        }
        noticeMessage = `${media.filename} was removed. Round skipped and streak unchanged.`;
        await nextRound();
      }
    } catch (error) {
      errorMessage = (error as Error).message;
      deletingMediaIds = [];
    }
  }

  async function finishRun(extraSeenIds: string[] = []) {
    if (!activeExport || !gameMode) return;
    const finalSeenIds = [...new Set([...sessionSeenIds, ...extraSeenIds])];
    sessionSeenIds = finalSeenIds;

    if (pendingSeenSave) {
      await pendingSeenSave;
    }

    if (pendingRunSave) {
      await pendingRunSave;
      return;
    }

    const exportId = activeExport.id;
    const mode = gameMode;
    const finalStreak = streak;
    streak = 0;

    pendingRunSave = (async () => {
      try {
        await getApi().saveRunResult(exportId, mode, finalStreak, finalSeenIds);
        // Refresh active export stats
        activeExport = await getApi().getModeOverview(exportId);
      } catch (error) {
        console.error('Failed to save run result:', error);
      }
    })();

    try {
      await pendingRunSave;
    } finally {
      pendingRunSave = null;
    }
  }

  function getPendingRoundState(): PendingRoundState | null {
    if (!gameMode || roundStatus !== 'guessing') {
      return null;
    }

    if (gameMode === 'location' && locationRound) {
      return {
        mode: 'location',
        mediaId: locationRound.media.id
      };
    }

    if (gameMode === 'older-newer' && olderNewerRound) {
      return {
        mode: 'older-newer',
        leftId: olderNewerRound.left.id,
        rightId: olderNewerRound.right.id
      };
    }

    if (gameMode === 'timeline-sort' && timelineSortRound) {
      return {
        mode: 'timeline-sort',
        itemIds: timelineSortRound.items.map((item: TimelineRoundMedia) => item.id),
        newlyAddedId: timelineSortRound.newlyAddedId
      };
    }

    return null;
  }

  async function persistSeenProgress() {
    const pendingRound = getPendingRoundState();

    if (!activeExport || !gameMode || (sessionSeenIds.length === 0 && !pendingRound)) {
      return;
    }

    if (pendingRunSave) {
      await pendingRunSave;
      return;
    }

    if (pendingSeenSave) {
      await pendingSeenSave;

      if (!activeExport || !gameMode || ((sessionSeenIds.length === 0 && !pendingRound) || pendingRunSave)) {
        return;
      }
    }

    const exportId = activeExport.id;
    const mode = gameMode;
    const seenIds = [...new Set(sessionSeenIds)];

    pendingSeenSave = (async () => {
      try {
        await getApi().saveSeenMediaIds(exportId, mode, streak, seenIds, pendingRound);
        activeExport = await getApi().getModeOverview(exportId);
      } catch (error) {
        console.error('Failed to save seen media IDs:', error);
      }
    })();

    try {
      await pendingSeenSave;
    } finally {
      pendingSeenSave = null;
    }
  }

  async function waitForPendingSaves() {
    try {
      await pendingRunSave;
      await pendingSeenSave;
    } catch {
      // save helpers already report the error
    }
  }

  async function exitToModes() {
    olderNewerFullscreenMedia = null;
    await persistSeenProgress();
    await waitForPendingSaves();
    view = 'modes';
  }

  async function exitToMenu() {
    await persistSeenProgress();
    await waitForPendingSaves();
    activeExport = null;
    view = 'menu';
    void refreshOverview();
  }

  async function handleRename(entry: ExportOverview) {
    renameValue = entry.name;
    renamingExport = entry;
  }

  function cancelRename() {
    renamingExport = null;
    renameValue = '';
  }

  async function confirmRename() {
    if (!renamingExport || !renameValue.trim()) {
      return;
    }

    const entry = renamingExport;
    const name = renameValue.trim();

    errorMessage = '';
    noticeMessage = '';
    renamingExport = null;

    try {
      const updated = await getApi().renameExport(entry.id, name);
      await refreshOverview();
      if (activeExport?.id === updated.id) {
        activeExport = { ...activeExport, name: updated.name };
      }
      noticeMessage = `Renamed library to ${name}.`;
    } catch (error) {
      errorMessage = (error as Error).message;
    }
  }

  async function handleDelete(entry: ExportOverview) {
    if (!window.confirm(`Delete the library "${entry.name}" and all of its imported files?`)) {
      return;
    }

    errorMessage = '';
    noticeMessage = '';

    try {
      await getApi().deleteExport(entry.id);
      await refreshOverview();
      noticeMessage = `${entry.name} was deleted.`;
    } catch (error) {
      errorMessage = (error as Error).message;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && showSetupModal && !isImporting) {
      closeSetupModal();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="mq-shell">
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
    <div class="absolute -left-24 top-0 h-72 w-72 rounded-full bg-clay-300/30 blur-3xl"></div>
    <div class="absolute right-[-6rem] top-40 h-80 w-80 rounded-full bg-moss-300/30 blur-3xl"></div>
    <div class="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-paper-100/70 blur-3xl"></div>
  </div>

  <div class={view === 'playing' && gameMode === 'location' ? 'absolute inset-0 z-10 bg-ink overflow-hidden flex flex-col' : 'mx-auto flex max-w-7xl flex-col gap-8 pb-20 pt-10'}>
    {#if view === 'menu'}
      <header class="mq-card-enter grid gap-3 px-6 text-center lg:px-8">
        <span class="mq-pill mx-auto">MemoryQuiz</span>
        <h1 class="font-display text-[clamp(2rem,5vw,3.5rem)] leading-tight tracking-tight text-ink">
          Your Libraries
        </h1>
        <p class="mq-copy mx-auto max-w-2xl text-lg">
          Choose a library to play with. Each library is imported from a Google Photos Takeout export.
        </p>
      </header>

      {#if errorMessage}
        <div class="mx-6 lg:mx-8">
          <div class={`${flashBaseClass} border-danger-500/15 bg-paper-200/88 text-danger-500`}>{errorMessage}</div>
        </div>
      {/if}

      {#if noticeMessage}
        <div class="mx-6 lg:mx-8">
          <div class={`${flashBaseClass} border-moss-700/15 bg-paper-200/88 text-moss-700`}>{noticeMessage}</div>
        </div>
      {/if}

      {#if loading}
        <section class="grid place-items-center py-20 text-center text-base text-muted">
          <div class="grid gap-4">
            <div class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-clay-500/20 border-t-clay-500"></div>
            <p>Loading your libraries...</p>
          </div>
        </section>
      {:else}
        <section class="grid gap-6 px-6 lg:px-8 xl:grid-cols-2">
          {#if appOverview}
            {#each appOverview.exports as entry}
              <ExportCard
                entry={entry}
                onSelect={enterLibrary}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            {/each}
          {/if}

          <button
            class="mq-panel mq-card-enter group flex min-h-[280px] flex-col items-center justify-center gap-4 border-2 border-dashed border-clay-500/30 bg-paper-200/55 p-8 transition-all hover:border-clay-500/60 hover:bg-paper-200/72"
            onclick={openSetupModal}
          >
            <div class="grid h-16 w-16 place-items-center rounded-full bg-clay-500/10 text-clay-600 transition-transform group-hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </div>
            <div class="text-center">
              <h3 class="font-display text-2xl text-ink">Add New Library</h3>
              <p class="mt-1 text-sm text-muted">Import a Google Photos Takeout zip</p>
            </div>
          </button>
        </section>
      {/if}
    {:else if view === 'modes' && activeExport}
      <div class="flex flex-col gap-8 px-6 lg:px-8">
        <header class="mq-card-enter flex items-center justify-between">
          <button class="mq-btn-secondary" onclick={exitToMenu}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            Back to Libraries
          </button>
          <div class="text-right">
            <div class="flex items-center justify-end gap-3">
              <h2 class="font-display text-3xl text-ink">{activeExport.name}</h2>
              <button
                title="Rename library"
                aria-label="Rename library"
                class="flex h-8 w-8 items-center justify-center rounded-full border border-paper-300/60 bg-paper-200/82 text-muted hover:border-clay-500/40 hover:text-clay-600 hover:shadow-sm"
                onclick={() => handleRename(activeExport!)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
              </button>
            </div>
            <p class="mt-1 text-sm text-muted">Choose a mode to start playing</p>
          </div>
        </header>

        {#if errorMessage}
          <div class={`${flashBaseClass} border-danger-500/15 bg-paper-200/88 text-danger-500`}>{errorMessage}</div>
        {/if}

        {#if noticeMessage}
          <div class={`${flashBaseClass} border-moss-700/15 bg-paper-200/88 text-moss-700`}>{noticeMessage}</div>
        {/if}

        <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <ModeCard
            title="LocationGuessr"
            subtitle="Look at the photo and guess where on earth it was taken. The circle gets smaller as your streak grows!"
            count={activeExport.modeStats.location.playableCount}
            activeStreak={activeExport.modeStats.location.activeStreak}
            bestStreak={activeExport.modeStats.location.bestStreak}
            disabled={activeExport.modeStats.location.playableCount < 1}
            accent="#2f8f62"
            onPlay={() => startMode('location')}
          />
          <ModeCard
            title="Older or Newer"
            subtitle="Compare two photos and decide which one was taken first. A test of your long-term memory!"
            count={activeExport.modeStats['older-newer'].playableCount}
            activeStreak={activeExport.modeStats['older-newer'].activeStreak}
            bestStreak={activeExport.modeStats['older-newer'].bestStreak}
            disabled={activeExport.modeStats['older-newer'].playableCount < 2}
            accent="#d97706"
            onPlay={() => startMode('older-newer')}
          />
          <ModeCard
            title="Memory Timeline"
            subtitle="Build a full-library timeline. Each win locks the photo in place and adds one new memory to sort."
            count={activeExport.modeStats['timeline-sort'].playableCount}
            activeStreak={activeExport.modeStats['timeline-sort'].activeStreak}
            bestStreak={activeExport.modeStats['timeline-sort'].bestStreak}
            disabled={activeExport.modeStats['timeline-sort'].playableCount < 2}
            accent="#2d6aa3"
            onPlay={() => startMode('timeline-sort')}
          />
        </div>
      </div>
    {:else if view === 'playing' && activeExport && gameMode}
      {#if gameMode === 'older-newer' && olderNewerRound}
        {@const leftIsOlder = roundStatus === 'result' && olderNewerRound.correctSide === 'right'}
        {@const rightIsOlder = roundStatus === 'result' && olderNewerRound.correctSide === 'left'}
        {@const leftIsNewer = roundStatus === 'result' && olderNewerRound.correctSide === 'left'}
        {@const rightIsNewer = roundStatus === 'result' && olderNewerRound.correctSide === 'right'}
        
        <div class="fixed inset-0 z-0">
          <div class="absolute inset-0 bg-paper-100"></div>
          <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,0,0,0.045),transparent_45%)]"></div>
          <div class="absolute inset-0 opacity-[0.35] [background-size:28px_28px] [background-image:linear-gradient(to_right,rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.05)_1px,transparent_1px)]"></div>
        </div>

        <div class="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6 lg:gap-5 lg:px-8">
          <header class="flex items-center justify-between rounded-2xl border border-paper-300/70 bg-paper-200/85 px-4 py-3 shadow-[0_10px_30px_rgba(34,34,34,0.08)] backdrop-blur-sm">
            <div class="flex items-center gap-3">
              <button
                class="mq-btn-secondary h-10 w-10 p-0"
                onclick={exitToModes}
                aria-label="Back to modes"
                title="Back to modes"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Older or Newer</p>
                <h2 class="font-display text-xl text-ink sm:text-2xl">
                  {#if roundStatus === 'guessing'}
                    Pick the newer photo
                  {:else if lastOlderNewerGuess === olderNewerRound.correctSide}
                    Correct guess
                  {:else}
                    Incorrect guess
                  {/if}
                </h2>
              </div>
            </div>
            <div class="flex items-center gap-2 rounded-full border border-paper-300/80 bg-paper-100/90 px-4 py-2">
              <span class="text-xs font-semibold uppercase tracking-widest text-muted">Streak</span>
              <span class="font-display text-xl leading-none text-ink">{streak}</span>
            </div>
          </header>

          {#if errorMessage}
            <div class="{flashBaseClass} border-danger-500/15 bg-paper-200/90 text-danger-600">{errorMessage}</div>
          {/if}

          {#if noticeMessage}
            <div class="{flashBaseClass} border-moss-600/15 bg-paper-200/90 text-moss-700">{noticeMessage}</div>
          {/if}

          <div class="rounded-2xl border border-paper-300/70 bg-paper-200/85 px-4 py-3 text-center shadow-[0_10px_30px_rgba(34,34,34,0.08)] backdrop-blur-sm sm:px-5 sm:py-4">
            {#if roundStatus === 'guessing'}
              <p class="text-sm text-muted sm:text-base">Select one image. You can open full screen before choosing.</p>
            {:else}
              <p class="text-sm text-muted sm:text-base">
                {#if olderNewerRound.gapDays === 0}
                  Both photos were taken on the same day.
                {:else}
                  These photos are {olderNewerRound.gapDays} day{olderNewerRound.gapDays === 1 ? '' : 's'} apart.
                {/if}
              </p>
            {/if}
          </div>

          <div class="grid items-start gap-4 md:grid-cols-2 lg:gap-5">
            <div
              class="group relative flex flex-col overflow-hidden rounded-2xl border bg-paper-200/90 shadow-[0_14px_34px_rgba(34,34,34,0.08)] transition-all duration-200 {roundStatus === 'guessing' ? 'border-paper-300/80 hover:-translate-y-0.5 hover:border-clay-500/40' : leftIsNewer ? 'border-moss-500/50 bg-moss-50/80' : 'border-paper-300/80'}"
            >
              <div class="relative aspect-[4/3] overflow-hidden bg-paper-100">
                <img
                  class="h-full w-full object-cover transition-transform duration-300 {roundStatus === 'guessing' ? 'group-hover:scale-[1.015]' : ''}"
                  src={olderNewerRound.left.imageUrl}
                  alt={olderNewerRound.left.filename}
                  loading="eager"
                />
                <div class="absolute left-3 top-3 z-10">
                  <button
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300/80 bg-paper-200/90 text-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-paper-100"
                    aria-label="View full screen"
                    title="View full screen"
                    onclick={() => openOlderNewerFullscreen(olderNewerRound!.left)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  </button>
                </div>
                {#if canDeleteCurrentRoundMedia()}
                  <div class="absolute right-3 top-3 z-10">
                    <button
                      type="button"
                      class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300/80 bg-paper-200/90 text-danger-500 shadow-sm backdrop-blur-sm transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Delete photo and skip round"
                      title="Delete photo and skip round"
                      onclick={() => handleDeleteRoundMedia(olderNewerRound!.left)}
                      disabled={deletingMediaIds.length > 0}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                    </button>
                  </div>
                {/if}
              </div>
              <div class="grid gap-2 p-4 sm:p-5">
                {#if roundStatus === 'result'}
                  <p class="text-sm font-semibold text-ink">
                    {leftIsOlder ? 'Older photo' : 'Newer photo'}
                  </p>
                  <p class="text-xs text-muted sm:text-sm">{olderNewerRound.left.captureDateLabel}</p>
                {:else}
                  <p class="text-xs text-muted sm:text-sm">Choose this photo if you think it is newer.</p>
                  <button
                    type="button"
                    class="mq-btn-primary justify-center text-sm"
                    onclick={() => handleOlderNewerGuess('left')}
                    disabled={deletingMediaIds.length > 0}
                  >
                    Select as newer
                  </button>
                {/if}
              </div>
            </div>

            <div
              class="group relative flex flex-col overflow-hidden rounded-2xl border bg-paper-200/90 shadow-[0_14px_34px_rgba(34,34,34,0.08)] transition-all duration-200 {roundStatus === 'guessing' ? 'border-paper-300/80 hover:-translate-y-0.5 hover:border-clay-500/40' : rightIsNewer ? 'border-moss-500/50 bg-moss-50/80' : 'border-paper-300/80'}"
            >
              <div class="relative aspect-[4/3] overflow-hidden bg-paper-100">
                <img
                  class="h-full w-full object-cover transition-transform duration-300 {roundStatus === 'guessing' ? 'group-hover:scale-[1.015]' : ''}"
                  src={olderNewerRound.right.imageUrl}
                  alt={olderNewerRound.right.filename}
                  loading="eager"
                />
                <div class="absolute left-3 top-3 z-10">
                  <button
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300/80 bg-paper-200/90 text-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-paper-100"
                    aria-label="View full screen"
                    title="View full screen"
                    onclick={() => openOlderNewerFullscreen(olderNewerRound!.right)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  </button>
                </div>
                {#if canDeleteCurrentRoundMedia()}
                  <div class="absolute right-3 top-3 z-10">
                    <button
                      type="button"
                      class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300/80 bg-paper-200/90 text-danger-500 shadow-sm backdrop-blur-sm transition-colors hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Delete photo and skip round"
                      title="Delete photo and skip round"
                      onclick={() => handleDeleteRoundMedia(olderNewerRound!.right)}
                      disabled={deletingMediaIds.length > 0}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                    </button>
                  </div>
                {/if}
              </div>
              <div class="grid gap-2 p-4 sm:p-5">
                {#if roundStatus === 'result'}
                  <p class="text-sm font-semibold text-ink">
                    {rightIsOlder ? 'Older photo' : 'Newer photo'}
                  </p>
                  <p class="text-xs text-muted sm:text-sm">{olderNewerRound.right.captureDateLabel}</p>
                {:else}
                  <p class="text-xs text-muted sm:text-sm">Choose this photo if you think it is newer.</p>
                  <button
                    type="button"
                    class="mq-btn-primary justify-center text-sm"
                    onclick={() => handleOlderNewerGuess('right')}
                    disabled={deletingMediaIds.length > 0}
                  >
                    Select as newer
                  </button>
                {/if}
              </div>
            </div>
          </div>

          {#if roundStatus === 'result'}
            <div class="mx-auto w-full max-w-md">
              <div class="mq-card-enter grid gap-3 rounded-[20px] border p-4 shadow-lg sm:rounded-[24px] sm:p-5 {lastOlderNewerGuess === olderNewerRound.correctSide ? 'border-moss-500/25 bg-moss-50/95' : 'border-danger-400/25 bg-danger-50/95'}">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="font-display text-lg text-ink sm:text-xl">
                      {lastOlderNewerGuess === olderNewerRound.correctSide ? 'Correct!' : 'Wrong guess'}
                    </h3>
                    <p class="text-xs text-muted sm:text-sm">
                      {#if olderNewerRound.gapDays === 0}
                        Same day!
                      {:else}
                        {olderNewerRound.gapDays} day{olderNewerRound.gapDays === 1 ? '' : 's'} apart
                      {/if}
                    </p>
                  </div>
                  <button
                    class="mq-btn-primary whitespace-nowrap text-sm sm:text-base"
                    onclick={lastOlderNewerGuess === olderNewerRound.correctSide ? nextRound : exitToModes}
                  >
                    {lastOlderNewerGuess === olderNewerRound.correctSide ? 'Next' : 'Done'}
                  </button>
                </div>
              </div>
            </div>
          {/if}

          {#if olderNewerFullscreenMedia}
            <ImageOverlay
              src={olderNewerFullscreenMedia.imageUrl}
              alt={olderNewerFullscreenMedia.filename}
              onClose={closeOlderNewerFullscreen}
            />
          {/if}
        </div>
      {:else if gameMode === 'location' && locationRound}
        <div class="absolute inset-0 z-0 bg-black/90">
          <div class="absolute inset-0 z-0 overflow-hidden opacity-30 blur-2xl">
            <img 
              class="h-full w-full object-cover object-center"
              src={locationRound.media.imageUrl}
              alt=""
            />
          </div>
          <div
            bind:this={locationImageViewport}
            class="absolute inset-0 z-10 overflow-hidden touch-none"
            role="region"
            aria-label="LocationGuessr image zoom and pan"
            onwheel={handleLocationImageWheel}
            onpointerdown={handleLocationImagePointerDown}
            onpointermove={handleLocationImagePointerMove}
            onpointerup={handleLocationImagePointerUp}
            onpointercancel={handleLocationImagePointerUp}
          >
            <img
              class="h-full w-full select-none object-contain object-center opacity-100 transition-transform duration-75 ease-out {locationImageScale > 1 ? (locationImageDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}"
              src={locationRound.media.imageUrl}
              alt="Where was this taken?"
              draggable="false"
              style="transform: translate({locationImageOffsetX}px, {locationImageOffsetY}px) scale({locationImageScale});"
            />
          </div>
          
          <div class="absolute inset-0 z-20 bg-gradient-to-b from-ink/60 via-transparent to-transparent pointer-events-none"></div>
          
          <header class="absolute left-0 right-0 top-0 flex items-center justify-between p-4 sm:p-6 lg:p-8 z-20 pointer-events-auto">
            <div class="flex items-center gap-3">
              <button class="mq-btn-secondary h-10 w-10 p-0 shadow-lg border-paper-300/25 bg-paper-200/14 text-ink hover:bg-paper-200/20 hover:border-paper-300/30 backdrop-blur-md" onclick={exitToModes} aria-label="Back to modes" title="Back to modes">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <div class="flex items-center gap-2 rounded-full border border-paper-300/25 bg-paper-200/14 px-2 py-2 text-ink shadow-lg backdrop-blur-md">
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-paper-300/25 bg-paper-200/14 text-ink transition-colors hover:bg-paper-200/22"
                  onclick={() => zoomLocationImage(locationImageScale / 1.2)}
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-paper-300/25 bg-paper-200/14 text-ink transition-colors hover:bg-paper-200/22"
                  onclick={() => zoomLocationImage(locationImageScale * 1.2)}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button
                  type="button"
                  class="inline-flex h-8 items-center justify-center rounded-full border border-paper-300/25 bg-paper-200/14 px-3 text-xs font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-paper-200/22"
                  onclick={resetLocationImageView}
                >
                  Reset
                </button>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2 rounded-full border border-paper-300/25 bg-paper-200/14 px-4 py-2 text-ink shadow-lg backdrop-blur-md">
                <span class="text-xs font-bold uppercase tracking-widest opacity-80">Radius</span>
                <span class="font-display text-xl leading-none">{locationRound.allowedRadiusKm}km</span>
              </div>
              
              <div class="flex items-center gap-2 rounded-full border border-paper-300/25 bg-moss-600/80 px-4 py-2 text-ink shadow-lg backdrop-blur-md">
                <span class="text-xs font-bold uppercase tracking-widest opacity-80">Streak</span>
                <span class="font-display text-xl leading-none">{streak}</span>
              </div>
            </div>
          </header>

          <div class="absolute bottom-5 right-5 z-30 aspect-[4/3] w-[min(52vw,280px)] min-w-[170px] sm:w-[min(32vw,300px)] lg:w-[300px]">
            <WorldMap
              guess={lastGuess}
              answer={roundStatus === 'result' ? locationRound.answer : null}
              disabled={roundStatus === 'result' || deletingMediaIds.length > 0}
              onSelect={handleLocationGuess}
              onConfirm={submitLocationGuess}
            />
          </div>

          <div class="pointer-events-none absolute left-1/2 top-[5.25rem] z-20 -translate-x-1/2 rounded-full border border-paper-300/25 bg-paper-200/12 px-4 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink/80 shadow-md backdrop-blur-md sm:top-[6.2rem]">
            Scroll or +/- to zoom. Drag to pan.
          </div>

          {#if roundStatus === 'result'}
            <div class="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 w-[min(calc(100%-2.5rem),480px)]">
              <div class={`${flashBaseClass} border-none shadow-2xl backdrop-blur-xl ${lastDistanceKm! <= locationRound.allowedRadiusKm ? 'bg-moss-700/90 text-ink' : 'bg-danger-600/90 text-ink'}`}>
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <h4 class="font-display text-xl">
                      {lastDistanceKm! <= locationRound.allowedRadiusKm ? 'Great guess!' : 'Too far away!'}
                    </h4>
                    <p class="text-sm opacity-90">
                      You were <strong>{formatLocationDistance(lastDistanceKm!)}</strong> away.
                      {#if lastDistanceKm! <= locationRound.allowedRadiusKm}
                        The goal was {locationRound.allowedRadiusKm} km.
                      {:else}
                        Streak reset.
                      {/if}
                    </p>
                  </div>
                  <button class="mq-btn-primary bg-paper-200 text-ink hover:bg-paper-100 border-none shadow-md" onclick={lastDistanceKm! <= locationRound.allowedRadiusKm ? nextRound : exitToModes}>
                    {lastDistanceKm! <= locationRound.allowedRadiusKm ? 'Next Round' : 'Try Again'}
                  </button>
                </div>
              </div>
            </div>
          {/if}
          
          {#if canDeleteCurrentRoundMedia()}
            <button
              type="button"
              class="absolute left-5 bottom-5 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-paper-300/25 bg-paper-200/14 text-ink shadow-lg backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-danger-500/80 hover:border-danger-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-danger-500/35 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Remove image"
              title="Remove image"
              onclick={() => handleDeleteRoundMedia(locationRound!.media)}
              disabled={deletingMediaIds.length > 0}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
            </button>
          {/if}

          {#if errorMessage}
            <div class="absolute top-24 left-1/2 -translate-x-1/2 z-20 w-[min(calc(100%-2.5rem),480px)]">
              <div class={`${flashBaseClass} border-danger-500/15 bg-paper-200/88 text-danger-500 backdrop-blur-md`}>{errorMessage}</div>
            </div>
          {/if}

          {#if noticeMessage}
            <div class="absolute top-24 left-1/2 -translate-x-1/2 z-20 w-[min(calc(100%-2.5rem),480px)]">
              <div class={`${flashBaseClass} border-moss-700/15 bg-paper-200/88 text-moss-700 backdrop-blur-md`}>{noticeMessage}</div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex flex-col gap-6 px-6 lg:px-8">
          <header class="mq-card-enter flex items-center justify-between">
            <div class="flex items-center gap-4">
              <button class="mq-btn-secondary h-10 w-10 p-0" onclick={exitToModes} aria-label="Back to modes" title="Back to modes">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <div>
                <h2 class="font-display text-xl text-ink">{getModeTitle(gameMode)}</h2>
                <p class="text-xs font-bold uppercase tracking-wider text-muted/60">{activeExport.name}</p>
              </div>
            </div>

            <div class="flex items-center gap-2 rounded-full bg-clay-500/10 px-4 py-2 text-clay-700">
              <span class="text-xs font-bold uppercase tracking-widest opacity-60">Streak</span>
              <span class="font-display text-2xl leading-none">{streak}</span>
            </div>
          </header>

          {#if errorMessage}
            <div class={`${flashBaseClass} border-danger-500/15 bg-paper-200/88 text-danger-500`}>{errorMessage}</div>
          {/if}

          {#if noticeMessage}
            <div class={`${flashBaseClass} border-moss-700/15 bg-paper-200/88 text-moss-700`}>{noticeMessage}</div>
          {/if}

        {#if gameMode === 'timeline-sort' && timelineSortRound}
          <div class="flex flex-col gap-6" style="margin-left: calc(-50vw + 50%); margin-right: calc(-50vw + 50%); width: 100vw; padding: 0 max(1.5rem, calc((100vw - 1280px) / 2)); overflow-x: hidden;">
            <div class="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start max-w-7xl mx-auto w-full">
              {#if selectedTimelineMedia}
                <div class="h-full max-h-[50vh]">
                  {#key selectedTimelineMedia.id}
                    <PhotoFrame
                      src={selectedTimelineMedia.imageUrl}
                      alt={selectedTimelineMedia.filename}
                      label={
                        timelineLockedIds.includes(selectedTimelineMedia.id)
                          ? `${selectedTimelineMedia.captureDateLabel} • Locked on the full timeline`
                          : 'Drag this photo above the timeline into the right chronological slot.'
                      }
                      deleteDisabled={deletingMediaIds.length > 0}
                      onDelete={canDeleteCurrentRoundMedia() ? () => handleDeleteRoundMedia(selectedTimelineMedia!) : null}
                    />
                  {/key}
                </div>
              {/if}

              <aside class="grid gap-4 w-full">
                <div class="mq-panel grid gap-3 p-5">
                  <p class="text-xs font-bold uppercase tracking-[0.24em] text-clay-600/75">This Round</p>
                  <h3 class="font-display text-2xl text-ink">Full Library Timeline</h3>
                  <p class="text-sm leading-relaxed text-muted">
                    Keep the order correct. Every successful guess snaps the new photo to its true date and locks it below the timeline.
                  </p>
                  <p class="text-sm text-muted">
                    Range: <strong>{formatTimelineDate(timelineSortRound.rangeStartTs)}</strong> to
                    <strong>{formatTimelineDate(timelineSortRound.rangeEndTs)}</strong>
                  </p>
                </div>

                <div class="mq-panel grid gap-3 p-5">
                  <p class="text-xs font-bold uppercase tracking-[0.24em] text-clay-600/75">Selected Photo</p>
                  <p class="text-sm text-muted">
                    {getTimelinePlacementSummary(selectedTimelineMedia)}
                  </p>
                  {#if roundStatus === 'result' && selectedTimelineMedia}
                    <p class="text-sm text-muted">
                      Actual date: <strong>{formatTimelineDetail(selectedTimelineMedia.captureTs)}</strong>
                    </p>
                  {/if}
                </div>

                {#if roundStatus === 'guessing'}
                  <button class="mq-btn-primary w-full justify-center" onclick={submitTimelineGuess} disabled={deletingMediaIds.length > 0}>
                    Check Order
                  </button>
                {:else}
                  <div class={`${flashBaseClass} ${lastTimelineOrderCorrect ? 'border-moss-700/15 bg-moss-700/5 text-moss-800' : 'border-danger-500/15 bg-danger-500/5 text-danger-700'}`}>
                    <div class="grid gap-3">
                      <div>
                        <h4 class="font-display text-xl">
                          {lastTimelineOrderCorrect ? 'Order locked in!' : 'Out of order'}
                        </h4>
                        <p class="text-sm opacity-80">
                          {#if lastTimelineOrderCorrect}
                            The new photo snaps to <strong>{formatTimelineDate(getTimelineRoundMedia(timelineSortRound.newlyAddedId)?.captureTs ?? timelineSortRound.rangeStartTs)}</strong> and joins the locked stack.
                          {:else}
                            The new photo belongs at <strong>{formatTimelineDate(getTimelineRoundMedia(timelineSortRound.newlyAddedId)?.captureTs ?? timelineSortRound.rangeStartTs)}</strong>.
                          {/if}
                        </p>
                      </div>
                      <button class="mq-btn-primary justify-center" onclick={lastTimelineOrderCorrect ? nextRound : exitToModes}>
                        {lastTimelineOrderCorrect ? 'Add Another Photo' : 'Try Again'}
                      </button>
                    </div>
                  </div>
                {/if}
              </aside>
            </div>
            
            <div class="w-full pb-8">
              <TimelineSorter
                items={timelineSortRound.items}
                positions={timelinePlacements}
                selectedId={selectedTimelineMediaId}
                newlyAddedId={timelineSortRound.newlyAddedId}
                lockedIds={timelineLockedIds}
                rangeStartTs={timelineSortRound.rangeStartTs}
                rangeEndTs={timelineSortRound.rangeEndTs}
                disabled={roundStatus === 'result' || deletingMediaIds.length > 0}
                revealAnswer={roundStatus === 'result'}
                statusMap={timelineStatusMap}
                onMove={handleTimelinePlacement}
                onSelect={handleTimelineSelect}
              />
            </div>
          </div>
        {/if}
      </div>
    {/if}
    {/if}

    {#if showSetupModal}
      <div class="fixed inset-0 z-20 grid place-items-center bg-ink/55 p-4 backdrop-blur-md sm:p-6">
        <div
          class="mq-panel mq-modal-panel flex h-full max-h-[720px] w-full max-w-[800px] flex-col overflow-hidden p-0 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="takeout-setup-title"
        >
          <!-- Modal Header -->
          <div class="flex items-center justify-between border-b border-paper-300/50 bg-paper-50/30 px-6 py-5 sm:px-8">
            <div class="grid gap-1">
              <span class="text-xs font-bold uppercase tracking-widest text-clay-600">New Library</span>
              <h2 id="takeout-setup-title" class="font-display text-2xl text-ink">
                {#if setupStep === 'guide'}How to prepare your export{:else if setupStep === 'name'}Name your library{:else if setupStep === 'preparing'}Inspecting your zip{:else if setupStep === 'review'}Review and confirm{:else if setupStep === 'importing'}Importing library...{:else}Import results{/if}
              </h2>
            </div>
            <button class="text-muted hover:text-ink disabled:opacity-30" onclick={() => closeSetupModal()} disabled={isImporting || isPreparingImport} aria-label="Close library setup" title="Close library setup">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="12" x2="18" y2="12"></line><line x1="6" y1="18" x2="18" y2="6"></line></svg>
            </button>
          </div>

          <!-- Step Indicator -->
          <div class="flex gap-1 bg-paper-50/45 px-6 py-3 sm:px-8">
            {#each setupFlowSteps as step}
              {@const active = setupStep === step}
              {@const completed = setupFlowSteps.indexOf(step) < setupFlowSteps.indexOf(setupStep)}
              <div class="h-1 flex-1 rounded-full transition-colors {active ? 'bg-clay-500' : completed ? 'bg-moss-600' : 'bg-paper-300'}"></div>
            {/each}
          </div>

          <!-- Modal Body -->
          <div class="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
            {#if setupStep === 'guide'}
              <div class="grid gap-8">
                <div class="grid gap-4">
                  {#each takeoutSteps as step, index}
                    <div class="flex gap-5">
                      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-clay-500/10 font-display text-lg text-clay-600">
                        {index + 1}
                      </div>
                      <div class="grid gap-1">
                        <h4 class="font-display text-xl text-ink">{step.title}</h4>
                        <p class="text-sm leading-relaxed text-muted">{step.detail}</p>
                      </div>
                    </div>
                  {/each}
                </div>

                <div class="rounded-[24px] bg-moss-700/5 p-6 text-sm leading-relaxed text-moss-800">
                  <p><strong>Pro Tip:</strong> Only include the albums you want to play with. This keeps the library fast and compact.</p>
                </div>
              </div>
            {:else if setupStep === 'name'}
              <div class="grid gap-6">
                <div class="grid gap-2">
                  <label for="library-name-input" class="text-xs font-bold uppercase tracking-widest text-clay-600">Library Name</label>
                  <input
                    bind:this={libraryNameInput}
                    id="library-name-input"
                    type="text"
                    class="mq-input w-full"
                    value={libraryName}
                    placeholder="Summer Trips 2024"
                    maxlength="80"
                    oninput={handleLibraryNameInput}
                    onkeydown={(event) => event.key === 'Enter' && libraryName.trim() && chooseImportFile()}
                  />
                </div>

                <div class="rounded-[24px] bg-paper-200/55 p-5 text-sm leading-relaxed text-muted">
                  Pick a friendly name now so this library is easy to find later. You can still rename it after the import.
                </div>

                {#if setupErrorMessage}
                  <div class="flex gap-3 rounded-2xl bg-danger-500/10 p-4 text-sm text-danger-600">
                    <svg class="mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <p>{setupErrorMessage}</p>
                  </div>
                {/if}
              </div>
            {:else if setupStep === 'preparing'}
              <div class="flex h-full flex-col items-center justify-center gap-6 py-10 text-center">
                <div class="relative flex h-24 w-24 items-center justify-center">
                  <div class="absolute inset-0 rounded-full border-4 border-paper-300"></div>
                  <div class="absolute inset-0 rounded-full border-4 border-clay-500 border-t-transparent animate-spin"></div>
                  <div class="h-3 w-3 rounded-full bg-clay-500"></div>
                </div>

                <div class="grid max-w-[420px] gap-2">
                  <h3 class="font-display text-2xl text-ink">{setupLoadingMessage}</h3>
                  <p class="text-muted">This reads the selected archive details before you confirm the import.</p>
                </div>
              </div>
            {:else if setupStep === 'review'}
              <div class="grid gap-6">
                {#if importPreview}
                  <div class="grid gap-4 rounded-[24px] border border-paper-300 bg-paper-200/55 p-6">
                    <div class="grid grid-cols-[100px_1fr] gap-x-4 gap-y-3 text-sm">
                      <span class="font-medium text-muted">Library</span>
                      <strong class="text-ink">{libraryName}</strong>

                      <span class="font-medium text-muted">Filename</span>
                      <strong class="text-ink">{importPreview.fileName}</strong>

                      <span class="font-medium text-muted">Size</span>
                      <strong class="text-ink">{formatBytes(importPreview.sizeBytes)}</strong>

                      <span class="font-medium text-muted">Path</span>
                      <code class="break-all rounded bg-paper-200/50 px-1.5 py-0.5 text-xs text-ink/80">{importPreview.filePath}</code>
                    </div>
                  </div>

                  {#if importPreview.duplicateOf}
                    <div class="flex gap-4 rounded-[24px] border border-sun-300/30 bg-sun-300/10 p-5 text-sun-900">
                      <div class="mt-0.5 shrink-0 text-sun-600">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                      </div>
                      <div class="grid gap-1.5">
                        <strong class="font-semibold">Duplicate export detected</strong>
                        <p class="text-sm leading-relaxed opacity-90">
                          This zip matches <strong>{importPreview.duplicateOf.name}</strong>. Import as a separate library anyway?
                        </p>
                        <label class="mt-2 flex items-center gap-2 font-medium">
                          <input type="checkbox" class="h-4 w-4 rounded accent-clay-500" bind:checked={allowDuplicateImport} />
                          <span>Yes, create a separate copy</span>
                        </label>
                      </div>
                    </div>
                  {/if}
                {/if}

                {#if setupErrorMessage}
                  <div class="flex gap-3 rounded-2xl bg-danger-500/10 p-4 text-sm text-danger-600">
                    <svg class="mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <p>{setupErrorMessage}</p>
                  </div>
                {/if}
              </div>
            {:else if setupStep === 'importing'}
              <div class="flex h-full flex-col items-center justify-center gap-8 py-10 text-center">
                <div class="relative h-32 w-32">
                  <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100">
                    <circle class="text-paper-300" stroke-width="8" stroke="currentColor" fill="transparent" r="40" cx="50" cy="50" />
                    <circle class="text-clay-500 transition-all duration-300" stroke-width="8" stroke-dasharray={2 * Math.PI * 40} stroke-dashoffset={(1 - progressPercent / 100) * 2 * Math.PI * 40} stroke-linecap="round" stroke="currentColor" fill="transparent" r="40" cx="50" cy="50" />
                  </svg>
                  <div class="absolute inset-0 flex items-center justify-center font-display text-2xl text-ink">
                    {progressPercent}%
                  </div>
                </div>

                <div class="grid gap-2">
                  <h3 class="font-display text-2xl text-ink">{importProgress?.message ?? 'Starting import...'}</h3>
                  <p class="text-muted">Please keep the app open while we process your photos.</p>
                </div>
              </div>
            {:else if setupStep === 'result' && importResult}
              <div class="grid gap-6">
                <div class="rounded-[28px] border border-moss-700/15 bg-moss-700/6 p-6">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="grid gap-1">
                      <span class="text-xs font-bold uppercase tracking-[0.24em] text-moss-700/70">Library Ready</span>
                      <h3 class="font-display text-3xl text-ink">{importResult.overview.name}</h3>
                      <p class="text-sm leading-relaxed text-muted">
                        Imported <strong>{importResult.summary.totalImages}</strong> photos into the library from
                        <strong>{importResult.summary.sourceImageCount}</strong> discovered image files.
                      </p>
                    </div>
                    <div class="inline-flex items-center rounded-full bg-paper-200/82 px-4 py-2 text-sm font-semibold text-ink shadow-sm">
                      {importResult.summary.issueCount} issue{importResult.summary.issueCount === 1 ? '' : 's'} found
                    </div>
                  </div>
                </div>

                <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div class="rounded-[24px] border border-paper-300/70 bg-paper-200/72 p-5">
                    <p class="text-xs font-bold uppercase tracking-widest text-clay-600">With Geolocation</p>
                    <p class="mt-2 font-display text-4xl text-ink">{importResult.summary.withGeoCount}</p>
                  </div>
                  <div class="rounded-[24px] border border-paper-300/70 bg-paper-200/72 p-5">
                    <p class="text-xs font-bold uppercase tracking-widest text-clay-600">Without Geolocation</p>
                    <p class="mt-2 font-display text-4xl text-ink">{importResult.summary.withoutGeoCount}</p>
                  </div>
                  <div class="rounded-[24px] border border-paper-300/70 bg-paper-200/72 p-5">
                    <p class="text-xs font-bold uppercase tracking-widest text-clay-600">With Timestamp</p>
                    <p class="mt-2 font-display text-4xl text-ink">{importResult.summary.withTimestampCount}</p>
                  </div>
                  <div class="rounded-[24px] border border-paper-300/70 bg-paper-200/72 p-5">
                    <p class="text-xs font-bold uppercase tracking-widest text-clay-600">Without Timestamp</p>
                    <p class="mt-2 font-display text-4xl text-ink">{importResult.summary.withoutTimestampCount}</p>
                  </div>
                  <div class="rounded-[24px] border border-paper-300/70 bg-paper-200/72 p-5">
                    <p class="text-xs font-bold uppercase tracking-widest text-clay-600">Images Found In Zip</p>
                    <p class="mt-2 font-display text-4xl text-ink">{importResult.summary.sourceImageCount}</p>
                  </div>
                  <div class="rounded-[24px] border border-paper-300/70 bg-paper-200/72 p-5">
                    <p class="text-xs font-bold uppercase tracking-widest text-clay-600">Images In Library</p>
                    <p class="mt-2 font-display text-4xl text-ink">{importResult.summary.totalImages}</p>
                  </div>
                </div>

                <section class="grid gap-3 rounded-[24px] border border-paper-300/70 bg-paper-200/105 p-6">
                  <div class="flex items-center justify-between gap-3">
                    <h4 class="font-display text-2xl text-ink">Import Issues</h4>
                    <span class="text-xs font-bold uppercase tracking-widest text-muted/70">{importResult.summary.issueCount} logged</span>
                  </div>

                  {#if importResult.summary.issueCount === 0}
                    <div class="rounded-2xl bg-moss-700/8 px-4 py-3 text-sm text-moss-800">
                      No import issues were detected.
                    </div>
                  {:else}
                    <div class="max-h-64 overflow-y-auto rounded-2xl bg-paper-100/70 p-3">
                      <div class="grid gap-2">
                        {#each importResult.summary.issues as issue}
                          <div class="rounded-2xl border border-sun-300/35 bg-paper-200/74 px-4 py-3 text-sm leading-relaxed text-ink">
                            {issue}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </section>
              </div>
            {/if}
          </div>

          <!-- Modal Footer -->
          <div class="flex items-center justify-between border-t border-paper-300/50 bg-paper-50/35 px-6 py-5 sm:px-8">
            {#if setupStep === 'guide'}
              <button class="mq-btn-secondary" onclick={() => getApi().openTakeoutLink()}>
                Open Google Takeout
              </button>
              <button class="mq-btn-primary" onclick={() => (setupStep = 'name')}>
                Next: Name Library
              </button>
            {:else if setupStep === 'name'}
              <button class="mq-btn-secondary" onclick={() => (setupStep = 'guide')} disabled={isImporting || isPreparingImport}>
                Back
              </button>
              <button class="mq-btn-primary" onclick={chooseImportFile} disabled={!libraryName.trim() || isImporting || isPreparingImport}>
                Next: Select Zip
              </button>
            {:else if setupStep === 'preparing'}
              <div class="w-full text-center text-sm font-medium text-muted">
                Reading the selected zip and checking whether it already exists...
              </div>
            {:else if setupStep === 'review'}
              <button class="mq-btn-secondary" onclick={() => (setupStep = 'name')} disabled={isImporting || isPreparingImport}>
                Back
              </button>
              <div class="flex gap-3">
                <button class="mq-btn-secondary" onclick={chooseImportFile} disabled={isImporting || isPreparingImport}>
                  Change File
                </button>
                <button class="mq-btn-primary" onclick={startImport} disabled={isImporting || isPreparingImport}>
                  Create Library
                </button>
              </div>
            {:else if setupStep === 'importing'}
              <div class="w-full text-center text-sm font-medium text-muted">
                Indexing and processing media library...
              </div>
            {:else if setupStep === 'result'}
              <div class="w-full flex justify-end">
                <button class="mq-btn-primary" onclick={finishImportReview}>
                  Open Library
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if renamingExport}
      <div class="fixed inset-0 z-20 grid place-items-center bg-ink/55 p-4 backdrop-blur-md sm:p-6">
        <div
          class="mq-panel mq-modal-panel flex w-full max-w-[480px] flex-col overflow-hidden p-0 shadow-2xl"
          role="dialog"
          aria-modal="true"
        >
          <div class="border-b border-paper-300/50 bg-paper-50/30 px-6 py-5 sm:px-8">
            <h2 class="font-display text-2xl text-ink">Rename Library</h2>
          </div>

          <div class="px-6 py-8 sm:px-8">
            <div class="grid gap-2">
              <label for="rename-input" class="text-xs font-bold uppercase tracking-widest text-clay-600">Friendly Name</label>
              <input
                bind:this={renameInput}
                id="rename-input"
                type="text"
                class="mq-input w-full"
                bind:value={renameValue}
                placeholder="Give this library a friendly name"
                onkeydown={(e) => e.key === 'Enter' && confirmRename()}
              />
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 border-t border-paper-300/50 bg-paper-50/35 px-6 py-5 sm:px-8">
            <button class="mq-btn-secondary" onclick={cancelRename}>Cancel</button>
            <button class="mq-btn-primary" onclick={confirmRename} disabled={!renameValue.trim()}>Save Changes</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
