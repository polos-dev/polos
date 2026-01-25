import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as localMode from '@/lib/localMode';

// Mock dependencies
vi.mock('@/lib/localMode', () => ({
  isLocalMode: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getJSON: vi.fn(),
  postJSON: vi.fn(),
}));

// Create mock functions
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getSession: () => mockGetSession(),
        onAuthStateChange: () => mockOnAuthStateChange(),
        signInWithOAuth: () => mockSignInWithOAuth(),
        signOut: () => mockSignOut(),
      },
    },
  };
});

import { getJSON, postJSON } from '@/lib/api';

const mockGetJSON = vi.mocked(getJSON);
const mockPostJSON = vi.mocked(postJSON);

// Mock fetch for OAuth sync
global.fetch = vi.fn();

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localMode.isLocalMode).mockReturnValue(false);
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('initializes with null user and loading=true', async () => {
      mockGetJSON.mockRejectedValue(new Error('Not authenticated'));

      const TestComponent = () => {
        const { user, loading } = useAuth();
        return (
          <div>
            <div data-testid="user">{user ? 'authenticated' : 'null'}</div>
            <div data-testid="loading">
              {loading ? 'loading' : 'not-loading'}
            </div>
          </div>
        );
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Initially loading
      expect(getByTestId('loading')).toHaveTextContent('loading');

      await waitFor(() => {
        expect(getByTestId('loading')).toHaveTextContent('not-loading');
        expect(getByTestId('user')).toHaveTextContent('null');
      });
    });

    it('sets user from local auth when session exists', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
      };

      mockGetJSON.mockResolvedValue(mockUser);

      const TestComponent = () => {
        const { user } = useAuth();
        return <div data-testid="user">{user?.email || 'null'}</div>;
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('user')).toHaveTextContent('test@example.com');
      });
    });

    it('sets user from Supabase OAuth session', async () => {
      const mockSession = {
        user: {
          id: 'oauth-user-1',
          email: 'oauth@example.com',
          user_metadata: { first_name: 'OAuth', last_name: 'User' },
        },
      };

      mockGetSession.mockResolvedValue({
        data: { session: mockSession as any },
        error: null,
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: 'user-1', email: 'oauth@example.com' },
        }),
      });
      global.fetch = mockFetch;

      const TestComponent = () => {
        const { user } = useAuth();
        return <div data-testid="user">{user?.email || 'null'}</div>;
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('user')).toHaveTextContent('oauth@example.com');
      });
    });

    it('uses dummy user in local mode', async () => {
      vi.mocked(localMode.isLocalMode).mockReturnValue(true);

      const TestComponent = () => {
        const { user } = useAuth();
        return <div data-testid="user">{user?.email || 'null'}</div>;
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('user')).toHaveTextContent('user@local');
      });
    });
  });

  describe('signIn', () => {
    it('updates user state on successful sign in', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
      };

      mockPostJSON.mockResolvedValue({});
      mockGetJSON.mockResolvedValue(mockUser);

      const TestComponent = () => {
        const { user, signIn } = useAuth();
        return (
          <div>
            <div data-testid="user">{user?.email || 'null'}</div>
            <button
              data-testid="signin"
              onClick={() => signIn('test@example.com', 'password')}
            >
              Sign In
            </button>
          </div>
        );
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const button = getByTestId('signin');
      button.click();

      await waitFor(() => {
        expect(getByTestId('user')).toHaveTextContent('test@example.com');
      });
    });

    it('throws error on failed sign in', async () => {
      mockPostJSON.mockRejectedValue(new Error('Invalid credentials'));

      const TestComponent = () => {
        const { signIn } = useAuth();
        const [error, setError] = React.useState<string | null>(null);

        return (
          <div>
            <button
              data-testid="signin"
              onClick={async () => {
                try {
                  await signIn('test@example.com', 'wrong');
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Sign In
            </button>
            <div data-testid="error">{error || 'no-error'}</div>
          </div>
        );
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      const button = getByTestId('signin');
      button.click();

      await waitFor(() => {
        expect(getByTestId('error')).toHaveTextContent('Invalid credentials');
      });
    });
  });

  describe('signOut', () => {
    it('clears user state on sign out', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
      };

      mockGetJSON.mockResolvedValue(mockUser);
      mockPostJSON.mockResolvedValue({});
      mockSignOut.mockResolvedValue({ error: null } as any);

      const TestComponent = () => {
        const { user, signOut } = useAuth();
        return (
          <div>
            <div data-testid="user">{user?.email || 'null'}</div>
            <button data-testid="signout" onClick={signOut}>
              Sign Out
            </button>
          </div>
        );
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for initial user load
      await waitFor(() => {
        expect(getByTestId('user')).toHaveTextContent('test@example.com');
      });

      const button = getByTestId('signout');
      button.click();

      await waitFor(() => {
        expect(getByTestId('user')).toHaveTextContent('null');
      });
    });
  });

  describe('updateUserProfile', () => {
    it('updates user data', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        first_name: 'Test',
      };

      mockGetJSON.mockResolvedValue(mockUser);

      const TestComponent = () => {
        const { user, updateUserProfile } = useAuth();
        return (
          <div>
            <div data-testid="user-name">{user?.first_name || 'null'}</div>
            <button
              data-testid="update"
              onClick={() =>
                updateUserProfile({ ...user!, first_name: 'Updated' })
              }
            >
              Update
            </button>
          </div>
        );
      };

      const { getByTestId } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('user-name')).toHaveTextContent('Test');
      });

      const user = userEvent.setup();
      const button = getByTestId('update');
      await user.click(button);

      // Wait for the state update to complete
      await waitFor(
        () => {
          expect(getByTestId('user-name')).toHaveTextContent('Updated');
        },
        { timeout: 1000 }
      );
    });
  });
});
