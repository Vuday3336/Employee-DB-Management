import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  Star,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Avatar, humanise } from '../components/ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'manager', 'employee'], end: true },
  { to: '/employees', label: 'Employees', icon: Users, roles: ['admin', 'manager', 'employee'] },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['admin', 'manager', 'employee'] },
  { to: '/leave', label: 'Leave', icon: CalendarDays, roles: ['admin', 'manager', 'employee'] },
  { to: '/approvals', label: 'Approvals', icon: ClipboardList, roles: ['admin', 'manager'] },
  { to: '/reviews', label: 'Reviews', icon: Star, roles: ['admin', 'manager', 'employee'] },
  { to: '/org-chart', label: 'Org chart', icon: Network, roles: ['admin', 'manager'] },
  { to: '/departments', label: 'Departments', icon: Building2, roles: ['admin', 'manager', 'employee'] },
  { to: '/admin', label: 'Administration', icon: ShieldCheck, roles: ['admin'] },
  { to: '/audit', label: 'Audit trail', icon: ScrollText, roles: ['admin'] },
];

const ROLE_TONE = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200',
  manager: 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200',
  employee: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme, unread } = useUI();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  const links = NAV.filter((item) => item.roles.includes(user?.role));
  const displayName = user?.employee?.fullName || user?.email || 'Signed in';

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-full">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ink-200 bg-white transition-transform dark:border-ink-800 dark:bg-ink-900 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-ink-200 px-5 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              EC
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">EmpCore</p>
              <p className="text-[11px] text-ink-500 dark:text-ink-400">HR operations</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost p-1 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                    : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-200 p-3 dark:border-ink-800">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar name={displayName} src={user?.employee?.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{displayName}</p>
              <span className={`badge mt-0.5 ${ROLE_TONE[user?.role] || ROLE_TONE.employee}`}>
                {humanise(user?.role || '')}
              </span>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="btn-ghost mt-1 w-full justify-start">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90 sm:px-6">
          <button
            type="button"
            className="btn-ghost p-2 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <h1 className="flex-1 truncate text-base font-semibold text-ink-900 dark:text-ink-50">
            {links.find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)))?.label ||
              'EmpCore'}
          </h1>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn-ghost p-2"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          <NavLink to="/notifications" className="btn-ghost relative p-2" aria-label="Notifications">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </NavLink>

          <NavLink to="/settings" className="btn-ghost p-2" aria-label="Settings">
            <Settings className="h-5 w-5" />
          </NavLink>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>

        <footer className="border-t border-ink-200 px-6 py-4 text-xs text-ink-400 dark:border-ink-800">
          EmpCore · role-based HR operations · signed in as {user?.role}
        </footer>
      </div>
    </div>
  );
}
