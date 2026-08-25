import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, LogIn, LogOut, Users } from 'lucide-react';
import api, { downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useFetch } from '../hooks/useApi';
import {
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  Spinner,
  StatCard,
  StatusBadge,
  humanise,
} from '../components/ui';
import { dayjs, fmtHours, fmtMonth, fmtTime, monthKey } from '../lib/format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CELL_STYLES = {
  present: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  late: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  half_day: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200',
  absent: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
  on_leave: 'bg-brand-100 text-brand-900 dark:bg-brand-500/20 dark:text-brand-200',
  holiday: 'bg-purple-100 text-purple-900 dark:bg-purple-500/20 dark:text-purple-200',
  weekend: 'bg-ink-100 text-ink-400 dark:bg-ink-800/60 dark:text-ink-500',
};

export default function Attendance() {
  const { user, isApprover, employeeId } = useAuth();
  const { toast } = useUI();

  const [month, setMonth] = useState(monthKey());
  const [subject, setSubject] = useState(employeeId || '');
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(null);

  const calendarUrl = `/attendance/calendar?month=${month}${subject ? `&employee=${subject}` : ''}`;
  const { data: calendar, loading, error, refetch } = useFetch(calendarUrl, { deps: [calendarUrl] });
  const { data: team } = useFetch('/employees/lookup', { enabled: isApprover });
  const { data: todayRecord, refetch: refetchToday } = useFetch('/attendance/today');

  const isOwnCalendar = String(subject) === String(employeeId);

  const punch = async (action) => {
    setBusy(true);
    try {
      await api.post(`/attendance/${action}`);
      toast(action === 'check-in' ? 'Checked in' : 'Checked out');
      refetchToday();
      if (isOwnCalendar) refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      await downloadCsv(
        `/attendance/export?month=${month}${subject ? `&employee=${subject}` : ''}`,
        `attendance-${month}.csv`
      );
      toast('Export downloaded');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const shiftMonth = (delta) => setMonth(dayjs.utc(`${month}-01`).add(delta, 'month').format('YYYY-MM'));

  // Blank cells so the 1st lands under its real weekday column.
  const leadingBlanks = useMemo(() => {
    if (!calendar?.days?.length) return [];
    return Array.from({ length: calendar.days[0].weekday }, (_, i) => i);
  }, [calendar]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Attendance</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {isApprover ? 'Your own record, or any member of your team.' : 'Your daily attendance record.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isApprover && (
            <button type="button" className="btn-secondary" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || Boolean(todayRecord?.checkIn)}
            onClick={() => punch('check-in')}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} Check in
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !todayRecord?.checkIn || Boolean(todayRecord?.checkOut)}
            onClick={() => punch('check-out')}
          >
            <LogOut className="h-4 w-4" /> Check out
          </button>
        </div>
      </header>

      {todayRecord && (
        <div className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm dark:border-ink-800 dark:bg-ink-900">
          Today: <StatusBadge status={todayRecord.status} />{' '}
          <span className="text-ink-500 dark:text-ink-400">
            in {fmtTime(todayRecord.checkIn)}
            {todayRecord.checkOut ? ` · out ${fmtTime(todayRecord.checkOut)} · ${fmtHours(todayRecord.workedMinutes)}` : ''}
          </span>
        </div>
      )}

      {isApprover && (
        <Card>
          <label className="label" htmlFor="subject">
            Whose calendar?
          </label>
          <select
            id="subject"
            className="input max-w-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value={employeeId || ''}>My attendance</option>
            {(team || [])
              .filter((m) => m._id !== employeeId)
              .map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name} — {m.jobTitle}
                </option>
              ))}
          </select>
        </Card>
      )}

      {error && <ErrorNote message={error} onRetry={refetch} />}

      {calendar?.summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Attendance rate" value={`${calendar.summary.rate}%`} sub={fmtMonth(`${month}-01`)} tone="green" icon={Users} />
          <StatCard label="Present" value={`${calendar.summary.presentDays}/${calendar.summary.workingDays}`} sub="Working days" tone="blue" />
          <StatCard label="Late arrivals" value={calendar.summary.lateDays} sub="This month" tone="amber" />
          <StatCard label="Hours logged" value={`${calendar.summary.hours}h`} sub="This month" tone="purple" />
        </div>
      )}

      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3 dark:border-ink-800">
          <button type="button" className="btn-ghost p-2" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{fmtMonth(`${month}-01`)}</h3>
          <button
            type="button"
            className="btn-ghost p-2"
            onClick={() => shiftMonth(1)}
            disabled={month >= monthKey()}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-500">
            <Spinner /> Loading calendar…
          </div>
        ) : calendar ? (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((day) => (
                <div key={day} className="pb-1 text-center text-xs font-semibold text-ink-400">
                  {day}
                </div>
              ))}
              {leadingBlanks.map((i) => (
                <div key={`blank-${i}`} />
              ))}
              {calendar.days.map((day) => {
                const label = day.status ? humanise(day.status) : 'Not marked';
                const clickable = isApprover && !isOwnCalendar;
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && setCorrecting(day)}
                    title={`${day.date} · ${label}${day.holidayName ? ` (${day.holidayName})` : ''}`}
                    className={`flex aspect-square flex-col items-center justify-center rounded-lg border border-transparent p-1 text-xs transition ${
                      CELL_STYLES[day.status] || 'bg-white text-ink-400 dark:bg-ink-950/40'
                    } ${clickable ? 'cursor-pointer hover:border-brand-400' : 'cursor-default'}`}
                  >
                    <span className="font-semibold">{Number(day.date.slice(-2))}</span>
                    {day.checkIn && <span className="mt-0.5 text-[10px] opacity-80">{fmtTime(day.checkIn)}</span>}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-3 border-t border-ink-200 pt-3 text-xs dark:border-ink-800">
              {Object.entries(CELL_STYLES).map(([status, className]) => (
                <span key={status} className="flex items-center gap-1.5">
                  <span className={`h-3 w-3 rounded ${className}`} />
                  <span className="text-ink-500 dark:text-ink-400">{humanise(status)}</span>
                </span>
              ))}
            </div>

            {isApprover && !isOwnCalendar && (
              <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
                Click any day to record a correction. You cannot edit your own attendance — the API refuses it.
              </p>
            )}
          </div>
        ) : (
          <EmptyState title="No calendar data" />
        )}
      </Card>

      <CorrectionModal
        day={correcting}
        employeeId={subject}
        onClose={() => setCorrecting(null)}
        onSaved={() => {
          setCorrecting(null);
          refetch();
        }}
      />
    </div>
  );
}

