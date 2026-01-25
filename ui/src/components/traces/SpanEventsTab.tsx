import React from 'react';
import type { Span } from '@/types/models';

interface SpanEventsTabProps {
  span: Span;
}

const formatTime = (isoString: string) => {
  return new Date(isoString).toLocaleTimeString();
};

export const SpanEventsTab: React.FC<SpanEventsTabProps> = ({ span }) => {
  return (
    <div className="p-3 overflow-auto">
      {span.events && Array.isArray(span.events) && span.events.length > 0 ? (
        <div className="space-y-3">
          {span.events.map((event, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-md overflow-hidden"
            >
              <div className="flex justify-between items-center p-2.5 border-b border-gray-200 bg-gray-50">
                <div className="font-medium text-sm">
                  {event.name || 'event'}
                </div>
                <div className="text-xs text-gray-500">
                  {event.timestamp ? formatTime(event.timestamp) : ''}
                </div>
              </div>
              {event.attributes && Object.keys(event.attributes).length > 0 && (
                <div className="p-2.5">
                  <pre className="text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(event.attributes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-gray-500">
          No events available for this span
        </div>
      )}
    </div>
  );
};
