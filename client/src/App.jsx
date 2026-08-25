import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { UIProvider } from './context/UIContext';
import { RequireAuth, RequireRole, RedirectIfAuthed } from './components/RouteGuards';
import { PageLoader, ToastStack } from './components/ui';
import AppLayout from './layouts/AppLayout';

// Route-level code splitting keeps the initial bundle small.
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Leave = lazy(() => import('./pages/Leave'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Reviews = lazy(() => import('./pages/Reviews'));
const ReviewDetail = lazy(() => import('./pages/ReviewDetail'));
const OrgChart = lazy(() => import('./pages/OrgChart'));
const Departments = lazy(() => import('./pages/Departments'));
const Admin = lazy(() => import('./pages/Admin'));
const AuditTrail = lazy(() => import('./pages/AuditTrail'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UIProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route element={<RedirectIfAuthed />}>
                <Route path="/login" element={<Login />} />
              </Route>

              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="employees" element={<Employees />} />
                  <Route path="employees/:id" element={<EmployeeDetail />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route path="leave" element={<Leave />} />
                  <Route path="leave/:id" element={<Leave />} />
                  <Route path="reviews" element={<Reviews />} />
                  <Route path="reviews/:id" element={<ReviewDetail />} />
                  <Route path="departments" element={<Departments />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="settings" element={<Settings />} />

                  <Route element={<RequireRole roles={['admin', 'manager']} />}>
                    <Route path="approvals" element={<Approvals />} />
                    <Route path="org-chart" element={<OrgChart />} />
                  </Route>

                  <Route element={<RequireRole roles={['admin']} />}>
                    <Route path="admin" element={<Admin />} />
                    <Route path="audit" element={<AuditTrail />} />
                  </Route>

                  <Route path="404" element={<NotFound />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
          <ToastStack />
        </UIProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
