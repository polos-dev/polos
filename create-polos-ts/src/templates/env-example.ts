import type { ProviderConfig } from '../providers.js';

export function envExampleTemplate(provider: ProviderConfig): string {
  return `${provider.envVar}=${provider.envPlaceholder}
`;
}
