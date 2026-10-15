// Sound effects, made on the fly with the browser's Web Audio API.
// Nothing is downloaded: every sound is a few synthesized notes or a puff
// of filtered noise, written for this app (see ASSETS.md).

let context: AudioContext | null = null;
let soundOn = true;
const VOLUME = 0.12; // low on purpose

export function setSoundOn(on: boolean) {
  soundOn = on;
}

function audio(): AudioContext | null {
  if (!soundOn) return null;
  if (!context) {
    if (!window.AudioContext) return null;
    context = new AudioContext();
  }
  // Browsers only allow sound after the user has clicked something.
  if (context.state === "suspended") void context.resume();
  return context;
}

type NoteOptions = {
  at?: number; // seconds from now
  length?: number; // seconds
  wave?: OscillatorType;
  volume?: number; // 0-1, relative
  glideTo?: number; // slide to this frequency
};

// One note that starts quickly and fades out.
function note(frequency: number, { at = 0, length = 0.15, wave = "sine", volume = 1, glideTo }: NoteOptions = {}) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(VOLUME * volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.05);
}

type SwishOptions = { at?: number; length?: number; from?: number; to?: number; volume?: number };

// A short burst of noise swept through a filter: card swishes and paper rips.
function swish({ at = 0, length = 0.12, from = 2500, to = 700, volume = 1 }: SwishOptions = {}) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(VOLUME * volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
}

export const sounds = {
  flip: () => swish({ length: 0.15, from: 3200, to: 900, volume: 0.9 }),
  play: () => {
    swish({ length: 0.1, from: 1600, to: 500, volume: 0.6 });
    note(240, { at: 0.04, length: 0.12, wave: "triangle", volume: 0.8 });
  },
  correct: () => {
    note(660, { length: 0.12, wave: "triangle" });
    note(990, { at: 0.09, length: 0.25, wave: "triangle" });
  },
  wrong: () => note(200, { length: 0.3, wave: "sawtooth", volume: 0.3, glideTo: 140 }),
  tick: () => note(1400, { length: 0.04, wave: "square", volume: 0.25 }),
  // A little fanfare for finishing the daily goal.
  goal: () => {
    [523, 659, 784, 1047].forEach((frequency, i) =>
      note(frequency, { at: i * 0.11, length: i === 3 ? 0.5 : 0.16, wave: "triangle" }),
    );
  },
  packOpen: () => {
    swish({ length: 0.35, from: 700, to: 4500, volume: 1.2 });
    note(523, { at: 0.35, length: 0.15, wave: "triangle" });
    note(659, { at: 0.45, length: 0.15, wave: "triangle" });
    note(784, { at: 0.55, length: 0.35, wave: "triangle" });
  },
};
