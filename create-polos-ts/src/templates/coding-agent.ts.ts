import type { ProviderConfig } from '../providers.js';

export function codingAgentTemplate(provider: ProviderConfig): string {
  return `${provider.import};
import { defineAgent, maxSteps, sandboxTools } from '@polos/sdk';

const tools = sandboxTools({
  env: 'local',
  scope: 'session',
});

export const codingAgent = defineAgent({
  id: 'coding_agent',
  model: ${provider.call},
  systemPrompt: 'You are a coding agent with access to sandbox tools. Use your tools to read, write, and execute code.',
  tools,
  stopConditions: [maxSteps({ count: 30 })],
});
`;
}
