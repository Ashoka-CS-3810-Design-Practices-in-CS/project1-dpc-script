import type {
  AudioContextLike,
  BufferSourceLike,
  GainLike,
  NodeLike,
  ParamLike,
} from '@/engine/audioTypes';

/** A fake audio context that writes down everything done to it, as readable lines like
 *  `gain#2 = 0.5`, `connect gain#2 -> gain#1`, `gain#3.set 0 @1.05`, `src#4.start 10.05 3 2`.
 *  Nodes are numbered in the order they are created, so logs can be compared exactly. */
export interface RecordingContext extends AudioContextLike {
  log: string[];
}

type Named = NodeLike & { name: string };

// Rounded so floating-point noise (13.049999999999999) doesn't end up in the log.
const show = (n: number) => String(Number(n.toFixed(6)));

export function createRecordingContext(currentTime = 0): RecordingContext {
  const log: string[] = [];
  let count = 0;

  function makeNode(kind: string): Named {
    const name = `${kind}#${++count}`;
    return {
      name,
      connect: (dest) => log.push(`connect ${name} -> ${(dest as Named).name}`),
      disconnect: () => {
        log.push(`disconnect ${name}`);
      },
    };
  }

  function makeParam(owner: string): ParamLike {
    let value = 1;
    return {
      get value() {
        return value;
      },
      set value(v: number) {
        value = v;
        log.push(`${owner} = ${show(v)}`);
      },
      setValueAtTime: (v, t) => log.push(`${owner}.set ${show(v)} @${show(t)}`),
      linearRampToValueAtTime: (v, t) => log.push(`${owner}.ramp ${show(v)} @${show(t)}`),
      cancelScheduledValues: (t) => log.push(`${owner}.cancel @${show(t)}`),
    };
  }

  return {
    log,
    currentTime,
    destination: { name: 'destination', connect: () => {}, disconnect: () => {} } as Named,

    createGain(): GainLike {
      const node = makeNode('gain');
      return Object.assign(node, { gain: makeParam(node.name) });
    },

    createBufferSource(): BufferSourceLike {
      const node = makeNode('src');
      let buffer: AudioBuffer | null = null;
      // A literal (not Object.assign), so the buffer setter below keeps logging.
      return {
        ...node,
        get buffer() {
          return buffer;
        },
        set buffer(b: AudioBuffer | null) {
          buffer = b;
          log.push(`${node.name}.buffer = ${b === null ? 'null' : `${show(b.duration)}s`}`);
        },
        start: (when: number, offset: number, duration: number) => {
          log.push(`${node.name}.start ${show(when)} ${show(offset)} ${show(duration)}`);
        },
        stop: () => {
          log.push(`${node.name}.stop`);
        },
        onended: null,
      };
    },
  };
}
