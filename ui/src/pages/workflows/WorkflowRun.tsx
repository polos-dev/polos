import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import { Copy, Check, ChevronLeft } from 'lucide-react';
import type { Workflow, WorkflowRunSummary } from '@/types/models';
import { useExecutionStatus } from '@/hooks/useExecutionStatus';

export const WorkflowRunPage: React.FC = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedInput, setCopiedInput] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunSummary | null>(
    null
  );
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [inputPayload, setInputPayload] = useState<string>('{}');

  const {
    status,
    result,
    error: executionError,
  } = useExecutionStatus(executionId, selectedProjectId || null);

  useEffect(() => {
    const fetchWorkflow = async () => {
      if (!selectedProjectId || !workflowId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const foundWorkflow = await api.getWorkflow(
          selectedProjectId,
          workflowId
        );
        setWorkflow(foundWorkflow);
      } catch (err) {
        console.error('Failed to fetch workflow:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load workflow'
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkflow();
  }, [selectedProjectId, workflowId]);

  const fetchWorkflowRuns = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }

    try {
      setIsLoadingRuns(true);
      const runs = await api.getWorkflowRuns(
        selectedProjectId,
        'workflow',
        workflowId || undefined,
        20
      );
      setWorkflowRuns(runs);
      if (runs && runs.length > 0) {
        setSelectedRun(runs[0]);
      }
    } catch (err) {
      console.error('Failed to fetch workflow runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [selectedProjectId, workflowId]);

  useEffect(() => {
    fetchWorkflowRuns();
  }, [fetchWorkflowRuns]);

  // Refetch workflow runs when execution completes
  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      fetchWorkflowRuns();
    }
  }, [status, fetchWorkflowRuns]);

  const handleRunClick = (run: WorkflowRunSummary) => {
    setSelectedRun(run);
    setExecutionId(null);
    setError(null);
  };

  const handleNewRun = () => {
    setSelectedRun(null);
    setExecutionId(null);
    setError(null);
    setInputPayload('{}');
  };

  const handleInputChange = (value: string) => {
    setInputPayload(value);
  };

  const handleRun = async () => {
    if (!workflowId || !selectedProjectId) return;

    setError(null);
    setExecutionId(null);

    try {
      // Parse input payload
      let parsedPayload: any;
      try {
        parsedPayload = JSON.parse(inputPayload);
      } catch (e) {
        throw new Error('Invalid JSON in input payload');
      }

      // Start workflow execution
      const { execution_id } = await api.runWorkflow(
        selectedProjectId,
        workflowId,
        parsedPayload
      );
      setExecutionId(execution_id);
    } catch (err) {
      console.error('Failed to run workflow:', err);
      setError(err instanceof Error ? err.message : 'Failed to run workflow');
    }
  };

  const handleCopyInput = async () => {
    if (!selectedRun?.payload) return;

    try {
      const jsonString = JSON.stringify(selectedRun.payload, null, 2);
      await navigator.clipboard.writeText(jsonString);
      setCopiedInput(true);
      setTimeout(() => setCopiedInput(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleCopyOutput = async () => {
    const outputData = selectedRun?.result || result;
    if (!outputData) return;

    try {
      const jsonString = JSON.stringify(outputData, null, 2);
      await navigator.clipboard.writeText(jsonString);
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading workflow...</div>
        </div>
      </div>
    );
  }

  if (error && !workflowId) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!workflowId) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Workflow not found</div>
        </div>
      </div>
    );
  }

  const combinedError = error || executionError;

  // Parse input for display
  let displayInput: any = {};
  if (selectedRun?.payload) {
    displayInput = selectedRun.payload;
  } else if (inputPayload) {
    try {
      displayInput = JSON.parse(inputPayload);
    } catch {
      displayInput = {};
    }
  }

  const displayOutput = selectedRun?.result || result || null;
  const displayError = selectedRun?.error || executionError;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/workflows')}
              className="p-1 h-8 w-8"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-semibold text-gray-900">
              {workflowId}
            </h1>
          </div>
          <Button
            size="sm"
            onClick={() => navigate(`/workflows/${workflowId}/traces`)}
          >
            View Traces
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-[250px_1fr_1fr] gap-6">
        {/* Left: Workflow Run History */}
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
              ) : workflowRuns.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No runs yet
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {workflowRuns.map((run) => (
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

        {/* Middle: Input JSON */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Input</h2>
            {selectedRun && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyInput}
                className="flex items-center gap-2"
              >
                {copiedInput ? (
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
            {selectedRun ? (
              <pre className="text-sm text-gray-800 whitespace-pre-wrap overflow-auto">
                {JSON.stringify(displayInput, null, 2)}
              </pre>
            ) : (
              <textarea
                value={inputPayload}
                onChange={(e) => handleInputChange(e.target.value)}
                disabled={status === 'running'}
                className="w-full h-full min-h-[400px] p-2 text-sm font-mono bg-white border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder='{"key": "value"}'
              />
            )}
          </div>
          {!selectedRun && (
            <>
              <Button
                onClick={handleRun}
                disabled={status === 'running'}
                className="w-full"
              >
                {status === 'running' ? 'Running...' : 'Run Workflow'}
              </Button>
              {combinedError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {combinedError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Output JSON */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Output</h2>
            {(displayOutput || displayError) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyOutput}
                className="flex items-center gap-2"
              >
                {copiedOutput ? (
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
            {displayError ? (
              <div className="text-sm text-red-600">
                <div className="font-medium mb-2">Error:</div>
                <pre className="whitespace-pre-wrap">{displayError}</pre>
              </div>
            ) : displayOutput ? (
              <pre className="text-sm text-gray-800 whitespace-pre-wrap overflow-auto">
                {JSON.stringify(displayOutput, null, 2)}
              </pre>
            ) : status === 'running' ? (
              <div className="text-sm text-gray-500 italic">
                Running workflow...
              </div>
            ) : (
              <div className="text-sm text-gray-400 italic">
                Run the workflow to see results here
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
