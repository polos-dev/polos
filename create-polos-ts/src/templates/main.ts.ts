export function mainTsTemplate(): string {
  return `import 'dotenv/config';
import { Polos } from '@polos/sdk';

// Import agents and workflows for registration
import './agents/coding-agent.js';
import './agents/assistant-agent.js';
import './workflows/text-review/agents.js';
import './workflows/text-review/workflow.js';

const polos = new Polos();

console.log('');
console.log('\\x1b[1mPolos worker starting...\\x1b[0m');
console.log('');
console.log(\`  UI:        \${process.env.POLOS_UI_URL || 'http://localhost:5173'}\`);
console.log('');
console.log('  Run an agent:');
console.log('    polos run assistant_agent');
console.log('    polos run coding_agent --input "Write a hello world script"');
console.log('');
console.log('  Run a workflow:');
console.log('    polos invoke text_review --input "Your text here"');
console.log('');

await polos.serve();
`;
}
