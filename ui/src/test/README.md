# UI Testing Guide

This project uses **Vitest** and **React Testing Library** for unit and integration testing of the Gypsum UI.

## Quick Start

```bash
# Run tests in watch mode (recommended during development)
npm test

# Run all tests once
npm run test:run

# Run tests with interactive UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

## Test Structure

Tests are co-located with their source files using the `.test.tsx` or `.test.ts` suffix:

```
src/
├── components/
│   ├── header/
│   │   ├── Header.tsx
│   │   └── Header.test.tsx
│   └── auth/
│       ├── ProtectedRoute.tsx
│       └── ProtectedRoute.test.tsx
├── pages/
│   └── agents/
│       ├── AgentRunsView.tsx
│       └── AgentRunsView.test.tsx
├── utils/
│   ├── formatter.ts
│   ├── formatter.test.ts
│   ├── timeFilters.ts
│   └── timeFilters.test.ts
├── lib/
│   ├── api.ts
│   └── api.test.ts
└── context/
    ├── AuthContext.tsx
    ├── AuthContext.test.tsx
    ├── ProjectContext.tsx
    └── ProjectContext.test.tsx
```

## Test Utilities

### Custom Render Function

The `render` function from `@/test/utils` automatically wraps components with required providers:

- `AuthProvider` - Authentication context
- `ProjectProvider` - Project selection context
- `MemoryRouter` - React Router for navigation testing

```typescript
import { render, screen } from '@/test/utils';
import { Header } from './Header';

describe('Header', () => {
  it('renders correctly', () => {
    render(<Header {...props} />);
    expect(screen.getByText('Agent Runs')).toBeInTheDocument();
  });
});
```

### Mock Data

Shared mock data is available in `@/test/mockData`:

```typescript
import {
  mockUser,
  mockProjects,
  mockWorkflowRun,
  mockWorkflowRuns,
} from '@/test/mockData';
```

Available mocks:

- `mockUser` - User object for authentication tests
- `mockProjects` - Array of project objects
- `mockWorkflowRun` - Single workflow run example
- `mockWorkflowRuns` - Array of workflow runs with different statuses

### Shared Test Utilities for Runs Views

For testing AgentRunsView, WorkflowRunsView, and ToolRunsView, use utilities from `@/test/runsViewUtils`:

```typescript
import { mockGetWorkflowRuns, mockCancelExecution } from '@/test/runsViewUtils';

// Mock API calls
const getRunsSpy = mockGetWorkflowRuns(mockWorkflowRuns);
const cancelSpy = mockCancelExecution(true); // true = success
```

## Writing Tests

### Component Tests

Example from `Header.test.tsx`:

```typescript
import { render, screen } from '@/test/utils';
import { Header } from './Header';
import { mockUser, mockProjects } from '@/test/mockData';

describe('Header', () => {
  it('renders logo with correct alt text', () => {
    render(
      <Header
        user={mockUser}
        projects={mockProjects}
        selectedProjectId="project-1"
        onProjectChange={vi.fn()}
      />
    );
    const logo = screen.getByAltText('Polos');
    expect(logo).toBeInTheDocument();
  });
});
```

### API Function Tests

Example from `api.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { api, getJSON, postJSON } from './api';

describe('api', () => {
  it('cancels execution correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    global.fetch = mockFetch;

    await api.cancelExecution('project-123', 'exec-456');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/executions/exec-456/cancel'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Project-ID': 'project-123',
        }),
      })
    );
  });
});
```

### Utility Function Tests

Example from `formatter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatDuration, formatCost } from './formatter';

