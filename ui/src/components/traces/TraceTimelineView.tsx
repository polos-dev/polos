import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Span } from '@/types/models';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TraceTimelineViewProps {
  spans: Span[];
  selectedSpanId: string | null;
  onSpanSelect: (spanId: string) => void;
  hasError: (span: Span) => boolean;
  formatDuration: (start: string, end: string) => string;
  formatTime: (isoString: string) => string;
  traceStartTime: string | null;
  traceEndTime: string | null;
}

const ROW_HEIGHT = 28;

// Color coding by span_type for span bars
const getSpanTypeColor = (spanType: string): { bg: string; border: string } => {
  switch (spanType) {
    case 'agent':
      return { bg: 'bg-purple-300', border: 'border-purple-500' };
    case 'workflow':
      return { bg: 'bg-blue-300', border: 'border-blue-500' };
    case 'tool':
      return { bg: 'bg-orange-300', border: 'border-orange-500' };
    case 'step':
      return { bg: 'bg-green-300', border: 'border-green-500' };
    default:
      return { bg: 'bg-gray-300', border: 'border-gray-500' };
  }
};

export const TraceTimelineView: React.FC<TraceTimelineViewProps> = ({
  spans,
  selectedSpanId,
  onSpanSelect,
  hasError,
  formatDuration,
  formatTime,
  traceStartTime,
  traceEndTime,
}) => {
  // Calculate trace time range
  const { traceStart, traceDuration } = useMemo(() => {
    let start: number | null = null;
    let end: number | null = null;

    if (traceStartTime) {
      start = new Date(traceStartTime).getTime();
    }
    if (traceEndTime) {
      end = new Date(traceEndTime).getTime();
    }

    // Fallback: calculate from spans if trace times are not available
    if (!start || !end) {
      spans.forEach((span) => {
        const spanStart = new Date(span.started_at).getTime();
        const spanEnd = span.ended_at
          ? new Date(span.ended_at).getTime()
          : spanStart;

        if (start === null || spanStart < start) {
          start = spanStart;
        }
        if (end === null || spanEnd > end) {
          end = spanEnd;
        }
      });
    }

    const duration = start && end ? end - start : 0;
    return {
      traceStart: start || 0,
      traceDuration: duration,
    };
  }, [spans, traceStartTime, traceEndTime]);

  // Calculate time ruler markers (5 markers)
  const timeMarkers = useMemo(() => {
    if (!traceDuration || traceDuration === 0) return [];

    const markers = [];
    for (let i = 0; i <= 4; i++) {
      const percent = (i / 4) * 100;
      const time = traceStart + (traceDuration * i) / 4;
      markers.push({
        percent,
        time: new Date(time),
        timestamp: time,
      });
    }
    return markers;
  }, [traceStart, traceDuration]);

  // Calculate span positions and widths
  const spanPositions = useMemo(() => {
    return spans.map((span) => {
      const spanStart = new Date(span.started_at).getTime();
      const spanEnd = span.ended_at
        ? new Date(span.ended_at).getTime()
        : spanStart;
      const spanDuration = spanEnd - spanStart;

      const leftPercent =
        traceDuration > 0
          ? ((spanStart - traceStart) / traceDuration) * 100
          : 0;
      const widthPercent =
        traceDuration > 0 ? (spanDuration / traceDuration) * 100 : 0;

      // Minimum width to ensure visibility (at least 2px or 0.5% of timeline)
      const minWidthPercent = 0.5;
      const finalWidthPercent = Math.max(widthPercent, minWidthPercent);

      return {
        span,
        leftPercent,
        widthPercent: finalWidthPercent,
        actualDuration: spanDuration,
      };
    });
  }, [spans, traceStart, traceDuration]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Time Ruler - Fixed at top */}
      <div
        className="border-b border-gray-300 bg-gray-50 relative"
        style={{ height: '40px' }}
      >
        <div className="h-full relative">
          {timeMarkers.map((marker, index) => (
            <div
              key={index}
              className="absolute top-0 h-full flex flex-col items-center"
              style={{
                left: `${marker.percent}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="w-px h-3 bg-gray-400"></div>
              <div className="text-xs text-gray-600 mt-1 whitespace-nowrap">
                {formatTime(marker.time.toISOString())}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Content - Scrollable */}
      <div className="flex-1 overflow-auto">
        <div
          className="relative"
          style={{ minHeight: `${spans.length * ROW_HEIGHT}px` }}
        >
          {spanPositions.map(({ span, leftPercent, widthPercent }, index) => {
            const isSelected = selectedSpanId === span.span_id;
            const isError = hasError(span);
            const spanTypeColor = getSpanTypeColor(span.span_type);
            const spanEnd = span.ended_at || span.started_at;

            return (
              <TooltipProvider key={span.span_id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'absolute flex items-center cursor-pointer transition-all',
                        'border-t border-b border-gray-200 bg-white',
                        isSelected && 'bg-blue-50'
                      )}
                      style={{
                        top: `${index * ROW_HEIGHT}px`,
                        height: `${ROW_HEIGHT}px`,
                        left: '200px', // Space for span name label
                        width: `calc(100% - 200px)`, // Rest of width for timeline
                      }}
                      onClick={() => onSpanSelect(span.span_id)}
                    >
                      {/* Span Bar - Color coded by span_type */}
                      <div
                        className={cn(
                          'h-5 rounded border-2 transition-all relative',
                          isError
                            ? 'bg-red-200 border-red-500'
                            : `${spanTypeColor.bg} ${spanTypeColor.border}`,
                          isSelected && 'ring-2 ring-blue-400'
                        )}
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          minWidth: '2px', // Ensure visibility even for very short spans
                        }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <div className="font-medium">{span.name}</div>
                      <div className="text-xs">Type: {span.span_type}</div>
                      <div className="text-xs">
                        Start: {formatTime(span.started_at)}
                      </div>
                      <div className="text-xs">
                        Duration: {formatDuration(span.started_at, spanEnd)}
                      </div>
                      {isError && (
                        <div className="text-xs text-red-600">Error</div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>

                {/* Span Name Label - Fixed on left */}
                <div
                  className={cn(
                    'absolute flex items-center px-2 h-7 border-r border-gray-200 bg-white',
                    isSelected && 'bg-blue-50',
                    isError && 'border-r-red-500'
                  )}
                  style={{
                    top: `${index * ROW_HEIGHT}px`,
                    left: 0,
                    width: '200px',
                    height: `${ROW_HEIGHT}px`,
                  }}
                  onClick={() => onSpanSelect(span.span_id)}
                >
                  <div className="flex items-center min-w-0 flex-1">
                    <span
                      className={cn(
                        'text-xs font-medium truncate',
                        isSelected && 'text-blue-700',
                        isError && 'text-red-600'
                      )}
                    >
                      {span.name}
                    </span>
                    {isError && (
                      <Badge
                        variant="destructive"
                        className="ml-1 text-[10px] h-4 px-1"
                      >
                        Error
                      </Badge>
                    )}
                  </div>
                </div>
              </TooltipProvider>
            );
          })}
        </div>
      </div>
    </div>
  );
};
