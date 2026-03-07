# MemoryQuiz

MemoryQuiz is a SvelteKit + Electron desktop app that turns Google Photos Takeout exports into replayable memory games.

## What it does

- imports one or more Google Photos Takeout `.zip` exports into local app storage
- treats every export as its own savegame with isolated highscores and history
- shows export size, indexed counts, and management actions on startup
- includes two game modes: `LocationGuessr` and `OlderVsNewer`

## Development

```bash
npm install
npm run dev
```

## Windows CI artifacts

Every push runs `.github/workflows/build-windows.yml` and uploads a Windows build artifact.

To download it:

1. Open the GitHub Actions run for your push.
2. Open the `Build Windows App` workflow run.
3. Download the artifact named `MemoryQuiz-windows-<commit-sha>` from the Artifacts section.
