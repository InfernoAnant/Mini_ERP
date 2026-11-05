import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAction, useLoad } from '../../api/hooks';
import type { BomDTO, ProductOption, WorkCenter } from '../../api/types';
import ListPage from '../../components/ListPage';
import LogsButton from '../../components/LogsButton';
import { ErrorBanner, Field, Notice, PageHeader, qty, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export function BomListPage() {
  const { can } = useAuth();
  return (
    <ListPage<BomDTO>
      title="Bills of Materials"
      endpoint="/boms"
      searchPlaceholder="Search reference or product…"
      newPath={can('BOM', 'create') ? '/boms/new' : undefined}
      rowPath={(b) => `/boms/${b.id}`}
      columns={[
        { header: 'Reference', cell: (b) => <span className="font-medium">{b.reference}</span> },
        { header: 'Finished product', cell: (b) => b.product.name },
        { header: 'Makes', cell: (b) => qty(b.outputQty), className: 'text-right' },
        { header: 'Components', cell: (b) => b.components.map((c) => `${qty(c.quantity)} × ${c.productName}`).join(', ') },
        { header: 'Operations', cell: (b) => b.operations.map((o) => `${o.name} ${o.durationMinutes}m`).join(' → ') },
      ]}
    />
  );
}

type CompRow = { key: number; productId: string; quantity: string };
type OpRow = { key: number; name: string; workCenterId: string; durationMinutes: string };
let k = 0;

export function BomFormPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { can } = useAuth();
  const bom = useLoad(() => (isNew ? Promise.resolve(null) : api.get<BomDTO>(`/boms/${id}`)), [id]);
  const products = useLoad(() => api.get<ProductOption[]>('/products/options'), []);
  const centers = useLoad(() => api.get<WorkCenter[]>('/work-centers'), []);
  const [productId, setProductId] = useState('');
  const [outputQty, setOutputQty] = useState('1');
  const [comps, setComps] = useState<CompRow[]>([{ key: ++k, productId: '', quantity: '1' }]);
  const [ops, setOps] = useState<OpRow[]>([]);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const editable = isNew ? can('BOM', 'create') : can('BOM', 'edit');

  useEffect(() => {
    const b = bom.data;
    if (!b) return;
    setProductId(String(b.product.id));
    setOutputQty(String(b.outputQty));
    setComps(b.components.map((c) => ({ key: ++k, productId: String(c.productId), quantity: String(c.quantity) })));
    setOps(b.operations.map((o) => ({ key: ++k, name: o.name, workCenterId: String(o.workCenter.id), durationMinutes: String(o.durationMinutes) })));
  }, [bom.data]);

  if (!isNew && !bom.data) return bom.error ? <ErrorBanner message={bom.error} /> : <Spinner />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const body = {
      productId: Number(productId),
      outputQty: Number(outputQty),
      components: comps.map((c) => ({ productId: Number(c.productId), quantity: Number(c.quantity) })),
      operations: ops.map((o) => ({ name: o.name, workCenterId: Number(o.workCenterId), durationMinutes: Number(o.durationMinutes) })),
    };
    const res = await action.run(() => (isNew ? api.post<BomDTO>('/boms', body) : api.patch<BomDTO>(`/boms/${id}`, body)));
    if (!res) return;
    if (isNew) navigate(`/boms/${res.id}`, { replace: true });
    else {
      bom.setData(res);
      setSaved(true);
    }
  };

  const productSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!editable} required aria-label={label}>
      <option value="">Choose a product…</option>
      {products.data?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={isNew ? 'New bill of materials' : bom.data?.reference}
        back={
          <Link to="/boms" className="text-sm text-slate-500 hover:text-slate-800">
            ← Bills of Materials
          </Link>
        }
      >
        {bom.data && <LogsButton module="BOM" recordId={bom.data.id} />}
      </PageHeader>
      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {saved && <Notice tone="success">Saved. Existing manufacturing orders keep the components they were created with.</Notice>}
      <form onSubmit={submit} className="grid gap-4">
        <div className="card grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Finished product">{productSelect(productId, setProductId, 'Finished product')}</Field>
          <Field label="Quantity this BoM makes">
            <input className="input" type="number" min="0.001" step="0.001" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} disabled={!editable} required />
          </Field>
        </div>

        <div className="card">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Components</h2>
          <div className="grid gap-2 p-4">
            {comps.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <div className="flex-1">{productSelect(c.productId, (v) => setComps(comps.map((x) => (x.key === c.key ? { ...x, productId: v } : x))), 'Component')}</div>
                <input
                  className="input w-28 text-right"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={c.quantity}
                  aria-label="Component quantity"
                  onChange={(e) => setComps(comps.map((x) => (x.key === c.key ? { ...x, quantity: e.target.value } : x)))}
                  disabled={!editable}
                  required
                />
                {editable && (
                  <button type="button" className="text-slate-400 hover:text-rose-600" aria-label="Remove component" onClick={() => setComps(comps.filter((x) => x.key !== c.key))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {editable && (
              <button type="button" className="w-fit text-sm text-indigo-600 hover:underline" onClick={() => setComps([...comps, { key: ++k, productId: '', quantity: '1' }])}>
                + Add a component
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Operations (become work orders)</h2>
          <div className="grid gap-2 p-4">
            {ops.map((o) => (
              <div key={o.key} className="flex flex-wrap items-center gap-2">
                <input
                  className="input min-w-[10rem] flex-1"
                  placeholder="Operation (e.g. Assembly)"
                  value={o.name}
                  aria-label="Operation name"
                  onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))}
                  disabled={!editable}
                  required
                />
                <select
                  className="input w-48"
                  value={o.workCenterId}
                  aria-label="Work center"
                  onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, workCenterId: e.target.value } : x)))}
                  disabled={!editable}
                  required
                >
                  <option value="">Work center…</option>
                  {centers.data?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input w-28 text-right"
                  type="number"
                  min="1"
                  step="1"
                  value={o.durationMinutes}
                  aria-label="Minutes"
                  onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, durationMinutes: e.target.value } : x)))}
                  disabled={!editable}
                  required
                />
                <span className="text-sm text-slate-500">min</span>
                {editable && (
                  <button type="button" className="text-slate-400 hover:text-rose-600" aria-label="Remove operation" onClick={() => setOps(ops.filter((x) => x.key !== o.key))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {editable && (
              <button
                type="button"
                className="w-fit text-sm text-indigo-600 hover:underline"
                onClick={() => setOps([...ops, { key: ++k, name: '', workCenterId: '', durationMinutes: '30' }])}
              >
                + Add an operation
              </button>
            )}
          </div>
        </div>

        {editable && (
          <div>
            <button type="submit" className="btn-primary" disabled={action.busy}>
              {action.busy ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
