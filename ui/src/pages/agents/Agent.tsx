import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import { Bot, Search, List, Play } from 'lucide-react';
import type { Agent } from '@/types/models';
import { getProviderLogo } from '@/components/logos/ProviderLogo';
import { AgentRunsView } from './AgentRunsView';

type ViewMode = 'list' | 'runs';

export const AgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    const fetchAgents = async () => {
      if (!selectedProjectId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const data = await api.getAgents(selectedProjectId);
        setAgents(data);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to load agents');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgents();
  }, [selectedProjectId]);

  // Filter agents based on search query
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) {
      return agents;
    }
    const query = searchQuery.toLowerCase();
    return agents.filter((agent) => {
      return (
        agent.id.toLowerCase().includes(query) ||
        agent.model.toLowerCase().includes(query) ||
        agent.deployment_id.toLowerCase().includes(query)
      );
    });
  }, [agents, searchQuery]);

  // Get tool count for an agent
  const getToolCount = (agent: Agent): number => {
    if (!agent.tools) return 0;
    if (Array.isArray(agent.tools)) return agent.tools.length;
    return 0;
  };

  const handleAgentClick = (agentId: string) => {
    navigate(`/agents/${agentId}/run`);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading agents...</div>
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
        <h1 className="text-2xl font-semibold text-gray-900">Agents</h1>

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
        <AgentRunsView />
      ) : (
        <>
          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search agents by name, model or deployment..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-full max-w-md"
              />
            </div>
          </div>

          {/* Agents List */}
          {filteredAgents.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">
                {searchQuery
                  ? 'No agents found matching your search.'
                  : 'No agents found. Create your first agent to get started.'}
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
                        Model
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Tools
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Deployment
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAgents.map((agent, index) => (
                      <tr
                        key={`${agent.id}-${agent.deployment_id}-${index}`}
                        onClick={() => handleAgentClick(agent.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-xs font-medium text-gray-900">
                              {agent.id}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <img
                              src={getProviderLogo(agent.provider)}
                              alt={agent.provider}
                              className="w-4 h-4"
                            />
                            <span className="text-xs text-gray-600">
                              {agent.model}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-xs text-gray-600">
                            {getToolCount(agent)}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-xs text-gray-600 font-mono">
                            {agent.deployment_id}
                          </span>
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
