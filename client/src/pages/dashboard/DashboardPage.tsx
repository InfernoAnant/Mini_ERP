import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useLoad } from '../../api/hooks';
import type { DashboardDTO, Section } from '../../api/types';
import { ErrorBanner, label, PageHeader, qty, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

type CardDef = { title: string; path: string; section: Section | null; statuses: string[] };

const CHIP_STYLES: Record<string, string> = {
  DRAFT: 'border-slate-300 text-slate-700',
  CONFIRMED: 'border-sky-300 text-sky-800',
  PARTIALLY_DELIVERED: 'border-amber-300 text-amber-800',
  PARTIALLY_RECEIVED: 'border-amber-300 text-amber-800',
  IN_PROGRESS: 'border-amber-300 text-amber-800',
  TO_CLOSE: 'border-violet-300 text-violet-800',
  FULLY_DELIVERED: 'border-emerald-300 text-emerald-800',
  FULLY_RECEIVED: 'border-emerald-300 text-emerald-800',
  DONE: 'border-emerald-300 text-emerald-800',
};

function Chip({ to, count, text, tone }: { to: string; count: number; text: string; tone: string }) {
  return (
    <Link
      to={to}
      className={`flex min-w-[5.5rem] flex-col items-center rounded-lg border bg-white px-3 py-2 hover:shadow-sm ${tone}`}
    >
      <span className="text-xl font-semibold">{count}</span>
      <span className="text-center text-xs">{text}</span>
    </Link>
  );
}

function OrderCard({ title, path, section, statuses }: CardDef) {
  if (!section) return null;
  const row = (kind: 'all' | 'my') => (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-xs font-semibold uppercase text-slate-500">{kind === 'all' ? 'All' : 'My'}</span>
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Chip
            key={s}
            to={`${path}?status=${s}${kind === 'my' ? '&mine=1' : ''}`}
            count={section[kind][s] ?? 0}
            text={label(s)}
            tone={CHIP_STYLES[s] ?? 'border-slate-300'}
          />
        ))}
        <Chip
          to={`${path}?late=1${kind === 'my' ? '&mine=1' : ''}`}
          count={kind === 'all' ? section.late : section.myLate}
          text="Late"
          tone={
            (kind === 'all' ? section.late : section.myLate) > 0
              ? 'border-rose-400 text-rose-700'
              : 'border-slate-200 text-slate-400'
          }
        />
      </div>
    </div>
  );
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <Link to={path} className="text-sm text-indigo-600 hover:underline">
          Open →
        </Link>
      </div>
      <div className="grid gap-3">
        {row('all')}
        {row('my')}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error } = useLoad(() => api.get<DashboardDTO>('/dashboard'), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;

  const cards: CardDef[] = [
    {
      title: 'Sale Orders',
      path: '/sales',
      section: data.sales,
      statuses: ['DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED'],
    },
    {
      title: 'Purchase Orders',
      path: '/purchase',
      section: data.purchase,
      statuses: ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'],
    },
    {
      title: 'Manufacturing Orders',
      path: '/manufacturing',
      section: data.manufacturing,
      statuses: ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE'],
    },
  ];

  return (
    <div>
      <PageHeader title={`Good day, ${user?.name.split(' ')[0] ?? ''}`} />
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="grid gap-4">
          {cards.map((c) => (
            <OrderCard key={c.path} {...c} />
          ))}
          {cards.every((c) => !c.section) && (
            <div className="card p-6 text-sm text-slate-500">You don't have access to any order modules yet.</div>
          )}
        </div>
        <div className="grid h-fit gap-4">
          <Link to="/operations?status=PLACED" className="card block p-4 hover:border-indigo-300">
            <div className="text-sm text-slate-500">Stock operations awaiting confirmation</div>
            <div className={`text-3xl font-semibold ${data.awaitingConfirmation ? 'text-amber-600' : 'text-slate-400'}`}>
              {data.awaitingConfirmation}
            </div>
          </Link>
          <div className="card">
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Material shortages</h2>
            {data.shortages.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No shortages — every reservation is covered.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.shortages.map((s) => (
                  <li key={s.productId} className="flex items-center justify-between px-4 py-2 text-sm">
                    <Link to={`/products/${s.productId}`} className="hover:underline">
                      {s.name}
                    </Link>
                    <span className="font-semibold text-rose-600" title={`On hand ${qty(s.onHand)}, reserved ${qty(s.reserved)}`}>
                      {qty(s.free)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
