import React from 'react';
import type { Span } from '@/types/models';

interface SpanDataTabProps {
  span: Span;
}

export const SpanDataTab: React.FC<SpanDataTabProps> = ({ span }) => {
  // Check if span is workflow, agent, or tool type
  const showState = ['workflow', 'agent', 'tool'].includes(span.span_type);
  const hasState = span.initial_state || span.final_state;

  return (
    <div className="p-3">
      {/* Input */}
      {span.input && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Input</h3>
          <div className="border border-gray-200 rounded-md overflow-hidden bg-blue-50">
            <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {typeof span.input === 'object'
                ? JSON.stringify(span.input, null, 2)
                : String(span.input)}
            </pre>
          </div>
        </div>
      )}

      {/* Output */}
      {span.output && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Output</h3>
          <div className="border border-gray-200 rounded-md overflow-hidden bg-green-50">
            <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {typeof span.output === 'object'
                ? JSON.stringify(span.output, null, 2)
                : String(span.output)}
            </pre>
          </div>
        </div>
      )}

      {/* State - only show for workflow, agent, or tool spans */}
      {showState && hasState && (
        <div>
          {span.initial_state && (
            <div className="mb-4">
              <h3 className="text-sm font-medium mb-1.5">Initial State</h3>
              <div className="border border-gray-200 rounded-md overflow-hidden bg-gray-50">
                <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
                  {JSON.stringify(span.initial_state, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {span.final_state && (
            <div>
              <h3 className="text-sm font-medium mb-1.5">Final State</h3>
              <div className="border border-gray-200 rounded-md overflow-hidden bg-gray-50">
                <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
                  {JSON.stringify(span.final_state, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {!span.input && !span.output && (!showState || !hasState) && (
        <div className="text-center py-8 text-sm text-gray-500">
          No input/output data available for this span
        </div>
      )}
    </div>
  );
};
