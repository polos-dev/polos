import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatForInput,
  calculateStartTimeForPreset,
  applyTimePreset,
  recalculateTimeRangeForRefresh,
} from './timeFilters';

describe('timeFilters', () => {
  beforeEach(() => {
    // Mock current time to a fixed date for consistent tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatForInput', () => {
    it('formats date correctly for datetime-local input', () => {
      // Use a date in local timezone to avoid timezone conversion issues
      const date = new Date(2026, 0, 15, 12, 30); // Jan 15, 2026 12:30
      const result = formatForInput(date);
      expect(result).toBe('2026-01-15T12:30');
    });

    it('pads single digit months and days', () => {
      const date = new Date(2026, 0, 5, 9, 5); // Jan 5, 2026 09:05
      const result = formatForInput(date);
      expect(result).toBe('2026-01-05T09:05');
    });
  });

  describe('calculateStartTimeForPreset', () => {
    it('calculates 1h preset correctly', () => {
      const now = new Date('2026-01-15T12:00:00Z');
      const result = calculateStartTimeForPreset('1h', now);
      expect(result).toEqual(new Date('2026-01-15T11:00:00Z'));
    });

    it('calculates 24h preset correctly', () => {
      const now = new Date('2026-01-15T12:00:00Z');
      const result = calculateStartTimeForPreset('24h', now);
      expect(result).toEqual(new Date('2026-01-14T12:00:00Z'));
    });

    it('calculates 7d preset correctly', () => {
      const now = new Date('2026-01-15T12:00:00Z');
      const result = calculateStartTimeForPreset('7d', now);
      expect(result).toEqual(new Date('2026-01-08T12:00:00Z'));
    });

    it('returns null for invalid preset', () => {
      const now = new Date();
      const result = calculateStartTimeForPreset('invalid', now);
      expect(result).toBeNull();
    });
  });

  describe('applyTimePreset', () => {
    it('applies 1h preset correctly', () => {
      const result = applyTimePreset('1h');
      expect(result).not.toBeNull();
      expect(result?.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(result?.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('returns null for custom preset', () => {
      const result = applyTimePreset('custom');
      expect(result).toBeNull();
    });
  });

  describe('recalculateTimeRangeForRefresh', () => {
    it('recalculates time range for 24h preset', () => {
      const result = recalculateTimeRangeForRefresh('24h');
      expect(result).not.toBeNull();
      expect(result?.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(result?.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('returns null for custom preset', () => {
      const result = recalculateTimeRangeForRefresh('custom');
      expect(result).toBeNull();
    });
  });
});
