import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Route guard: no session goes to /login; a temporary password goes to /change-password. */
export default function RequireAuth() {
  const { token, mustChange } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (mustChange && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!mustChange && location.pathname === '/change-password') return <Navigate to="/" replace />;
  return <Outlet />;
}
