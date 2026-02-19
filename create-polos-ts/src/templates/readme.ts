import type { ProviderConfig } from '../providers.js';

export function readmeTemplate(projectName: string, provider: ProviderConfig): string {
  return `# ${projectName}

A Polos agent project using **${provider.label}**.

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Copy \`.env.example\` to \`.env\` and add your API keys:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

3. Start the development server:
   \`\`\`bash
   polos dev
   \`\`\`

## Project Structure

\`\`\`
src/
  main.ts                    # Entry point — imports agents, starts Polos
  agents/
    coding-agent.ts          # Coding agent with local sandbox tools
    assistant-agent.ts       # Assistant with sandbox tools + ask user
  workflows/
    text-review/
      agents.ts              # Grammar, tone, correctness, and editor agents
      workflow.ts            # Parallel review workflow
\`\`\`

## Agents

- **coding_agent** — A coding agent with local sandbox tools (exec, read, write, edit, glob, grep)
- **assistant_agent** — An assistant with sandbox tools and ask user

## Workflows

- **text_review** — A workflow that runs 3 reviewer agents in parallel, then a final editor agent
  - **grammar_review** — A grammar review agent
  - **tone_review** — A tone review agent
  - **correctness_review** — A correctness review agent
  - **editor_review** — An editor review agent

## Running an Agent

With \`polos dev\` running, open another terminal:

\`\`\`bash
# Interactive REPL
polos run assistant_agent

# One-shot
polos run assistant_agent --input "Summarize the latest news about AI"
\`\`\`

## Running a Workflow

\`\`\`bash
polos invoke text_review --input "The quick brown fox jumps over the lazy dog."

# Check result
polos result <execution-id>
\`\`\`

## Learn More

- [Polos Documentation](https://polos.dev/docs)
`;
}
