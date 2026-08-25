import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Users } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import { Avatar, EmptyState, ErrorNote, Modal, PageLoader, Spinner } from '../components/ui';

export default function Departments() {
  const { isAdmin } = useAuth();
  const { data: departments, loading, error, refetch } = useFetch('/departments');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Departments</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Headcount is computed live and excludes deactivated records.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New department
          </button>
        )}
      </header>

      {error && <ErrorNote message={error} onRetry={refetch} />}

      {departments?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((department) => (
            <button
              key={department._id}
              type="button"
              onClick={() => setSelected(department._id)}
              className="card p-5 text-left transition hover:border-brand-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-lg bg-brand-100 p-2.5 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="badge bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                  {department.code}
                </span>
              </div>

              <h3 className="mt-3 text-base font-semibold text-ink-900 dark:text-ink-50">{department.name}</h3>
              {department.description && (
                <p className="mt-1 line-clamp-2 text-sm text-ink-500 dark:text-ink-400">{department.description}</p>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-ink-200 pt-3 dark:border-ink-800">
                <span className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-ink-300">
                  <Users className="h-4 w-4" aria-hidden="true" /> {department.headcount ?? 0} people
                </span>
                {department.manager && (
                  <span className="truncate text-xs text-ink-500 dark:text-ink-400">
                    Led by {department.manager.firstName} {department.manager.lastName}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No departments yet" icon={Building2} />
      )}

      <DepartmentDetail id={selected} onClose={() => setSelected(null)} />
      <CreateDepartmentModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          refetch();
        }}
      />
    </div>
  );
}

function DepartmentDetail({ id, onClose }) {
  const { data, loading } = useFetch(id ? `/departments/${id}` : null, { enabled: Boolean(id), deps: [id] });
  if (!id) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={data?.name || 'Department'}
      wide
      footer={
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      {loading || !data ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <p className="label">Code</p>
              <p className="text-ink-800 dark:text-ink-100">{data.code}</p>
            </div>
            <div>
              <p className="label">Headcount</p>
              <p className="text-ink-800 dark:text-ink-100">{data.headcount}</p>
            </div>
            {data.manager && (
              <div>
                <p className="label">Department head</p>
                <p className="text-ink-800 dark:text-ink-100">
                  {data.manager.firstName} {data.manager.lastName}
                </p>
              </div>
            )}
            {data.costCenter && (
              <div>
                <p className="label">Cost centre</p>
                <p className="text-ink-800 dark:text-ink-100">{data.costCenter}</p>
              </div>
            )}
          </div>

          {data.description && <p className="text-sm text-ink-600 dark:text-ink-300">{data.description}</p>}

          <div>
            <p className="label">Members</p>
            <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
              {data.employees.map((employee) => (
                <li key={employee._id}>
                  <Link
                    to={`/employees/${employee._id}`}
                    onClick={onClose}
                    className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-ink-50 dark:hover:bg-ink-800/40"
                  >
                    <Avatar name={`${employee.firstName} ${employee.lastName}`} src={employee.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-800 dark:text-ink-100">
                        {employee.firstName} {employee.lastName}
                      </span>
                      <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                        {employee.jobTitle}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {!data.employees.length && (
                <li className="px-4 py-6 text-center text-sm text-ink-500">Nobody assigned yet</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CreateDepartmentModal({ open, onClose, onCreated }) {
  const { toast } = useUI();
  const [form, setForm] = useState({ name: '', code: '', description: '', manager: '', costCenter: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: employees } = useFetch('/employees/lookup', { enabled: open, deps: [open] });

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/departments', {
        name: form.name,
        code: form.code,
        description: form.description || undefined,
        manager: form.manager || undefined,
        costCenter: form.costCenter || undefined,
      });
      toast(`${form.name} created`);
      setForm({ name: '', code: '', description: '', manager: '', costCenter: '' });
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
      title="New department"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="create-department" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Create
          </button>
        </>
      }
    >
      <form id="create-department" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="dept-name">Name</label>
            <input id="dept-name" className="input" required value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="label" htmlFor="dept-code">Code</label>
            <input id="dept-code" className="input" required maxLength={10} value={form.code} onChange={set('code')} placeholder="ENG" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="dept-head">Department head</label>
          <select id="dept-head" className="input" value={form.manager} onChange={set('manager')}>
            <option value="">Unassigned</option>
            {(employees || []).map((e) => (
              <option key={e._id} value={e._id}>{e.name} — {e.jobTitle}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dept-cc">Cost centre</label>
          <input id="dept-cc" className="input" value={form.costCenter} onChange={set('costCenter')} />
        </div>
        <div>
          <label className="label" htmlFor="dept-desc">Description</label>
          <textarea id="dept-desc" className="input min-h-20 resize-y" value={form.description} onChange={set('description')} />
        </div>
        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}
