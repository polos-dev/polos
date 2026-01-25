import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isLocalMode } from '@/lib/localMode';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // In local mode, skip auth checks (dummy user is always provided)
  if (isLocalMode()) {
    return <>{children}</>;
  }

  if (loading) {
    return <div className="p-4">Loading…</div>;
  }

  if (!user) {
    // redirect to sign-in and preserve attempted path
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};
