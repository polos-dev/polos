import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import {
  Network,
  Search,
  CheckCircle,
  XCircle,
  List,
  Play,
} from 'lucide-react';
import type { Workflow } from '@/types/models';
import { WorkflowRunsView } from './WorkflowRunsView';

type ViewMode = 'list' | 'runs';

export const WorkflowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    const fetchWorkflows = async () => {
      if (!selectedProjectId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const data = await api.getWorkflows(selectedProjectId);
        setWorkflows(data);
      } catch (err) {
        console.error('Failed to fetch workflows:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load workflows'
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkflows();
  }, [selectedProjectId]);

  // Filter workflows based on search query
  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) {
      return workflows;
    }
    const query = searchQuery.toLowerCase();
    return workflows.filter((workflow) => {
      return (
        workflow.workflow_id.toLowerCase().includes(query) ||
        workflow.deployment_id.toLowerCase().includes(query)
      );
    });
  }, [workflows, searchQuery]);

  const handleWorkflowClick = (workflowId: string) => {
    navigate(`/workflows/${workflowId}/run`);
  };

  const handleRunWorkflow = (e: React.MouseEvent, workflowId: string) => {
    e.stopPropagation(); // Prevent row click
    navigate(`/workflows/${workflowId}/run`);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading workflows...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Workflows</h1>

        {/* View Toggle */}
        <div className="flex items-center gap-2 border border-gray-300 rounded-lg p-1 bg-white">
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            className="h-6 gap-2"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
            List
          </Button>
          <Button
            variant={viewMode === 'runs' ? 'default' : 'ghost'}
            size="sm"
            className="h-6 gap-2"
            onClick={() => setViewMode('runs')}
          >
            <Play className="h-4 w-4" />
            Runs
          </Button>
        </div>
      </div>

      {viewMode === 'runs' ? (
        <WorkflowRunsView />
      ) : (
        <>
          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search workflows by name or deployment ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-full max-w-md"
              />
            </div>
          </div>

          {/* Workflows List */}
          {filteredWorkflows.length === 0 ? (
            <div className="text-center py-12">
              <Network className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">
                {searchQuery
                  ? 'No workflows found matching your search.'
                  : 'No workflows found. Create your first workflow to get started.'}
              </p>
            </div>
          ) : (
            <div
              className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col"
              style={{ maxHeight: 'calc(70vh)' }}
            >
              <div className="overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Name
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Deployment
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Event Triggered
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Scheduled
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredWorkflows.map((workflow, index) => (
                      <tr
                        key={`${workflow.workflow_id}-${workflow.deployment_id}-${index}`}
                        onClick={() =>
                          handleWorkflowClick(workflow.workflow_id)
                        }
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-xs font-medium text-gray-900">
                              {workflow.workflow_id}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-xs text-gray-600 font-mono">
                            {workflow.deployment_id}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {workflow.trigger_on_event ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {workflow.scheduled ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) =>
                              handleRunWorkflow(e, workflow.workflow_id)
                            }
                            className="text-xs h-7"
                          >
                            Run Workflow
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
