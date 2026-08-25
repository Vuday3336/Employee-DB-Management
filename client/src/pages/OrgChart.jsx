import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Network } from 'lucide-react';
import { useFetch } from '../hooks/useApi';
import { Avatar, Card, EmptyState, ErrorNote, PageLoader } from '../components/ui';

/**
 * Renders the tree the API builds with a single $graphLookup over the self-referencing
 * Employee.manager edge — no per-level round trips from the client.
 */
export default function OrgChart() {
  const { data: roots, loading, error, refetch } = useFetch('/employees/org-chart');

  if (loading) return <PageLoader label="Building the org chart" />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  const total = (roots || []).reduce((sum, root) => sum + countNodes(root), 0);

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Org chart</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          {total} people in your view. Managers see their own reporting sub-tree; admins see every root.
        </p>
      </header>

      <Card padded={false}>
        {roots?.length ? (
          <div className="overflow-x-auto p-5">
            <ul className="space-y-2">
              {roots.map((root) => (
                <TreeNode key={root._id} node={root} depth={0} />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState title="No reporting structure yet" hint="Assign managers to employees to build the tree." icon={Network} />
        )}
      </Card>
    </div>
  );
}

function countNodes(node) {
  return 1 + (node.reports || []).reduce((sum, child) => sum + countNodes(child), 0);
}

function TreeNode({ node, depth }) {
  // Collapse deep branches by default so a large org stays readable.
  const [open, setOpen] = useState(depth < 2);
  const hasReports = node.reports?.length > 0;
  const teamSize = countNodes(node) - 1;

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white p-2.5 transition hover:border-brand-300 dark:border-ink-800 dark:bg-ink-900"
        style={{ marginLeft: depth * 20 }}
      >
        {hasReports ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="btn-ghost p-1"
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.name}'s reports` : `Expand ${node.name}'s reports`}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-6" />
        )}

        <Avatar name={node.name} src={node.avatarUrl} size="sm" />

        <div className="min-w-0 flex-1">
          <Link
            to={`/employees/${node._id}`}
            className="block truncate text-sm font-medium text-ink-900 hover:text-brand-600 dark:text-ink-50"
          >
            {node.name}
          </Link>
          <span className="block truncate text-xs text-ink-500 dark:text-ink-400">{node.jobTitle}</span>
        </div>

        {teamSize > 0 && (
          <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">
            {teamSize} in team
          </span>
        )}
      </div>

      {hasReports && open && (
        <ul className="mt-2 space-y-2">
          {node.reports.map((child) => (
            <TreeNode key={child._id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
