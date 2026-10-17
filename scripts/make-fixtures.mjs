// Makes the audio files the e2e tests import. Run with `npm run fixtures`
// (add `-- --perf` for the ten long files used by the performance test).
import { closeSync, ftruncateSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../e2e/fixtures/generated/', import.meta.url));
const MB = 1024 * 1024;

/** The 44-byte header of a 16-bit PCM WAV file. */
function wavHeader(channels, rate, dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // plain PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** A WAV of sine tones, one frequency per channel, written one second at a time. */
function writeTone(name, seconds, rate, freqs) {
  const channels = freqs.length;
  const fd = openSync(OUT + name, 'w');
  writeSync(fd, wavHeader(channels, rate, seconds * rate * channels * 2));

  const chunk = Buffer.alloc(rate * channels * 2);
  for (let s = 0; s < seconds; s++) {
    for (let i = 0; i < rate; i++) {
      const t = s + i / rate;
      freqs.forEach((freq, c) => {
        const sample = Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * freq * t));
        chunk.writeInt16LE(sample, (i * channels + c) * 2);
      });
    }
    writeSync(fd, chunk);
  }
  closeSync(fd);
}

/** A file of the given size, all zeros after `head`. No need to write the zeros ourselves. */
function writeSparse(name, size, head = Buffer.alloc(0)) {
  const fd = openSync(OUT + name, 'w');
  writeSync(fd, head);
  ftruncateSync(fd, size);
  closeSync(fd);
}

mkdirSync(OUT, { recursive: true });

writeTone('voice.wav', 6, 44100, [220]);
writeTone('music.wav', 8, 44100, [330, 440]);
writeFileSync(OUT + 'notes.wav', 'This is a text file that only pretends to be audio.\n');
writeFileSync(OUT + 'empty.mp3', '');
writeSparse('big.wav', 200 * MB + 1); // one byte over the size limit

// 40 minutes at 8 kHz mono: the header alone says it is over the 30-minute limit.
const longBytes = 40 * 60 * 8000 * 2;
writeSparse('long.wav', 44 + longBytes, wavHeader(1, 8000, longBytes));

if (process.argv.includes('--perf')) {
  for (let i = 1; i <= 10; i++)
    writeTone(`perf-${i}.wav`, 5 * 60, 44100, [200 + i * 20, 300 + i * 20]);
}

console.log(`fixtures: written to ${OUT}`);
