import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useLoad } from '../../api/hooks';
import type { OperationDTO, Paged } from '../../api/types';
import { OperationRow } from '../../components/OperationsPanel';
import { Empty, ErrorBanner, PageHeader, Spinner } from '../../components/ui';

const TABS = [
  ['PLACED', 'Awaiting confirmation'],
  ['CONFIRMED', 'Confirmed'],
  ['REJECTED', 'Rejected'],
] as const;

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'PLACED';
  const page = Number(params.get('page') ?? 1);
  const { data, error, reload } = useLoad(() => api.get<Paged<OperationDTO>>('/operations', { status, page }), [status, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Stock Operations" />
      <p className="mb-4 text-sm text-slate-600">
        Deliveries, receipts, production and adjustments are placed first. Stock only moves when a supervisor or manager confirms them.
      </p>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => setParams({ status: key })}
            className={`px-4 py-2 text-sm font-medium ${status === key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {text}
          </button>
        ))}
      </div>
      <ErrorBanner message={error} />
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <div className="card">
          <Empty>No operations here.</Empty>
        </div>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {data.items.map((op) => (
            <OperationRow key={op.id} op={op} onChanged={() => void reload()} showSource />
          ))}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setParams({ status, page: String(page - 1) })}>
            ‹ Prev
          </button>
          <span className="self-center">
            Page {page} of {pages}
          </span>
          <button type="button" className="btn-secondary" disabled={page >= pages} onClick={() => setParams({ status, page: String(page + 1) })}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
