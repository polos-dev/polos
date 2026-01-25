import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatTime,
  formatCost,
  formatDate,
  formatDurationMs,
} from './formatter';

describe('formatter', () => {
  describe('formatDuration', () => {
    it('formats milliseconds correctly (< 1000ms)', () => {
      const start = '2026-01-15T10:00:00Z';
      const end = '2026-01-15T10:00:00.500Z';
      expect(formatDuration(start, end)).toBe('500ms');
    });

    it('formats seconds correctly (< 60s)', () => {
      const start = '2026-01-15T10:00:00Z';
      const end = '2026-01-15T10:00:05.500Z';
      expect(formatDuration(start, end)).toBe('5.50s');
    });

    it('formats minutes and seconds correctly', () => {
      const start = '2026-01-15T10:00:00Z';
      const end = '2026-01-15T10:05:30Z';
      expect(formatDuration(start, end)).toBe('5m 30s');
    });

    it('handles same start and end time (0ms)', () => {
      const time = '2026-01-15T10:00:00Z';
      expect(formatDuration(time, time)).toBe('0ms');
    });

    it('returns "—" for invalid dates', () => {
      expect(formatDuration('invalid', '2026-01-15T10:00:00Z')).toBe('—');
      expect(formatDuration('2026-01-15T10:00:00Z', 'invalid')).toBe('—');
      expect(formatDuration('invalid', 'invalid')).toBe('—');
    });

    it('clamps negative durations to 0', () => {
      const start = '2026-01-15T10:05:00Z';
      const end = '2026-01-15T10:00:00Z';
      expect(formatDuration(start, end)).toBe('0ms');
    });

    it('handles large durations correctly', () => {
      const start = '2026-01-15T10:00:00Z';
      const end = '2026-01-15T10:45:30Z';
      expect(formatDuration(start, end)).toBe('45m 30s');
    });
  });

  describe('formatTime', () => {
    it('formats valid ISO string correctly', () => {
      const time = '2026-01-15T14:30:45Z';
      const result = formatTime(time);
      // Should contain month, day, hour, minute, second
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      // Time format depends on timezone, so just check it contains time components
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('handles midnight correctly', () => {
      const time = '2026-01-15T00:00:00Z';
      const result = formatTime(time);
      // Timezone-dependent, just verify it's formatted with time components
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('handles end of day correctly', () => {
      const time = '2026-01-15T23:59:59Z';
      const result = formatTime(time);
      // Timezone-dependent, just verify it contains time
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('formats various date formats consistently', () => {
      const times = [
        '2026-01-15T10:00:00Z',
        '2026-12-31T23:59:59Z',
        '2026-06-01T12:30:00Z',
      ];
      times.forEach((time) => {
        const result = formatTime(time);
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
      });
    });
  });

  describe('formatCost', () => {
    it('formats normal values correctly', () => {
      expect(formatCost(1.2345)).toBe('$1.2345');
      expect(formatCost(0.1234)).toBe('$0.1234');
      expect(formatCost(100.5678)).toBe('$100.5678');
    });

    it('handles very small numbers (< $0.0001)', () => {
      expect(formatCost(0.00005)).toBe('<$0.0001');
      expect(formatCost(0.00001)).toBe('<$0.0001');
      expect(formatCost(0.00009)).toBe('<$0.0001');
    });

    it('handles zero correctly', () => {
      expect(formatCost(0)).toBe('$0.0000');
    });

    it('returns "-" for undefined', () => {
      expect(formatCost(undefined)).toBe('-');
    });

    it('returns "-" for null', () => {
      expect(formatCost(null as any)).toBe('-');
    });

    it('returns "-" for NaN', () => {
      expect(formatCost(NaN)).toBe('-');
    });

    it('handles large numbers correctly', () => {
      expect(formatCost(1000.1234)).toBe('$1000.1234');
      expect(formatCost(999999.9999)).toBe('$999999.9999');
    });

    it('handles exactly 0.0001 threshold', () => {
      expect(formatCost(0.0001)).toBe('$0.0001');
      expect(formatCost(0.00011)).toBe('$0.0001');
    });
  });

  describe('formatDate', () => {
    it('formats valid ISO string correctly', () => {
      const date = '2026-01-15T14:30:45Z';
      const result = formatDate(date);
      // Should contain year, month, day, hour, minute, second
      expect(result).toMatch(/2026/);
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      // Time format depends on timezone, so just check it contains time components
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('formats various dates consistently', () => {
      const dates = [
        '2026-01-02T00:00:00Z',
        '2026-12-30T23:59:59Z',
        '2026-06-15T12:30:00Z',
      ];
      dates.forEach((date) => {
        const result = formatDate(date);
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
        // Check for year
        expect(result).toMatch(/2026/);
      });
    });

    it('includes year in output', () => {
      const date = '2026-01-15T10:00:00Z';
      const result = formatDate(date);
      expect(result).toContain('2026');
    });
  });

  describe('formatDurationMs', () => {
    it('formats milliseconds correctly (< 1000ms)', () => {
      expect(formatDurationMs(0)).toBe('0ms');
      expect(formatDurationMs(500)).toBe('500ms');
      expect(formatDurationMs(999)).toBe('999ms');
    });

    it('formats seconds correctly (>= 1000ms)', () => {
      expect(formatDurationMs(1000)).toBe('1.00s');
      expect(formatDurationMs(1500)).toBe('1.50s');
      expect(formatDurationMs(5000)).toBe('5.00s');
      expect(formatDurationMs(12345)).toBe('12.35s');
    });

    it('handles fractional seconds correctly', () => {
      expect(formatDurationMs(1234)).toBe('1.23s');
      expect(formatDurationMs(5678)).toBe('5.68s');
    });
  });
});
