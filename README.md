# 🧠 MemoryQuiz

**Turn your Google Photos into a replayable memory workout.**

MemoryQuiz is a desktop app that transforms your Google Photos Takeout exports into three addictive memory games. Test how well you remember where you've been, when things happened, and the order of your life's moments.

---

## ✨ What It Does

Import your Google Photos Takeout `.zip` files and instantly get three ways to challenge your memory:

### 🌍 LocationGuessr
*"Wait... where WAS this taken?"*

Look at a photo and drop a pin on the world map where you think it was captured. The challenge gets harder as your streak grows—the target radius shrinks with every correct guess! Perfect for those "I know I've been there but..." moments.

### 🕐 Older or Newer  
*"Which came first—the vacation or the graduation?"*

Two photos appear side by side. Your job? Pick which one is newer. Sounds simple until you're comparing two random Tuesdays from 2019. Great for testing your long-term episodic memory.

### 📅 Memory Timeline
*"Build your life story, one photo at a time"*

Start with one photo locked in time. Each round adds a new photo to place on the timeline. Get it right, and it locks into history. Get it wrong, and your run ends. Can you reconstruct your past chronologically?

---

## 🎮 Features

- **📚 Multiple Libraries** — Import as many Takeout exports as you want. Each gets its own high scores, streaks, and history.
- **🔥 Streak System** — Build up streaks in each mode. How long can you keep your run alive?
- **🏆 Personal Bests** — Track your best streaks per library and mode.
- **🗑️ Photo Management** — Delete photos mid-round if they're too easy, too hard, or just not fun. Your streak stays safe if you skip before guessing.
- **🔍 Duplicate Detection** — Won't accidentally import the same zip twice (unless you really want to).
- **🖼️ Full-Screen Viewing** — Zoom into photos to spot those telltale location clues.
- **🗺️ Interactive Maps** — Pan, zoom, and hunt for that exact spot. Double-click to zoom in faster.
- **📊 Import Progress** — Watch your photos get processed with real-time progress updates.

---

## 🚀 Getting Started

### Prerequisites

- Windows (for now—CI builds Windows executables)
- A Google Photos Takeout export (`.zip` file)

### Installation

1. Download the latest Windows build from the [latest GitHub release](https://github.com/PoolPirate/MemoryQuiz/releases/latest)
2. Run the installer or portable executable
3. Launch MemoryQuiz!

### Your First Import

1. **Export from Google Takeout:**
   - Go to [Google Takeout](https://takeout.google.com)
   - Deselect everything, then select **Google Photos only**
   - Pick specific albums or years you want to play with
   - Export as `.zip` and download

2. **Import to MemoryQuiz:**
   - Click "Add New Library"
   - Select your downloaded zip file
   - Give it a name (e.g., "2023 Vacation Photos")
   - Wait for processing (indexing, thumbnails, the works)
   - Start playing!

---

## 🛠️ Development

MemoryQuiz is built with:

- **SvelteKit** — Frontend framework
- **Electron** — Desktop shell
- **TypeScript** — Type safety throughout
- **Tailwind CSS** — Styling with custom design tokens
- **Better SQLite3** — Local database for metadata
- **Sharp** — Image processing and thumbnails

### Dev Setup

```bash
npm install
npm run dev
```

This starts the Vite dev server, builds the Electron main process, and launches the app in development mode.

### Building

```bash
npm run build        # Build renderer + electron
npm run package      # Create distributable
npm run package:win  # Windows-specific build
```

---

## 🎯 How Scoring Works

- **Correct guess** → Streak +1, photo(s) marked as seen
- **Wrong guess** → Run ends, final streak saved as high score if it's your best
- **Skip photo** → Delete it from the library, streak stays the same (only before you guess!)

Each mode tracks its own streak independently. Your "Older or Newer" streak won't help you in "LocationGuessr"—you've got to earn each one!

---

## 🏗️ Project Structure

```
src/
├── lib/
│   ├── components/    # Svelte UI components (WorldMap, TimelineSorter, etc.)
│   ├── types/         # TypeScript type definitions
│   └── utils/         # Game logic helpers
├── main/
│   ├── electron-main.ts   # Electron entry point
│   └── services/          # Backend services (game logic, import, storage)
├── preload/           # Electron preload scripts
└── routes/            # SvelteKit pages
```

---

## 🤝 Contributing

Found a bug? Got an idea for a new game mode? PRs welcome! The codebase is organized to make adding new memory games straightforward—just look at how the three existing modes are implemented.

---

## 📄 License

MIT — Go ahead, fork it, make it yours, challenge your friends to memory battles.

---

## 🎉 Pro Tips

- **Start broad** in LocationGuessr—zoom out, get the continent right, then refine
- **Look for season clues** in Older or Newer—fall foliage vs summer beach scenes
- **Build patterns** in Memory Timeline—notice how your photo habits changed over time
- **Import smaller albums** for focused challenges (like "Europe 2022" or "Wedding Weekend")

---

*Now go forth and prove you actually remember your own life!* 🧠✨
