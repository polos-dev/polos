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
  FilterIcon,
  MessagesSquare,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionListItem } from '@/types/models';
import { api } from '@/lib/api';
import { formatTime } from '@/utils/formatter';
import {
  applyTimePreset,
  recalculateTimeRangeForRefresh,
} from '@/utils/timeFilters';
import { useProject } from '@/context/ProjectContext';

export const SessionListPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [timePreset, setTimePreset] = useState<string>('24h');
  const [status, setStatus] = useState<string>('all');
  const [agentId, setAgentId] = useState<string>('');
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
    const times = applyTimePreset('24h');
    if (times) {
      setStartTime(times.startTime);
      setEndTime(times.endTime);

      fetchSessions({
        startTime: times.startTime,
        endTime: times.endTime,
        status: 'all',
        agentId: '',
      });
    }
  }, [selectedProjectId]);

  const fetchSessions = async (customFilters?: {
    startTime?: string;
    endTime?: string;
    status?: string;
    agentId?: string;
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
        status,
        agentId,
      };

      if (filters.startTime)
        params.start_time = new Date(filters.startTime).toISOString();
      if (filters.endTime)
        params.end_time = new Date(filters.endTime).toISOString();
      if (filters.status && filters.status !== 'all')
        params.status = filters.status;
      if (filters.agentId) params.agent_id = filters.agentId;

      const data = await api.getSessions(selectedProjectId, params);
      setSessions(data.sessions);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  };

  const statusBadge = (s: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-red-800',
      running: 'bg-yellow-100 text-yellow-800',
      pending: 'bg-blue-100 text-blue-800',
      suspended: 'bg-amber-100 text-amber-800',
    };
    return (
      <span
        className={cn(
          'px-2 py-0.5 rounded text-[10px] font-medium',
          styles[s] || 'bg-gray-100 text-gray-800'
        )}
      >
        {s}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-sm text-gray-500">Loading sessions...</p>
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
        <h1 className="text-lg font-semibold">Sessions</h1>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            const times = recalculateTimeRangeForRefresh(timePreset);
            if (times) {
              setStartTime(times.startTime);
              setEndTime(times.endTime);
              fetchSessions({
                startTime: times.startTime,
                endTime: times.endTime,
                status,
                agentId,
              });
            } else {
              fetchSessions({
                startTime,
                endTime,
                status,
                agentId,
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
              {['1h', '6h', '24h', '7d', '30d'].map((preset) => (
                <Button
                  key={preset}
                  variant={timePreset === preset ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleApplyTimePreset(preset)}
                >
                  {preset === '1h'
                    ? 'Last 1 hour'
                    : preset === '6h'
                      ? 'Last 6 hours'
                      : preset === '24h'
                        ? 'Last 24 hours'
                        : preset === '7d'
                          ? 'Last 7 days'
                          : 'Last 30 days'}
                </Button>
              ))}
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

          {/* Other Filters */}
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">
              Other Filters
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Status
                </label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Agent ID
                </label>
                <Input
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="Filter by agent..."
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                fetchSessions();
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
            status !== 'all' ||
            agentId) && (
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
              {status !== 'all' && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  Status: {status}
                </Badge>
              )}
              {agentId && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  Agent: {agentId}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Clear Filters Button */}
        {(timePreset !== 'custom' ||
          startTime ||
          endTime ||
          status !== 'all' ||
          agentId) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs font-normal text-gray-600 hover:text-gray-900"
            onClick={() => {
              setStartTime('');
              setEndTime('');
              setTimePreset('custom');
              setStatus('all');
              setAgentId('');
              fetchSessions({
                startTime: '',
                endTime: '',
                status: 'all',
                agentId: '',
              });
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Sessions Table */}
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessagesSquare className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-500">No sessions found</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto p-3">
            <table className="border-collapse" style={{ minWidth: '1200px' }}>
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                    Agent
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '100px' }}
                  >
                    Status
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '300px', maxWidth: '300px' }}
                  >
                    User Message
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '180px' }}
                  >
                    Started
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '70px' }}
                  >
                    Turns
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '80px' }}
                  >
                    Tokens
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '90px' }}
                  >
                    Tool Calls
                  </th>
                  <th
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                    style={{ width: '90px' }}
                  >
                    Approvals
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sessions.map((session) => (
                  <tr
                    key={session.execution_id}
                    className={cn(
                      'hover:bg-gray-50 cursor-pointer transition-colors',
                      session.error && 'bg-red-50/30'
                    )}
                    onClick={() =>
                      navigate(`/sessions/${session.execution_id}`)
                    }
                  >
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={cn(
                            'p-0.5 rounded flex-shrink-0',
                            session.error ? 'bg-red-100' : 'bg-blue-100'
                          )}
                        >
                          <Bot className="h-3.5 w-3.5 text-gray-700" />
                        </div>
                        <span className="font-medium">{session.agent_id}</span>
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 text-xs"
                      style={{ width: '100px' }}
                    >
                      {statusBadge(session.status)}
                    </td>
                    <td
                      className="px-3 py-2 text-xs"
                      style={{
                        width: '300px',
                        maxWidth: '300px',
                        overflow: 'hidden',
                      }}
                    >
                      {session.user_message_preview ? (
                        <div
                          className="truncate text-gray-700"
                          style={{
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {session.user_message_preview}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '180px' }}
                    >
                      {session.created_at
                        ? formatTime(session.created_at)
                        : '-'}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '70px' }}
                    >
                      {session.execution_count ?? 1}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '80px' }}
                    >
                      {session.total_tokens
                        ? session.total_tokens.toLocaleString()
                        : '-'}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '90px' }}
                    >
                      {session.tool_call_count}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-gray-600"
                      style={{ width: '90px' }}
                    >
                      {session.approval_count > 0 ? (
                        <span className="text-amber-600 font-medium">
                          {session.approval_count}
                        </span>
                      ) : (
                        '0'
                      )}
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
