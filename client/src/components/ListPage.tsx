import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLoad } from '../api/hooks';
import type { Paged } from '../api/types';
import { Empty, ErrorBanner, label, PageHeader, Spinner, StatusBadge } from './ui';

export type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string };

type Props<T extends { id: number }> = {
  title: string;
  endpoint: string;
  columns: Column<T>[];
  rowPath: (row: T) => string;
  statuses?: string[];
  statusOf?: (row: T) => string;
  kanbanTitle?: (row: T) => ReactNode;
  kanbanBody?: (row: T) => ReactNode;
  newPath?: string;
  searchPlaceholder?: string;
  /** Show the "My" and "Late" toggles (orders only). */
  orderFilters?: boolean;
  actions?: ReactNode;
};

/** Search + filters + list/kanban + pagination. Filters live in the URL so dashboard chips can deep-link. */
export default function ListPage<T extends { id: number }>(props: Props<T>) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [qInput, setQInput] = useState(params.get('q') ?? '');
  const view = params.get('view') === 'kanban' && props.statuses ? 'kanban' : 'list';
  const query = {
    q: params.get('q') ?? undefined,
    status: params.get('status') ?? undefined,
    mine: params.get('mine') === '1' ? 'true' : undefined,
    late: params.get('late') === '1' ? 'true' : undefined,
    page: params.get('page') ?? '1',
    pageSize: view === 'kanban' ? '100' : '20',
  };
  const { data, error, loading } = useLoad(() => api.get<Paged<T>>(props.endpoint, query), [props.endpoint, params.toString()]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = Number(query.page);

  return (
    <div>
      <PageHeader title={props.title}>
        {props.actions}
        {props.newPath && (
          <Link to={props.newPath} className="btn-primary">
            New
          </Link>
        )}
      </PageHeader>

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <form
          className="flex min-w-48 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: qInput.trim() });
          }}
        >
          <input
            className="input"
            placeholder={props.searchPlaceholder ?? 'Search…'}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            aria-label="Search"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
        {props.statuses && (
          <select
            className="input w-auto"
            value={query.status ?? ''}
            onChange={(e) => update({ status: e.target.value })}
            aria-label="Status filter"
          >
            <option value="">All statuses</option>
            {props.statuses.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        )}
        {props.orderFilters && (
          <>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={params.get('mine') === '1'}
                onChange={(e) => update({ mine: e.target.checked ? '1' : null })}
              />
              My
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={params.get('late') === '1'}
                onChange={(e) => update({ late: e.target.checked ? '1' : null })}
              />
              Late
            </label>
          </>
        )}
        {props.statuses && (
          <div className="ml-auto flex overflow-hidden rounded-md border border-slate-300 text-sm">
            {(['list', 'kanban'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => update({ view: v === 'list' ? null : v })}
                className={`px-3 py-1.5 ${view === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {v === 'list' ? 'List' : 'Kanban'}
              </button>
            ))}
          </div>
        )}
      </div>

      <ErrorBanner message={error} />
      {loading && !data ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <div className="card">
          <Empty>Nothing here yet.</Empty>
        </div>
      ) : view === 'kanban' && props.statuses && props.statusOf ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {props.statuses.map((s) => {
            const items = data.items.filter((r) => props.statusOf?.(r) === s);
            return (
              <div key={s} className="w-64 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <StatusBadge status={s} />
                  <span className="text-xs text-slate-500">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((r) => (
                    <Link key={r.id} to={props.rowPath(r)} className="card block p-3 hover:border-indigo-300">
                      <div className="text-sm font-medium">{props.kanbanTitle?.(r)}</div>
                      <div className="mt-1 text-xs text-slate-500">{props.kanbanBody?.(r)}</div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                {props.columns.map((c) => (
                  <th key={c.header} className={`th ${c.className ?? ''}`}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(props.rowPath(r))}>
                  {props.columns.map((c) => (
                    <td key={c.header} className={`td ${c.className ?? ''}`}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && view === 'list' && pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            ‹ Prev
          </button>
          <span>
            Page {page} of {pages} · {data.total} records
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= pages}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
