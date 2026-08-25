import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageLoader } from './ui';

/**
 * Front-end guards are a navigation convenience, not a security boundary — the API
 * re-checks every role and every record. They exist so users never land on a page
 * that would only render an error.
 */
export function RequireAuth() {
  const { user, booting } = useAuth();
  const location = useLocation();

  if (booting) return <PageLoader label="Restoring your session" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function RequireRole({ roles }) {
  const { user, booting } = useAuth();
  if (booting) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Forbidden roles={roles} />;
  return <Outlet />;
}

function Forbidden({ roles }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold text-ink-900 dark:text-ink-50">Not available for your role</h1>
      <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
        This page is limited to {roles.join(' and ')} accounts. The API enforces the same rule, so nothing
        here is hidden from you that you could otherwise reach.
      </p>
    </div>
  );
}

export function RedirectIfAuthed() {
  const { user, booting } = useAuth();
  if (booting) return <PageLoader label="Checking your session" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
