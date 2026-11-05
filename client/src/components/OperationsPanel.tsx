import { useState } from 'react';
import { api } from '../api/client';
import { useAction } from '../api/hooks';
import type { OperationDTO } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { dateTime, ErrorBanner, Field, label, Modal, qty, StatusBadge } from './ui';

/** Stock operations of one order: who placed what, and Confirm / Reject for supervisors and managers. */
export default function OperationsPanel({ operations, onChanged }: { operations: OperationDTO[]; onChanged: () => void }) {
  if (operations.length === 0) return null;
  return (
    <div className="card mt-4">
      <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Stock operations</h2>
      <ul className="divide-y divide-slate-100">
        {operations.map((op) => (
          <OperationRow key={op.id} op={op} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

export function OperationRow({ op, onChanged, showSource = false }: { op: OperationDTO; onChanged: () => void; showSource?: boolean }) {
  const { canConfirmOperation } = useAuth();
  const action = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const mayDecide = op.status === 'PLACED' && canConfirmOperation(op.type);

  const confirm = async () => {
    if (await action.run(() => api.post(`/operations/${op.id}/confirm`))) onChanged();
  };
  const reject = async () => {
    if (await action.run(() => api.post(`/operations/${op.id}/reject`, { reason }))) {
      setRejecting(false);
      onChanged();
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{op.reference}</span>
          <span className="text-slate-500">{label(op.type)}</span>
          <StatusBadge status={op.status} />
          {showSource && <span className="text-slate-500">· {op.source.reference}</span>}
        </div>
        {op.status === 'PLACED' &&
          (mayDecide ? (
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={action.busy} onClick={confirm}>
                Confirm
              </button>
              <button type="button" className="btn-danger" disabled={action.busy} onClick={() => setRejecting(true)}>
                Reject
              </button>
            </div>
          ) : (
            <span className="text-xs text-amber-700">Awaiting supervisor/manager confirmation</span>
          ))}
      </div>
      <div className="mt-1 text-sm text-slate-600">
        {op.lines.map((l) => (
          <span key={l.productId} className="mr-3">
            {op.type === 'ADJUSTMENT' ? `${l.productName} → set to ${qty(l.quantity)}` : `${qty(l.quantity)} × ${l.productName}`}
          </span>
        ))}
        {op.reason && <span className="text-slate-500">· {op.reason}</span>}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Placed by {op.placedBy?.name ?? '—'} · {dateTime(op.placedAt)}
        {op.decidedBy && ` · ${op.status === 'CONFIRMED' ? 'Confirmed' : 'Rejected'} by ${op.decidedBy.name} · ${dateTime(op.decidedAt)}`}
        {op.rejectReason && ` · "${op.rejectReason}"`}
      </div>
      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {rejecting && (
        <Modal
          title={`Reject ${op.reference}`}
          onClose={() => setRejecting(false)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setRejecting(false)}>
                Back
              </button>
              <button type="button" className="btn-danger" disabled={action.busy || reason.trim().length < 2} onClick={reject}>
                Reject
              </button>
            </>
          }
        >
          <Field label="Reason">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goods damaged in transit" autoFocus />
          </Field>
        </Modal>
      )}
    </li>
  );
}
