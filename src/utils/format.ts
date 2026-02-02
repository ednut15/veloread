export function formatPercent(current: number, total: number): string {
  if (total <= 0) return '0.0%';
  return `${Math.min(100, Math.max(0, (current / total) * 100)).toFixed(1)}%`;
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleDateString();
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}
