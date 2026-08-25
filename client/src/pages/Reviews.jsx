import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Star } from 'lucide-react';
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
import { dayjs } from '../lib/format';

const COMPETENCIES = ['delivery', 'quality', 'collaboration', 'ownership', 'communication'];

export function RatingStars({ value = 0, size = 'h-4 w-4' }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${size} ${
            n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-ink-300 dark:text-ink-700'
          }`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export default function Reviews() {
  const { isApprover } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    if (status && isApprover) params.set('status', status);
    return params.toString();
  }, [page, status, isApprover]);

  const { data: reviews, meta, loading, error, refetch } = useFetch(`/reviews?${query}`, { deps: [query] });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Performance reviews</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {isApprover
              ? 'Reviews you have written, plus those covering your team. Drafts stay private until submitted.'
              : 'Your review history. Only reviews your manager has shared are visible here.'}
          </p>
        </div>
        {isApprover && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New review
          </button>
        )}
      </header>

      <Card padded={false}>
        {isApprover && (
          <div className="border-b border-ink-200 p-4 dark:border-ink-800">
            <select
              className="input w-auto"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Filter reviews by status"
            >
              <option value="">All statuses</option>
              {['draft', 'submitted', 'acknowledged'].map((s) => (
                <option key={s} value={s}>{humanise(s)}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="p-4">
            <ErrorNote message={error} onRetry={refetch} />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-500">
            <Spinner /> Loading reviews…
          </div>
        ) : reviews?.length ? (
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {reviews.map((review) => (
              <li key={review._id}>
                <Link
                  to={`/reviews/${review._id}`}
                  className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-ink-50 dark:hover:bg-ink-800/40"
                >
                  <Avatar
                    name={`${review.employee?.firstName} ${review.employee?.lastName}`}
                    src={review.employee?.avatarUrl}
                  />
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
                      {review.employee?.firstName} {review.employee?.lastName}
                    </p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">
                      Q{review.period.quarter} {review.period.year} · reviewed by {review.reviewer?.firstName}{' '}
                      {review.reviewer?.lastName}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <RatingStars value={review.rating} />
                    <span className="text-sm font-semibold text-ink-800 dark:text-ink-100">{review.rating}</span>
                    <StatusBadge status={review.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No reviews yet"
            hint={isApprover ? 'Start a review for someone on your team.' : 'Your manager has not shared a review yet.'}
            icon={Star}
          />
        )}

        <Pagination meta={meta} onPage={setPage} />
      </Card>

      <CreateReviewModal
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

function CreateReviewModal({ open, onClose, onCreated }) {
  const { toast } = useUI();
  const { employeeId } = useAuth();
  const now = dayjs.utc();

  const [form, setForm] = useState({
    employee: '',
    year: now.year(),
    quarter: Math.max(1, now.quarter() - 1) || 4,
    strengths: '',
    improvements: '',
    comments: '',
    status: 'draft',
  });
  const [scores, setScores] = useState(Object.fromEntries(COMPETENCIES.map((c) => [c, 3])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: team } = useFetch('/employees/lookup', { enabled: open, deps: [open] });

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));
  const average = (
    Object.values(scores).reduce((sum, s) => sum + Number(s), 0) / COMPETENCIES.length
  ).toFixed(1);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/reviews', {
        employee: form.employee,
        period: { year: Number(form.year), quarter: Number(form.quarter) },
        scores: COMPETENCIES.map((competency) => ({ competency, score: Number(scores[competency]) })),
        strengths: form.strengths || undefined,
        improvements: form.improvements || undefined,
        comments: form.comments || undefined,
        status: form.status,
      });
      toast(form.status === 'submitted' ? 'Review shared with the employee' : 'Draft saved');
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
      title="New performance review"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="create-review" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {form.status === 'submitted' ? 'Submit review' : 'Save draft'}
          </button>
        </>
      }
    >
      <form id="create-review" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="label" htmlFor="review-employee">Employee</label>
            <select id="review-employee" className="input" required value={form.employee} onChange={set('employee')}>
              <option value="">Select someone on your team…</option>
              {(team || [])
                .filter((m) => m._id !== employeeId)
                .map((m) => (
                  <option key={m._id} value={m._id}>{m.name} — {m.jobTitle}</option>
                ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
              You can only review your own direct or indirect reports, and never yourself.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="review-year">Year</label>
            <input id="review-year" type="number" className="input" min="2000" max="2100" value={form.year} onChange={set('year')} />
          </div>
          <div>
            <label className="label" htmlFor="review-quarter">Quarter</label>
            <select id="review-quarter" className="input" value={form.quarter} onChange={set('quarter')}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>Q{q}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="review-status">Save as</label>
            <select id="review-status" className="input" value={form.status} onChange={set('status')}>
              <option value="draft">Draft (private to you)</option>
              <option value="submitted">Submit (visible to the employee)</option>
            </select>
          </div>
        </div>

        <fieldset className="rounded-lg border border-ink-200 p-4 dark:border-ink-800">
          <legend className="px-1 text-sm font-medium text-ink-800 dark:text-ink-100">
            Competency scores · average {average}/5
          </legend>
          <div className="space-y-3">
            {COMPETENCIES.map((competency) => (
              <div key={competency} className="flex items-center gap-4">
                <span className="w-32 text-sm text-ink-700 dark:text-ink-200">{humanise(competency)}</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={scores[competency]}
                  onChange={(e) => setScores((c) => ({ ...c, [competency]: e.target.value }))}
                  className="flex-1 accent-brand-600"
                  aria-label={`${competency} score`}
                />
                <span className="w-6 text-right text-sm font-semibold text-ink-900 dark:text-ink-50">
                  {scores[competency]}
                </span>
              </div>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor="review-strengths">Strengths</label>
          <textarea id="review-strengths" className="input min-h-20 resize-y" value={form.strengths} onChange={set('strengths')} />
        </div>
        <div>
          <label className="label" htmlFor="review-improvements">Areas to develop</label>
          <textarea id="review-improvements" className="input min-h-20 resize-y" value={form.improvements} onChange={set('improvements')} />
        </div>
        <div>
          <label className="label" htmlFor="review-comments">Overall comments</label>
          <textarea id="review-comments" className="input min-h-20 resize-y" value={form.comments} onChange={set('comments')} />
        </div>

        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}

