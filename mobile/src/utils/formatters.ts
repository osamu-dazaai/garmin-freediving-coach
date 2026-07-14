export function fmtDepth(meters: number, unit: 'm' | 'ft' = 'm'): string {
  if (!meters) return '—';
  if (unit === 'ft') return `${Math.round(meters * 3.281)}ft`;
  return `${meters.toFixed(1)}m`;
}

export function fmtSeconds(s: number): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function fmtTimer(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
