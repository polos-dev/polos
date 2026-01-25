import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Clock,
  Bot,
  Database,
  RefreshCw,
  Network,
  Wrench,
  StepForward,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Span, Trace } from '@/types/models';
import { api } from '@/lib/api';
import { formatDuration } from '@/utils/formatter';
import {
  SpanDataTab,
  SpanResponseTab,
  SpanLLMCallTab,
  SpanEventsTab,
  SpanAttributesTab,
  SpanErrorsTab,
  TraceGraphView,
  TraceTimelineView,
} from '@/components/traces';
import { useProject } from '@/context/ProjectContext';

export const TraceDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('data');
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(
    new Set()
  );
  const [viewMode, setViewMode] = useState<'tree' | 'graph' | 'timeline'>(
    'tree'
  );

  const fetchTrace = async () => {
    if (!traceId) return;

    try {
      setIsLoading(true);
      setError(null);
      const traceData = await api.getTrace(selectedProjectId, traceId);

      setTrace(traceData);

      // Auto-expand root span and select first span
      if (traceData.spans.length > 0) {
        const rootSpan = traceData.spans[0];
        setExpandedSpanIds(new Set([rootSpan.span_id]));
        setSelectedSpanId(rootSpan.span_id);
      }
    } catch (err) {
      console.error('Failed to fetch trace:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trace');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrace();
  }, [traceId, selectedProjectId]);

  // Build span tree
  const spanMap = new Map<string, Span>();
  const childrenMap = new Map<string, Span[]>();

  if (trace) {
    trace.spans.forEach((span) => {
      spanMap.set(span.span_id, span);
      childrenMap.set(span.span_id, []);
    });

    trace.spans.forEach((span) => {
      if (span.parent_span_id && childrenMap.has(span.parent_span_id)) {
        childrenMap.get(span.parent_span_id)!.push(span);
      }
    });

    // Sort children by started_at
    //childrenMap.forEach(children => {
    //  children.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    //});
  }

  const rootSpans: Span[] = trace
    ? trace.spans
        .filter(
          (span) =>
            !span.parent_span_id || span.parent_span_id === trace.trace_id
        )
        .sort(
          (a, b) =>
            new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
        )
    : [];

  const selectedSpan =
    selectedSpanId && trace
      ? trace.spans.find((span) => span.span_id === selectedSpanId)
      : null;

  const toggleSpan = (spanId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const newExpandedSpans = new Set(expandedSpanIds);
    if (newExpandedSpans.has(spanId)) {
      newExpandedSpans.delete(spanId);
    } else {
      newExpandedSpans.add(spanId);
    }
    setExpandedSpanIds(newExpandedSpans);
  };

  const selectSpan = (spanId: string) => {
    setSelectedSpanId(spanId);
    // Switch back to tree view when selecting a span from graph or timeline view
    if (viewMode === 'graph' || viewMode === 'timeline') {
      setViewMode('tree');
    }
    const span = trace
      ? trace.spans.find((span) => span.span_id === spanId)
      : null;
    if (span && hasError(span)) {
      setDetailTab('errors');
    } else if (span && isLLMStep(span)) {
      setDetailTab('llm-call');
    } else if (span && span.span_type === 'agent') {
      setDetailTab('response');
    } else {
      setDetailTab('data');
    }
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString();
  };

  // Helper to determine if span has error
  const hasError = (span: Span): boolean => {
    return (
      span.error !== null &&
      span.error !== undefined &&
      (typeof span.error === 'object'
        ? Object.keys(span.error).length > 0
        : true)
    );
  };

  // Helper to check if span is an LLM step
  const isLLMStep = (span: Span): boolean => {
    return span.span_type === 'step' && span.name?.startsWith('step.llm_');
  };

  // Helper to extract error message
  const getErrorMessage = (span: Span): string | undefined => {
    if (!span.error) return undefined;
    if (typeof span.error === 'string') return span.error;
    if (typeof span.error === 'object') {
      return (span.error as any).message || JSON.stringify(span.error, null, 2);
    }
    return String(span.error);
  };

  const spanTypeIcon = (spanType: string) => {
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

  const spanTypeBgColor = (spanType: string, isError: boolean) => {
    if (isError) {
      return 'bg-red-100';
    }
    if (spanType === 'agent') {
      return 'bg-purple-100';
    } else if (spanType === 'workflow') {
      return 'bg-blue-100';
    } else if (spanType === 'tool') {
      return 'bg-orange-100';
    } else if (spanType === 'step') {
      return 'bg-green-100';
    }
    return 'bg-gray-100';
  };

  const renderSpan = (span: Span, depth = 0, isLast = true) => {
    const isExpanded = expandedSpanIds.has(span.span_id);
    const children = childrenMap.get(span.span_id);
    const hasChildren = children && children.length > 0;
    const isError = hasError(span);
    const isSelected = selectedSpanId === span.span_id;
    const errorMessage = getErrorMessage(span);

    return (
      <div key={span.span_id} className="relative">
        {depth > 0 && (
          <div
            className="absolute left-3 top-0 w-0.5 bg-gray-200"
            style={{
              height: isLast ? '24px' : '100%',
              left: `${depth * 16 - 8}px`,
            }}
          />
        )}

        <div
          className={cn(
            'flex items-start py-2 pl-4 pr-2 hover:bg-gray-50 transition-colors cursor-pointer border-l-2',
            isSelected ? 'bg-blue-50 hover:bg-blue-50' : '',
            isError ? 'border-l-red-500' : 'border-l-blue-500'
          )}
          style={{ paddingLeft: `${depth * 16 + 16}px` }}
          onClick={() => selectSpan(span.span_id)}
        >
          {hasChildren && (
            <button
              className="p-1 mr-1"
              onClick={(e) => toggleSpan(span.span_id, e)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-5 mr-1" />}

          <div
            className={cn(
              'p-1 rounded mr-1 flex-shrink-0',
              spanTypeBgColor(span.span_type, isError)
            )}
          >
            {spanTypeIcon(span.span_type)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between">
              <div className="font-medium text-xs truncate">
                {span.name}
                {isError && (
                  <Badge
                    variant="destructive"
                    className="ml-2 text-[10px] h-4 px-1"
                  >
                    Error
                  </Badge>
                )}
              </div>
              <div className="flex items-center text-[10px] text-gray-500 mt-0.5 sm:mt-0">
                <Clock className="h-3 w-3 mr-0.5" />
                <span className="mr-1.5">
                  {formatDuration(
                    span.started_at,
                    span.ended_at || span.started_at
                  )}
                </span>
              </div>
            </div>

            <div className="text-[10px] text-gray-500 mt-0.5">
              {span.span_type || 'unknown'}
            </div>

            {isError && errorMessage && (
              <div className="mt-0.5 text-[10px] text-red-600 flex items-start">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5 mt-0.5 flex-shrink-0" />
                <span className="truncate">{errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        {isExpanded && hasChildren && children && (
          <div>
            {children.map((childSpan, index) =>
              renderSpan(childSpan, depth + 1, index === children.length - 1)
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-sm text-gray-500">Loading trace...</p>
        </div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-red-400 mb-4" />
          <p className="text-sm text-gray-500">{error || 'Trace not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Trace Header */}
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => navigate(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-base font-semibold flex items-center">
                {trace.root_span_name || trace.trace_id}
                {trace.error_count > 0 && (
                  <Badge variant="destructive" className="ml-2 text-xs">
                    Error
                  </Badge>
                )}
                {trace.status && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'ml-2 text-xs',
                      trace.status === 'completed' &&
                        'bg-green-100 text-green-800 border-green-300',
                      trace.status === 'failed' &&
                        'bg-red-100 text-red-800 border-red-300',
                      trace.status === 'cancelled' &&
                        'bg-red-100 text-red-800 border-red-300',
                      (!trace.status || trace.status === 'running') &&
                        'bg-yellow-100 text-yellow-800 border-yellow-300'
                    )}
                  >
                    {trace.status}
                  </Badge>
                )}
              </h1>
              <div className="flex items-center border-l border-gray-300 pl-2 ml-2">
                <div className="inline-flex rounded-md shadow-xs border border-gray-300 overflow-hidden">
                  <Button
                    variant={viewMode === 'tree' ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-7 text-xs rounded-none border-0 border-r border-gray-300',
                      viewMode === 'tree' ? '' : 'hover:bg-gray-100'
                    )}
                    onClick={() => setViewMode('tree')}
                  >
                    Tree
                  </Button>
                  <Button
                    variant={viewMode === 'graph' ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-7 text-xs rounded-none border-0 border-r border-gray-300',
                      viewMode === 'graph' ? '' : 'hover:bg-gray-100'
                    )}
                    onClick={() => setViewMode('graph')}
                  >
                    Graph
                  </Button>
                  <Button
                    variant={viewMode === 'timeline' ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-7 text-xs rounded-none border-0',
                      viewMode === 'timeline' ? '' : 'hover:bg-gray-100'
                    )}
                    onClick={() => setViewMode('timeline')}
                  >
                    Timeline
                  </Button>
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Trace ID: {trace.trace_id}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1 sm:mt-0 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center">
              <div className="flex items-center mr-3">
                <Clock className="h-3.5 w-3.5 mr-1 text-gray-500" />
                <span>
                  {trace.trace_start_time
                    ? formatTime(trace.trace_start_time)
                    : 'N/A'}{' '}
                  -{' '}
                  {trace.trace_end_time
                    ? formatTime(trace.trace_end_time)
                    : 'N/A'}
                </span>
              </div>
              <div>
                Duration:{' '}
                {trace.trace_start_time && trace.trace_end_time
                  ? formatDuration(trace.trace_start_time, trace.trace_end_time)
                  : 'N/A'}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={fetchTrace}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column - Spans Tree or Graph View */}
        {viewMode === 'tree' ? (
          <div className="w-1/4 border-r border-gray-200 flex flex-col">
            <div className="p-2 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
              <h2 className="text-sm font-medium">Spans</h2>
              <div className="text-xs text-gray-500">
                {trace.span_count} spans
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <div className="h-full">
                {rootSpans.map((span) => renderSpan(span))}
              </div>
            </div>
          </div>
        ) : viewMode === 'graph' ? (
          <div className="w-full flex flex-col">
            <div className="p-2 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
              <h2 className="text-sm font-medium">Graph View</h2>
              <div className="text-xs text-gray-500">
                {trace.span_count} spans
              </div>
            </div>
            <div className="flex-1">
              <TraceGraphView
                spans={trace.spans}
                selectedSpanId={selectedSpanId}
                onSpanSelect={selectSpan}
                hasError={hasError}
                formatDuration={formatDuration}
                formatTime={formatTime}
              />
            </div>
          </div>
        ) : viewMode === 'timeline' ? (
          <div className="w-full flex flex-col">
            <div className="p-2 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
              <h2 className="text-sm font-medium">Timeline View</h2>
              <div className="text-xs text-gray-500">
                {trace.span_count} spans
              </div>
            </div>
            <div className="flex-1">
              <TraceTimelineView
                spans={trace.spans}
                selectedSpanId={selectedSpanId}
                onSpanSelect={selectSpan}
                hasError={hasError}
                formatDuration={formatDuration}
                formatTime={formatTime}
                traceStartTime={trace.trace_start_time}
                traceEndTime={trace.trace_end_time}
              />
            </div>
          </div>
        ) : null}

        {/* Right Column - Selected Span Details (hidden in graph and timeline views) */}
        {viewMode === 'tree' && (
          <div className="w-3/4 flex flex-col">
            {selectedSpan ? (
              <>
                {/* Selected Span Header */}
                <div className="p-2 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div className="flex items-center">
                    <div
                      className={cn(
                        'p-1 rounded mr-2 flex-shrink-0',
                        spanTypeBgColor(
                          selectedSpan.span_type,
                          hasError(selectedSpan)
                        )
                      )}
                    >
                      {spanTypeIcon(selectedSpan.span_type)}
                    </div>
                    <div>
                      <div className="text-sm font-medium flex items-center">
                        {selectedSpan.name}
                        {hasError(selectedSpan) && (
                          <Badge
                            variant="destructive"
                            className="ml-2 text-[10px]"
                          >
                            Error
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatTime(selectedSpan.started_at)} •{' '}
                        {formatDuration(
                          selectedSpan.started_at,
                          selectedSpan.ended_at || selectedSpan.started_at
                        )}
                      </div>
                    </div>
                  </div>
                  {((selectedSpan.span_type === 'agent' &&
                    selectedSpan.output?.usage) ||
                    (isLLMStep(selectedSpan) &&
                      selectedSpan.output?.usage)) && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 text-xs font-semibold">
                        Tokens
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs font-semibold px-2 py-1"
                      >
                        <span className="text-gray-600">In</span>{' '}
                        <span className="font-mono ml-1">
                          {selectedSpan.output.usage.input_tokens ?? 0}
                        </span>
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-xs font-semibold px-2 py-1"
                      >
                        <span className="text-gray-600">Out</span>{' '}
                        <span className="font-mono ml-1">
                          {selectedSpan.output.usage.output_tokens ?? 0}
                        </span>
                      </Badge>
                      <Badge
                        variant="default"
                        className="text-xs font-semibold px-2 py-1 bg-blue-600 text-white"
                      >
                        <span>Total</span>{' '}
                        <span className="font-mono ml-1">
                          {selectedSpan.output.usage.total_tokens ?? 0}
                        </span>
                      </Badge>
                    </div>
                  )}
                </div>

                {/* Tabs */}
                <Tabs
                  defaultValue={
                    selectedSpan.span_type === 'agent'
                      ? 'response'
                      : isLLMStep(selectedSpan)
                        ? 'llm-call'
                        : 'data'
                  }
                  value={detailTab}
                  onValueChange={setDetailTab}
                  className="flex-1 flex flex-col min-h-0 overflow-hidden"
                >
                  <div className="border-b border-gray-200">
                    <TabsList className="h-8">
                      {selectedSpan.span_type === 'agent' && (
                        <TabsTrigger value="response" className="text-xs">
                          Response
                        </TabsTrigger>
                      )}
                      {isLLMStep(selectedSpan) && (
                        <TabsTrigger value="llm-call" className="text-xs">
                          LLM Call
                        </TabsTrigger>
                      )}
                      <TabsTrigger value="data" className="text-xs">
                        Data
                      </TabsTrigger>
                      <TabsTrigger value="events" className="text-xs">
                        Events
                      </TabsTrigger>
                      <TabsTrigger value="attributes" className="text-xs">
                        Attributes
                      </TabsTrigger>
                      {hasError(selectedSpan) && (
                        <TabsTrigger
                          value="errors"
                          className="text-xs text-red-600"
                        >
                          Errors
                        </TabsTrigger>
                      )}
                    </TabsList>
                  </div>

                  {/* Response Tab (for agent spans) */}
                  {selectedSpan.span_type === 'agent' && (
                    <TabsContent
                      value="response"
                      className="flex-1 overflow-auto p-0 m-0"
                    >
                      <SpanResponseTab span={selectedSpan} />
                    </TabsContent>
                  )}

                  {/* LLM Call Tab (for LLM step spans) */}
                  {isLLMStep(selectedSpan) && (
                    <TabsContent
                      value="llm-call"
                      className="flex-1 overflow-auto p-0 m-0"
                    >
                      <SpanLLMCallTab span={selectedSpan} />
                    </TabsContent>
                  )}

                  {/* Data Tab */}
                  <TabsContent
                    value="data"
                    className="flex-1 overflow-auto p-0 m-0"
                  >
                    <SpanDataTab span={selectedSpan} />
                  </TabsContent>

                  {/* Events Tab */}
                  <TabsContent
                    value="events"
                    className="flex-1 overflow-auto p-0 m-0"
                  >
                    <SpanEventsTab span={selectedSpan} />
                  </TabsContent>

                  {/* Attributes Tab */}
                  <TabsContent
                    value="attributes"
                    className="flex-1 overflow-auto p-0 m-0"
                  >
                    <SpanAttributesTab span={selectedSpan} />
                  </TabsContent>

                  {/* Errors Tab */}
                  {hasError(selectedSpan) && (
                    <TabsContent
                      value="errors"
                      className="flex-1 overflow-auto p-0 m-0"
                    >
                      <SpanErrorsTab span={selectedSpan} />
                    </TabsContent>
                  )}
                </Tabs>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-center text-gray-500">
                <div>
                  <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-sm">Select a span to view details</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
