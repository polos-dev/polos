import type { ProviderConfig } from '../providers.js';

export function packageJsonTemplate(projectName: string, provider: ProviderConfig): string {
  return `{
  "name": ${JSON.stringify(projectName)},
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "polos dev",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "${provider.package}": "${provider.packageVersion}",
    "@polos/sdk": "latest",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
`;
}
