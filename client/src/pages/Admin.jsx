import { useState } from 'react';
import { CalendarOff, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import {
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  Pagination,
  Spinner,
  humanise,
} from '../components/ui';
import { fmtDate, fromNow, inputDate } from '../lib/format';

const TABS = [
  { id: 'users', label: 'User accounts', icon: UserCog },
  { id: 'policies', label: 'Leave policies', icon: ShieldCheck },
  { id: 'holidays', label: 'Public holidays', icon: CalendarOff },
];

export default function Admin() {
  const [tab, setTab] = useState('users');

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Administration</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Accounts, leave policy and the holiday calendar that the working-day calculation reads from.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-ink-200 dark:border-ink-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === id
                ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'holidays' && <HolidaysTab />}
    </div>
  );
}

/* ------------------------------- users ---------------------------------- */

function UsersTab() {
  const { user: me } = useAuth();
  const { toast } = useUI();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const { data: users, meta, loading, error, refetch } = useFetch(`/users?page=${page}&limit=10`, { deps: [page] });

  const changeRole = async (target, role) => {
    try {
      await api.patch(`/users/${target._id}/role`, { role });
      toast(`${target.email} is now ${role}`);
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const toggleActive = async (target) => {
    try {
      await api.patch(`/users/${target._id}/status`, { isActive: !target.isActive });
      toast(`${target.email} ${target.isActive ? 'deactivated' : 'reactivated'}`);
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-ink-200 p-4 dark:border-ink-800">
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Changing a role or disabling an account revokes its live sessions immediately.
        </p>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New account
        </button>
      </div>

      {error && <div className="p-4"><ErrorNote message={error} onRetry={refetch} /></div>}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem]">
            <thead className="border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-950/40">
              <tr>
                <th className="th">Email</th>
                <th className="th">Linked employee</th>
                <th className="th">Role</th>
                <th className="th">Last sign-in</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
              {(users || []).map((row) => {
                const isMe = String(row._id) === String(me.id);
                return (
                  <tr key={row._id}>
                    <td className="td font-medium text-ink-900 dark:text-ink-50">
                      {row.email}
                      {isMe && <span className="ml-2 text-xs text-ink-400">(you)</span>}
                    </td>
                    <td className="td">
                      {row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : '—'}
                    </td>
                    <td className="td">
                      <select
                        className="input w-auto py-1 text-xs"
                        value={row.role}
                        disabled={isMe}
                        onChange={(e) => changeRole(row, e.target.value)}
                        aria-label={`Role for ${row.email}`}
                      >
                        {['admin', 'manager', 'employee'].map((r) => (
                          <option key={r} value={r}>{humanise(r)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="td whitespace-nowrap">{row.lastLoginAt ? fromNow(row.lastLoginAt) : 'Never'}</td>
                    <td className="td">
                      <button
                        type="button"
                        disabled={isMe}
                        onClick={() => toggleActive(row)}
                        className={`badge ${
                          row.isActive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
                        } ${isMe ? 'opacity-60' : 'hover:opacity-80'}`}
                      >
                        {row.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination meta={meta} onPage={setPage} />

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          refetch();
        }}
      />
    </Card>
  );
}

function CreateUserModal({ open, onClose, onCreated }) {
  const { toast } = useUI();
  const [form, setForm] = useState({ email: '', password: '', role: 'employee', employee: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: employees } = useFetch('/employees/lookup', { enabled: open, deps: [open] });

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/users', { ...form, employee: form.employee || undefined });
      toast(`Account created for ${form.email}`);
      setForm({ email: '', password: '', role: 'employee', employee: '' });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a login account"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="create-user" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Create account
          </button>
        </>
      }
    >
      <form id="create-user" onSubmit={submit} className="space-y-4">
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
          This is the only route that can mint a manager or admin account — self-registration always produces an
          employee.
        </p>
        <div>
          <label className="label" htmlFor="u-email">Email</label>
          <input id="u-email" type="email" className="input" required value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label" htmlFor="u-password">Password</label>
          <input
            id="u-password"
            type="text"
            className="input"
            required
            value={form.password}
            onChange={set('password')}
            placeholder="Min 8 chars, upper + lower + number"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="u-role">Role</label>
            <select id="u-role" className="input" value={form.role} onChange={set('role')}>
              {['employee', 'manager', 'admin'].map((r) => (
                <option key={r} value={r}>{humanise(r)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="u-employee">Link to employee</label>
            <select id="u-employee" className="input" value={form.employee} onChange={set('employee')}>
              <option value="">Not linked</option>
              {(employees || []).map((e) => (
                <option key={e._id} value={e._id}>{e.name}</option>
              ))}
            </select>
          </div>
        </div>
        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}

/* ------------------------------ policies -------------------------------- */

function PoliciesTab() {
  const { toast } = useUI();
  const { data: policies, loading, refetch } = useFetch('/leave-policies');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put('/leave-policies', {
        ...editing,
        annualQuota: Number(editing.annualQuota),
        maxCarryForward: Number(editing.maxCarryForward),
        maxConsecutiveDays: Number(editing.maxConsecutiveDays),
        minNoticeDays: Number(editing.minNoticeDays),
      });
      toast(`${editing.label} updated`);
      setEditing(null);
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead className="border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-950/40">
              <tr>
                <th className="th">Policy</th>
                <th className="th">Annual quota</th>
                <th className="th">Carry forward</th>
                <th className="th">Max consecutive</th>
                <th className="th">Notice</th>
                <th className="th">Paid</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
              {(policies || []).map((policy) => (
                <tr key={policy._id}>
                  <td className="td font-medium text-ink-900 dark:text-ink-50">{policy.label}</td>
                  <td className="td">{policy.annualQuota} days</td>
                  <td className="td">{policy.maxCarryForward} days</td>
                  <td className="td">{policy.maxConsecutiveDays} days</td>
                  <td className="td">{policy.minNoticeDays} days</td>
                  <td className="td">{policy.isPaid ? 'Yes' : 'No'}</td>
                  <td className="td text-right">
                    <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(policy)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={`Edit ${editing.label}`}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" form="edit-policy" className="btn-primary" disabled={busy}>
                {busy && <Spinner className="h-4 w-4" />} Save policy
              </button>
            </>
          }
        >
          <form id="edit-policy" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            {[
              ['annualQuota', 'Annual quota (days)'],
              ['maxCarryForward', 'Max carry forward'],
              ['maxConsecutiveDays', 'Max consecutive days'],
              ['minNoticeDays', 'Minimum notice (days)'],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="label" htmlFor={`p-${field}`}>{label}</label>
                <input
                  id={`p-${field}`}
                  type="number"
                  min="0"
                  className="input"
                  value={editing[field]}
                  onChange={(e) => setEditing((c) => ({ ...c, [field]: e.target.value }))}
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={editing.isPaid}
                onChange={(e) => setEditing((c) => ({ ...c, isPaid: e.target.checked }))}
              />
              Paid leave (consumes balance)
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={editing.accrues}
                onChange={(e) => setEditing((c) => ({ ...c, accrues: e.target.checked }))}
              />
              Accrues monthly
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------ holidays -------------------------------- */

function HolidaysTab() {
  const { toast } = useUI();
  const year = new Date().getFullYear();
  const { data: holidays, loading, refetch } = useFetch(`/holidays?year=${year}`);
  const [form, setForm] = useState({ name: '', date: inputDate(new Date()) });
  const [busy, setBusy] = useState(false);

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/holidays', form);
      toast(`${form.name} added`);
      setForm({ name: '', date: inputDate(new Date()) });
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (holiday) => {
    if (!window.confirm(`Remove ${holiday.name}?`)) return;
    try {
      await api.delete(`/holidays/${holiday._id}`);
      toast('Holiday removed');
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={`Holidays in ${year}`} className="lg:col-span-2" padded={false}>
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : holidays?.length ? (
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {holidays.map((holiday) => (
              <li key={holiday._id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{holiday.name}</p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">{fmtDate(holiday.date)}</p>
                </div>
                <button
                  type="button"
                  className="btn-ghost p-2 text-red-600"
                  onClick={() => remove(holiday)}
                  aria-label={`Remove ${holiday.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No holidays configured" icon={CalendarOff} />
        )}
      </Card>

      <Card title="Add a holiday">
        <form onSubmit={add} className="space-y-4">
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Holidays are excluded from leave-day counts and skipped by the auto-absent job.
          </p>
          <div>
            <label className="label" htmlFor="h-name">Name</label>
            <input
              id="h-name"
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="h-date">Date</label>
            <input
              id="h-date"
              type="date"
              className="input"
              required
              value={form.date}
              onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Add holiday
          </button>
        </form>
      </Card>
    </div>
  );
}
