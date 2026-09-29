/** Minutniki trybu gotowania - czysta logika czasu (testowalna bez DOM). */
export interface CookTimer {
  step: number;
  totalSeconds: number;
  /** Moment końca (ms) - liczymy z zegara, nie z interwałów, żeby uśpiona karta nie gubiła czasu */
  endsAt: number | null;
  /** Pozostało przy pauzie */
  pausedLeft: number | null;
  done: boolean;
}

export function startTimer(step: number, minutes: number, now: number): CookTimer {
  const totalSeconds = minutes * 60;
  return { step, totalSeconds, endsAt: now + totalSeconds * 1000, pausedLeft: null, done: false };
}

export function secondsLeft(t: CookTimer, now: number): number {
  if (t.done) return 0;
  if (t.pausedLeft !== null) return t.pausedLeft;
  return Math.max(0, Math.ceil(((t.endsAt ?? now) - now) / 1000));
}

export function pause(t: CookTimer, now: number): CookTimer {
  return { ...t, pausedLeft: secondsLeft(t, now), endsAt: null };
}

export function resume(t: CookTimer, now: number): CookTimer {
  return { ...t, endsAt: now + (t.pausedLeft ?? 0) * 1000, pausedLeft: null };
}

/** mm:ss albo h:mm:ss */
export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
