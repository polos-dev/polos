import React from 'react';
import type { Span } from '@/types/models';

interface SpanErrorsTabProps {
  span: Span;
}

// Helper to extract error message
const getErrorMessage = (span: Span): string | undefined => {
  if (!span.error) return undefined;
  if (typeof span.error === 'string') return span.error;
  if (typeof span.error === 'object') {
    return (span.error as any).message || JSON.stringify(span.error, null, 2);
  }
  return String(span.error);
};

// Helper to extract error type
const getErrorType = (span: Span): string | undefined => {
  if (span.error && typeof span.error === 'object') {
    return (span.error as any).code || (span.error as any).type;
  }
  return undefined;
};

export const SpanErrorsTab: React.FC<SpanErrorsTabProps> = ({ span }) => {
  return (
    <div className="p-3 overflow-auto">
      {span.error ? (
        <div className="space-y-4">
          <div className="border border-red-200 rounded-md overflow-hidden bg-red-50">
            <div className="p-3 border-b border-red-200 bg-red-100">
              <h3 className="text-sm font-medium text-red-800">
                Error Details
              </h3>
            </div>
            <div className="p-3">
              {getErrorType(span) && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-red-800">Type:</div>
                  <div className="text-xs text-red-700">
                    {getErrorType(span)}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-red-800">Message:</div>
                <pre className="p-3 text-xs text-red-700 overflow-auto max-h-48 whitespace-pre-wrap break-all mt-1">
                  {getErrorMessage(span) || JSON.stringify(span.error, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-gray-500">
          No error details available
        </div>
      )}
    </div>
  );
};
