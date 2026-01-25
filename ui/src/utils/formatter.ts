export const formatDuration = (startTime: string, endTime: string) => {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (!Number.isFinite(ms)) return '—';

  const dur = Math.max(0, ms); // don’t show negatives
  if (dur < 1000) return `${dur}ms`;

  const seconds = dur / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;

  const mins = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return `${mins}m ${remSec}s`;
};

export const formatTime = (timeString: string) => {
  return new Date(timeString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const formatCost = (cost?: number) => {
  // If cost is very small but not zero, show scientific notation or a special format
  if (cost === undefined || cost === null || isNaN(cost)) return '-';

  // For very small numbers, show a minimum value
  if (cost < 0.0001 && cost > 0) {
    return '<$0.0001';
  }

  // Format the number with 4 decimal places
  return `$${cost.toFixed(4)}`;
};

export const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const formatDurationMs = (durationMs: number) => {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
};
