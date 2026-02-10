import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import { Copy, Check, ChevronLeft } from 'lucide-react';
import type { Tool, WorkflowRunSummary } from '@/types/models';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useExecutionStatus } from '@/hooks/useExecutionStatus';

interface ParameterField {
  name: string;
  type: string;
  required: boolean;
  default?: any;
  description?: string;
}

export const ToolRunPage: React.FC = () => {
  const { toolId } = useParams<{ toolId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deploymentId = searchParams.get('deployment_id');
  const { selectedProjectId } = useProject();
  const [tool, setTool] = useState<Tool | null>(null);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [toolRuns, setToolRuns] = useState<WorkflowRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunSummary | null>(
    null
  );
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [hasWorkers, setHasWorkers] = useState<boolean | null>(null);

  const {
    status,
    result,
    error: executionError,
  } = useExecutionStatus(executionId, selectedProjectId || null);

  useEffect(() => {
    const fetchTool = async () => {
      if (!selectedProjectId || !toolId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const foundTool = await api.getTool(
          selectedProjectId,
          toolId,
          deploymentId || undefined
        );
        setTool(foundTool);

        // Parse parameters from JSON schema
        if (foundTool.parameters) {
          const schema = foundTool.parameters;
          const props = schema.properties || {};
          const initialParams: Record<string, string> = {};

          Object.keys(props).forEach((key) => {
            const prop = props[key];
            const defaultValue =
              prop.default !== undefined
                ? typeof prop.default === 'object'
                  ? JSON.stringify(prop.default)
                  : String(prop.default)
                : '';
            initialParams[key] = defaultValue;
          });

          setParameters(initialParams);
        }
      } catch (err) {
        console.error('Failed to fetch tool:', err);
        setError(err instanceof Error ? err.message : 'Failed to load tool');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTool();
  }, [selectedProjectId, toolId, deploymentId]);

  useEffect(() => {
    if (!selectedProjectId || !tool?.deployment_id) return;
    api
      .getWorkerStatus(selectedProjectId, tool.deployment_id)
      .then((res) => setHasWorkers(res.has_workers))
      .catch(() => setHasWorkers(null));
  }, [selectedProjectId, tool?.deployment_id]);

  const fetchToolRuns = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }

    try {
      setIsLoadingRuns(true);
      const runs = await api.getWorkflowRuns(
        selectedProjectId,
        'tool',
        toolId || undefined,
        20
      );
      setToolRuns(runs);
      if (runs && runs.length > 0) {
        setSelectedRun(runs[0]);
      }
    } catch (err) {
      console.error('Failed to fetch tool runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [selectedProjectId, toolId]);

  useEffect(() => {
    fetchToolRuns();
  }, [fetchToolRuns]);

  // Refetch tool runs when execution completes
  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      fetchToolRuns();
    }
  }, [status, fetchToolRuns]);

  const getParameterFields = (): ParameterField[] => {
    if (!tool?.parameters) return [];

    const schema = tool.parameters;
    const props = schema.properties || {};
    const required = schema.required || [];

    return Object.keys(props).map((key) => {
      const prop = props[key];
      return {
        name: key,
        type: prop.type || 'string',
        required: required.includes(key),
        default: prop.default,
        description: prop.description,
      };
    });
  };

  const handleParameterChange = (name: string, value: string) => {
    setParameters((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleRunClick = (run: WorkflowRunSummary) => {
    setSelectedRun(run);
    setExecutionId(null);
    setError(null);

    // Populate parameters from the run's payload
    if (run.payload && typeof run.payload === 'object') {
      const payloadParams: Record<string, string> = {};
      const fields = getParameterFields();

      fields.forEach((field) => {
        const value = run.payload[field.name];
        if (value !== undefined && value !== null) {
          if (field.type === 'object' || field.type === 'array') {
            payloadParams[field.name] = JSON.stringify(value);
          } else {
            payloadParams[field.name] = String(value);
          }
        } else {
          // Use default if available
          payloadParams[field.name] =
            field.default !== undefined
              ? typeof field.default === 'object'
                ? JSON.stringify(field.default)
                : String(field.default)
              : '';
        }
      });

      setParameters(payloadParams);
    }

    // Set result if available
    if (run.result) {
      // We'll show this in the result panel
    }
  };

  const handleNewRun = () => {
    setSelectedRun(null);
    setExecutionId(null);
    setError(null);

    // Reset parameters to defaults
    if (tool?.parameters) {
      const schema = tool.parameters;
      const props = schema.properties || {};
      const initialParams: Record<string, string> = {};

      Object.keys(props).forEach((key) => {
        const prop = props[key];
        const defaultValue =
          prop.default !== undefined
            ? typeof prop.default === 'object'
              ? JSON.stringify(prop.default)
              : String(prop.default)
            : '';
        initialParams[key] = defaultValue;
      });

      setParameters(initialParams);
    }
  };

  const handleRun = async () => {
    if (!tool || !selectedProjectId) return;

    setError(null);
    setExecutionId(null);

    try {
      // Parse parameter values based on their types
      const parsedParams: Record<string, any> = {};
      const fields = getParameterFields();

      fields.forEach((field) => {
        const value = parameters[field.name];
        if (value === '' && field.required) {
          throw new Error(`Parameter ${field.name} is required`);
        }

        try {
          if (field.type === 'number' || field.type === 'integer') {
            parsedParams[field.name] = Number(value);
          } else if (field.type === 'boolean') {
            parsedParams[field.name] = value === 'true' || value === '1';
          } else if (field.type === 'object' || field.type === 'array') {
            parsedParams[field.name] = JSON.parse(value);
          } else {
            parsedParams[field.name] = value;
          }
        } catch (e) {
          throw new Error(
            `Invalid value for parameter ${field.name}: ${e instanceof Error ? e.message : 'Invalid format'}`
          );
        }
      });

      // Start tool execution and store execution_id for status tracking
      const { execution_id } = await api.runTool(
        selectedProjectId,
        tool.id,
        parsedParams
      );
      setExecutionId(execution_id);
    } catch (err) {
      console.error('Failed to run tool:', err);
      setError(err instanceof Error ? err.message : 'Failed to run tool');
    }
  };

  const handleCopyToClipboard = async () => {
    if (!result) return;

    try {
      const jsonString = JSON.stringify(result, null, 2);
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading tool...</div>
        </div>
      </div>
    );
  }

  if (error && !tool) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Tool not found</div>
        </div>
      </div>
    );
  }

  const parameterFields = getParameterFields();
  const combinedError = error || executionError;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/tools')}
              className="p-1 h-8 w-8"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-semibold text-gray-900">{tool.id}</h1>
            {hasWorkers !== null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${hasWorkers ? 'bg-green-500' : 'bg-red-500'}`}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {hasWorkers
                      ? 'Workers available to run this tool'
                      : 'No workers are online for this tool'}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Button size="sm" onClick={() => navigate(`/tools/${toolId}/traces`)}>
            View Traces
          </Button>
        </div>
        {tool.description && (
          <p className="text-xs text-gray-500 ml-11">{tool.description}</p>
        )}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-[250px_1fr_1fr] gap-6">
        {/* Left: Tool Run History */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Recent Runs</h2>
            <Button variant="outline" size="default" onClick={handleNewRun}>
              <span className="text-sm font-normal">+ New Run</span>
            </Button>
          </div>
          <div
            className="border border-gray-200 rounded-lg overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(70vh)' }}
          >
            <div className="overflow-y-auto">
              {isLoadingRuns ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  Loading...
                </div>
              ) : toolRuns.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No runs yet
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {toolRuns.map((run) => (
                    <div
                      key={run.id}
                      onClick={() => handleRunClick(run)}
                      className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedRun?.id === run.id
                          ? 'bg-blue-50 border-l-4 border-l-blue-500'
                          : ''
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {run.id.substring(0, 8)}...
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(run.created_at).toLocaleString()}
                      </div>
                      <div className="text-xs mt-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded ${
                            run.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : run.status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle: Parameters Form */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Parameters</h2>
          {parameterFields.length === 0 ? (
            <p className="text-sm text-gray-500">No parameters required</p>
          ) : (
            <div className="space-y-4">
              {parameterFields.map((field) => (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.name}
                    {field.required && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                  </label>
                  {field.description && (
                    <p className="text-xs text-gray-500 mb-1">
                      {field.description}
                    </p>
                  )}
                  <Input
                    type="text"
                    value={parameters[field.name] || ''}
                    onChange={(e) =>
                      handleParameterChange(field.name, e.target.value)
                    }
                    placeholder={
                      field.default !== undefined ? String(field.default) : ''
                    }
                    className="w-full"
                    disabled={selectedRun !== null}
                  />
                </div>
              ))}
              <Button
                onClick={handleRun}
                disabled={status === 'running' || selectedRun !== null}
                hidden={selectedRun !== null}
                className="w-full"
              >
                {status === 'running' ? 'Running...' : 'Run Tool'}
              </Button>
            </div>
          )}
          {combinedError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {combinedError}
            </div>
          )}
        </div>

        {/* Right: Result Display */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Result</h2>
            {result && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyToClipboard}
                className="flex items-center gap-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 min-h-[400px]">
            {selectedRun?.result ? (
              <pre className="text-sm text-gray-800 whitespace-pre-wrap overflow-auto">
                {JSON.stringify(selectedRun.result, null, 2)}
              </pre>
            ) : selectedRun?.error ? (
              <div className="text-sm text-red-600">
                <div className="font-medium mb-2">Error:</div>
                <pre className="whitespace-pre-wrap">{selectedRun.error}</pre>
              </div>
            ) : result ? (
              <pre className="text-sm text-gray-800 whitespace-pre-wrap overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : status === 'running' ? (
              <div className="text-sm text-gray-500 italic">
                Running tool...
              </div>
            ) : (
              <div className="text-sm text-gray-400 italic">
                Run the tool to see results here
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
