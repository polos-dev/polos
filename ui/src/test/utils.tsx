import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ProjectProvider } from '@/context/ProjectContext';

// Custom render function that includes providers
interface AllTheProvidersProps {
  children: React.ReactNode;
  initialEntries?: string[];
}

const AllTheProviders = ({
  children,
  initialEntries = ['/'],
}: AllTheProvidersProps) => {
  // Set a default project ID in localStorage for tests that need it
  if (
    typeof window !== 'undefined' &&
    !localStorage.getItem('selectedProjectId')
  ) {
    localStorage.setItem('selectedProjectId', 'test-project-id');
  }

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <ProjectProvider>{children}</ProjectProvider>
      </AuthProvider>
    </MemoryRouter>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & {
    initialEntries?: string[];
  }
) => {
  const { initialEntries, ...renderOptions } = options || {};

  return render(ui, {
    wrapper: (props) => (
      <AllTheProviders {...props} initialEntries={initialEntries} />
    ),
    ...renderOptions,
  });
};

// Re-export everything from React Testing Library
export * from '@testing-library/react';
export { customRender as render };

// Helper to create mock API responses
export const createMockResponse = <T,>(data: T, status = 200) => {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
};
