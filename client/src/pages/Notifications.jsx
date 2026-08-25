import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useUI } from '../context/UIContext';
import { Card, EmptyState } from '../components/ui';
import { fromNow } from '../lib/format';

const TYPE_TONES = {
  leave_submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  leave_decided: 'bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300',
  review_submitted: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
  review_acknowledged: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  system: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
};

export default function Notifications() {
  const { notifications, unread, markRead, markAllRead } = useUI();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Notifications</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {unread ? `${unread} unread` : 'You are all caught up'} · delivered live over a websocket
          </p>
        </div>
        {unread > 0 && (
          <button type="button" className="btn-secondary" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </header>

      <Card padded={false}>
        {notifications.length ? (
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {notifications.map((notification) => {
              const body = (
                <>
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      notification.readAt ? 'bg-transparent' : 'bg-brand-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={`text-sm ${
                          notification.readAt
                            ? 'text-ink-600 dark:text-ink-300'
                            : 'font-semibold text-ink-900 dark:text-ink-50'
                        }`}
                      >
                        {notification.title}
                      </p>
                      <span className={`badge ${TYPE_TONES[notification.type] || TYPE_TONES.system}`}>
                        {notification.type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{notification.message}</p>
                    <p className="mt-1 text-xs text-ink-400">{fromNow(notification.createdAt)}</p>
                  </div>
                </>
              );

              return (
                <li key={notification._id}>
                  {notification.link ? (
                    <Link
                      to={notification.link}
                      onClick={() => !notification.readAt && markRead(notification._id)}
                      className="flex gap-3 px-5 py-4 transition hover:bg-ink-50 dark:hover:bg-ink-800/40"
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => !notification.readAt && markRead(notification._id)}
                      className="flex w-full gap-3 px-5 py-4 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800/40"
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="No notifications yet"
            hint="Leave decisions and shared reviews land here in real time."
            icon={Bell}
          />
        )}
      </Card>
    </div>
  );
}
