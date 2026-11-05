import { type ReactNode, useEffect } from 'react';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export const money = (n: number | null | undefined) => inr.format(n ?? 0);
export const qty = (n: number | null | undefined) => qtyFmt.format(n ?? 0);
export const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
/** yyyy-mm-dd for <input type="date"> */
export const dateInput = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
export const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <span>{message}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="text-rose-500 hover:text-rose-700" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warn' }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  PARTIALLY_DELIVERED: 'bg-amber-100 text-amber-800',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  TO_CLOSE: 'bg-violet-100 text-violet-800',
  FULLY_DELIVERED: 'bg-emerald-100 text-emerald-800',
  FULLY_RECEIVED: 'bg-emerald-100 text-emerald-800',
  DONE: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-rose-100 text-rose-700',
  PLACED: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-rose-100 text-rose-700',
  PENDING: 'bg-slate-100 text-slate-700',
  LATE: 'bg-rose-600 text-white',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {label(status)}
    </span>
  );
}

export function Field({ label: text, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{text}</span>
      {children}
    </label>
  );
}

export function PageHeader({ title, children, back }: { title: ReactNode; children?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {back}
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Spinner() {
  return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 px-4 py-3 font-semibold">{title}</div>
        <div className="px-4 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-8 text-center text-sm text-slate-500">{children}</div>;
}
