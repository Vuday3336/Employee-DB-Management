import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarDays,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RotateCcw,
  Trash2,
  UserRound,
} from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  PageLoader,
  Spinner,
  StatusBadge,
  humanise,
} from '../components/ui';
import { fmtDate, fmtMoney, fromNow } from '../lib/format';

export default function EmployeeDetail() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();

  const { data: employee, loading, error, refetch } = useFetch(`/employees/${id}`, { deps: [id] });
  const { data: reviewHistory } = useFetch(`/reviews/history/${id}`, { deps: [id] });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!employee) return null;

  const isSelf = String(employee._id) === String(user.employeeId);
  const canEdit = isAdmin || isSelf || user.role === 'manager';
  const fullName = `${employee.firstName} ${employee.lastName}`;

  const deactivate = async () => {
    if (!window.confirm(`Deactivate ${fullName}? History is preserved and reports move to their manager.`)) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/employees/${employee._id}`);
      toast(`${fullName} deactivated — ${data.data.reportsReassigned} report(s) reassigned`);
      navigate('/employees');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await api.post(`/employees/${employee._id}/restore`);
      toast(`${fullName} restored`);
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/employees" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Back to employees
      </Link>

      {employee.deletedAt && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          This record was deactivated {fromNow(employee.deletedAt)}. It is kept so attendance, leave and review
          history stay intact.
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={fullName} src={employee.avatarUrl} size="lg" />
            <div>
              <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">{fullName}</h2>
              <p className="text-sm text-ink-500 dark:text-ink-400">
                {employee.jobTitle} · {employee.employeeCode}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge status={employee.status} />
                <span className="badge bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                  {humanise(employee.employmentType)}
                </span>
                {employee.account && (
                  <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">
                    {humanise(employee.account.role)} login
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {canEdit && !employee.deletedAt && (
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            {isAdmin && !employee.deletedAt && !isSelf && (
              <button type="button" className="btn-danger" onClick={deactivate} disabled={busy}>
                <Trash2 className="h-4 w-4" /> Deactivate
              </button>
            )}
            {isAdmin && employee.deletedAt && (
              <button type="button" className="btn-primary" onClick={restore} disabled={busy}>
                {busy ? <Spinner className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />} Restore
              </button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field icon={Mail} label="Work email" value={employee.workEmail} />
            <Field icon={Phone} label="Phone" value={employee.phone} />
            <Field icon={Building2} label="Department" value={employee.department?.name} />
            <Field
              icon={UserRound}
              label="Reports to"
              value={
                employee.manager ? (
                  <Link to={`/employees/${employee.manager._id}`} className="text-brand-600 hover:underline dark:text-brand-300">
                    {employee.manager.firstName} {employee.manager.lastName}
                  </Link>
                ) : (
                  'No manager'
                )
              }
            />
            <Field icon={CalendarDays} label="Hire date" value={`${fmtDate(employee.hireDate)} (${fromNow(employee.hireDate)})`} />
            <Field icon={MapPin} label="Location" value={employee.location} />
            <Field icon={Briefcase} label="Employment type" value={humanise(employee.employmentType)} />
            {/* Salary only arrives from the API for admins and for the employee themselves. */}
            {employee.salary !== undefined && (
              <Field icon={Briefcase} label="Annual salary" value={fmtMoney(employee.salary)} />
            )}
          </dl>
        </Card>

        <div className="space-y-6">
          <Card title={`Direct reports (${employee.directReports?.length || 0})`} padded={false}>
            {employee.directReports?.length ? (
              <ul className="divide-y divide-ink-200 dark:divide-ink-800">
                {employee.directReports.map((report) => (
                  <li key={report._id}>
                    <Link
                      to={`/employees/${report._id}`}
                      className="flex items-center gap-3 px-5 py-3 transition hover:bg-ink-50 dark:hover:bg-ink-800/40"
                    >
                      <Avatar name={`${report.firstName} ${report.lastName}`} src={report.avatarUrl} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                          {report.firstName} {report.lastName}
                        </span>
                        <span className="block truncate text-xs text-ink-500 dark:text-ink-400">{report.jobTitle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No direct reports" icon={UserRound} />
            )}
          </Card>

          <Card title="Review history" padded={false}>
            {reviewHistory?.length ? (
              <ul className="divide-y divide-ink-200 dark:divide-ink-800">
                {reviewHistory.map((review) => (
                  <li key={review._id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link to={`/reviews/${review._id}`} className="text-sm text-brand-600 hover:underline dark:text-brand-300">
                      {review.label}
                    </Link>
                    <span className="text-sm font-semibold text-ink-800 dark:text-ink-100">{review.rating}/5</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No shared reviews yet" />
            )}
          </Card>
        </div>
      </div>

      <EditEmployeeModal
        open={editing}
        employee={employee}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          refetch();
        }}
      />
    </div>
  );
}

function Field({ icon: Icon, label, value }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</dt>
        <dd className="mt-0.5 truncate text-sm text-ink-800 dark:text-ink-100">{value || '—'}</dd>
      </div>
    </div>
  );
}

function EditEmployeeModal({ open, employee, onClose, onSaved }) {
  const { isAdmin, user } = useAuth();
  const { toast } = useUI();
  const isSelf = String(employee._id) === String(user.employeeId);

  const [form, setForm] = useState({
    jobTitle: employee.jobTitle || '',
    phone: employee.phone || '',
    location: employee.location || '',
    status: employee.status,
    employmentType: employee.employmentType,
    salary: employee.salary ?? '',
    department: employee.department?._id || '',
    manager: employee.manager?._id || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: departments } = useFetch('/departments', { enabled: open, deps: [open] });
  const { data: managers } = useFetch('/employees/lookup', { enabled: open && isAdmin, deps: [open] });

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));

  // Mirrors the server-side field policy so the form never offers what the API would drop.
  const canEditJob = isAdmin || (user.role === 'manager' && !isSelf);
  const canEditOrg = isAdmin;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { phone: form.phone, location: form.location };
      if (canEditJob) {
        payload.jobTitle = form.jobTitle;
        payload.status = form.status;
        payload.employmentType = form.employmentType;
      }
      if (canEditOrg) {
        payload.department = form.department || null;
        payload.salary = form.salary === '' ? undefined : Number(form.salary);
      }
      await api.patch(`/employees/${employee._id}`, payload);

      if (canEditOrg && (form.manager || '') !== (employee.manager?._id || '')) {
        await api.patch(`/employees/${employee._id}/manager`, { manager: form.manager || null });
      }

      toast('Employee updated');
      onSaved();
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
      title={`Edit ${employee.firstName} ${employee.lastName}`}
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="edit-employee" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Save changes
          </button>
        </>
      }
    >
      <form id="edit-employee" onSubmit={submit} className="space-y-4">
        <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">
          Fields you cannot change are hidden here — and the API drops them too, so the two never disagree.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="edit-phone">Phone</label>
            <input id="edit-phone" className="input" value={form.phone} onChange={set('phone')} />
          </div>
          <div>
            <label className="label" htmlFor="edit-location">Location</label>
            <input id="edit-location" className="input" value={form.location} onChange={set('location')} />
          </div>

          {canEditJob && (
            <>
              <div>
                <label className="label" htmlFor="edit-title">Job title</label>
                <input id="edit-title" className="input" value={form.jobTitle} onChange={set('jobTitle')} />
              </div>
              <div>
                <label className="label" htmlFor="edit-status">Status</label>
                <select id="edit-status" className="input" value={form.status} onChange={set('status')}>
                  {['active', 'probation', 'on_leave', 'suspended', 'terminated'].map((s) => (
                    <option key={s} value={s}>{humanise(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="edit-type">Employment type</label>
                <select id="edit-type" className="input" value={form.employmentType} onChange={set('employmentType')}>
                  {['full_time', 'part_time', 'contract', 'intern'].map((t) => (
                    <option key={t} value={t}>{humanise(t)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {canEditOrg && (
            <>
              <div>
                <label className="label" htmlFor="edit-dept">Department</label>
                <select id="edit-dept" className="input" value={form.department} onChange={set('department')}>
                  <option value="">Unassigned</option>
                  {(departments || []).map((d) => (
                    <option key={d._id} value={d._id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="edit-manager">Reports to</label>
                <select id="edit-manager" className="input" value={form.manager} onChange={set('manager')}>
                  <option value="">No manager</option>
                  {(managers || [])
                    .filter((m) => m._id !== employee._id)
                    .map((m) => (
                      <option key={m._id} value={m._id}>{m.name} — {m.jobTitle}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="edit-salary">Annual salary</label>
                <input id="edit-salary" type="number" min="0" className="input" value={form.salary} onChange={set('salary')} />
              </div>
            </>
          )}
        </div>

        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}
