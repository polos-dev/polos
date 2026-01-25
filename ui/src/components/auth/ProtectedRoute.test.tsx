import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import * as localMode from '@/lib/localMode';

// Use vi.hoisted to properly hoist the mock function
const { mockUseAuth } = vi.hoisted(() => {
  return {
    mockUseAuth: vi.fn(),
  };
});

vi.mock('@/context/AuthContext', () => {
  return {
    useAuth: mockUseAuth,
  };
});

// Mock localMode
vi.mock('@/lib/localMode', () => ({
  isLocalMode: vi.fn(),
}));

// Mock Navigate to avoid redirect issues in tests
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate" data-to={to}>
        Navigate to {to}
      </div>
    ),
  };
});

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localMode.isLocalMode).mockReturnValue(false);
  });

  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'test@example.com' },
      loading: false,
      signIn: vi.fn(),
      signInWithProvider: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateUserProfile: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to /sign-in when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signInWithProvider: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateUserProfile: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    // Should show Navigate component
    expect(screen.getByTestId('navigate')).toBeInTheDocument();
    expect(screen.getByTestId('navigate')).toHaveAttribute(
      'data-to',
      '/sign-in'
    );
    // Protected content should not be shown
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('shows loading state while auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      signIn: vi.fn(),
      signInWithProvider: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateUserProfile: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('bypasses auth in local mode', () => {
    vi.mocked(localMode.isLocalMode).mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      signIn: vi.fn(),
      signInWithProvider: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateUserProfile: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    // Should render children even though user is null and loading is true
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('bypasses auth in local mode even when not loading', () => {
    vi.mocked(localMode.isLocalMode).mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signInWithProvider: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateUserProfile: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
