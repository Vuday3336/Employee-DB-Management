import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Filter, Plus, Search, X } from 'lucide-react';
import api, { downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useDebounced, useFetch } from '../hooks/useApi';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  Pagination,
  Spinner,
  StatusBadge,
  humanise,
} from '../components/ui';
import { fmtDate, fmtMoney, inputDate } from '../lib/format';

const STATUSES = ['active', 'probation', 'on_leave', 'suspended', 'terminated'];
const SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'firstName', label: 'Name A→Z' },
  { value: '-firstName', label: 'Name Z→A' },
  { value: '-hireDate', label: 'Recently hired' },
  { value: 'hireDate', label: 'Longest tenure' },
];

export default function Employees() {
  const { isAdmin, user } = useAuth();
  const { toast } = useUI();

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('-createdAt');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounced(search);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '10', sort });
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (department) params.set('department', department);
    if (status) params.set('status', status);
    return params.toString();
  }, [page, sort, debouncedSearch, department, status]);

  const { data: employees, meta, loading, error, refetch } = useFetch(`/employees?${query}`, { deps: [query] });
  const { data: departments } = useFetch('/departments');

  const resetFilters = () => {
    setSearch('');
    setDepartment('');
    setStatus('');
    setSort('-createdAt');
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadCsv(`/employees/export?${query}`, `employees-${Date.now()}.csv`);
      toast('Export downloaded');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setExporting(false);
    }
  };

  const activeFilters = [debouncedSearch, department, status].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Employees</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {user.role === 'admin'
              ? 'Every record in the organisation.'
              : user.role === 'manager'
                ? 'Your reporting line — the API filters this list to your team.'
                : 'Your own record.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {user.role !== 'employee' && (
            <button type="button" className="btn-secondary" onClick={handleExport} disabled={exporting}>
              {exporting ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />} Export CSV
            </button>
          )}
          {isAdmin && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Add employee
            </button>
          )}
        </div>
      </header>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 p-4 dark:border-ink-800">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search name, email, code or job title…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Search employees"
            />
          </div>

          <select
            className="input w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort employees"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
          >
            <Filter className="h-4 w-4" /> Filters
            {activeFilters > 0 && (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 border-b border-ink-200 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-950/40">
            <div className="min-w-48">
              <label className="label" htmlFor="filter-dept">
                Department
              </label>
              <select
                id="filter-dept"
                className="input"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All departments</option>
                {(departments || []).map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-40">
              <label className="label" htmlFor="filter-status">
                Status
              </label>
              <select
                id="filter-status"
                className="input"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanise(s)}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" className="btn-ghost" onClick={resetFilters}>
              <X className="h-4 w-4" /> Clear
            </button>
          </div>
        )}

        {error && <div className="p-4">
          <ErrorNote message={error} onRetry={refetch} />
        </div>}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-500">
            <Spinner /> Loading employees…
          </div>
        ) : employees?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem]">
              <thead className="border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-950/40">
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Department</th>
                  <th className="th">Manager</th>
                  <th className="th">Hired</th>
                  <th className="th">Status</th>
                  {isAdmin && <th className="th">Salary</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
                {employees.map((employee) => (
                  <tr key={employee._id} className="transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <td className="td">
                      <Link to={`/employees/${employee._id}`} className="flex items-center gap-3">
                        <Avatar name={`${employee.firstName} ${employee.lastName}`} src={employee.avatarUrl} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink-900 hover:text-brand-600 dark:text-ink-50">
                            {employee.firstName} {employee.lastName}
                          </span>
                          <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                            {employee.employeeCode} · {employee.jobTitle}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">{employee.department?.name || '—'}</td>
                    <td className="td">
                      {employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'}
                    </td>
                    <td className="td whitespace-nowrap">{fmtDate(employee.hireDate)}</td>
                    <td className="td">
                      <StatusBadge status={employee.status} />
                    </td>
                    {isAdmin && <td className="td whitespace-nowrap">{fmtMoney(employee.salary)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No employees match those filters"
            hint={activeFilters ? 'Try clearing the search or filters.' : 'Add your first employee to get started.'}
            action={
              activeFilters ? (
                <button type="button" className="btn-secondary" onClick={resetFilters}>
                  Clear filters
                </button>
              ) : null
            }
          />
        )}

        <Pagination meta={meta} onPage={setPage} />
      </Card>

      <CreateEmployeeModal
        open={creating}
        departments={departments || []}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          refetch();
        }}
      />
    </div>
  );
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  workEmail: '',
  phone: '',
  jobTitle: '',
  department: '',
  manager: '',
  hireDate: inputDate(new Date()),
  employmentType: 'full_time',
  salary: '',
  location: '',
  createAccount: false,
  accountRole: 'employee',
  accountPassword: '',
};

function CreateEmployeeModal({ open, onClose, onCreated, departments }) {
  const { toast } = useUI();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: managers } = useFetch('/employees/lookup', { enabled: open, deps: [open] });

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        salary: form.salary ? Number(form.salary) : undefined,
        department: form.department || undefined,
        manager: form.manager || undefined,
        phone: form.phone || undefined,
        location: form.location || undefined,
        accountPassword: form.createAccount ? form.accountPassword : undefined,
        accountRole: form.createAccount ? form.accountRole : undefined,
      };
      await api.post('/employees', payload);
      toast(`${form.firstName} ${form.lastName} added`);
      setForm(EMPTY_FORM);
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
      title="Add employee"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="create-employee" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Create employee
          </button>
        </>
      }
    >
      <form id="create-employee" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="firstName">First name</label>
            <input id="firstName" className="input" required value={form.firstName} onChange={set('firstName')} />
          </div>
          <div>
            <label className="label" htmlFor="lastName">Last name</label>
            <input id="lastName" className="input" required value={form.lastName} onChange={set('lastName')} />
          </div>
          <div>
            <label className="label" htmlFor="workEmail">Work email</label>
            <input id="workEmail" type="email" className="input" required value={form.workEmail} onChange={set('workEmail')} />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" value={form.phone} onChange={set('phone')} />
          </div>
          <div>
            <label className="label" htmlFor="jobTitle">Job title</label>
            <input id="jobTitle" className="input" required value={form.jobTitle} onChange={set('jobTitle')} />
          </div>
          <div>
            <label className="label" htmlFor="department">Department</label>
            <select id="department" className="input" value={form.department} onChange={set('department')}>
              <option value="">Unassigned</option>
              {departments.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="manager">Reports to</label>
            <select id="manager" className="input" value={form.manager} onChange={set('manager')}>
              <option value="">No manager (top of the tree)</option>
              {(managers || []).map((m) => (
                <option key={m._id} value={m._id}>{m.name} — {m.jobTitle}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="hireDate">Hire date</label>
            <input id="hireDate" type="date" className="input" required value={form.hireDate} onChange={set('hireDate')} />
          </div>
          <div>
            <label className="label" htmlFor="employmentType">Employment type</label>
            <select id="employmentType" className="input" value={form.employmentType} onChange={set('employmentType')}>
              {['full_time', 'part_time', 'contract', 'intern'].map((t) => (
                <option key={t} value={t}>{humanise(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="salary">Annual salary</label>
            <input id="salary" type="number" min="0" className="input" value={form.salary} onChange={set('salary')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="location">Location</label>
            <input id="location" className="input" value={form.location} onChange={set('location')} />
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 p-4 dark:border-ink-800">
          <label className="flex items-center gap-2 text-sm font-medium text-ink-800 dark:text-ink-100">
            <input type="checkbox" checked={form.createAccount} onChange={set('createAccount')} className="h-4 w-4 rounded" />
            Also create a login account
          </label>

          {form.createAccount && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="accountRole">Role</label>
                <select id="accountRole" className="input" value={form.accountRole} onChange={set('accountRole')}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="accountPassword">Temporary password</label>
                <input
                  id="accountPassword"
                  type="text"
                  className="input"
                  required={form.createAccount}
                  value={form.accountPassword}
                  onChange={set('accountPassword')}
                  placeholder="Min 8 chars, upper + lower + number"
                />
              </div>
            </div>
          )}
        </div>

        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}
