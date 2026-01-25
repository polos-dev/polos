import React, { createContext, useContext, useEffect, useState } from 'react';
import { getJSON, postJSON } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import type { ProjectMembership } from '@/types/models';
import { isLocalMode } from '@/lib/localMode';

type UserInfo = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  created_at?: string;
  updated_at?: string;
  projects?: ProjectMembership[];
};

type AuthContextType = {
  user: UserInfo | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<UserInfo | null>;
  signInWithProvider: (provider: 'google' | 'github') => Promise<void>;
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => Promise<UserInfo | null>;
  signOut: () => Promise<void>;
  updateUserProfile: (userData: UserInfo) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

// Dummy user object for local mode
const LOCAL_MODE_DUMMY_USER: UserInfo = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'user@local',
  display_name: 'user',
  first_name: 'user',
  last_name: '',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  projects: [],
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Check for existing session on load
  useEffect(() => {
    async function checkAuth() {
      setLoading(true);

      // If local mode is enabled, skip all auth checks and use dummy user
      if (isLocalMode()) {
        setUser(LOCAL_MODE_DUMMY_USER);
        setLoading(false);
        return;
      }

      try {
        // First check for Supabase session
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          // User is logged in via OAuth
          await syncOAuthUser(session);
        } else {
          // Check for local authentication
          try {
            const localUser = await getJSON('/api/v1/auth/me');
            if (localUser) {
              setUser(localUser as UserInfo);
            }
          } catch (err) {
            // No local auth session either
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    checkAuth();

    // Listen for Supabase auth changes (only if not in local mode)
    let subscription: any = null;
    if (!isLocalMode()) {
      const {
        data: { subscription: sub },
      } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session) {
          await syncOAuthUser(session);
        }
      });
      subscription = sub;
    }

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  // Sync OAuth user with backend
  async function syncOAuthUser(session: Session) {
    // If we're already syncing, don't start another sync
    if (isSyncing) return;

    try {
      setIsSyncing(true);

      // Send the OAuth token to your backend for validation/syncing
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/oauth-signin`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            provider: 'supabase',
            user_id: session.user.id,
            email: session.user.email,
            first_name: session.user.user_metadata?.first_name,
            last_name: session.user.user_metadata?.last_name,
          }),
        }
      );

      if (response.ok) {
        const userData = await response.json();
        setUser(userData.user);
      } else {
        throw new Error('Failed to sync OAuth user with backend');
      }
    } catch (error) {
      console.error('Error syncing OAuth user:', error);
      await supabase.auth.signOut(); // Sign out from Supabase if backend sync fails
      setUser(null);
    } finally {
      setIsSyncing(false);
    }
  }

  async function signIn(email: string, password: string) {
    try {
      await postJSON('/api/v1/auth/signin', { email, password });
      const userData = await getJSON<UserInfo>('/api/v1/auth/me');
      setUser(userData);
      return userData;
    } catch (error: any) {
      throw new Error(error.message || 'Sign in failed');
    }
  }

  // OAuth sign in with Supabase
  async function signInWithProvider(provider: 'google' | 'github') {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/agents`,
        },
      });

      if (error) throw new Error(error.message);
    } catch (error: any) {
      throw new Error(error.message || `Sign in with ${provider} failed`);
    }
  }

  const signUp = async (
    firstName: string,
    email: string,
    password: string,
    lastName = ''
  ): Promise<UserInfo> => {
    await postJSON('/api/v1/auth/signup', {
      first_name: firstName,
      last_name: lastName,
      email,
      password,
    });

    // sign in & return the user
    const userData = await signIn(email, password);
    return userData;
  };

  const signOut = async () => {
    try {
      await postJSON('/api/v1/auth/signout', {});

      // Also sign out from Supabase if needed
      await supabase.auth.signOut();

      setUser(null);
    } catch (error: any) {
      console.error('Sign out error:', error);
      throw new Error(error.message || 'Sign out failed');
    }
  };

  const updateUserProfile = (userData: UserInfo) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signInWithProvider,
        signUp,
        signOut,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
