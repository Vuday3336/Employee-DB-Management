import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlarmClock,
  CalendarClock,
  CalendarCheck,
  Clock,
  LogIn,
  LogOut,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import { Card, EmptyState, ErrorNote, PageLoader, StatCard, StatusBadge, Spinner, humanise } from '../components/ui';
import { fmtDate, fmtHours, fmtTime, dateRangeLabel } from '../lib/format';

const CHART_COLORS = ['#3363f7', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];

export default function Dashboard() {
  const { isApprover } = useAuth();
  return isApprover ? <ManagerDashboard /> : <EmployeeDashboard />;
}

/* ------------------------- admin / manager view ------------------------- */

function ManagerDashboard() {
  const { data, loading, error, refetch } = useFetch('/dashboard');

  if (loading) return <PageLoader label="Building your dashboard" />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!data) return null;

  const { kpis, headcountByDepartment, leave, attendanceTrend, hiringTrend, attendance, stalePendingApprovals } = data;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Overview</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Every figure below is scoped to <strong>{data.scope}</strong> — the API restricts the aggregation to
          the employees you are allowed to see.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Headcount" value={kpis.headcount} sub={`${kpis.newThisMonth} joined this month`} icon={Users} tone="blue" />
        <StatCard
          label="Attendance rate"
          value={`${kpis.attendanceRate}%`}
          sub={`${attendance.late} late · ${attendance.absent} absent this month`}
          icon={CalendarCheck}
          tone="green"
        />
        <StatCard
          label="Pending leave"
          value={kpis.pendingLeave}
          sub={kpis.pendingLeave ? 'Waiting on an approver' : 'Queue is clear'}
          icon={CalendarClock}
          tone={kpis.pendingLeave ? 'amber' : 'gray'}
        />
        <StatCard label="Away today" value={kpis.onLeaveToday} sub={`${kpis.draftReviews} draft reviews`} icon={AlarmClock} tone="purple" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Attendance rate, last 6 months" className="lg:col-span-2">
          {attendanceTrend.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={attendanceTrend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-ink-200 dark:text-ink-800" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="currentColor" className="text-ink-400" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="currentColor" className="text-ink-400" />
                <Tooltip formatter={(value) => `${value}%`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="rate" name="Attendance %" stroke="#3363f7" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No attendance recorded yet" hint="Rates appear once check-ins start arriving." />
          )}
        </Card>

        <Card title="Approved leave by type">
          {leave.byType.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={leave.byType}
                  dataKey="days"
                  nameKey="type"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={3}
                  label={({ type }) => humanise(type)}
                  labelLine={false}
                >
                  {leave.byType.map((entry, index) => (
                    <Cell key={entry.type} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value} days`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No approved leave yet" />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Headcount by department">
          {headcountByDepartment.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={headcountByDepartment} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-ink-200 dark:text-ink-800" />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} stroke="currentColor" className="text-ink-400" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="currentColor" className="text-ink-400" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="headcount" name="People" radius={[6, 6, 0, 0]}>
                  {headcountByDepartment.map((entry, index) => (
                    <Cell key={entry.department} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No departments yet" />
          )}
        </Card>

        <Card title="Hiring, last 12 months">
          {hiringTrend.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hiringTrend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-ink-200 dark:text-ink-800" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" className="text-ink-400" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="currentColor" className="text-ink-400" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="hires" name="New hires" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No recent hires" icon={UserPlus} />
          )}
        </Card>
      </div>

      {stalePendingApprovals.length > 0 && (
        <Card
          title="Waiting on a decision for more than 3 days"
          action={
            <Link to="/approvals" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
              Open approvals
            </Link>
          }
          padded={false}
        >
          <ul className="divide-y divide-ink-200 dark:divide-ink-800">
            {stalePendingApprovals.map((item) => (
              <li key={item._id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{item.employeeName}</p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">
                    {humanise(item.type)} · {item.days} day(s) from {fmtDate(item.startDate)}
                  </p>
                </div>
                <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
                  {item.waitingDays}d waiting
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* --------------------------- employee view ------------------------------ */

function EmployeeDashboard() {
  const { data, loading, error, refetch } = useFetch('/dashboard/me');
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);

  const punch = async (action) => {
    setBusy(true);
    try {
      await api.post(`/attendance/${action}`);
      toast(action === 'check-in' ? 'Checked in — have a good day' : 'Checked out, see you tomorrow');
      refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoader label="Loading your day" />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!data?.linked) {
    return (
      <EmptyState
        title="Your account is not linked to an employee record"
        hint="Ask an administrator to connect your login to your HR profile — attendance and leave need it."
      />
    );
  }

  const { attendanceToday, balances, upcomingLeave, latestReview, monthSummary, pendingRequests } = data;
  const annual = balances.find((b) => b.type === 'annual');

  return (
    <div className="space-y-6">
      <Card title="Today">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="rounded-lg bg-brand-100 p-3 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
              <Clock className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
                  {attendanceToday ? 'You are marked' : 'Not checked in yet'}
                </p>
                {attendanceToday && <StatusBadge status={attendanceToday.status} />}
              </div>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {attendanceToday?.checkIn ? `In at ${fmtTime(attendanceToday.checkIn)}` : 'No check-in recorded'}
                {attendanceToday?.checkOut ? ` · Out at ${fmtTime(attendanceToday.checkOut)}` : ''}
                {attendanceToday?.workedMinutes ? ` · ${fmtHours(attendanceToday.workedMinutes)}` : ''}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || Boolean(attendanceToday?.checkIn)}
              onClick={() => punch('check-in')}
            >
              {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} Check in
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !attendanceToday?.checkIn || Boolean(attendanceToday?.checkOut)}
              onClick={() => punch('check-out')}
            >
              <LogOut className="h-4 w-4" /> Check out
            </button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Attendance this month"
          value={`${monthSummary.rate}%`}
          sub={`${monthSummary.presentDays}/${monthSummary.workingDays} days`}
          icon={CalendarCheck}
          tone="green"
        />
        <StatCard
          label="Annual leave left"
          value={annual ? annual.remaining : 0}
          sub={annual ? `of ${annual.total} days` : 'No policy assigned'}
          icon={CalendarClock}
          tone="blue"
        />
        <StatCard label="Hours logged" value={fmtHours(monthSummary.hours * 60)} sub="This month" icon={Clock} tone="purple" />
        <StatCard
          label="Pending requests"
          value={pendingRequests}
          sub={pendingRequests ? 'Awaiting your manager' : 'Nothing outstanding'}
          icon={TrendingUp}
          tone={pendingRequests ? 'amber' : 'gray'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Leave balances"
          action={
            <Link to="/leave" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
              Request leave
            </Link>
          }
        >
          <ul className="space-y-3">
            {balances.map((balance) => {
              const pct = balance.total ? Math.round((balance.used / balance.total) * 100) : 0;
              return (
                <li key={balance.type}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-ink-700 dark:text-ink-200">{balance.label}</span>
                    <span className="text-ink-500 dark:text-ink-400">
                      {balance.remaining} left of {balance.total}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Upcoming time off" padded={false}>
          {upcomingLeave.length ? (
            <ul className="divide-y divide-ink-200 dark:divide-ink-800">
              {upcomingLeave.map((leave) => (
                <li key={leave._id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{humanise(leave.type)} leave</p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">
                      {dateRangeLabel(leave.startDate, leave.endDate)} · {leave.days} day(s)
                    </p>
                  </div>
                  <StatusBadge status={leave.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No upcoming leave" hint="Anything you book will show up here." />
          )}
        </Card>
      </div>

      {latestReview && (
        <Card
          title="Latest performance review"
          action={
            <Link
              to={`/reviews/${latestReview._id}`}
              className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300"
            >
              View
            </Link>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
                Q{latestReview.period.quarter} {latestReview.period.year}
              </p>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                Reviewed by {latestReview.reviewer?.firstName} {latestReview.reviewer?.lastName}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={latestReview.status} />
              <span className="text-2xl font-semibold text-ink-900 dark:text-ink-50">{latestReview.rating}/5</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
