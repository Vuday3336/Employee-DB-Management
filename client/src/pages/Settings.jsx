import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Moon, Sun, UserRound } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Avatar, Card, ErrorNote, Spinner, humanise } from '../components/ui';

export default function Settings() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme, toast } = useUI();
  const navigate = useNavigate();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));

  const changePassword = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError('The two new passwords do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch('/auth/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast('Password changed — please sign in again');
      // The server bumped tokenVersion, so every session including this one is dead.
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const displayName = user?.employee?.fullName || user?.email;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Settings</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">Your account, security and display preferences.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <div className="flex items-center gap-4">
            <Avatar name={displayName} src={user?.employee?.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">{displayName}</p>
              <p className="truncate text-sm text-ink-500 dark:text-ink-400">{user?.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">
                  {humanise(user?.role || '')}
                </span>
                {user?.employee?.jobTitle && (
                  <span className="badge bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                    {user.employee.jobTitle}
                  </span>
                )}
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Contact details are edited on your employee record. Job title, department and salary are changed by
            HR — the API refuses those fields from your role.
          </p>
        </Card>

        <Card title="Appearance">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Theme</p>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                Currently {theme}. The preference is stored in this browser.
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              Switch to {theme === 'dark' ? 'light' : 'dark'}
            </button>
          </div>
        </Card>
      </div>

      <Card title="Change password" className="max-w-xl">
        <form onSubmit={changePassword} className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Changing your password revokes every active session, including this one. You will be asked to sign
            in again.
          </p>

          <div>
            <label className="label" htmlFor="current">Current password</label>
            <input
              id="current"
              type="password"
              autoComplete="current-password"
              className="input"
              required
              value={form.currentPassword}
              onChange={set('currentPassword')}
            />
          </div>
          <div>
            <label className="label" htmlFor="new">New password</label>
            <input
              id="new"
              type="password"
              autoComplete="new-password"
              className="input"
              required
              value={form.newPassword}
              onChange={set('newPassword')}
            />
            <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
              At least 8 characters with an uppercase letter, a lowercase letter and a number.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              className="input"
              required
              value={form.confirm}
              onChange={set('confirm')}
            />
          </div>

          <ErrorNote message={error} />

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Update password
          </button>
        </form>
      </Card>
    </div>
  );
}
