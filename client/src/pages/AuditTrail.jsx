import { useMemo, useState } from 'react';
import { ScrollText, ShieldAlert } from 'lucide-react';
import { useFetch } from '../hooks/useApi';
import { Card, EmptyState, ErrorNote, Pagination, Spinner, humanise } from '../components/ui';
import { fmtDateTime, fromNow } from '../lib/format';

const ENTITIES = ['', 'Employee', 'LeaveRequest', 'PerformanceReview', 'Attendance', 'User', 'Department'];
const OUTCOMES = ['', 'success', 'denied', 'error'];

/**
 * Read-only view over the append-only trail. Nothing in the app updates or deletes
 * these rows; a TTL index expires them after two years.
 */
export default function AuditTrail() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [outcome, setOutcome] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (entity) params.set('entity', entity);
    if (outcome) params.set('outcome', outcome);
    return params.toString();
  }, [page, entity, outcome]);

  const { data: entries, meta, loading, error, refetch } = useFetch(`/audit?${query}`, { deps: [query] });

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Audit trail</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Every mutating action, plus refused attempts — who did what, to which record, and what changed.
        </p>
      </header>

      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-ink-200 p-4 dark:border-ink-800">
          <select
            className="input w-auto"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by entity"
          >
            {ENTITIES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || 'All entities'}
              </option>
            ))}
          </select>
          <select
            className="input w-auto"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by outcome"
          >
            {OUTCOMES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? humanise(value) : 'All outcomes'}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="p-4"><ErrorNote message={error} onRetry={refetch} /></div>}

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : entries?.length ? (
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {entries.map((entry) => (
              <li key={entry._id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-800 dark:bg-ink-800 dark:text-ink-100">
                        {entry.action}
                      </code>
                      {entry.outcome !== 'success' && (
                        <span className="badge bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300">
                          <ShieldAlert className="h-3 w-3" /> {humanise(entry.outcome)}
                        </span>
                      )}
                      <span className="text-xs text-ink-500 dark:text-ink-400">
                        {entry.entity}
                        {entry.entityId ? ` · ${String(entry.entityId).slice(-6)}` : ''}
                      </span>
                    </div>

                    <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">
                      {entry.actorEmail || 'system'}{' '}
                      <span className="text-xs text-ink-500">({entry.actorRole || 'n/a'})</span>
                    </p>

                    {entry.changes && Object.keys(entry.changes).length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {Object.entries(entry.changes).slice(0, 4).map(([field, change]) => (
                          <li key={field} className="text-xs text-ink-500 dark:text-ink-400">
                            <span className="font-medium text-ink-600 dark:text-ink-300">{field}:</span>{' '}
                            <span className="line-through opacity-70">{format(change.from)}</span> →{' '}
                            <span>{format(change.to)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xs text-ink-500 dark:text-ink-400">{fromNow(entry.createdAt)}</p>
                    <p className="text-[11px] text-ink-400">{fmtDateTime(entry.createdAt)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing recorded yet" hint="Actions appear here as soon as they happen." icon={ScrollText} />
        )}

        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </div>
  );
}

function format(value) {
  if (value === null || value === undefined || value === '') return '∅';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 40);
  return String(value).slice(0, 40);
}
