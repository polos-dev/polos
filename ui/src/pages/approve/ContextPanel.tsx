interface ContextPanelProps {
  context: Record<string, unknown>;
}

export function ContextPanel({ context }: ContextPanelProps) {
  const entries = Object.entries(context);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm font-mono">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 py-0.5">
          <span className="text-gray-500 shrink-0">{key}:</span>
          {typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ? (
            <span className="text-gray-900 break-all">{String(value)}</span>
          ) : (
            <pre className="text-gray-900 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(value, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
