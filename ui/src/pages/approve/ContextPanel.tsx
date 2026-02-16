interface ContextPanelProps {
  context: Record<string, unknown>;
}

export function ContextPanel({ context }: ContextPanelProps) {
  if (Object.keys(context).length === 0) return null;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <pre className="text-xs text-gray-800 whitespace-pre-wrap break-all overflow-auto max-h-96">
        {JSON.stringify(context, null, 2)}
      </pre>
    </div>
  );
}
