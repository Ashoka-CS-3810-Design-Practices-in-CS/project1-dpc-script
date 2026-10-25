# DPC-Script demo walkthrough

A five-minute tour of the editor, from an empty project to an exported WAV. It uses the two
files in [`samples/`](../samples):

| File               | What it is                    |
| ------------------ | ----------------------------- |
| `voice-220hz.wav`  | 6 s mono tone (220 Hz)        |
| `music-stereo.wav` | 8 s stereo tones (330/440 Hz) |

Open the app (`npm run dev` → http://localhost:5173, or the deployed URL in the README) in a
current Chromium, Firefox or Safari window at least 1280 px wide.

## 1. Build a two-track composition (UC1)

1. Click **+ Add track** twice. Rename the first track: click its name, type `Voice`, press
   Enter.
2. Select the `Voice` track, then **Import** and pick `voice-220hz.wav`. The clip appears at the
   playhead with its waveform.
3. Select the second track and import `music-stereo.wav`. Or drag the file straight onto the
   track.
4. Press **Space** to play and **Space** again to pause. **Home** stops and returns to 0.
5. Drag the music clip sideways. With **Snap** on, it clicks to clip edges and the playhead; a
   clip can never overlap its neighbour.

## 2. Remove a mistake (UC2)

1. Click the voice clip, move the playhead to about 2 s (click the ruler, or focus it and use
   ← / →), and press **S** (or **Split**) to cut the clip in two. No audio is copied.
2. Drag across the waveform to select a region, then press **Delete** to cut that part out
   (**Delete selection** in the clip panel).
3. **T** (or **Trim**) keeps only the selected region.
4. Edit the **Fade-in** and **Fade-out** fields in the clip panel (seconds; Enter commits), or
   drag the fade handles on the clip. Fade-in plus fade-out can't exceed the clip.

## 3. Mix with solo, volume and mute (UC3)

1. Drag a track's **Volume** slider; the dB value updates beside it.
2. Press **M** (or the **M** button) to mute the selected track, **O** (or **S** button) to
   solo it. A pressed button is underlined and double-framed, so you can tell without colour.
3. Press Play. Changes apply immediately, with no click at the switch.

## 4. Save, reopen and export (UC4)

1. Click the project name, type `Demo`, press Enter. Click **Save** (or **Ctrl/Cmd + S**). The
   status line reads "All changes saved …". The app also autosaves.
2. Reload the page, click **Open**, and open `Demo`. Tracks, clips, fades and the original
   audio come back.
3. Click **Export**, keep the defaults and press **Export**. A 16-bit WAV downloads. Open it
   in any player; it sounds the same as the preview.

## Keyboard only

Every mouse action has a keyboard path: Tab through the bars and track headers, use the hidden
clip list (Tab to a clip, Enter selects it), the **Playhead position** slider (← / →, Shift for
1 s) and the shortcuts above. **+** / **−** zoom.

| Key           | Action                         |
| ------------- | ------------------------------ |
| Space         | Play / pause                   |
| Home          | Stop, back to 0                |
| S             | Split at the playhead          |
| T             | Trim to selection              |
| Delete        | Delete selection               |
| M / O         | Mute / solo the selected track |
| ← / → (Shift) | Move playhead 10 ms (1 s)      |
| + / −         | Zoom                           |
| Ctrl/Cmd + S  | Save                           |

## Things that should fail politely

| Try this                                 | You see                                          |
| ---------------------------------------- | ------------------------------------------------ |
| Import a text file renamed `.wav`        | "… couldn't be read. Use a WAV or MP3 file."     |
| Import with no track selected            | "Select or add a track first."                   |
| Split with the playhead outside the clip | "Move the playhead inside the clip to split it." |
| Export with every track muted            | "Every track is muted."                          |

In each case the project is left unchanged.
