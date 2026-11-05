import { Link } from 'react-router-dom';
import type { AuditModule } from '../api/types';
import { useAuth } from '../context/AuthContext';

/** Opens the audit log filtered to this record (only the system administrator sees audit logs). */
export default function LogsButton({ module, recordId }: { module: AuditModule; recordId: number }) {
  const { user } = useAuth();
  if (!user?.isSystemAdmin) return null;
  return (
    <Link to={`/audit?module=${module}&recordId=${recordId}`} className="btn-secondary">
      Logs
    </Link>
  );
}
