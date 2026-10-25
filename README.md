# DPC.Script — a multi-track audio editor in your browser

**Live app: https://project1-dpc-script.vercel.app/**

CS-3810 Design Practices in Computer Science · Project 2 (Interactive Multi-Track Audio Editor and Mixer) · Team DPC-Script: Aaryan Bahri and Sri Varshith Reddy V · Ashoka University

DPC.Script lets anyone import audio, arrange it on a multi-track timeline, edit and mix it, and export one finished file. There is nothing to install and no account to make: open the link, drop in a file and start editing.

---

## 1. What we are building, and why

**The problem.** Combining several recordings into one finished piece of audio today means either professional software with a steep learning curve, or platform-locked software (GarageBand is Apple-only). There is no simple tool that a non-expert can open in seconds.

**Who it is for.** Students and hobbyists making podcasts, voice-overs and short music sketches, and creators who want to layer narration over background music, with no audio-engineering background.

**The main goal.** Import audio, arrange it on tracks, preview it in sync, edit and mix it (trim, split, delete, volume, mute, solo, fades), save and reopen the project, and export a single file that sounds exactly like the preview.

**A deliberate product decision: no login, projects stay in your browser.**
This product is for people who want to edit audio quickly and conveniently, without the barrier of signing up. So we chose browser storage for saving and loading projects instead of accounts and a server:

- Open the site and start working. No sign-up, no password, no upload wait.
- Your audio never leaves your computer. Everything, including decoding, mixing and export, runs client-side.
- Projects are saved in your browser's own storage on your device. The project list, the stored original audio files and the autosave all live there. (Technically this is IndexedDB through the `idb` library, because a browser's `localStorage` is far too small for audio files. `localStorage` is used only for small preferences, such as your Cream/Ink theme choice.)
- The cost is that a project lives in the browser that created it and cannot be moved to another computer. We list that as a known limitation (LM4) below.

---

## 2. Try it

1. Open **https://project1-dpc-script.vercel.app/** in a current desktop Chrome, Edge, Firefox or Safari, in a window at least 1280 px wide.
2. Click **Add a track**, then **Import** (or drag audio files onto the timeline). WAV and MP3 are supported.
3. Press **Space** to play. Drag clips, split with **S**, drag over a waveform to select a region and press **Delete**, drag the top corners of a clip to set fades.
4. **Save** (Ctrl/Cmd+S), reload the page, and **Open** the project again.
5. **Export** to a WAV file and play it anywhere.

A step-by-step walkthrough and two sample audio files are in [`docs/DEMO.md`](docs/DEMO.md) and [`samples/`](samples).

---

## 3. Features

| #     | Feature           | What it does                                                                                                                                       |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR1   | Tracks            | Add, rename and delete tracks. Each track has its own colour.                                                                                      |
| FR2   | Import            | WAV and MP3 files, up to 200 MB and 30 minutes, by file picker or drag and drop.                                                                   |
| FR3   | Arrange           | Drag clips along a track or between tracks. They snap to other clips and the playhead, and clips on one track never overlap.                       |
| FR4   | Playback          | One Play/Pause button, Stop, a millisecond clock, and a draggable playhead. All tracks start on one shared audio clock, so they never drift.       |
| FR5   | Edit              | Trim (by edge or by selection), split at the playhead, delete a region, remove a clip. Edits never change the audio itself.                        |
| FR6   | Mix               | Volume per track (shown in dB), mute and solo. Changes are heard immediately, without clicks.                                                      |
| FR7   | Fades             | Linear fade-in and fade-out per clip, by dragging handles or typing seconds.                                                                       |
| FR8   | Projects          | New, Save, Open, Reset. Autosave every 30 s. A project with missing audio still opens, with those clips marked.                                    |
| FR9   | Export            | 16-bit WAV, mono or stereo, 44.1 or 48 kHz, with a progress bar and cancel. The export uses the same mixer as playback, so it matches the preview. |
| Extra | Undo and redo     | Every edit can be undone (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).                                                                                           |
| Extra | Keyboard and zoom | Every mouse action has a keyboard alternative. Press **?** in the app for the full list. Ctrl+wheel zooms around the pointer.                      |
| Extra | Look              | A Cream or Ink theme, switched by the toggle at the top right. The colours come from our logo.                                                     |

Anything unexpected or invalid (an unreadable file, an edit that is too short, a full browser storage) shows a clear message and leaves the project unchanged.

---

## 4. How it works

**Stack.** React and TypeScript for the interface, the Canvas API for the timeline, the Web Audio API for sound, Web Workers for heavy work, and IndexedDB (through `idb`) for storage. The only runtime dependencies are `react`, `react-dom` and `idb`. Waveform summaries, WAV encoding and all timeline algorithms are our own code.

**Layers.** The code is split into layers, and ESLint enforces which layer may import which:

