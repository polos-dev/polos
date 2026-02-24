import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionDetail, TimelineEntry } from '@/types/models';
import { api } from '@/lib/api';
import { formatTime, formatDurationMs } from '@/utils/formatter';
import { useProject } from '@/context/ProjectContext';

export const SessionDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { executionId } = useParams<{ executionId: string }>();
  const { selectedProjectId } = useProject();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const fetchSession = async () => {
    if (!executionId) return;
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.getSessionDetail(selectedProjectId, executionId);
      setSession(data);
    } catch (err) {
      console.error('Failed to fetch session:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, [executionId, selectedProjectId]);

  const toggleExpanded = (index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const statusColor = (s: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-red-800',
      running: 'bg-yellow-100 text-yellow-800',
      pending: 'bg-blue-100 text-blue-800',
      suspended: 'bg-amber-100 text-amber-800',
    };
    return colors[s] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-sm text-gray-500">Loading session...</p>
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
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => navigate('/sessions')}
          >
            Back to Sessions
          </Button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => navigate('/sessions')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Bot className="h-5 w-5 text-gray-700" />
            <span className="font-semibold text-sm">{session.agent_id}</span>
            <span
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium',
                statusColor(session.status)
              )}
            >
              {session.status}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={fetchSession}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>
              {session.duration_ms
                ? formatDurationMs(session.duration_ms)
                : 'In progress'}
            </span>
          </div>
          <div>
            Tokens: In:{' '}
            <span className="font-medium">
              {session.total_input_tokens.toLocaleString()}
            </span>{' '}
            Out:{' '}
            <span className="font-medium">
              {session.total_output_tokens.toLocaleString()}
            </span>{' '}
            Total:{' '}
            <span className="font-medium">
              {session.total_tokens.toLocaleString()}
            </span>
          </div>
          <div>
            Tool Calls:{' '}
            <span className="font-medium">{session.tool_call_count}</span>
          </div>
          {session.approval_count > 0 && (
            <div>
              Approvals:{' '}
              <span className="font-medium text-amber-600">
                {session.approval_count}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="py-1">
          {/* Error banner */}
          {session.error && (
            <div className="mx-3 mt-2 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-700">{session.error}</div>
            </div>
          )}

          {/* Timeline */}
          {session.timeline.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-8">
              No conversation data available
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {session.timeline.map((entry, index) => (
                <TimelineRow
                  key={index}
                  entry={entry}
                  isExpanded={expandedItems.has(index)}
                  onToggle={() => toggleExpanded(index)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const extractText = (content: any): string => {
  if (typeof content === 'string') return content;
  if (content?.text) return content.text;
  if (content?.message) return content.message;
  if (content?.content) {
    if (typeof content.content === 'string') return content.content;
    if (Array.isArray(content.content)) {
      return content.content
        .map((c: any) => {
          if (typeof c === 'string') return c;
          if (c?.text) return c.text;
          return JSON.stringify(c);
        })
        .join('\n');
    }
  }
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === 'string') return c;
        if (c?.text) return c.text;
        return JSON.stringify(c);
      })
      .join('\n');
  }
  return JSON.stringify(content, null, 2);
};

const TimelineRow: React.FC<{
  entry: TimelineEntry;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ entry, isExpanded, onToggle }) => {
  if (entry.entry_type === 'user_message') {
    const text = extractText(entry.data?.content);
    return (
      <div className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <div className="flex items-start gap-2 px-4 py-2">
          <User className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-blue-600">User</span>
              <span className="text-[10px] text-gray-400">
                {formatTime(entry.timestamp)}
              </span>
              {text.length > 120 &&
                (isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                ))}
            </div>
            <div
              className={cn(
                'text-xs text-gray-800 mt-0.5',
                !isExpanded && 'line-clamp-2'
              )}
            >
              {text}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (entry.entry_type === 'assistant_message') {
    const text = extractText(entry.data?.content);
    return (
      <div className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <div className="flex items-start gap-2 px-4 py-2">
          <Bot className="h-3.5 w-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">
                Assistant
              </span>
              <span className="text-[10px] text-gray-400">
                {formatTime(entry.timestamp)}
              </span>
              {text.length > 120 &&
                (isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                ))}
            </div>
            {isExpanded ? (
              <div className="text-xs text-gray-800 mt-0.5 prose prose-xs max-w-none">
                <ReactMarkdown>{text}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-xs text-gray-800 mt-0.5 line-clamp-2">
                {text}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (entry.entry_type === 'tool_call') {
    const toolName = entry.data?.tool_name || 'Tool Call';
    const toolStatus = entry.data?.status || 'completed';
    return (
      <div className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <div className="flex items-start gap-2 px-4 py-1.5 pl-8">
          <Wrench className="h-3 w-3 text-gray-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600 font-mono">
                {toolName}
              </span>
              <span
                className={cn(
                  'text-[10px]',
                  toolStatus === 'completed' ? 'text-green-600' : 'text-red-500'
                )}
              >
                {toolStatus}
              </span>
              {entry.data?.result != null &&
                (isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                ))}
            </div>
            {isExpanded && entry.data?.result != null && (
              <pre className="text-[11px] text-gray-500 mt-1 whitespace-pre-wrap overflow-auto max-h-40 bg-gray-50 rounded p-2">
                {typeof entry.data.result === 'string'
                  ? entry.data.result
                  : JSON.stringify(entry.data.result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (entry.entry_type === 'approval_request') {
    const payload = entry.data?.payload || {};
    const form = payload._form || {};
    const context = form.context || {};
    const tool = payload._tool || '';
    const title = form.title || 'Approval requested';
    // Build a concise detail string from context
    const detail = context.command || context.path || form.description || '';
    return (
      <div className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <div className="flex items-start gap-2 px-4 py-1.5 pl-8">
          <ShieldCheck className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700">
                {title}
              </span>
              {tool && (
                <span className="text-[10px] text-amber-500 font-mono">
                  {tool}
                </span>
              )}
              <span className="text-[10px] text-gray-400">
                {formatTime(entry.timestamp)}
              </span>
              {Object.keys(context).length > 0 &&
                (isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                ))}
            </div>
            {detail && !isExpanded && (
              <div className="text-xs text-amber-600 mt-0.5 font-mono truncate">
                {detail}
              </div>
            )}
            {isExpanded && Object.keys(context).length > 0 && (
              <pre className="text-[11px] text-gray-600 mt-1 whitespace-pre-wrap overflow-auto max-h-40 bg-amber-50 rounded p-2">
                {JSON.stringify(context, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (entry.entry_type === 'approval_response') {
    const payload = entry.data?.payload || {};
    const approved = payload.approved ?? payload.data?.approved;
    const feedback = payload.feedback ?? payload.data?.feedback;
    return (
      <div className="flex items-start gap-2 px-4 py-1.5 pl-8">
        <ShieldCheck className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-700">
              {approved === false ? 'Rejected' : 'Approved'}
            </span>
            <span className="text-[10px] text-gray-400">
              {formatTime(entry.timestamp)}
            </span>
          </div>
          {feedback && (
            <div className="text-xs text-gray-600 mt-0.5">{feedback}</div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
