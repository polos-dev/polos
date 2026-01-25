import React from 'react';
import type { Span } from '@/types/models';
import { getProviderLogo } from '../logos/ProviderLogo';

interface SpanLLMCallTabProps {
  span: Span;
}

export const SpanLLMCallTab: React.FC<SpanLLMCallTabProps> = ({ span }) => {
  // Extract model from span.output.model or span.input.kwargs.agent_config.model
  const provider = span.input?.kwargs?.agent_config?.provider;
  const model = span.output?.model || span.input?.kwargs?.agent_config?.model;

  // Extract input messages from span.input.kwargs.agent_config.messages
  const messages = span.input?.kwargs?.messages;

  // Extract response from span.output.content
  const response = span.output?.content;

  // Extract tools from span.input.kwargs.agent_config.tools
  const tools = span.input?.kwargs?.agent_config?.tools;

  // Extract tool calls from span.output.tool_calls
  const toolCalls = span.output?.tool_calls;

  return (
    <div className="p-3">
      {/* Model */}
      {model && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Model</h3>
          <div className="border border-gray-200 rounded-md overflow-hidden bg-gray-50">
            <div className="flex items-center gap-2 p-3">
              {provider && (
                <img
                  src={getProviderLogo(provider)}
                  alt={provider}
                  className="w-4 h-4"
                />
              )}
              <span className="text-xs">{model}</span>
            </div>
          </div>
        </div>
      )}

      {/* Input Messages */}
      {messages && Array.isArray(messages) && messages.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Input Messages</h3>
          <div className="space-y-2">
            {messages.map((message: any, index: number) => (
              <div
                key={index}
                className="border border-gray-200 rounded-md overflow-hidden bg-white"
              >
                <div className="p-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-700">
                    Message {index + 1}
                    {message.role && (
                      <span className="ml-2 text-gray-500">
                        ({message.role})
                      </span>
                    )}
                  </span>
                </div>
                <div className="p-3">
                  <pre className="text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {typeof message === 'object'
                      ? JSON.stringify(message, null, 2)
                      : String(message)}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response */}
      {response !== undefined && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Response</h3>
          <div className="border border-gray-200 rounded-md overflow-hidden bg-white">
            <pre className="p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {typeof response === 'object'
                ? JSON.stringify(response, null, 2)
                : String(response)}
            </pre>
          </div>
        </div>
      )}

      {/* Tool Calls */}
      {toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">
            Tool Calls from Response
          </h3>
          <div className="space-y-3">
            {toolCalls.map((toolCall: any, index: number) => (
              <div
                key={index}
                className="border border-gray-200 rounded-md overflow-hidden bg-white"
              >
                <div className="p-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-700">
                    {toolCall.function?.name || `Tool Call ${index + 1}`}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {toolCall.function?.arguments !== undefined && (
                    <div>
                      <pre className="text-xs overflow-auto max-h-32 whitespace-pre-wrap break-all">
                        {(() => {
                          try {
                            // Try to parse as JSON string first
                            const parsed =
                              typeof toolCall.function.arguments === 'string'
                                ? JSON.parse(toolCall.function.arguments)
                                : toolCall.function.arguments;
                            return JSON.stringify(parsed, null, 2);
                          } catch (e) {
                            // If parsing fails, just stringify the value
                            return typeof toolCall.function.arguments ===
                              'object'
                              ? JSON.stringify(
                                  toolCall.function.arguments,
                                  null,
                                  2
                                )
                              : String(toolCall.function.arguments);
                          }
                        })()}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tools */}
      {tools && Array.isArray(tools) && tools.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-1.5">Tools</h3>
          <div className="space-y-3">
            {tools.map((tool: any, index: number) => (
              <div
                key={index}
                className="border border-gray-200 rounded-md overflow-hidden bg-white"
              >
                <div className="p-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-700">
                    Tool {index + 1}
                  </span>
                  {tool.name && (
                    <span className="ml-2 text-xs text-gray-600 font-semibold">
                      {tool.name}
                    </span>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  {tool.parameters && (
                    <div>
                      <pre className="text-xs overflow-auto max-h-32 whitespace-pre-wrap break-all">
                        {typeof tool.parameters === 'object'
                          ? JSON.stringify(tool.parameters, null, 2)
                          : String(tool.parameters)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!model &&
        (!messages || !Array.isArray(messages) || messages.length === 0) &&
        response === undefined &&
        (!tools || !Array.isArray(tools) || tools.length === 0) &&
        (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) && (
          <div className="text-center py-8 text-sm text-gray-500">
            No LLM call data available for this span
          </div>
        )}
    </div>
  );
};
