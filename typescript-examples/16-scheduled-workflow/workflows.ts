/**
 * Scheduled workflow examples.
 *
 * Demonstrates workflows that run on a schedule using cron expressions.
 * Scheduled workflows are useful for:
 * - Daily reports
 * - Periodic cleanup tasks
 * - Recurring data synchronization
 * - Scheduled notifications
 */

import { defineWorkflow } from '@polos/sdk';
import type { SchedulePayload } from '@polos/sdk';

// ============================================================================
// Result Types
// ============================================================================

interface CleanupResult {
  timestamp: string;
  recordsCleaned: number;
  filesCleaned: number;
}

interface ReportResult {
  timestamp: string;
  reportId: string;
  metricsCount: number;
}

interface SyncResult {
  timestamp: string;
  recordsSynced: number;
}

interface ReminderResult {
  timestamp: string;
  message: string;
  sent: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function cleanupOldRecords(): Record<string, unknown> {
  // In a real scenario, this would delete old records
  return { count: 150, status: 'completed' };
}

function cleanupTempFiles(): Record<string, unknown> {
  // In a real scenario, this would delete temp files
  return { count: 25, status: 'completed' };
}

function gatherDailyMetrics(): Record<string, unknown> {
  return {
    activeUsers: 1250,
    newSignups: 45,
    revenue: 12500.0,
    orders: 320,
  };
}

function generateReport(metrics: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'report-001',
    metrics,
    generatedAt: new Date().toISOString(),
  };
}

function sendReport(report: Record<string, unknown>): Record<string, unknown> {
  return { sent: true, reportId: report['id'] };
}

function syncExternalData(): Record<string, unknown> {
  return { count: 500, status: 'synced' };
}

// ============================================================================
// Daily Cleanup - Runs at 3:00 AM UTC
// ============================================================================

export const dailyCleanup = defineWorkflow<SchedulePayload, unknown, CleanupResult>(
  {
    id: 'daily_cleanup',
    schedule: '0 3 * * *',
  },
  async (ctx, payload) => {
    // Clean up old data
    const cleanupResult = await ctx.step.run(
      'cleanup_old_records',
      () => cleanupOldRecords(),
    );

    // Clean up temp files
    const tempResult = await ctx.step.run(
      'cleanup_temp_files',
      () => cleanupTempFiles(),
    );

    // Log completion
    await ctx.step.run(
      'log_cleanup',
      () => console.log(`Daily cleanup completed at ${payload.timestamp}`),
    );

    return {
      timestamp: payload.timestamp,
      recordsCleaned: (cleanupResult['count'] as number) ?? 0,
      filesCleaned: (tempResult['count'] as number) ?? 0,
    };
  },
);

// ============================================================================
// Morning Report - Runs at 8:00 AM Eastern, Monday-Friday
// ============================================================================

export const morningReport = defineWorkflow<SchedulePayload, unknown, ReportResult>(
  {
    id: 'morning_report',
    schedule: { cron: '0 8 * * 1-5', timezone: 'America/New_York' },
  },
  async (ctx, payload) => {
    // Gather metrics
    const metrics = await ctx.step.run(
      'gather_metrics',
      () => gatherDailyMetrics(),
    );

    // Generate report
    const report = await ctx.step.run(
      'generate_report',
      () => generateReport(metrics),
    );

    // Send report
    await ctx.step.run(
      'send_report',
      () => sendReport(report),
    );

    return {
      timestamp: payload.timestamp,
      reportId: (report['id'] as string) ?? '',
      metricsCount: Object.keys(metrics).length,
    };
  },
);

// ============================================================================
// Hourly Sync - Runs at the start of every hour
// ============================================================================

export const hourlySync = defineWorkflow<SchedulePayload, unknown, SyncResult>(
  {
    id: 'hourly_sync',
    schedule: '0 * * * *',
  },
  async (ctx, payload) => {
    // Sync data from external source
    const syncResult = await ctx.step.run(
      'sync_external_data',
      () => syncExternalData(),
    );

    return {
      timestamp: payload.timestamp,
      recordsSynced: (syncResult['count'] as number) ?? 0,
    };
  },
);

// ============================================================================
// Schedulable Reminder - No default schedule, can be scheduled via API
// ============================================================================

export const schedulableReminder = defineWorkflow<SchedulePayload, unknown, ReminderResult>(
  {
    id: 'schedulable_reminder',
    // No default cron — marked as schedulable so it can be scheduled dynamically
    // using client.schedules.create()
    schedule: true,
  },
  async (ctx, payload) => {
    const message = 'Scheduled reminder!';

    await ctx.step.run(
      'send_reminder',
      () => console.log(`Reminder at ${payload.timestamp}: ${message}`),
    );

    return {
      timestamp: payload.timestamp,
      message,
      sent: true,
    };
  },
);
