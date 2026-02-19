export interface ProviderConfig {
  label: string;
  value: string;
  import: string;
  call: string;
  package: string;
  packageVersion: string;
  envVar: string;
  envPlaceholder: string;
}

export const providers: ProviderConfig[] = [
  {
    label: 'Anthropic',
    value: 'anthropic',
    import: `import { anthropic } from '@ai-sdk/anthropic'`,
    call: `anthropic('claude-sonnet-4-5')`,
    package: '@ai-sdk/anthropic',
    packageVersion: '^3.0.0',
    envVar: 'ANTHROPIC_API_KEY',
    envPlaceholder: 'sk-ant-...',
  },
  {
    label: 'OpenAI',
    value: 'openai',
    import: `import { openai } from '@ai-sdk/openai'`,
    call: `openai('gpt-4o-mini')`,
    package: '@ai-sdk/openai',
    packageVersion: '^3.0.0',
    envVar: 'OPENAI_API_KEY',
    envPlaceholder: 'sk-...',
  },
  {
    label: 'Google Gemini',
    value: 'google',
    import: `import { google } from '@ai-sdk/google'`,
    call: `google('gemini-2.0-flash')`,
    package: '@ai-sdk/google',
    packageVersion: '^3.0.0',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    envPlaceholder: 'AIza...',
  },
];
