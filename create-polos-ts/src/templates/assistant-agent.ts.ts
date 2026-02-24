import type { ProviderConfig } from '../providers.js';

export function assistantAgentTemplate(provider: ProviderConfig): string {
  return `${provider.import};
import {
  defineAgent,
  maxSteps,
  sandboxTools,
} from '@polos/sdk';

const sandbox = sandboxTools({
  env: 'local',
  scope: 'session',
});

export const assistantAgent = defineAgent({
  id: 'assistant_agent',
  model: ${provider.call},
  systemPrompt: 'You are a helpful assistant with access to sandbox tools. Use your tools to help the user with their tasks.',
  tools: [...sandbox],
  stopConditions: [maxSteps({ count: 30 })],
});
`;
}
