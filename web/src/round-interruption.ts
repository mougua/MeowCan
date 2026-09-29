const ACTIVE_KEY = 'meowcan.activeRound.v1';
const LAST_KEY = 'meowcan.lastInterruptedRound.v1';

interface ActiveRound {
  song: string;
  startedAt: string;
  renderer: string;
  audioSource: string;
  pagehideObserved: boolean;
}

let activeRound: ActiveRound | null = null;

function saveActiveRound(): void {
  try {
    if (activeRound) sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(activeRound));
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch { /* Storage may be unavailable. */ }
}

export function reportInterruptedRound(): void {
  try {
    const previous = sessionStorage.getItem(ACTIVE_KEY);
    if (!previous) return;
    sessionStorage.removeItem(ACTIVE_KEY);
    const round = JSON.parse(previous) as ActiveRound;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const report = { ...round, detectedAt: new Date().toISOString(), navigationType: navigation?.type ?? 'unknown' };
    sessionStorage.setItem(LAST_KEY, JSON.stringify(report));
    console.warn('[MeowCan] The previous round ended with a page navigation or tab restart.', report);
  } catch { /* Diagnostics must never prevent startup. */ }
}

export function beginRoundDiagnostics(song: string, renderer: string, audioSource: string): void {
  activeRound = {
    song,
    startedAt: new Date().toISOString(),
    renderer,
    audioSource,
    pagehideObserved: false,
  };
  saveActiveRound();
}

export function endRoundDiagnostics(): void {
  activeRound = null;
  saveActiveRound();
}

window.addEventListener('pagehide', () => {
  if (!activeRound) return;
  activeRound.pagehideObserved = true;
  saveActiveRound();
});
