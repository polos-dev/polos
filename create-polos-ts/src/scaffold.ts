import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ProviderConfig } from './providers.js';
import { packageJsonTemplate } from './templates/package-json.js';
import { tsconfigJsonTemplate } from './templates/tsconfig-json.js';
import { envExampleTemplate } from './templates/env-example.js';
import { gitignoreTemplate } from './templates/gitignore.js';
import { readmeTemplate } from './templates/readme.js';
import { mainTsTemplate } from './templates/main.ts.js';
import { codingAgentTemplate } from './templates/coding-agent.ts.js';
import { assistantAgentTemplate } from './templates/assistant-agent.ts.js';
import { textReviewAgentsTemplate } from './templates/text-review-agents.ts.js';
import { textReviewWorkflowTemplate } from './templates/text-review-workflow.ts.js';

interface FileEntry {
  path: string;
  content: string;
}

export function generateFiles(projectName: string, provider: ProviderConfig): FileEntry[] {
  return [
    { path: 'package.json', content: packageJsonTemplate(projectName, provider) },
    { path: 'tsconfig.json', content: tsconfigJsonTemplate() },
    { path: '.env.example', content: envExampleTemplate(provider) },
    { path: '.gitignore', content: gitignoreTemplate() },
    { path: 'README.md', content: readmeTemplate(projectName, provider) },
    { path: 'src/main.ts', content: mainTsTemplate() },
    { path: 'src/agents/coding-agent.ts', content: codingAgentTemplate(provider) },
    { path: 'src/agents/assistant-agent.ts', content: assistantAgentTemplate(provider) },
    { path: 'src/workflows/text-review/agents.ts', content: textReviewAgentsTemplate(provider) },
    { path: 'src/workflows/text-review/workflow.ts', content: textReviewWorkflowTemplate() },
  ];
}

export function scaffoldProject(projectDir: string, files: FileEntry[]): void {
  for (const file of files) {
    const filePath = path.join(projectDir, file.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content);
  }
}

export function installDependencies(projectDir: string): boolean {
  try {
    execSync('npm install', { cwd: projectDir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
