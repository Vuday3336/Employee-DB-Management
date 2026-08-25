import { useState } from 'react';
import { Check, ClipboardCheck, X } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import { Avatar, Card, EmptyState, ErrorNote, Modal, PageLoader, Spinner, humanise } from '../components/ui';
import { dateRangeLabel, fromNow } from '../lib/format';

/**
 * The approver's queue. The server decides what belongs here — a manager receives
 * only their own reports' requests, and never their own.
 */
export default function Approvals() {
  const { data: requests, loading, error, refetch } = useFetch('/leave/pending');
  const [decision, setDecision] = useState(null);

  if (loading) return <PageLoader label="Loading your approval queue" />;

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Approvals</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Requests from your reporting line. You cannot approve your own leave — the API rejects it regardless
          of what the interface offers.
        </p>
      </header>

      {error && <ErrorNote message={error} onRetry={refetch} />}

      <Card padded={false}>
        {requests?.length ? (
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {requests.map((request) => {
              const waiting = Math.floor((Date.now() - new Date(request.createdAt)) / 86400000);
              return (
                <li key={request._id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <Avatar
                    name={`${request.employee?.firstName} ${request.employee?.lastName}`}
                    src={request.employee?.avatarUrl}
                  />
                  <div className="min-w-48 flex-1">
                    <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
                      {request.employee?.firstName} {request.employee?.lastName}
                      <span className="ml-2 text-xs font-normal text-ink-500">{request.employee?.jobTitle}</span>
                    </p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">
                      {humanise(request.type)} · {dateRangeLabel(request.startDate, request.endDate)} ·{' '}
                      {request.days} day(s)
                    </p>
                    <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">{request.reason}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {waiting >= 3 && (
                      <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
                        {waiting}d waiting
                      </span>
                    )}
                    <span className="text-xs text-ink-400">{fromNow(request.createdAt)}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setDecision({ request, verdict: 'rejected' })}
                    >
                      <X className="h-4 w-4" /> Reject
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setDecision({ request, verdict: 'approved' })}
                    >
                      <Check className="h-4 w-4" /> Approve
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="Nothing waiting on you"
            hint="New requests from your team land here the moment they are filed."
            icon={ClipboardCheck}
          />
        )}
      </Card>

      <DecisionModal
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={() => {
          setDecision(null);
          refetch();
        }}
      />
    </div>
  );
}

function DecisionModal({ decision, onClose, onDone }) {
  const { toast } = useUI();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!decision) return null;
  const { request, verdict } = decision;
  const approving = verdict === 'approved';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/leave/${request._id}/decision`, { decision: verdict, note: note || undefined });
      toast(`Request ${verdict} — ${request.employee?.firstName} has been notified`);
      setNote('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={approving ? 'Approve request' : 'Reject request'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="decision"
            className={approving ? 'btn-primary' : 'btn-danger'}
            disabled={busy}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {approving ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      <form id="decision" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-ink-100 px-4 py-3 text-sm dark:bg-ink-800">
          <p className="font-medium text-ink-900 dark:text-ink-50">
            {request.employee?.firstName} {request.employee?.lastName}
          </p>
          <p className="text-ink-600 dark:text-ink-300">
            {humanise(request.type)} · {dateRangeLabel(request.startDate, request.endDate)} · {request.days} day(s)
          </p>
          <p className="mt-1 text-ink-600 dark:text-ink-300">{request.reason}</p>
        </div>

        {approving && (
          <p className="text-sm text-ink-600 dark:text-ink-300">
            Approving deducts {request.days} day(s) from their balance and marks those days as leave on the
            attendance record.
          </p>
        )}

        <div>
          <label className="label" htmlFor="decision-note">
            Note for the employee {approving ? '(optional)' : ''}
          </label>
          <textarea
            id="decision-note"
            className="input min-h-20 resize-y"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={approving ? 'Enjoy your time off' : 'Why this cannot be approved right now'}
            required={!approving}
          />
        </div>

        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}
