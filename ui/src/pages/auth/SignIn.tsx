import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SHOW_SSO, OAUTH_PROVIDERS } from '@/config/authUI';
import { getProviderLogo } from '@/components/logos/ProviderLogo';

export default function SignIn() {
  const { signIn, signInWithProvider } = useAuth();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '');
    const password = String(fd.get('password') || '');
    setLoading(true);
    try {
      const me = await signIn(email, password);
      if (me) window.location.href = '/agents';
    } catch (e: any) {
      setErr(e.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuthSignIn(provider: 'google' | 'github') {
    setErr(null);
    setProviderLoading(provider);
    try {
      await signInWithProvider(provider);
      // Redirect happens automatically
    } catch (e: any) {
      setErr(e.message || `Sign in with ${provider} failed`);
      setProviderLoading(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center justify-center gap-2">
            Sign in to{' '}
            <img src="/polos-logo.png" alt="Polos" className="h-6 w-auto" />{' '}
            Polos
          </h1>
          <p className="mt-1 text-sm text-gray-500">Welcome back.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"
                  >
                    {showPw ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>

              {err && (
                <div className="text-sm text-red-600 text-center">{err}</div>
              )}
            </form>

            {SHOW_SSO && (
              <>
                <div className="my-6 flex items-center gap-2 text-sm text-gray-500">
                  <div className="flex-1 h-px bg-gray-200" />
                  or continue with
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={loading}
                    onClick={() => signInWithProvider('google')}
                  >
                    <img
                      src={getProviderLogo('google')}
                      alt="Google"
                      className="w-4 h-4"
                    />
                    Google
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={loading}
                    onClick={() => signInWithProvider('github')}
                  >
                    <img
                      src={getProviderLogo('github')}
                      alt="GitHub"
                      className="w-4 h-4"
                    />
                    GitHub
                  </Button>
                </div>
              </>
            )}

            <p className="mt-6 text-center text-sm text-gray-500">
              No account?{' '}
              <Link
                to="/sign-up"
                className="font-medium text-blue-600 hover:underline"
              >
                Create one
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
