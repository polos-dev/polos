# Polos UI

The web interface for the Polos agent platform, built with React, TypeScript, and Vite.

## Overview

The Polos UI provides a comprehensive interface for managing and monitoring:
- **Agents** - AI agent definitions and executions
- **Workflows** - Workflow definitions and runs
- **Tools** - Tool definitions and executions
- **Traces** - Distributed tracing and observability

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Access to the Polos orchestrator API (default: `http://localhost:8080`)

### Installation

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The UI will be available at `http://localhost:5173` (or the next available port).

### Environment Variables

Create a `.env` file in the `ui/` directory:

```env
# API Base URL (default: http://localhost:8080)
VITE_API_BASE_URL=http://localhost:8080

# Supabase configuration (for OAuth authentication)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Local mode (skip authentication, for local/development mode)
VITE_POLOS_LOCAL_MODE=true
```

**Note:** Local mode only works when running on `localhost` and requires `VITE_POLOS_LOCAL_MODE=true`.

## Project Structure

```
ui/
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── auth/          # Authentication components
│   │   ├── header/        # Header/navigation
│   │   ├── traces/        # Trace visualization components
│   │   └── ui/            # Shadcn UI components
│   ├── pages/             # Page components
│   │   ├── agents/        # Agent management pages
│   │   ├── workflows/     # Workflow management pages
│   │   ├── tools/         # Tool management pages
│   │   ├── traces/        # Trace viewing pages
│   │   ├── auth/          # Authentication pages
│   │   ├── account/       # Account settings
│   │   └── projects/      # Project settings
│   ├── context/           # React context providers
│   │   ├── AuthContext.tsx    # Authentication state
│   │   └── ProjectContext.tsx # Project selection state
│   ├── lib/               # Utility libraries
│   │   ├── api.ts         # API client functions
│   │   ├── supabase.ts    # Supabase client
│   │   └── localMode.ts   # Local mode utilities
│   ├── utils/             # Utility functions
│   │   ├── formatter.ts   # Data formatting utilities
│   │   └── timeFilters.ts # Time range filtering
│   ├── types/             # TypeScript type definitions
│   ├── layouts/           # Layout components
│   └── test/              # Test utilities and mocks
├── public/                # Static assets
└── dist/                  # Build output (generated)
```

## Key Features

### Authentication

- **Local Authentication** - Email/password sign in and sign up
- **OAuth** - Google and GitHub authentication via Supabase
- **Local Mode** - Skip authentication for local development

### Project Management

- Multi-project support with project switching
- Project settings and API key management
- Project member management

### Agent/Workflow/Tool Management

- List views with filtering and search
- Run views showing execution history
- Detail pages for individual runs
- Trace visualization for debugging

### Observability

- Distributed tracing with timeline and graph views
- Span details with attributes, events, and errors
- LLM call tracking and visualization
- Error tracking and debugging

## Available Scripts

```bash
# Development
npm run dev          # Start development server

# Building
npm run build        # Build for production
npm run preview      # Preview production build

# Code Quality
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run format:check # Check code formatting

# Testing
npm test             # Run tests in watch mode
npm run test:run     # Run tests once
npm run test:ui      # Run tests with interactive UI
npm run test:coverage # Run tests with coverage report
```

## Building for Production

```bash
npm run build
```

The production build will be output to the `dist/` directory.

## Testing

The project uses **Vitest** and **React Testing Library** for testing. See [`src/test/README.md`](./src/test/README.md) for detailed testing documentation.

Quick start:
```bash
npm test              # Watch mode
npm run test:run      # Run once
npm run test:coverage # With coverage
```

## Code Formatting

Code is automatically formatted with **Prettier** before commits (via Husky + lint-staged). Manual formatting:

```bash
npm run format        # Format all files
npm run format:check  # Check formatting without changing files
```

## Technology Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Tailwind CSS** - Styling
- **Shadcn UI** - Component library
- **Vitest** - Testing framework
- **React Testing Library** - Component testing
- **MSW** - API mocking for tests
- **Supabase** - OAuth authentication

## Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow React best practices (hooks, functional components)
- Use Tailwind CSS for styling
- Use Shadcn UI components when available
- Format code with Prettier (auto-formatted on commit)

### Component Organization

- Co-locate components with their tests (`.test.tsx` files)
- Use the `@/` alias for imports from `src/`
- Keep components focused and reusable
- Use TypeScript interfaces for props

### API Integration

- All API calls go through `src/lib/api.ts`
- Use the `api` object for orchestration API calls
- Include `X-Project-ID` header for project-scoped requests
- Handle errors gracefully with user-friendly messages

### State Management

- Use React Context for global state (Auth, Project)
- Use local state (`useState`) for component-specific state
- Use `useEffect` for side effects and data fetching

## Troubleshooting

### Local Mode Not Working

Local mode only works when:
1. `VITE_POLOS_LOCAL_MODE=true` is set
2. The app is running on `localhost`, `127.0.0.1`, or `[::1]`

If local mode isn't working, check the browser console for warnings.

### API Connection Issues

- Verify `VITE_API_BASE_URL` is correct
- Check that the orchestrator is running
- Check browser console for CORS errors
- Verify authentication cookies are being set

### Build Errors

- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Clear Vite cache: `rm -rf node_modules/.vite`
- Check TypeScript errors: `npm run build` (shows TS errors)

## Contributing

1. Follow the code style guidelines
2. Write tests for new features
3. Ensure all tests pass: `npm run test:run`
4. Ensure code is formatted: `npm run format:check`
5. Ensure linting passes: `npm run lint`

## License

See the main project LICENSE file.
