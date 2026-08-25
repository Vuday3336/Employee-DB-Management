import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-10 text-center">
      <Compass className="mx-auto h-10 w-10 text-ink-400" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-semibold text-ink-900 dark:text-ink-50">Page not found</h1>
      <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
        That route does not exist in EmpCore. It may have moved, or the link may be out of date.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  );
}
