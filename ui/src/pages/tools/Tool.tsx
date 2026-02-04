import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import { Wrench, Search, List, Play } from 'lucide-react';
import type { Tool } from '@/types/models';
import { ToolRunsView } from './ToolRunsView';

type ViewMode = 'list' | 'runs';

export const ToolsPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [tools, setTools] = useState<Tool[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const handleToolClick = (toolId: string) => {
    navigate(`/tools/${toolId}/run`);
  };

  const handleNewToolRun = (e: React.MouseEvent, toolId: string) => {
    e.stopPropagation(); // Prevent row click
    navigate(`/tools/${toolId}/run`);
  };

  useEffect(() => {
    const fetchTools = async () => {
      if (!selectedProjectId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const data = await api.getTools(selectedProjectId);
        setTools(data);
      } catch (err) {
        console.error('Failed to fetch tools:', err);
        setError(err instanceof Error ? err.message : 'Failed to load tools');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTools();
  }, [selectedProjectId]);

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) {
      return tools;
    }
    const query = searchQuery.toLowerCase();
    return tools.filter((tool) => {
      return (
        tool.id.toLowerCase().includes(query) ||
        tool.deployment_id.toLowerCase().includes(query) ||
        (tool.description && tool.description.toLowerCase().includes(query))
      );
    });
  }, [tools, searchQuery]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading tools...</div>
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
        <h1 className="text-2xl font-semibold text-gray-900">Tools</h1>

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
        <ToolRunsView />
      ) : (
        <>
          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search tools by name, deployment, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-full max-w-md"
              />
            </div>
          </div>

          {/* Tools List */}
          {filteredTools.length === 0 ? (
            <div className="text-center py-12">
              <Wrench className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">
                {searchQuery
                  ? 'No tools found matching your search.'
                  : 'No tools found. Create your first tool to get started.'}
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
                        Description
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Deployment
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredTools.map((tool, index) => (
                      <tr
                        key={`${tool.id}-${tool.deployment_id}-${index}`}
                        onClick={() => handleToolClick(tool.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-xs font-medium text-gray-900">
                              {tool.id}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs text-gray-600">
                            {tool.description || (
                              <span className="text-gray-400 italic">
                                No description
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-xs text-gray-600 font-mono">
                            {tool.deployment_id}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleNewToolRun(e, tool.id)}
                            className="text-xs h-7"
                          >
                            Run Tool
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
