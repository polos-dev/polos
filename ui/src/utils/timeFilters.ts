/**
 * Formats a Date object for datetime-local input (YYYY-MM-DDTHH:mm)
 */
export const formatForInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Calculates start time based on a preset and current time
 */
export const calculateStartTimeForPreset = (
  preset: string,
  now: Date
): Date | null => {
  switch (preset) {
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '6h':
      return new Date(now.getTime() - 6 * 60 * 60 * 1000);
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
};

/**
 * Recalculates time range for refresh when using a time preset
 * Returns null if custom preset is selected (should use existing state)
 */
export const recalculateTimeRangeForRefresh = (
  timePreset: string
): { startTime: string; endTime: string } | null => {
  if (timePreset === 'custom') {
    return null;
  }

  const now = new Date();
  const start = calculateStartTimeForPreset(timePreset, now);

  if (!start) {
    return null;
  }

  return {
    startTime: formatForInput(start),
    endTime: formatForInput(now),
  };
};

/**
 * Applies a time preset, calculating both start and end times
 */
export const applyTimePreset = (
  preset: string
): { startTime: string; endTime: string } | null => {
  if (preset === 'custom') {
    return null;
  }

  const now = new Date();
  const start = calculateStartTimeForPreset(preset, now);

  if (!start) {
    return null;
  }

  return {
    startTime: formatForInput(start),
    endTime: formatForInput(now),
  };
};
