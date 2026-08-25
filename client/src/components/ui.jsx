import { AlertTriangle, CheckCircle2, Info, Loader2, X, Inbox } from 'lucide-react';
import { useUI } from '../context/UIContext';

/* ------------------------------ primitives ------------------------------ */

export function Spinner({ className = 'h-5 w-5' }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />;
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-ink-500">
      <Spinner className="h-7 w-7" />
      <p className="text-sm">{label}…</p>
    </div>
  );
}

export function Card({ title, action, children, className = '', padded = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-3.5 dark:border-ink-800">
          <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon className="h-8 w-8 text-ink-300 dark:text-ink-600" aria-hidden="true" />
      <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

/* -------------------------------- badges -------------------------------- */

const TONES = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  blue: 'bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300',
  gray: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
};

const STATUS_TONES = {
  active: 'green',
  present: 'green',
  approved: 'green',
  acknowledged: 'green',
  probation: 'amber',
  late: 'amber',
  half_day: 'amber',
  pending: 'amber',
  submitted: 'blue',
  on_leave: 'blue',
  draft: 'gray',
  weekend: 'gray',
  holiday: 'purple',
  not_marked: 'gray',
  cancelled: 'gray',
  suspended: 'red',
  terminated: 'red',
  absent: 'red',
  rejected: 'red',
};

export const humanise = (value = '') =>
  String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function Badge({ children, tone = 'gray' }) {
  return <span className={`badge ${TONES[tone] || TONES.gray}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  if (!status) return <Badge tone="gray">—</Badge>;
  return <Badge tone={STATUS_TONES[status] || 'gray'}>{humanise(status)}</Badge>;
}

/* -------------------------------- toasts -------------------------------- */

const TOAST_ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };
const TOAST_STYLES = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  info: 'border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-100',
};

export function ToastStack() {
  const { toasts, dismissToast } = useUI();
  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = TOAST_ICONS[t.kind] || Info;
        return (
          <div
            key={t.id}
            className={`animate-fade-up pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
              TOAST_STYLES[t.kind] || TOAST_STYLES.info
            }`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X className="h-4 w-4 opacity-60 hover:opacity-100" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- modal --------------------------------- */

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card animate-fade-up w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3.5 dark:border-ink-800">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-ink-200 px-5 py-3.5 dark:border-ink-800">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ pagination ------------------------------ */

export function Pagination({ meta, onPage }) {
  if (!meta || meta.pages <= 1) return null;
  const { page, pages, total, limit } = meta;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-4 py-3 dark:border-ink-800">
      <p className="text-sm text-ink-500 dark:text-ink-400">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5"
          disabled={!meta.hasPrev}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="px-3 text-sm text-ink-600 dark:text-ink-300">
          {page} / {pages}
        </span>
        <button
          type="button"
          className="btn-secondary px-3 py-1.5"
          disabled={!meta.hasNext}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- avatar --------------------------------- */

const AVATAR_TONES = [
  'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
];

export function Avatar({ name = '', src, size = 'md' }) {
  const sizes = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-14 w-14 text-lg' };
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
  // Stable colour per person so the same face keeps the same tone across pages.
  const tone = AVATAR_TONES[name.length % AVATAR_TONES.length];

  if (src) {
    return <img src={src} alt={name} className={`${sizes[size]} rounded-full object-cover`} />;
  }
  return (
    <span
      className={`${sizes[size]} ${tone} inline-flex shrink-0 items-center justify-center rounded-full font-semibold`}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  );
}

/* -------------------------------- stats --------------------------------- */

export function StatCard({ label, value, sub, icon: Icon, tone = 'blue' }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      {Icon && (
        <span className={`rounded-lg p-2.5 ${TONES[tone]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</p>
        <p className="text-2xl font-semibold text-ink-900 dark:text-ink-50">{value}</p>
        {sub && <p className="truncate text-xs text-ink-500 dark:text-ink-400">{sub}</p>}
      </div>
    </div>
  );
}
