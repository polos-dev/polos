import React from 'react';
import type { Span } from '@/types/models';

interface SpanAttributesTabProps {
  span: Span;
}

export const SpanAttributesTab: React.FC<SpanAttributesTabProps> = ({
  span,
}) => {
  return (
    <div className="p-3 overflow-auto">
      {span.attributes &&
      span.attributes !== null &&
      Object.keys(span.attributes).length > 0 ? (
        <div className="border border-gray-200 rounded-md overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.entries(span.attributes).map(([key, value]) => (
                <tr key={key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-gray-900">
                    {key}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {typeof value === 'object'
                      ? JSON.stringify(value)
                      : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-gray-500">
          No attributes available for this span
        </div>
      )}
    </div>
  );
};
