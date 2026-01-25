import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  Bot,
  Database,
  FilterIcon,
  RefreshCw,
  Network,
  Wrench,
  StepForward,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TraceListItem } from '@/types/models';
import { api } from '@/lib/api';
import { formatTime, formatDuration } from '@/utils/formatter';
import {
  applyTimePreset,
  recalculateTimeRangeForRefresh,
} from '@/utils/timeFilters';
import { useProject } from '@/context/ProjectContext';

export const TraceListPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [timePreset, setTimePreset] = useState<string>('24h');
  const [rootSpanType, setRootSpanType] = useState<string>('all');
  const [rootSpanName, setRootSpanName] = useState<string>('');
  const [hasError, setHasError] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

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
    // Apply initial 24h time preset and fetch traces
    const times = applyTimePreset('24h');
    if (times) {
      setStartTime(times.startTime);
      setEndTime(times.endTime);

      // Fetch with 24h filter
      fetchTraces({
        startTime: times.startTime,
        endTime: times.endTime,
        rootSpanType: 'all',
        rootSpanName: '',
        hasError: 'all',
      });
    }
  }, [selectedProjectId]);

  const fetchTraces = async (customFilters?: {
    startTime?: string;
    endTime?: string;
    rootSpanType?: string;
    rootSpanName?: string;
    hasError?: string;
  }) => {
    try {
      setIsLoading(true);
      setError(null);

      const params: any = {
        limit: 100,
        offset: 0,
      };

      const filters = customFilters || {
        startTime,
        endTime,
        rootSpanType,
        rootSpanName,
        hasError,
      };

      if (filters.startTime)
        params.start_time = new Date(filters.startTime).toISOString();
      if (filters.endTime)
        params.end_time = new Date(filters.endTime).toISOString();
      if (filters.rootSpanType && filters.rootSpanType !== 'all')
        params.root_span_type = filters.rootSpanType;
      if (filters.rootSpanName) params.root_span_name = filters.rootSpanName;
      if (filters.hasError && filters.hasError !== 'all')
        params.has_error = filters.hasError === 'true';

      const data = await api.getTraces(selectedProjectId, params);
      setTraces(data.traces);
    } catch (err) {
      console.error('Failed to fetch traces:', err);
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setIsLoading(false);
    }
  };

  const spanTypeIcon = (spanType: string | null) => {
    if (!spanType) return <Database className="h-3.5 w-3.5 text-gray-700" />;
    if (spanType === 'agent') {
      return <Bot className="h-3.5 w-3.5 text-gray-700" />;
    } else if (spanType === 'workflow') {
      return <Network className="h-3.5 w-3.5 text-gray-700" />;
    } else if (spanType === 'tool') {
      return <Wrench className="h-3.5 w-3.5 text-gray-700" />;
    } else if (spanType === 'step') {
      return <StepForward className="h-3.5 w-3.5 text-gray-700" />;
    }
    return <Database className="h-3.5 w-3.5 text-gray-700" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-sm text-gray-500">Loading traces...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-red-400 mb-4" />
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Traces</h1>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            const times = recalculateTimeRangeForRefresh(timePreset);
            if (times) {
              setStartTime(times.startTime);
              setEndTime(times.endTime);
              // Include all current filters when refreshing
              fetchTraces({
                startTime: times.startTime,
                endTime: times.endTime,
                rootSpanType,
                rootSpanName,
                hasError,
              });
            } else {
              // For custom time preset, use current state values
              fetchTraces({
                startTime,
                endTime,
                rootSpanType,
                rootSpanName,
                hasError,
              });
            }
          }}
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="p-3 border-b border-gray-200 bg-gray-50 space-y-3">
          {/* Time Filters */}
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">
              Time Range
            </label>
            <div className="flex gap-2 mb-2">
              <Button
                variant={timePreset === '1h' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('1h')}
              >
                Last 1 hour
              </Button>
              <Button
                variant={timePreset === '6h' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('6h')}
              >
                Last 6 hours
              </Button>
              <Button
                variant={timePreset === '24h' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('24h')}
              >
                Last 24 hours
              </Button>
              <Button
                variant={timePreset === '7d' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('7d')}
              >
                Last 7 days
              </Button>
              <Button
                variant={timePreset === '30d' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleApplyTimePreset('30d')}
              >
                Last 30 days
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
            {timePreset == 'custom' && (
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

          {/* Other Filters */}
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">
              Other Filters
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Root Span Type
                </label>
                <Select value={rootSpanType} onValueChange={setRootSpanType}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="workflow">Workflow</SelectItem>
                    <SelectItem value="tool">Tool</SelectItem>
                    <SelectItem value="step">Step</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Root Span Name
                </label>
                <Input
                  value={rootSpanName}
                  onChange={(e) => setRootSpanName(e.target.value)}
                  placeholder="Search by name..."
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Error
                </label>
                <Select value={hasError} onValueChange={setHasError}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="true">With Error</SelectItem>
                    <SelectItem value="false">Without Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                fetchTraces();
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
          {(timePreset !== 'custom' ||
            startTime ||
            endTime ||
            rootSpanType !== 'all' ||
            rootSpanName ||
            hasError !== 'all') && (
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
              {rootSpanType !== 'all' && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  Type: {rootSpanType}
                </Badge>
              )}
              {rootSpanName && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  Name: {rootSpanName}
                </Badge>
              )}
              {hasError !== 'all' && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {hasError === 'true' ? 'With Error' : 'Without Error'}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Clear Filters Button */}
        {(timePreset !== 'custom' ||
          startTime ||
          endTime ||
          rootSpanType !== 'all' ||
          rootSpanName ||
          hasError !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs font-normal text-gray-600 hover:text-gray-900"
            onClick={() => {
              setStartTime('');
              setEndTime('');
              setTimePreset('custom');
              setRootSpanType('all');
              setRootSpanName('');
              setHasError('all');
              // Fetch with no filters explicitly
              fetchTraces({
                startTime: '',
                endTime: '',
                rootSpanType: 'all',
                rootSpanName: '',
                hasError: 'all',
              });
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Traces Table */}
      <div className="flex-1 overflow-auto">
        {traces.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-500">No traces found</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto p-3">
            <table className="border-collapse" style={{ minWidth: '1400px' }}>
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                    Root Span Name
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '100px', maxWidth: '100px' }}
                  >
                    Root Span Type
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '100px', maxWidth: '100px' }}
                  >
                    Status
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
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                    Trace ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {traces.map((trace) => (
                  <tr
                    key={trace.trace_id}
                    className={cn(
                      'hover:bg-gray-50 cursor-pointer transition-colors',
                      trace.root_error && 'bg-red-50/30'
                    )}
                    onClick={() => navigate(`/traces/${trace.trace_id}`)}
                  >
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={cn(
                            'p-0.5 rounded flex-shrink-0',
                            trace.root_error ? 'bg-red-100' : 'bg-blue-100'
                          )}
                        >
                          {spanTypeIcon(trace.root_span_type)}
                        </div>
                        <span className="font-medium">
                          {trace.root_span_name || '-'}
                        </span>
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '100px', maxWidth: '100px' }}
                    >
                      {trace.root_span_type || '-'}
                    </td>
                    <td
                      className="px-3 py-2 text-xs"
                      style={{ width: '100px', maxWidth: '100px' }}
                    >
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-medium',
                          trace.status === 'completed' &&
                            'bg-green-100 text-green-800',
                          trace.status === 'failed' &&
                            'bg-red-100 text-red-800',
                          trace.status === 'cancelled' &&
                            'bg-gray-100 text-red-800',
                          (!trace.status || trace.status === 'running') &&
                            'bg-yellow-100 text-yellow-800'
                        )}
                      >
                        {trace.status || 'running'}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2 text-xs"
                      style={{
                        width: '300px',
                        maxWidth: '300px',
                        overflow: 'hidden',
                      }}
                    >
                      {trace.input ? (
                        <div
                          className="truncate font-mono text-gray-700"
                          style={{
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {typeof trace.input === 'object'
                            ? JSON.stringify(trace.input)
                            : String(trace.input)}
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
                      {trace.output ? (
                        <div
                          className="truncate font-mono text-gray-700"
                          style={{
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {typeof trace.output === 'object'
                            ? JSON.stringify(trace.output)
                            : String(trace.output)}
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
                      {trace.root_error ? (
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
                            {typeof trace.root_error === 'object'
                              ? JSON.stringify(trace.root_error)
                              : String(trace.root_error)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '200px', minWidth: '200px' }}
                    >
                      {trace.started_at ? formatTime(trace.started_at) : '-'}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '200px', minWidth: '200px' }}
                    >
                      {trace.ended_at ? formatTime(trace.ended_at) : '-'}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '120px', minWidth: '120px' }}
                    >
                      {trace.started_at && trace.ended_at
                        ? formatDuration(trace.started_at, trace.ended_at)
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-600">
                      {trace.trace_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