function CorrectionModal({ day, employeeId, onClose, onSaved }) {
  const { toast } = useUI();
  const [status, setStatus] = useState('present');
  const [checkIn, setCheckIn] = useState('09:00');
  const [checkOut, setCheckOut] = useState('17:30');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!day) return null;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const withTimes = ['present', 'late', 'half_day'].includes(status);
      await api.put('/attendance', {
        employee: employeeId,
        date: day.date,
        status,
        checkIn: withTimes ? `${day.date}T${checkIn}:00.000Z` : null,
        checkOut: withTimes ? `${day.date}T${checkOut}:00.000Z` : null,
        notes: notes || undefined,
      });
      toast(`${day.date} updated`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const withTimes = ['present', 'late', 'half_day'].includes(status);

  return (
    <Modal
      open={Boolean(day)}
      onClose={onClose}
      title={`Correct attendance — ${day.date}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="correction" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Save record
          </button>
        </>
      }
    >
      <form id="correction" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="c-status">Status</label>
          <select id="c-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday'].map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </select>
        </div>

        {withTimes && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-in">Check in</label>
              <input id="c-in" type="time" className="input" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="c-out">Check out</label>
              <input id="c-out" type="time" className="input" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="c-notes">Note (optional)</label>
          <input id="c-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for the correction" />
        </div>

        <p className="text-xs text-ink-500 dark:text-ink-400">
          Corrections are written to the audit trail with your name against them.
        </p>

        <ErrorNote message={error} />
      </form>
    </Modal>
  );
}
