import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Send, Target, Trash2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import { Avatar, Card, ErrorNote, PageLoader, Spinner, StatusBadge, humanise } from '../components/ui';
import { RatingStars } from './Reviews';
import { fmtDate } from '../lib/format';

export default function ReviewDetail() {
  const { id } = useParams();
  const { user, employeeId } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();

  const { data: review, loading, error, refetch } = useFetch(`/reviews/${id}`, { deps: [id] });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!review) return null;

  const subjectId = String(review.employee?._id || review.employee);
  const isSubject = subjectId === String(employeeId);
  const isAuthor = String(review.reviewer?._id || review.reviewer) === String(employeeId);
  const canEdit = (isAuthor || user.role === 'admin') && review.status !== 'acknowledged';

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitReview = () =>
    act(() => api.patch(`/reviews/${id}`, { status: 'submitted' }), 'Review shared with the employee');

  const acknowledge = () =>
    act(
      () => api.post(`/reviews/${id}/acknowledge`, { employeeComment: comment || undefined }),
      'Review acknowledged'
    );

  const remove = async () => {
    if (!window.confirm('Delete this draft review?')) return;
    setBusy(true);
    try {
      await api.delete(`/reviews/${id}`);
      toast('Draft deleted');
      navigate('/reviews');
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };

  const chartData = (review.scores || []).map((s) => ({
    competency: humanise(s.competency),
    score: s.score,
  }));

  return (
    <div className="space-y-6">
      <Link to="/reviews" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Back to reviews
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar
              name={`${review.employee?.firstName} ${review.employee?.lastName}`}
              src={review.employee?.avatarUrl}
              size="lg"
            />
            <div>
              <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                {review.employee?.firstName} {review.employee?.lastName}
              </h2>
              <p className="text-sm text-ink-500 dark:text-ink-400">
                Q{review.period.quarter} {review.period.year} · reviewed by {review.reviewer?.firstName}{' '}
                {review.reviewer?.lastName}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <RatingStars value={review.rating} />
                <span className="text-sm font-semibold text-ink-800 dark:text-ink-100">{review.rating}/5</span>
                <StatusBadge status={review.status} />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {canEdit && review.status === 'draft' && (
              <>
                <button type="button" className="btn-danger" onClick={remove} disabled={busy}>
                  <Trash2 className="h-4 w-4" /> Delete draft
                </button>
                <button type="button" className="btn-primary" onClick={submitReview} disabled={busy}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Share with employee
                </button>
              </>
            )}
          </div>
        </div>
      </Card>

      {review.status === 'draft' && (
        <div className="rounded-lg border border-ink-300 bg-ink-100 px-4 py-3 text-sm text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200">
          This review is a draft. The employee cannot see it — the API blocks the request, not just the link.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Competency scores">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-ink-200 dark:text-ink-800" />
                <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 12 }} stroke="currentColor" className="text-ink-400" />
                <YAxis dataKey="competency" type="category" width={110} tick={{ fontSize: 12 }} stroke="currentColor" className="text-ink-400" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="score" fill="#3363f7" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-ink-500">No competency scores recorded.</p>
          )}
        </Card>

        <div className="space-y-6">
          {review.strengths && (
            <Card title="Strengths">
              <p className="whitespace-pre-line text-sm text-ink-700 dark:text-ink-200">{review.strengths}</p>
            </Card>
          )}
          {review.improvements && (
            <Card title="Areas to develop">
              <p className="whitespace-pre-line text-sm text-ink-700 dark:text-ink-200">{review.improvements}</p>
            </Card>
          )}
        </div>
      </div>

      {review.comments && (
        <Card title="Overall comments">
          <p className="whitespace-pre-line text-sm text-ink-700 dark:text-ink-200">{review.comments}</p>
        </Card>
      )}

      {review.goals?.length > 0 && (
        <Card title="Goals for next period">
          <ul className="space-y-2">
            {review.goals.map((goal, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-ink-700 dark:text-ink-200">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
                {goal}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {review.status === 'acknowledged' ? (
        <Card title="Employee acknowledgement">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
            <div>
              <p className="text-sm text-ink-700 dark:text-ink-200">
                {review.employeeComment || 'Acknowledged without a comment.'}
              </p>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                Acknowledged on {fmtDate(review.acknowledgedAt)}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        isSubject &&
        review.status === 'submitted' && (
          <Card title="Acknowledge this review">
            <p className="mb-3 text-sm text-ink-600 dark:text-ink-300">
              Add a comment if you would like to. Acknowledging closes the review — it cannot be edited
              afterwards, by anyone.
            </p>
            <textarea
              className="input min-h-24 resize-y"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Your response (optional)"
              maxLength={1000}
            />
            <button type="button" className="btn-primary mt-3" onClick={acknowledge} disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Acknowledge
            </button>
          </Card>
        )
      )}
    </div>
  );
}