| Folder           | Role                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/algorithms` | Pure functions: finding clips (binary search), snapping, trim/split/delete, mute/solo rules, fade curves, waveform summaries, WAV encoding. No browser APIs. |
| `src/model`      | The data: project, tracks, clips, the source registry, and saving/loading to JSON.                                                                           |
| `src/engine`     | The mixer, playback, offline rendering for export, and the play/pause/stop state machine.                                                                    |
| `src/io`         | The browser edges: decoding files, IndexedDB, file picker and download, Web Worker bridges.                                                                  |
| `src/app`        | Services the interface calls: edit, import, export, transport, project.                                                                                      |
| `src/ui`         | React components and the canvas drawing. It holds only view state.                                                                                           |

**Key design decisions**

- **Edits are non-destructive.** A clip stores only numbers (start, offset into its audio, length, fades) and points to a shared audio source. Trim, split and delete change numbers, never copy audio. Memory does not grow with every cut, and a trimmed part can always be dragged back.
- **One mixer for playback and export.** A single mix builder produces the audio graph for both. Export is run through the same code with an offline audio context, so the exported file matches what you heard.
- **Sample-accurate synchronisation.** On Play, every clip is scheduled on the browser's audio clock from the playhead position, including clips that started earlier and fades already in progress.
- **Clips on a track are a sorted list with no overlaps.** Finding the clip under the mouse and checking a drop are binary searches, fast enough to run on every mouse move.
- **A responsive interface.** The timeline is drawn on two canvas layers, so playback only redraws the playhead. Only visible clips are drawn, and waveform summaries and WAV writing run in Web Workers.
- **Only one place changes the project.** All edits go through a single edit service, which validates first and changes the project only on success. This is what makes undo, and "a failure never leaves a half-edited project", simple.

---

## 5. Testing

The testing plan follows the one in our Assignment 3 document.

| Level        | What is tested                                                                                                            | Tool                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Unit         | Algorithms (editing, finding, snapping, mute/solo, fades, waveform, WAV), the model and saving, the transport state table | Vitest                                     |
| Integration  | Edit then play, preview vs export, save then open, import, redraws, with a simulated audio system and storage             | Vitest                                     |
| Audio output | The real sound of fades, mixing and export, rendered by the browser                                                       | Playwright                                 |
| End to end   | Use cases UC1–UC4 and the keyboard-only versions, through the real interface                                              | Playwright in Chromium, Firefox and WebKit |
| Performance  | The T7 targets, run locally                                                                                               | Playwright                                 |

The named cases from the plan (T1–T7) exist in the suite. Coverage gates run in CI: **100% of branches** in `src/algorithms` and at least 90% in `src/model`.

### Performance (T7)

Measured on an Intel i7-13700H, Chromium, against the unoptimised development server:

| Measure                                          | Target          | Result |
| ------------------------------------------------ | --------------- | ------ |
| Waveform summary of a 5-minute stereo file       | under 2 s       | 55 ms  |
| Play click to sound scheduled                    | under 100 ms    | 3 ms   |
| Frame rate while playing, scrolling and dragging | at least 30 fps | 60 fps |
| Long tasks over 50 ms                            | none            | none   |
| Export of a 3-minute stereo mix                  | under 10 s      | 844 ms |
| Opening a saved project                          | under 200 ms    | 4 ms   |

This is a fast machine, so a mid-range laptop will be slower.

---

## 6. Run it yourself

You need Node 22.

```bash
npm install
npm run dev            # http://localhost:5173
```

| Command                               | What it does                                                  |
| ------------------------------------- | ------------------------------------------------------------- |
| `npm run lint`                        | ESLint, including the layer rules                             |
| `npm run typecheck`                   | TypeScript                                                    |
| `npm test`                            | Unit and integration tests                                    |
| `npm run test:coverage`               | The same, with the coverage gates                             |
| `npm run fixtures` then `npm run e2e` | Create test audio, then run the Playwright tests              |
| `npm run test:perf`                   | The performance test (run `npm run fixtures -- --perf` first) |
| `npm run build`                       | Production build into `dist/`                                 |

GitHub Actions runs lint, formatting, types, the unit tests with coverage, the build and the end-to-end tests on every push.

The live site is a static build on Vercel (`npm run build`, output folder `dist`).

---

## 7. Known limitations

These were planned from the start (Assignment 3, section 5.3).

- **LM1** No recording: audio can only be imported.
- **LM2** Clips on one track cannot overlap, so there are no crossfades between them. Use two tracks instead.
- **LM3** The only effects are fade-in and fade-out.
- **LM4** Projects are saved in the browser that created them and cannot be moved to another computer. This is the trade-off of having no login.

Also: export is WAV only (no MP3), and the layout is designed for screens at least 1280 px wide.

---

## 8. Team

- **Aaryan Bahri**: data storage and saving, import and export, mixing and playback, transport, project and dialog interface.
- **Sri Varshith Reddy V**: the project model, waveform summaries, the finding, snapping and editing algorithms, the timeline and its interactions, the clip panel and the keyboard shortcuts.
