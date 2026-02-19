import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import { providers } from './providers.js';
import { generateFiles, scaffoldProject, installDependencies } from './scaffold.js';

async function main(): Promise<void> {
  p.intro('Create a new Polos project');

  const projectName = await p.text({
    message: 'What is your project name?',
    placeholder: 'my-polos-project',
    defaultValue: 'my-polos-project',
    validate(value) {
      if (!value) return 'Project name is required';
      if (!/^[a-z0-9@][a-z0-9._\-/]*$/.test(value)) {
        return 'Invalid project name — use lowercase letters, numbers, hyphens, and dots';
      }
    },
  });

  if (p.isCancel(projectName)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const providerValue = await p.select({
    message: 'Which LLM provider do you want to use?',
    options: providers.map((prov) => ({
      label: prov.label,
      value: prov.value,
    })),
    initialValue: 'anthropic',
  });

  if (p.isCancel(providerValue)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const provider = providers.find((prov) => prov.value === providerValue)!;
  const projectDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(projectDir)) {
    p.cancel(`Directory "${projectName}" already exists.`);
    process.exit(1);
  }

  const s = p.spinner();

  s.start('Creating project files...');
  const files = generateFiles(projectName, provider);
  scaffoldProject(projectDir, files);
  s.stop('Installing project...');

  s.start('Installing dependencies...');
  const installed = installDependencies(projectDir);
  if (installed) {
    s.stop('Dependencies installed.');
  } else {
    s.stop('Could not install dependencies. Run `npm install` manually.');
  }

  p.outro(`Your project is ready!

  Next steps:
    cd ${projectName}
    cp .env.example .env     # add your ${provider.envVar}
    polos dev

  Common commands:
    polos agent list                         # list registered agents
    polos run assistant_agent                # chat with the assistant agent
    polos run assistant_agent --input "hi"   # one-shot mode`);
}

main().catch(console.error);
