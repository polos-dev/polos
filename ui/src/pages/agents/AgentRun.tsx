import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProject } from '@/context/ProjectContext';
import { ChevronLeft, Wrench } from 'lucide-react';
import type { Agent, WorkflowRunSummary } from '@/types/models';
import { useExecutionStatus } from '@/hooks/useExecutionStatus';
import ReactMarkdown from 'react-markdown';
import { getProviderLogo } from '@/components/logos/ProviderLogo';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool_call';
  content: string;
  timestamp: string;
  toolName?: string;
}

export const AgentRunPage: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deploymentId = searchParams.get('deployment_id');
  const { selectedProjectId } = useProject();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentRuns, setAgentRuns] = useState<WorkflowRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunSummary | null>(
    null
  );
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamCleanup, setStreamCleanup] = useState<(() => void) | null>(null);
  const [hasWorkers, setHasWorkers] = useState<boolean | null>(null);

  const { status } = useExecutionStatus(executionId, selectedProjectId || null);

  useEffect(() => {
    const fetchAgent = async () => {
      if (!selectedProjectId || !agentId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const foundAgent = await api.getAgent(
          selectedProjectId,
          agentId,
          deploymentId || undefined
        );
        setAgent(foundAgent);
      } catch (err) {
        console.error('Failed to fetch agent:', err);
        setError(err instanceof Error ? err.message : 'Failed to load agent');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgent();
  }, [selectedProjectId, agentId, deploymentId]);

  useEffect(() => {
    if (!selectedProjectId || !agent?.deployment_id) return;
    api
      .getWorkerStatus(selectedProjectId, agent.deployment_id)
      .then((res) => setHasWorkers(res.has_workers))
      .catch(() => setHasWorkers(null));
  }, [selectedProjectId, agent?.deployment_id]);

  const fetchAgentRuns = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }

    try {
      setIsLoadingRuns(true);
      const runs = await api.getWorkflowRuns(
        selectedProjectId,
        'agent',
        agentId || undefined,
        20
      );

      // Filter runs: if multiple runs have the same conversation_id, keep only the latest one
      const runsByConversationId = new Map<string, WorkflowRunSummary>();

      for (const run of runs) {
        const convId = run.result?.conversation_id;

        if (convId) {
          // If we already have a run for this conversation_id, compare created_at and keep the latest
          const existingRun = runsByConversationId.get(convId);
          if (
            !existingRun ||
            new Date(run.created_at) > new Date(existingRun.created_at)
          ) {
            runsByConversationId.set(convId, run);
          }
        }
      }

      // Convert map back to array and sort by created_at (newest first)
      const filteredRuns = Array.from(runsByConversationId.values()).sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setAgentRuns(filteredRuns);
      if (filteredRuns && filteredRuns.length > 0) {
        setSelectedRun(filteredRuns[0]);
      }
    } catch (err) {
      console.error('Failed to fetch agent runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [selectedProjectId, agentId]);

  useEffect(() => {
    fetchAgentRuns();
  }, [fetchAgentRuns]);

  const handleRunClick = (run: WorkflowRunSummary) => {
    setSelectedRun(run);
    setError(null);
    // Extract conversation_id from the run's result to continue the conversation
    const convId = run.result?.conversation_id;
    if (convId) {
      setConversationId(convId);
    } else {
      setConversationId(null);
    }
    setInputMessage('');
    setExecutionId(null);
  };

  const handleNewRun = () => {
    setSelectedRun(null);
    setError(null);
    setChatMessages([]);
    // Generate a new UUID for conversation_id
    const newConversationId = crypto.randomUUID();
    setConversationId(newConversationId);
    setExecutionId(null);
    setInputMessage('');
  };

  const handleSendMessage = async () => {
    if (
      !inputMessage.trim() ||
      !conversationId ||
      !selectedProjectId ||
      !agentId ||
      isSending
    ) {
      return;
    }

    const message = inputMessage.trim();
    setInputMessage('');
    setIsSending(true);
    setError(null);

    // Cleanup any existing stream
    if (streamCleanup) {
      streamCleanup();
      setStreamCleanup(null);
    }

    // Immediately add user message to chat
    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMessage]);

    // Add placeholder assistant message for streaming
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, assistantMessage]);

    try {
      // Invoke agent run with input, conversation_id, and streaming=true
      const response = await api.runWorkflow(selectedProjectId, agentId, {
        input: message,
        conversation_id: conversationId,
        streaming: true,
      });

      const execId = response.execution_id;
      setExecutionId(execId);

      // Stream events from SSE endpoint
      let accumulatedContent = '';

      const cleanup = api.streamEvents(
        selectedProjectId,
        agentId,
        execId,
        (event) => {
          if (event.event_type === 'text_delta') {
            // Accumulate text deltas
            const delta =
              typeof event.data.content === 'string'
                ? event.data.content
                : String(event.data.content || '');
            accumulatedContent += delta;

            // Update the last assistant message with streaming content
            setChatMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                lastMessage.content = accumulatedContent;
              }
              return newMessages;
            });
          } else if (event.event_type === 'tool_call') {
            // Handle tool call events
            const toolCall = event.data.tool_call;
            if (
              toolCall &&
              toolCall.type === 'function' &&
              toolCall.function &&
              toolCall.function.name
            ) {
              const toolName = toolCall.function.name;
              // Add a tool_call message to the chat
              setChatMessages((prev) => {
                return [
                  ...prev,
                  {
                    role: 'tool_call' as const,
                    content: `Calling ${toolName}`,
                    timestamp: new Date().toISOString(),
                    toolName: toolName,
                  },
                ];
              });
            }
          } else if (
            event.event_type === 'agent_finish' &&
            event.data._metadata.execution_id === execId
          ) {
            // Workflow is complete
            setIsSending(false);
            setExecutionId(null);
            fetchAgentRuns();

            if (cleanup) {
              cleanup();
              setStreamCleanup(null);
            }
          }
        },
        (error) => {
          console.error('Stream error:', error);
          setError(error.message);
          setIsSending(false);
        }
      );

      setStreamCleanup(() => cleanup);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setIsSending(false);
      setInputMessage(message); // Restore message on error
      // Remove both user and placeholder assistant messages if there was an error
      setChatMessages((prev) => {
        const filtered = [...prev];
        if (filtered.length >= 2) {
          filtered.pop(); // Remove placeholder assistant message
          filtered.pop(); // Remove user message
        }
        return filtered;
      });
    }
  };

  // Fetch conversation history when selectedRun changes and has a conversation_id, or when conversationId is set for new conversations
  useEffect(() => {
    const fetchConversation = async () => {
      // If a run is selected, use its conversation_id
      if (selectedRun) {
        if (!selectedProjectId) {
          setChatMessages([]);
          return;
        }

        // Extract conversation_id from result
        const convId = selectedRun.result?.conversation_id;
        if (!convId) {
          setChatMessages([]);
          setConversationId(null);
          return;
        }

        setConversationId(convId);
      }

      // Fetch conversation if we have a conversation_id
      if (!conversationId || !selectedProjectId) {
        if (!selectedRun) {
          setChatMessages([]);
        }
        return;
      }

      try {
        setIsLoadingConversation(true);
        if (!agentId) {
          setChatMessages([]);
          return;
        }
        const messages = await api.getConversationHistory(
          selectedProjectId,
          conversationId,
          agentId,
          agent?.deployment_id
        );

        // Convert API messages to ChatMessage format
        const formattedMessages: ChatMessage[] = messages.map((msg: any) => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content || '',
          timestamp: msg.created_at || new Date().toISOString(),
        }));

        setChatMessages(formattedMessages);
      } catch (err) {
        console.error('Failed to fetch conversation history:', err);
        setChatMessages([]);
      } finally {
        setIsLoadingConversation(false);
      }
    };

    fetchConversation();
  }, [selectedRun, selectedProjectId, conversationId, agentId, agent]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamCleanup) {
        streamCleanup();
      }
    };
  }, [streamCleanup]);

  // Note: Status polling is no longer needed since streaming handles completion
  // But keep it for non-streaming workflows if needed
  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      // Only handle non-streaming workflows here
      // Streaming workflows are handled in the stream event handlers
      if (!streamCleanup && conversationId && selectedProjectId && agentId) {
        // Refresh conversation history for both new and existing conversations
        setIsLoadingConversation(true);
        api
          .getConversationHistory(
            selectedProjectId,
            conversationId,
            agentId,
            agent?.deployment_id
          )
          .then((messages) => {
            const formattedMessages: ChatMessage[] = messages.map(
              (msg: any) => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content || '',
                timestamp: msg.created_at || new Date().toISOString(),
              })
            );
            setChatMessages(formattedMessages);
          })
          .catch((err) => {
            console.error('Failed to refresh conversation:', err);
          })
          .finally(() => {
            setIsLoadingConversation(false);
            setIsSending(false);
          });

        // Always refresh the runs list to get the latest run (including new conversations)
        fetchAgentRuns();
      }
      setExecutionId(null);
    }
  }, [
    status,
    conversationId,
    selectedProjectId,
    fetchAgentRuns,
    agentId,
    agent,
  ]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading agent...</div>
        </div>
      </div>
    );
  }

  if (error && !agent) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Agent not found</div>
        </div>
      </div>
    );
  }

  const getToolCount = (): any => {
    if (!agent.tools) return 'None';
    if (Array.isArray(agent.tools)) return agent.tools.length;
    return 'None';
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/agents')}
              className="p-1 h-8 w-8"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-semibold text-gray-900">{agent.id}</h1>
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
                      ? 'Workers available to run this agent'
                      : 'No workers are online for this agent'}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => navigate(`/agents/${agentId}/traces`)}
          >
            View Traces
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-[250px_1fr_400px] gap-6">
        {/* Left: Agent Run History */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Recent Runs</h2>
            <Button variant="outline" size="default" onClick={handleNewRun}>
              <span className="text-sm font-normal">+ New Run</span>
            </Button>
          </div>
          <div
            className="border border-gray-200 rounded-lg overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(75vh)' }}
          >
            <div className="overflow-y-auto">
              {isLoadingRuns ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  Loading...
                </div>
              ) : agentRuns.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No runs yet
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {agentRuns.map((run) => (
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

        {/* Middle: Chat Conversation */}
        <div className="space-y-4 flex flex-col">
          <h2 className="text-lg font-medium text-gray-900">Conversation</h2>
          <div
            className="border border-gray-200 rounded-lg overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(75vh)' }}
          >
            <div className="overflow-y-auto p-4 space-y-4 flex-1">
              {isLoadingConversation ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-gray-500">Loading conversation...</div>
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-gray-500">
                    {conversationId
                      ? 'Start typing a message...'
                      : 'Click "New Run" to start a conversation'}
                  </div>
                </div>
              ) : (
                chatMessages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        message.role === 'user'
                          ? 'bg-blue-500 text-white'
                          : message.role === 'tool_call'
                            ? 'bg-gray-100 text-gray-700 border border-gray-300'
                            : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      <div className="text-sm">
                        {message.role === 'tool_call' ? (
                          <div className="flex items-center gap-2">
                            <Wrench className="w-4 h-4 text-blue-800" />
                            <span className="font-medium">
                              {message.content}
                            </span>
                          </div>
                        ) : message.role === 'assistant' ? (
                          <ReactMarkdown
                            components={{
                              // Style code blocks
                              code: ({
                                className,
                                children,
                                ...props
                              }: any) => {
                                const isInline = !className;
                                return isInline ? (
                                  <code
                                    className="bg-gray-100 rounded px-1 py-0.5 text-xs font-mono"
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                ) : (
                                  <pre className="bg-gray-100 rounded p-2 overflow-x-auto my-2">
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  </pre>
                                );
                              },
                              // Style paragraphs
                              p: ({ ...props }: any) => (
                                <p className="mb-2 last:mb-0" {...props} />
                              ),
                              // Style lists
                              ul: ({ ...props }: any) => (
                                <ul
                                  className="list-disc list-inside mb-2 space-y-1"
                                  {...props}
                                />
                              ),
                              ol: ({ ...props }: any) => (
                                <ol
                                  className="list-decimal list-inside mb-2 space-y-1"
                                  {...props}
                                />
                              ),
                              li: ({ ...props }: any) => (
                                <li className="ml-2" {...props} />
                              ),
                              // Style headings
                              h1: ({ ...props }: any) => (
                                <h1
                                  className="text-lg font-bold mb-2 mt-3 first:mt-0"
                                  {...props}
                                />
                              ),
                              h2: ({ ...props }: any) => (
                                <h2
                                  className="text-base font-bold mb-2 mt-3 first:mt-0"
                                  {...props}
                                />
                              ),
                              h3: ({ ...props }: any) => (
                                <h3
                                  className="text-sm font-bold mb-1 mt-2 first:mt-0"
                                  {...props}
                                />
                              ),
                              // Style blockquotes
                              blockquote: ({ ...props }: any) => (
                                <blockquote
                                  className="border-l-4 border-gray-300 pl-3 italic my-2"
                                  {...props}
                                />
                              ),
                              // Style links
                              a: ({ ...props }: any) => (
                                <a
                                  className="text-blue-600 underline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  {...props}
                                />
                              ),
                              // Style strong/bold
                              strong: ({ ...props }: any) => (
                                <strong className="font-semibold" {...props} />
                              ),
                              // Style emphasis/italic
                              em: ({ ...props }: any) => (
                                <em className="italic" {...props} />
                              ),
                              // Style horizontal rules
                              hr: ({ ...props }: any) => (
                                <hr
                                  className="my-3 border-gray-300"
                                  {...props}
                                />
                              ),
                              // Style tables
                              table: ({ ...props }: any) => (
                                <table
                                  className="border-collapse border border-gray-300 my-2"
                                  {...props}
                                />
                              ),
                              th: ({ ...props }: any) => (
                                <th
                                  className="border border-gray-300 px-2 py-1 bg-gray-100 font-semibold"
                                  {...props}
                                />
                              ),
                              td: ({ ...props }: any) => (
                                <td
                                  className="border border-gray-300 px-2 py-1"
                                  {...props}
                                />
                              ),
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {message.content}
                          </div>
                        )}
                      </div>
                      <div
                        className={`text-xs mt-1 ${
                          message.role === 'user'
                            ? 'text-blue-100'
                            : 'text-gray-500'
                        }`}
                      >
                        {new Date(message.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {conversationId && (
              <div className="border-t border-gray-200 p-4 bg-white">
                <div className="flex gap-2 items-end">
                  <textarea
                    placeholder="Type your message... (Shift+Enter for new line)"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        !e.shiftKey &&
                        inputMessage.trim() &&
                        !isSending
                      ) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[42px] max-h-[120px]"
                    disabled={isSending || !conversationId}
                    rows={1}
                    style={{
                      height: 'auto',
                      minHeight: '42px',
                    }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                    }}
                  />
                  <Button
                    variant="default"
                    onClick={handleSendMessage}
                    disabled={
                      !inputMessage.trim() || isSending || !conversationId
                    }
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    {isSending ? 'Sending...' : 'Send'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Agent Details */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Agent Details</h2>
          <div
            className="border border-gray-200 rounded-lg p-4 bg-gray-50 overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(75vh)' }}
          >
            <div className="overflow-y-auto space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Model
                </div>
                <div className="flex items-center gap-2">
                  <img
                    src={getProviderLogo(agent.provider)}
                    alt={agent.provider}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-900">{agent.model}</span>
                </div>
              </div>

              {agent.temperature !== undefined && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Temperature
                  </div>
                  <div className="text-sm text-gray-900">
                    {agent.temperature || 'Not specified'}
                  </div>
                </div>
              )}

              {agent.max_output_tokens !== undefined && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Max Output Tokens
                  </div>
                  <div className="text-sm text-gray-900">
                    {agent.max_output_tokens || 'Not specified'}
                  </div>
                </div>
              )}

              {agent.system_prompt && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    System Prompt
                  </div>
                  <div className="text-sm text-gray-900 whitespace-pre-wrap bg-white p-2 rounded border border-gray-200 max-h-64 overflow-y-auto">
                    {agent.system_prompt}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Tools
                </div>
                <div className="text-sm text-gray-900">{getToolCount()}</div>
                {agent.tools &&
                  Array.isArray(agent.tools) &&
                  agent.tools.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {agent.tools.map((tool: any, index: number) => {
                        // Check if tool has a "function" key
                        if (tool.function) {
                          const func = tool.function;
                          const description =
                            func.description || 'No description';
                          const parameters = func.parameters?.properties || {};
                          const paramNames = Object.keys(parameters);

                          return (
                            <div
                              key={index}
                              className="text-xs bg-white p-3 rounded border border-gray-200"
                            >
                              <div className="font-medium text-gray-900 mb-1">
                                {func.name || 'Unnamed Tool'}
                              </div>
                              <div className="text-gray-600 mb-2">
                                {description}
                              </div>
                              {paramNames.length > 0 && (
                                <div>
                                  <div className="text-gray-500 font-medium mb-1">
                                    Parameters:
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {paramNames.map((paramName: string) => (
                                      <span
                                        key={paramName}
                                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800"
                                      >
                                        {paramName}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // Fallback for tools without function structure
                        return (
                          <div
                            key={index}
                            className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-200"
                          >
                            {typeof tool === 'string'
                              ? tool
                              : tool.name || JSON.stringify(tool)}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>

              {agent.metadata && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Metadata
                  </div>
                  <div className="bg-white p-3 rounded border border-gray-200 space-y-3">
                    {agent.metadata.stop_conditions &&
                      Array.isArray(agent.metadata.stop_conditions) &&
                      agent.metadata.stop_conditions.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-gray-700 mb-1">
                            Stop Conditions
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {agent.metadata.stop_conditions.map(
                              (condition: string, index: number) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800"
                                >
                                  {condition}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    {agent.metadata.guardrails &&
                      Array.isArray(agent.metadata.guardrails) &&
                      agent.metadata.guardrails.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-gray-700 mb-1">
                            Guardrails
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {agent.metadata.guardrails.map(
                              (guardrail: string, index: number) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-800"
                                >
                                  {guardrail}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    {/* Show other metadata fields as JSON if they exist */}
                    {Object.keys(agent.metadata).filter(
                      (key) => key !== 'stop_conditions' && key !== 'guardrails'
                    ).length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-700 mb-1">
                          Other
                        </div>
                        <pre className="text-xs text-gray-900 max-h-32 overflow-y-auto">
                          {JSON.stringify(
                            Object.fromEntries(
                              Object.entries(agent.metadata).filter(
                                ([key]) =>
                                  key !== 'stop_conditions' &&
                                  key !== 'guardrails'
                              )
                            ),
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {agent.config && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Metadata
                  </div>
                  <pre className="text-xs text-gray-900 bg-white p-2 rounded border border-gray-200 max-h-32 overflow-y-auto">
                    {JSON.stringify(agent.config, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Deployment
                </div>
                <div className="text-sm text-gray-900 font-mono">
                  {agent.deployment_id}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
