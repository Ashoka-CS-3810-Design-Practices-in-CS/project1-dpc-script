import { ACCEPTED_EXTENSIONS, MAX_DURATION_S, MAX_FILE_BYTES } from '@/model/constants';
import { fail, ok, type Result } from '@/model/result';

/** The error texts for a rejected file. io can't import app/messages (README §5.2),
 *  so createServices passes them in from MSG. */
export interface ImportMessages {
  unreadable: (name: string) => string;
  tooLarge: (name: string) => string;
  tooLong: (name: string) => string;
}

export interface DecodeContext {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

const hasExtension = (name: string, extension: string) => name.toLowerCase().endsWith(extension);

/** Looks at the name and size only. The file is not read. */
export function checkFile(file: { name: string; size: number }, msgs: ImportMessages): Result {
  if (!ACCEPTED_EXTENSIONS.some((extension) => hasExtension(file.name, extension))) {
    return fail(msgs.unreadable(file.name));
  }
  if (file.size > MAX_FILE_BYTES) return fail(msgs.tooLarge(file.name));
  return ok(undefined);
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
}

/** Length of a WAV file in seconds, worked out from its header alone. null if it can't be read. */
function wavDurationFromHeader(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes);
  if (view.byteLength < 12 || readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') {
    return null;
  }

  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ' && body + 12 <= view.byteLength) byteRate = view.getUint32(body + 8, true);
    if (id === 'data') {
      // A cut-off file has less audio than its header claims, so trust what is really there.
      const dataBytes = Math.min(size, view.byteLength - body);
      return byteRate > 0 ? dataBytes / byteRate : null;
    }
    offset = body + size + (size % 2); // chunks are padded to an even length
  }
  return null;
}

/** A1 steps in the order of README §9.5 R5. */
export async function decodeFile(
  file: File,
  ctx: DecodeContext,
  msgs: ImportMessages,
): Promise<Result<{ buffer: AudioBuffer; bytes: ArrayBuffer }>> {
  const checked = checkFile(file, msgs);
  if (!checked.ok) return checked;

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return fail(msgs.unreadable(file.name));
  }

  // Cheap check first, so we never decode a huge WAV just to reject it.
  if (hasExtension(file.name, '.wav')) {
    const seconds = wavDurationFromHeader(bytes);
    if (seconds !== null && seconds > MAX_DURATION_S) return fail(msgs.tooLong(file.name));
  }

  let buffer: AudioBuffer;
  try {
    // decodeAudioData detaches what it is given, so hand it a copy and keep the original.
    buffer = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    return fail(msgs.unreadable(file.name));
  }
  if (buffer.length === 0) return fail(msgs.unreadable(file.name));
  if (buffer.duration > MAX_DURATION_S) return fail(msgs.tooLong(file.name));

  return ok({ buffer, bytes });
}
