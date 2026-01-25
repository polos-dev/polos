import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectProvider, useProject } from './ProjectContext';

const STORAGE_KEY = 'selectedProjectId';

describe('ProjectContext', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('initializes from localStorage if available', () => {
    localStorage.setItem(STORAGE_KEY, 'project-from-storage');

    const TestComponent = () => {
      const { selectedProjectId } = useProject();
      return <div data-testid="project">{selectedProjectId}</div>;
    };

    const { getByTestId } = render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    expect(getByTestId('project')).toHaveTextContent('project-from-storage');
  });

  it('initializes empty if no localStorage value', () => {
    const TestComponent = () => {
      const { selectedProjectId } = useProject();
      return <div data-testid="project">{selectedProjectId || 'empty'}</div>;
    };

    const { getByTestId } = render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    expect(getByTestId('project')).toHaveTextContent('empty');
  });

  it('updates state when setSelectedProjectId is called', async () => {
    const user = userEvent.setup();
    const TestComponent = () => {
      const { selectedProjectId, setSelectedProjectId } = useProject();
      return (
        <div>
          <div data-testid="project">{selectedProjectId || 'empty'}</div>
          <button
            data-testid="set-project"
            onClick={() => setSelectedProjectId('new-project-id')}
          >
            Set Project
          </button>
        </div>
      );
    };

    const { getByTestId } = render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    expect(getByTestId('project')).toHaveTextContent('empty');

    const button = getByTestId('set-project');
    await user.click(button);

    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getByTestId('project')).toHaveTextContent('new-project-id');
  });

  it('syncs to localStorage when setSelectedProjectId is called', async () => {
    const user = userEvent.setup();
    const TestComponent = () => {
      const { setSelectedProjectId } = useProject();
      return (
        <button
          data-testid="set-project"
          onClick={() => setSelectedProjectId('synced-project-id')}
        >
          Set Project
        </button>
      );
    };

    const { getByTestId } = render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    const button = getByTestId('set-project');
    await user.click(button);

    // Wait for useEffect to sync to localStorage
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('synced-project-id');
  });

  it('removes from localStorage when project is cleared', async () => {
    localStorage.setItem(STORAGE_KEY, 'existing-project');

    const TestComponent = () => {
      const { setSelectedProjectId } = useProject();
      return (
        <button
          data-testid="clear-project"
          onClick={() => setSelectedProjectId('')}
        >
          Clear Project
        </button>
      );
    };

    const { getByTestId } = render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    expect(localStorage.getItem(STORAGE_KEY)).toBe('existing-project');

    const user = userEvent.setup();
    const button = getByTestId('clear-project');
    await user.click(button);

    // Wait for useEffect to clear localStorage
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const TestComponent = () => {
      useProject();
      return <div>Test</div>;
    };

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useProject must be used within a ProjectProvider');

    consoleError.mockRestore();
  });
});
