import React from 'react';
import { cn } from '@/lib/utils';
import type { Span } from '@/types/models';

interface SpanResponseTabProps {
  span: Span;
}

export const SpanResponseTab: React.FC<SpanResponseTabProps> = ({ span }) => {
  // Extract request from span.input.input
  const request = span.input?.input;

  // Extract response from span.output.result
  const response = span.output?.result;

  // Extract tool results from span.output.tool_results
  const toolResults = span.output?.tool_results;

  return (
    <div className="p-3">
      {/* Request */}
      {request !== undefined && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Request</h3>
          <div className="border border-gray-200 rounded-md overflow-hidden bg-gray-50">
            <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {typeof request === 'object'
                ? JSON.stringify(request, null, 2)
                : String(request)}
            </pre>
          </div>
        </div>
      )}

      {/* Response */}
      {response !== undefined && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Response</h3>
          <div className="border border-gray-200 rounded-md overflow-hidden bg-white">
            <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {typeof response === 'object'
                ? JSON.stringify(response, null, 2)
                : String(response)}
            </pre>
          </div>
        </div>
      )}

      {/* Tool Results */}
      {toolResults && Array.isArray(toolResults) && toolResults.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Tool Results</h3>
          <div className="space-y-3">
            {toolResults.map((toolResult: any, index: number) => (
              <div
                key={index}
                className="border border-gray-200 rounded-md overflow-hidden bg-white"
              >
                <div className="p-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-700">
                    {toolResult.tool_name}
                  </span>
                  {toolResult.status && (
                    <span
                      className={cn(
                        'ml-2 text-xs px-2 py-0.5 rounded',
                        toolResult.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      )}
                    >
                      {toolResult.status}
                    </span>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  {toolResult.result !== undefined && (
                    <div>
                      <pre className="text-xs overflow-auto max-h-32 whitespace-pre-wrap break-all">
                        {typeof toolResult.result === 'object'
                          ? JSON.stringify(toolResult.result, null, 2)
                          : String(toolResult.result)}
                      </pre>
                    </div>
                  )}
                  {toolResult.error && (
                    <div>
                      <div className="text-xs font-medium text-red-600 mb-1">
                        Error:
                      </div>
                      <pre className="text-xs text-red-700 overflow-auto max-h-32 whitespace-pre-wrap break-all">
                        {typeof toolResult.error === 'object'
                          ? JSON.stringify(toolResult.error, null, 2)
                          : String(toolResult.error)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {request === undefined &&
        response === undefined &&
        (!toolResults ||
          !Array.isArray(toolResults) ||
          toolResults.length === 0) && (
          <div className="text-center py-8 text-sm text-gray-500">
            No response data available for this span
          </div>
        )}
    </div>
  );
};
