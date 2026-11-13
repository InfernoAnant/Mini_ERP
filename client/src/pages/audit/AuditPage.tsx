import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useLoad } from '../../api/hooks';
import type { AuditPage as AuditPageDTO, Ref } from '../../api/types';
import { dateTime, Empty, ErrorBanner, label, PageHeader, Spinner } from '../../components/ui';

const MODULES = ['SALES', 'PURCHASE', 'MANUFACTURING', 'BOM', 'PRODUCTS', 'STOCK', 'USERS'];
const ACTIONS = ['CREATE', 'UPDATE', 'STATUS_CHANGE', 'DELETE'];

function Tile({ title, value, sub, tone }: { title: string; value: number; sub: string; tone: string }) {
  return (
    <div className={`rounded-lg p-4 text-white ${tone}`}>
      <div className="text-sm opacity-90">{title}</div>
      <div className="text-3xl font-semibold">{value}</div>
      <div className="text-xs opacity-80">{sub}</div>
    </div>
  );
}

export default function AuditPage() {
  const [params, setParams] = useSearchParams();
  const q = Object.fromEntries(params.entries());
  const { data, error } = useLoad(
    () => api.get<AuditPageDTO>('/audit', { ...q, to: q.to ? `${q.to}T23:59:59` : undefined }),
    [params.toString()],
  );
  const users = useLoad(() => api.get<Ref[]>('/users/options'), []);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next);
  };
  const page = Number(params.get('page') ?? 1);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Audit Logs">
        {params.toString() && (
          <button type="button" className="btn-secondary" onClick={() => setParams({})}>
            Reset filters
          </button>
        )}
      </PageHeader>
      {data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile title="Total logs" value={data.summary.total} sub="matching filters" tone="bg-sky-800" />
          <Tile title="Create actions" value={data.summary.created} sub="records created" tone="bg-emerald-600" />
          <Tile title="Update actions" value={data.summary.updated} sub="incl. status changes" tone="bg-amber-600" />
          <Tile title="Delete actions" value={data.summary.deleted} sub="records deleted" tone="bg-rose-600" />
        </div>
      )}
      <div className="card mb-4 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <input
          className="input"
          type="date"
          aria-label="From"
          value={params.get('from') ?? ''}
          onChange={(e) => set('from', e.target.value)}
        />
        <input
          className="input"
          type="date"
          aria-label="To"
          value={params.get('to') ?? ''}
          onChange={(e) => set('to', e.target.value)}
        />
        <select
          className="input"
          aria-label="User"
          value={params.get('userId') ?? ''}
          onChange={(e) => set('userId', e.target.value)}
        >
          <option value="">All users</option>
          {users.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Module"
          value={params.get('module') ?? ''}
          onChange={(e) => set('module', e.target.value)}
        >
          <option value="">All modules</option>
          {MODULES.map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Action"
          value={params.get('action') ?? ''}
          onChange={(e) => set('action', e.target.value)}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        {params.get('recordId') && (
          <button type="button" className="btn-secondary" onClick={() => set('recordId', '')}>
            Record #{params.get('recordId')} ✕
          </button>
        )}
      </div>
      <ErrorBanner message={error} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          {data.items.length === 0 ? (
            <Empty>No log entries match.</Empty>
          ) : (
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    'Date & time',
                    'User',
                    'Module',
                    'Record type',
                    'Record',
                    'Action',
                    'Field',
                    'Old value',
                    'New value',
                    'Note',
                  ].map((h) => (
                    <th key={h} className="th whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="td whitespace-nowrap">{dateTime(r.createdAt)}</td>
                    <td className="td whitespace-nowrap">{r.user?.name ?? 'System'}</td>
                    <td className="td">{label(r.module)}</td>
                    <td className="td">{r.recordType}</td>
                    <td className="td whitespace-nowrap">{r.reference ?? `#${r.recordId}`}</td>
                    <td className="td">{label(r.action)}</td>
                    <td className="td">{r.field ?? '—'}</td>
                    <td className="td max-w-[14rem] truncate" title={r.oldValue ?? ''}>
                      {r.oldValue ?? '—'}
                    </td>
                    <td className="td max-w-[14rem] truncate" title={r.newValue ?? ''}>
                      {r.newValue ?? '—'}
                    </td>
                    <td className="td max-w-[14rem] truncate text-slate-500" title={r.note ?? ''}>
                      {r.note ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {data && pages > 1 && (
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>
            ‹ Prev
          </button>
          <span className="self-center">
            Page {page} of {pages} · {data.total} entries
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= pages}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('page', String(page + 1));
              setParams(next);
            }}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
