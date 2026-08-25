import { useMemo, useState } from 'react';
import { CalendarPlus, History, X } from 'lucide-react';
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
  Pagination,
  Spinner,
  StatusBadge,
  humanise,
} from '../components/ui';
import { dateRangeLabel, dayjs, fmtDateTime, fromNow, inputDate } from '../lib/format';

const STATUS_FILTERS = ['', 'pending', 'approved', 'rejected', 'cancelled'];

export default function Leave() {
  const { isApprover, employeeId } = useAuth();
  const { toast } = useUI();

  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const [detail, setDetail] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    if (status) params.set('status', status);
    if (isApprover) params.set('scope', scope);
    return params.toString();
  }, [page, status, scope, isApprover]);

  const { data: requests, meta, loading, error, refetch } = useFetch(`/leave?${query}`, { deps: [query] });
  const { data: balances, refetch: refetchBalances } = useFetch('/leave/balance', { enabled: Boolean(employeeId) });

  const cancel = async (request) => {
    if (!window.confirm('Withdraw this request? An approved one returns its days to your balance.')) return;
    try {
      await api.patch(`/leave/${request._id}/cancel`, {});
      toast('Request withdrawn');
      refetch();
      refetchBalances();
      setDetail(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Leave</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Business days are counted server-side — weekends and company holidays never consume balance.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setRequesting(true)} disabled={!employeeId}>
          <CalendarPlus className="h-4 w-4" /> Request leave
        </button>
      </header>

      {balances?.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances
            .filter((b) => b.total > 0)
            .map((balance) => (
              <div key={balance.type} className="card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {balance.label}
                </p>
                <p className="mt-1 text-2xl font-semibold text-ink-900 dark:text-ink-50">
                  {balance.remaining}
                  <span className="ml-1 text-sm font-normal text-ink-400">/ {balance.total} days</span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.min(100, (balance.used / balance.total) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 p-4 dark:border-ink-800">
          {isApprover && (
            <div className="flex rounded-lg border border-ink-300 p-0.5 dark:border-ink-700">
              {[
                { value: 'mine', label: 'Mine' },
                { value: 'team', label: 'My team' },
                { value: 'all', label: 'Everyone in scope' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setScope(option.value);
                    setPage(1);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    scope === option.value
                      ? 'bg-brand-600 text-white'
                      : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <select
            className="input w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s || 'all'} value={s}>
                {s ? humanise(s) : 'All statuses'}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="p-4">
            <ErrorNote message={error} onRetry={refetch} />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-500">
            <Spinner /> Loading requests…
          </div>
        ) : requests?.length ? (
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {requests.map((request) => (
              <li key={request._id}>
                <button
                  type="button"
                  onClick={() => setDetail(request)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800/40"
                >
                  <Avatar
                    name={`${request.employee?.firstName || ''} ${request.employee?.lastName || ''}`}
                    src={request.employee?.avatarUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                      {request.employee?.firstName} {request.employee?.lastName} · {humanise(request.type)}
                    </p>
                    <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                      {dateRangeLabel(request.startDate, request.endDate)} · {request.days} day(s) ·{' '}
                      {request.reason}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={request.status} />
                    <span className="text-xs text-ink-400">{fromNow(request.createdAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No leave requests"
            hint="Requests you file, and any you can see in your scope, appear here."
          />
        )}

        <Pagination meta={meta} onPage={setPage} />
      </Card>

      <RequestLeaveModal
        open={requesting}
        balances={balances || []}
        onClose={() => setRequesting(false)}
        onCreated={() => {
          setRequesting(false);
          refetch();
          refetchBalances();
        }}
      />

      <LeaveDetailModal request={detail} onClose={() => setDetail(null)} onCancel={cancel} employeeId={employeeId} />
    </div>
  );
}

function RequestLeaveModal({ open, onClose, onCreated, balances }) {
  const { toast } = useUI();
  const [form, setForm] = useState({
    type: 'annual',
    startDate: inputDate(dayjs.utc().add(7, 'day')),
    endDate: inputDate(dayjs.utc().add(8, 'day')),
    halfDay: false,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: policies } = useFetch('/leave-policies', { enabled: open, deps: [open] });

  const set = (field) => (e) =>
    setForm((c) => ({ ...c, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // Local preview of the working-day count; the API is still the authority.
  const workingDays = useMemo(() => {
    if (!form.startDate || !form.endDate) return 0;
    let cursor = dayjs.utc(form.startDate);
    const end = dayjs.utc(form.endDate);
    let count = 0;
    while (cursor.isSame(end) || cursor.isBefore(end)) {
      if (![0, 6].includes(cursor.day())) count += 1;
      cursor = cursor.add(1, 'day');
    }
    return form.halfDay ? 0.5 : count;
  }, [form.startDate, form.endDate, form.halfDay]);

  const selectedBalance = balances.find((b) => b.type === form.type);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/leave', form);
      toast('Request submitted — your manager has been notified');
      setForm((c) => ({ ...c, reason: '' }));
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
      title="Request leave"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="request-leave" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Submit request
          </button>
        </>
      }
    >
      <form id="request-leave" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="leave-type">Leave type</label>
          <select id="leave-type" className="input" value={form.type} onChange={set('type')}>
            {(policies || []).filter((p) => p.isActive).map((policy) => (
              <option key={policy.type} value={policy.type}>
                {policy.label}
                {policy.minNoticeDays ? ` · ${policy.minNoticeDays} days notice` : ''}
              </option>
            ))}
          </select>
          {selectedBalance && (
            <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
              {selectedBalance.remaining} of {selectedBalance.total} days remaining
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="leave-start">From</label>
            <input id="leave-start" type="date" required className="input" value={form.startDate} onChange={set('startDate')} />
          </div>
          <div>
            <label className="label" htmlFor="leave-end">To</label>
            <input
              id="leave-end"
              type="date"
              required
              className="input"
              min={form.startDate}
              value={form.endDate}
              onChange={set('endDate')}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
          <input type="checkbox" checked={form.halfDay} onChange={set('halfDay')} className="h-4 w-4 rounded" />
          Half day (single date only)
        </label>

        <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
          This request covers <strong>{workingDays}</strong> working day(s). Weekends and company holidays are
          excluded automatically.
        </div>

        <div>
          <label className="label" htmlFor="leave-reason">Reason</label>
          <textarea
            id="leave-reason"
            className="input min-h-24 resize-y"
            required
            minLength={5}
            maxLength={500}
            value={form.reason}
            onChange={set('reason')}
            placeholder="A short note for your approver"
          />
        </div>

        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}

function LeaveDetailModal({ request, onClose, onCancel, employeeId }) {
  if (!request) return null;
  const isOwner = String(request.employee?._id || request.employee) === String(employeeId);
  const canCancel = isOwner && ['pending', 'approved'].includes(request.status);

  return (
    <Modal
      open={Boolean(request)}
      onClose={onClose}
      title="Leave request"
      footer={
        canCancel ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="btn-danger" onClick={() => onCancel(request)}>
              <X className="h-4 w-4" /> Withdraw request
            </button>
          </>
        ) : (
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
              {humanise(request.type)} leave · {request.days} day(s)
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {dateRangeLabel(request.startDate, request.endDate)}
            </p>
          </div>
          <StatusBadge status={request.status} />
        </div>

        <div>
          <p className="label">Reason</p>
          <p className="text-sm text-ink-700 dark:text-ink-200">{request.reason}</p>
        </div>

        {request.decisionNote && (
          <div>
            <p className="label">Approver note</p>
            <p className="text-sm text-ink-700 dark:text-ink-200">{request.decisionNote}</p>
          </div>
        )}

        <div>
          <p className="label flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> Transition history
          </p>
          <ol className="mt-1 space-y-2 border-l-2 border-ink-200 pl-4 dark:border-ink-800">
            {(request.history || []).map((entry, index) => (
              <li key={index} className="relative text-sm">
                <span className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                <span className="text-ink-800 dark:text-ink-100">
                  {entry.from ? `${humanise(entry.from)} → ` : ''}
                  {humanise(entry.to)}
                </span>
                <span className="ml-2 text-xs text-ink-400">{fmtDateTime(entry.at)}</span>
                {entry.note && <p className="text-xs text-ink-500 dark:text-ink-400">{entry.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}
