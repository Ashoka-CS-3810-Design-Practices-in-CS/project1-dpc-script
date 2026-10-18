// Runs inside the page (the dev server serves it). Everything goes through window.__dpcs, the
// same services the UI uses, so the numbers are the app's own. t7.spec.ts drives and checks it.

const app = () => window.__dpcs;

/** Starts the monitors: long tasks, animation frames (when `recording`), peaks commits. */
export function installMonitors() {
  const perf = (window.__perf = { longTasks: [], frames: [], recording: false, peaks: [] });

  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) perf.longTasks.push({ start: e.startTime, ms: e.duration });
  }).observe({ type: 'longtask' });

  const tick = (t) => {
    if (perf.recording) perf.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  app().store.subscribe((change) => {
    if (change.kind === 'peaks')
      perf.peaks.push({ sourceId: change.sourceId, at: performance.now() });
  });
}

export function addTracks(count) {
  return Array.from({ length: count }, () => app().edit.addTrack());
}

/** Imports perf-<index>.wav onto a track at 0 s and says how long each part took. */
export async function importOne(index, trackId) {
  const blob = await (await fetch(`/e2e/fixtures/generated/perf-${index}.wav`)).blob();
  const file = new File([blob], `perf-${index}.wav`, { type: 'audio/wav' });

  const startedAt = performance.now();
  const result = await app().importer.importFile(file, trackId, 0);
  if (!result.ok) throw new Error(`import ${index} failed: ${result.error}`);
  const resolvedAt = performance.now();
  return {
    clipId: result.value.clipId,
    sourceId: app().queries.findClip(result.value.clipId).clip.sourceId,
    startedAt,
    resolvedAt,
  };
}

/** Waits for every source's waveform; returns when each one's peaks were committed. */
export async function waitForAllPeaks(timeoutMs = 120000) {
  const deadline = performance.now() + timeoutMs;
  while (
    app()
      .store.get()
      .sources.all()
      .some((s) => s.peaks === null)
  ) {
    if (performance.now() > deadline) throw new Error('waveforms were not ready in time');
    await new Promise((r) => setTimeout(r, 25));
  }
  return window.__perf.peaks.map((p) => ({ ...p }));
}

/** What a source's waveform summary holds, to show it is not empty. */
export function describePeaks(sourceId) {
  const peaks = app().store.get().sources.get(sourceId).peaks;
  const top = peaks.levels[0];
  let widest = 0;
  for (let i = 1; i < top.length; i += 2) widest = Math.max(widest, top[i]); // [min, max] pairs
  return { length: peaks.length, levels: peaks.levels.length, blockSize: peaks.blockSize, widest };
}

/** Splits each track's one long clip into 5 and moves the pieces apart with 1 s gaps, so the
 *  first piece can be dragged left and right without touching its neighbour. */
export function splitIntoFive() {
  const { edit, store } = app();
  for (const track of store.get().tracks) {
    const pieces = [track.clips[0].id];
    for (let k = 1; k < 5; k++) {
      const split = edit.split(pieces[k - 1], 60 * k);
      if (!split.ok) throw new Error(`split failed: ${split.error}`);
      pieces[k - 1] = split.value[0];
      pieces.push(split.value[1]);
    }
    for (let k = 4; k >= 0; k--) {
      const moved = edit.moveClip(pieces[k], track.id, 60 * k + k + 1);
      if (!moved.ok) throw new Error(`move failed: ${moved.error}`);
    }
  }
  return summary();
}

/** Cuts every track to 3 clips ending at exactly 180 s: a 3-minute mix. */
export function cutToThreeMinutes() {
  const { edit, store } = app();
  for (const track of store.get().tracks) {
    const clips = [...track.clips];
    for (const clip of clips.slice(3)) edit.removeClip(clip.id);
    const trimmed = edit.trimEdge(clips[2].id, 'end', 180);
    if (!trimmed.ok) throw new Error(`trim failed: ${trimmed.error}`);
  }
  return summary();
}

export function summary() {
  const project = app().store.get();
  return {
    tracks: project.tracks.length,
    clips: project.tracks.reduce((n, t) => n + t.clips.length, 0),
    end: app().queries.projectEnd(),
    firstClipStart: project.tracks[0].clips[0].startTime,
    sourcesReady: project.sources.all().every((s) => s.status === 'ready'),
  };
}

export function startRecording() {
  Object.assign(window.__perf, { frames: [], recording: true });
}

/** Stops recording and gives back the frame times plus the long tasks since `sinceMs`. */
export async function stopRecording(sinceMs) {
  window.__perf.recording = false;
  await new Promise((r) => setTimeout(r, 200)); // the long-task observer reports in batches
  return {
    frames: window.__perf.frames,
    longTasks: window.__perf.longTasks.filter((t) => t.start >= sinceMs),
  };
}

export async function longTasksSince(sinceMs) {
  await new Promise((r) => setTimeout(r, 200));
  return window.__perf.longTasks.filter((t) => t.start >= sinceMs);
}

/** Milliseconds from the last Play click to the mix being scheduled. */
export function playLatency() {
  const last = (name) => performance.getEntriesByName(name).at(-1);
  const click = last('dpcs:play-click');
  const scheduled = last('dpcs:play-scheduled');
  return click && scheduled ? scheduled.startTime - click.startTime : null;
}

/** A 3-minute stereo export through the real service. */
export async function exportMix() {
  const startedAt = performance.now();
  const progress = [];
  const result = await app().exporter.export(
    { fileName: 'perf-mix', sampleRate: 44100, channels: 2 },
    (p) => progress.push(p.phase),
    new AbortController().signal,
  );
  const renderEnd = performance.now();
  return {
    ok: result.ok,
    error: result.ok ? null : result.error,
    ms: renderEnd - startedAt,
    bytes: result.ok ? result.value.bytes : 0,
    duration: result.ok ? result.value.duration : 0,
  };
}

/** Saves, starts a fresh project, then times opening the saved one up to store.replace. */
export async function saveThenOpen() {
  const { projects, store } = app();
  const saved = await projects.save();
  if (!saved.ok) throw new Error(`save failed: ${saved.error}`);
  const id = store.get().id;
  projects.newProject();

  let replacedAt = null;
  const off = store.subscribe((change) => {
    if (change.kind === 'project' && replacedAt === null) replacedAt = performance.now();
  });
  const startedAt = performance.now();
  const opened = await projects.open(id);
  off();
  return {
    ok: opened.ok,
    toReplaceMs: replacedAt === null ? null : replacedAt - startedAt,
    openCallMs: performance.now() - startedAt,
    tracks: store.get().tracks.length,
    sourcesLoading: store
      .get()
      .sources.all()
      .filter((s) => s.status === 'loading').length,
  };
}