describe('formatter', () => {
  it('formats duration correctly', () => {
    const start = '2026-01-15T10:00:00Z';
    const end = '2026-01-15T10:05:30Z';
    expect(formatDuration(start, end)).toBe('5m 30s');
  });

  it('handles edge cases', () => {
    expect(formatCost(undefined)).toBe('-');
    expect(formatCost(0.00005)).toBe('<$0.0001');
  });
});
```

### Context Provider Tests

Example from `AuthContext.test.tsx`:

```typescript
import { render, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

describe('AuthContext', () => {
  it('initializes with null user', async () => {
    const TestComponent = () => {
      const { user, loading } = useAuth();
      return (
        <div>
          <div data-testid="user">{user ? 'authenticated' : 'null'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'not-loading'}</div>
        </div>
      );
    };

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId('user')).toHaveTextContent('null');
    });
  });
});
```

### Testing Runs Views

Example from `AgentRunsView.test.tsx`:

```typescript
import { render, screen, waitFor } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { AgentRunsView } from './AgentRunsView';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    getWorkflowRuns: vi.fn(),
    cancelExecution: vi.fn(),
  },
}));

describe('AgentRunsView', () => {
  it('shows cancel button on hover for running status', async () => {
    const user = userEvent.setup();
    const runsWithRunning = [{
      id: 'run-1',
      root_execution_id: 'exec-1',
      status: 'running',
      // ... other fields
    }];

    vi.mocked(api.getWorkflowRuns).mockResolvedValue(runsWithRunning);

    render(<AgentRunsView />);

    await waitFor(() => {
      expect(screen.getByText('Agent Runs')).toBeInTheDocument();
    });

    const statusCell = screen.getByText('running').closest('td');
    if (statusCell) {
      await user.hover(statusCell);
      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });
    }
  });
});
```

## Mocking Patterns

### Mocking Supabase (AuthContext)

```typescript
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getSession: () => mockGetSession(),
        onAuthStateChange: () => mockOnAuthStateChange(),
      },
    },
  };
});

// In tests
mockGetSession.mockResolvedValue({
  data: { session: null },
  error: null,
});
```

### Mocking API Functions

```typescript
vi.mock('@/lib/api', () => ({
  api: {
    getWorkflowRuns: vi.fn(),
    cancelExecution: vi.fn(),
    getTraces: vi.fn(),
  },
  getJSON: vi.fn(),
  postJSON: vi.fn(),
}));

const mockApi = vi.mocked(api);
mockApi.getWorkflowRuns.mockResolvedValue([]);
```

### Mocking React Router

```typescript
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});
```

## Coverage

Coverage threshold is set to **80%** for:

- Lines
- Functions
- Branches
- Statements

Generate coverage report:

```bash
npm run test:coverage
```

Then open `coverage/index.html` in your browser to view the detailed report.

## Test Files Organization

- `src/test/setup.ts` - Global test setup (MSW, mocks, cleanup)
- `src/test/mocks/server.ts` - MSW server configuration
- `src/test/mocks/handlers.ts` - Default API mock handlers
- `src/test/utils.tsx` - Custom render function and test utilities
- `src/test/mockData.ts` - Shared mock data
- `src/test/runsViewUtils.tsx` - Utilities for testing Runs views

## Best Practices

1. **Test user behavior**, not implementation details
2. **Use semantic queries** (`getByRole`, `getByLabelText`) over `getByTestId`
3. **Mock external dependencies** (API calls, Supabase, browser APIs)
4. **Keep tests focused** - one assertion per test when possible
5. **Use descriptive test names** that explain what is being tested
6. **Use shared mock data** from `@/test/mockData` for consistency
7. **Wait for async operations** using `waitFor` from React Testing Library
8. **Clean up mocks** in `beforeEach`/`afterEach` hooks

## Common Patterns

### Testing Async State Updates

```typescript
await waitFor(() => {
  expect(screen.getByText('Expected Text')).toBeInTheDocument();
});
```

### Testing User Interactions

```typescript
const user = userEvent.setup();
await user.click(button);
await user.type(input, 'text');
await user.hover(element);
```

### Testing Error States

```typescript
mockApi.getWorkflowRuns.mockRejectedValue(new Error('Failed'));
await waitFor(() => {
  expect(screen.getByText(/Error:/)).toBeInTheDocument();
});
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [MSW Documentation](https://mswjs.io/)
- [Testing Library User Event](https://testing-library.com/docs/user-event/intro)
