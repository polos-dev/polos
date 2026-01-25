import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Database, FilterIcon, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowRunSummary } from '@/types/models';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import { formatTime, formatDuration } from '@/utils/formatter';
import {
  applyTimePreset,
  recalculateTimeRangeForRefresh,
} from '@/utils/timeFilters';

export const AgentRunsView: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [timePreset, setTimePreset] = useState<string>('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [executionToCancel, setExecutionToCancel] = useState<string | null>(
    null
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [hoveredExecutionId, setHoveredExecutionId] = useState<string | null>(
    null
  );

  const handleApplyTimePreset = (preset: string) => {
    const times = applyTimePreset(preset);
    if (times) {
      setStartTime(times.startTime);
      setEndTime(times.endTime);
      setTimePreset(preset);
    } else {
      setTimePreset(preset);
    }
  };

  useEffect(() => {
    // Apply initial 24h time preset and fetch runs
    const times = applyTimePreset('24h');
    if (times) {
      setStartTime(times.startTime);
      setEndTime(times.endTime);

      // Fetch with 24h filter
      fetchRuns({
        startTime: times.startTime,
        endTime: times.endTime,
      });
    }
  }, [selectedProjectId]);

  const fetchRuns = async (customFilters?: {
    startTime?: string;
    endTime?: string;
  }) => {
    if (!selectedProjectId) return;

    try {
      setIsLoading(true);
      setError(null);

      const filters = customFilters || { startTime, endTime };

      const startTimeISO = filters.startTime
        ? new Date(filters.startTime).toISOString()
        : undefined;
      const endTimeISO = filters.endTime
        ? new Date(filters.endTime).toISOString()
        : undefined;

      // Fetch all agent runs (no workflowId filter)
      const runsData = await api.getWorkflowRuns(
        selectedProjectId,
        'agent',
        undefined, // No agentId filter - get all agent runs
        100,
        0,
        startTimeISO,
        endTimeISO
      );

      setRuns(runsData);
    } catch (err) {
      console.error('Failed to fetch agent runs:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to load agent runs'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Convert execution_id (UUID with hyphens) to trace_id (UUID without hyphens)
  const executionIdToTraceId = (executionId: string): string => {
    return executionId.replace(/-/g, '');
  };

  const handleCancelClick = (e: React.MouseEvent, executionId: string) => {
    e.stopPropagation(); // Prevent row click navigation
    setExecutionToCancel(executionId);
    setCancelDialogOpen(true);
  };

  const handleCancelConfirm = async () => {
    if (!executionToCancel || !selectedProjectId) return;

    try {
      setIsCancelling(true);
      await api.cancelExecution(selectedProjectId, executionToCancel);
      setCancelDialogOpen(false);
      setExecutionToCancel(null);
      // Refresh the runs list and update time filters
      const recalculated = recalculateTimeRangeForRefresh(timePreset);
      if (recalculated) {
        setStartTime(recalculated.startTime);
        setEndTime(recalculated.endTime);
        fetchRuns(recalculated);
      } else {
        fetchRuns({ startTime, endTime });
      }
    } catch (err) {
      console.error('Failed to cancel execution:', err);
      alert(err instanceof Error ? err.message : 'Failed to cancel execution');
    } finally {
      setIsCancelling(false);
    }
  };

  const canCancel = (status: string | undefined): boolean => {
    return status === 'running' || status === 'waiting';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading agent runs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg flex flex-col"
      style={{ height: 'calc(100vh - 200px)' }}
    >
      {/* Header with Refresh */}
      <div className="p-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Agent Runs</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            const times = recalculateTimeRangeForRefresh(timePreset);
            if (times) {
              setStartTime(times.startTime);
              setEndTime(times.endTime);
              fetchRuns({
                startTime: times.startTime,
                endTime: times.endTime,
              });
            } else {
              // For custom time preset, use current state values
              fetchRuns({
                startTime,
                endTime,
              });
            }
          }}
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="p-3 border-b border-gray-200 bg-gray-50 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-700">
              Time Range:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant={timePreset === '1h' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('1h')}
              >
                1h
              </Button>
              <Button
                variant={timePreset === '6h' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('6h')}
              >
                6h
              </Button>
              <Button
                variant={timePreset === '24h' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('24h')}
              >
                24h
              </Button>
              <Button
                variant={timePreset === '7d' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('7d')}
              >
                7d
              </Button>
              <Button
                variant={timePreset === '30d' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('30d')}
              >
                30d
              </Button>
              <Button
                variant={timePreset === 'custom' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setTimePreset('custom');
                  setStartTime('');
                  setEndTime('');
                }}
              >
                Custom
              </Button>
            </div>
            {timePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">
                    Start Time
                  </label>
                  <Input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      setTimePreset('custom');
                    }}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">
                    End Time
                  </label>
                  <Input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => {
                      setEndTime(e.target.value);
                      setTimePreset('custom');
                    }}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                fetchRuns();
                setShowFilters(false);
              }}
            >
              Apply Filters
            </Button>
          </div>
        </div>
      )}

      {/* Filter Toggle and Applied Filters */}
      <div className="p-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs font-normal"
            onClick={() => setShowFilters(!showFilters)}
          >
            <FilterIcon className="h-3 w-3" />
            Add Filters
          </Button>

          {/* Applied Filters */}
          {(timePreset !== 'custom' || startTime || endTime) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-500">Applied:</span>
              {timePreset !== 'custom' && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {timePreset === '1h'
                    ? 'Last 1 hour'
                    : timePreset === '6h'
                      ? 'Last 6 hours'
                      : timePreset === '24h'
                        ? 'Last 24 hours'
                        : timePreset === '7d'
                          ? 'Last 7 days'
                          : timePreset === '30d'
                            ? 'Last 30 days'
                            : timePreset}
                </Badge>
              )}
              {(startTime || endTime) && timePreset === 'custom' && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  Custom time
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Clear Filters Button */}
        {(timePreset !== 'custom' || startTime || endTime) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs font-normal text-gray-600 hover:text-gray-900"
            onClick={() => {
              setStartTime('');
              setEndTime('');
              setTimePreset('custom');
              fetchRuns({
                startTime: '',
                endTime: '',
              });
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Runs Table */}
      <div className="flex-1 overflow-auto">
        {runs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-500">No agent runs found</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto p-3">
            <table className="border-collapse" style={{ minWidth: '1600px' }}>
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '300px', minWidth: '300px' }}
                  >
                    Agent
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '100px', maxWidth: '100px' }}
                  >
                    Status
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '200px', minWidth: '200px' }}
                  >
                    Started At
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '200px', minWidth: '200px' }}
                  >
                    Ended At
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '120px', minWidth: '120px' }}
                  >
                    Duration
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '300px', maxWidth: '300px' }}
                  >
                    Input
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '300px', maxWidth: '300px' }}
                  >
                    Output
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '200px', maxWidth: '200px' }}
                  >
                    Error
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '300px', minWidth: '300px' }}
                  >
                    Run ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runs.map((run) => {
                  const traceId = executionIdToTraceId(
                    run.root_execution_id || run.id
                  );
                  return (
                    <tr
                      key={run.id}
                      className={cn(
                        'hover:bg-gray-50 cursor-pointer transition-colors',
                        run.error && 'bg-red-50/30'
                      )}
                      onClick={() => navigate(`/traces/${traceId}`)}
                    >
                      <td
                        className="px-3 py-2 text-xs font-mono text-gray-600"
                        style={{ width: '300px', minWidth: '300px' }}
                      >
                        {run.workflow_id || '-'}
                      </td>
                      <td
                        className="px-3 py-2 text-xs relative"
                        style={{ width: '100px', maxWidth: '100px' }}
                        onMouseEnter={() => setHoveredExecutionId(run.id)}
                        onMouseLeave={() => setHoveredExecutionId(null)}
                      >
                        {hoveredExecutionId === run.id &&
                        canCancel(run.status) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2"
                            disabled={isCancelling}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelClick(e, run.id);
                            }}
                          >
                            Cancel
                          </Button>
                        ) : (
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-medium',
                              run.status === 'completed' &&
                                'bg-green-100 text-green-800',
                              run.status === 'failed' &&
                                'bg-red-100 text-red-800',
                              run.status === 'cancelled' &&
                                'bg-red-100 text-red-800',
                              (!run.status || run.status === 'running') &&
                                'bg-yellow-100 text-yellow-800'
                            )}
                          >
                            {run.status || 'running'}
                          </span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-gray-600"
                        style={{ width: '200px', minWidth: '200px' }}
                      >
                        {run.created_at ? formatTime(run.created_at) : '-'}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-gray-600"
                        style={{ width: '200px', minWidth: '200px' }}
                      >
                        {run.completed_at ? formatTime(run.completed_at) : '-'}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-gray-600"
                        style={{ width: '120px', minWidth: '120px' }}
                      >
                        {run.created_at && run.completed_at
                          ? formatDuration(run.created_at, run.completed_at)
                          : '-'}
                      </td>
                      <td
                        className="px-3 py-2 text-xs"
                        style={{
                          width: '300px',
                          maxWidth: '300px',
                          overflow: 'hidden',
                        }}
                      >
                        {run.payload ? (
                          <div
                            className="truncate font-mono text-gray-700"
                            style={{
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {typeof run.payload === 'object'
                              ? JSON.stringify(run.payload)
                              : String(run.payload)}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs"
                        style={{
                          width: '300px',
                          maxWidth: '300px',
                          overflow: 'hidden',
                        }}
                      >
                        {run.result ? (
                          <div
                            className="truncate font-mono text-gray-700"
                            style={{
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {typeof run.result === 'object'
                              ? JSON.stringify(run.result)
                              : String(run.result)}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs"
                        style={{
                          width: '200px',
                          maxWidth: '200px',
                          overflow: 'hidden',
                        }}
                      >
                        {run.error ? (
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-red-600 flex-shrink-0" />
                            <div
                              className="truncate text-red-600 font-mono"
                              style={{
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {String(run.error)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-xs font-mono text-gray-600"
                        style={{ width: '300px', minWidth: '300px' }}
                      >
                        {run.id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Execution</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this execution? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              disabled={isCancelling}
              className="bg-red-600 hover:bg-red-700"
            >
              {isCancelling ? 'Cancelling...' : 'Yes, Cancel'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
