import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, Eye, EyeOff, ShieldCheck, Users, CalendarCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';
import { ErrorNote, Spinner } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'aditi.rao@empcore.dev', blurb: 'Full org access, user management, audit trail' },
  { role: 'Manager', email: 'sofia.ramirez@empcore.dev', blurb: 'Own team only — approvals and reviews' },
  { role: 'Employee', email: 'wei.chen@empcore.dev', blurb: 'Own profile, attendance and leave' },
];
const DEMO_PASSWORD = 'Password@123';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = location.state?.from?.pathname || '/';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not sign you in'));
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (demoEmail) => {
    setMode('login');
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError('');
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Marketing panel — hidden on small screens so the form gets the full viewport. */}
      <div className="hidden flex-col justify-between bg-brand-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 font-bold">EC</span>
          <span className="text-lg font-semibold">EmpCore</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">
            The internal HR tool that replaced the spreadsheet.
          </h1>
          <p className="mt-3 text-brand-100">
            Employee records, attendance, leave workflow and performance reviews — with authorization
            enforced at the API, not just hidden in the interface.
          </p>

          <ul className="mt-8 space-y-4 text-sm">
            <li className="flex gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-brand-200" aria-hidden="true" />
              <span>Three roles, checked per record against the live reporting tree</span>
            </li>
            <li className="flex gap-3">
              <Users className="h-5 w-5 shrink-0 text-brand-200" aria-hidden="true" />
              <span>Soft deletes keep attendance and review history intact</span>
            </li>
            <li className="flex gap-3">
              <CalendarCheck className="h-5 w-5 shrink-0 text-brand-200" aria-hidden="true" />
              <span>Leave workflow with balances, overlap checks and an audit trail</span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-brand-200">MERN · JWT · MongoDB aggregation · Socket.IO</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-bold text-white">EC</span>
            <span className="text-lg font-semibold text-ink-900 dark:text-ink-50">EmpCore</span>
          </div>

          <h2 className="text-2xl font-semibold text-ink-900 dark:text-ink-50">
            {mode === 'login' ? 'Sign in' : 'Create an account'}
          </h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {mode === 'login'
              ? 'Use your work email to continue.'
              : 'New accounts always start with the employee role — an admin grants anything higher.'}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@empcore.dev"
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  className="input pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-400 hover:text-ink-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === 'register' && (
                <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                  At least 8 characters with an uppercase letter, a lowercase letter and a number.
                </p>
              )}
            </div>

            <ErrorNote message={error} />

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-ink-500 dark:text-ink-400">
            {mode === 'login' ? "Don't have an account?" : 'Already registered?'}{' '}
            <button
              type="button"
              className="font-medium text-brand-600 hover:underline dark:text-brand-300"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
            >
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>

          <div className="mt-8 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
              <Building2 className="h-4 w-4" aria-hidden="true" /> Demo accounts (after{' '}
              <code className="rounded bg-ink-100 px-1 text-xs dark:bg-ink-800">npm run seed</code>)
            </div>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => useDemo(account.email)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:border-ink-800 dark:hover:border-brand-600 dark:hover:bg-brand-500/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink-800 dark:text-ink-100">{account.role}</span>
                    <span className="text-xs text-ink-400">{account.email}</span>
                  </div>
                  <p className="text-xs text-ink-500 dark:text-ink-400">{account.blurb}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
