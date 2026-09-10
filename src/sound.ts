type SoundName = "tap" | "dice" | "card" | "safe" | "bomb" | "win";

let context: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  context ??= new window.AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(
  audio: AudioContext,
  frequency: number,
  duration: number,
  options: { delay?: number; endFrequency?: number; type?: OscillatorType; volume?: number } = {},
) {
  const start = audio.currentTime + (options.delay ?? 0);
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const volume = options.volume ?? 0.07;
  oscillator.type = options.type ?? "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.endFrequency)
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** 첫 터치 때 브라우저의 자동재생 제한을 해제한다. */
export function unlockAudio() {
  const audio = getContext();
  if (audio?.state === "suspended") void audio.resume();
}

/** 외부 음원 파일 없이 Web Audio로 작고 짧은 게임 효과음을 만든다. */
export function playSound(name: SoundName) {
  const audio = getContext();
  if (!audio) return;

  switch (name) {
    case "tap":
      tone(audio, 520, 0.08, { volume: 0.045, endFrequency: 680 });
      break;
    case "dice":
      tone(audio, 230, 0.1, { delay: 0, volume: 0.05, endFrequency: 330, type: "triangle" });
      tone(audio, 330, 0.1, { delay: 0.1, volume: 0.05, endFrequency: 470, type: "triangle" });
      tone(audio, 470, 0.16, { delay: 0.2, volume: 0.07, endFrequency: 700, type: "triangle" });
      break;
    case "card":
      tone(audio, 300, 0.16, { volume: 0.05, endFrequency: 640, type: "sine" });
      tone(audio, 760, 0.09, { delay: 0.1, volume: 0.035, endFrequency: 980, type: "sine" });
      break;
    case "safe":
      tone(audio, 560, 0.16, { volume: 0.06, endFrequency: 720, type: "sine" });
      tone(audio, 720, 0.25, { delay: 0.12, volume: 0.07, endFrequency: 980, type: "sine" });
      break;
    case "bomb":
      tone(audio, 170, 0.24, { volume: 0.1, endFrequency: 90, type: "sawtooth" });
      tone(audio, 95, 0.38, { delay: 0.15, volume: 0.08, endFrequency: 52, type: "triangle" });
      break;
    case "win":
      tone(audio, 520, 0.16, { volume: 0.055, endFrequency: 660 });
      tone(audio, 660, 0.16, { delay: 0.13, volume: 0.06, endFrequency: 820 });
      tone(audio, 820, 0.28, { delay: 0.26, volume: 0.07, endFrequency: 1_040 });
      break;
  }
}
