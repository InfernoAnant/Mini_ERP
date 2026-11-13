import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAction, useLoad } from '../../api/hooks';
import type { Contact, LedgerRow, OperationDTO, Paged, ProductDTO } from '../../api/types';
import LogsButton from '../../components/LogsButton';
import { dateTime, ErrorBanner, Field, label, Modal, Notice, PageHeader, qty, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

type Form = {
  name: string;
  unit: string;
  salesPrice: string;
  costPrice: string;
  initialStock: string;
  procureOnDemand: boolean;
  procurementType: '' | 'PURCHASE' | 'MANUFACTURING';
  vendorId: string;
  defaultBomId: string;
};

const empty: Form = {
  name: '',
  unit: 'Units',
  salesPrice: '',
  costPrice: '',
  initialStock: '0',
  procureOnDemand: false,
  procurementType: '',
  vendorId: '',
  defaultBomId: '',
};

export default function ProductFormPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const product = useLoad(() => (isNew ? Promise.resolve(null) : api.get<ProductDTO>(`/products/${id}`)), [id]);
  const vendors = useLoad(() => api.get<Contact[]>('/contacts', { type: 'VENDOR' }), []);
  const boms = useLoad(
    () => (isNew ? Promise.resolve([]) : api.get<{ id: number; reference: string }[]>('/boms/options', { productId: id })),
    [id],
  );
  const ledger = useLoad(() => (isNew ? Promise.resolve(null) : api.get<Paged<LedgerRow>>(`/products/${id}/ledger`)), [id]);
  const [form, setForm] = useState<Form>(empty);
  const [saved, setSaved] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const action = useAction();

  useEffect(() => {
    const p = product.data;
    if (!p) return;
    setForm({
      name: p.name,
      unit: p.unit,
      salesPrice: String(p.salesPrice),
      costPrice: String(p.costPrice),
      initialStock: '0',
      procureOnDemand: p.procureOnDemand,
      procurementType: p.procurementType ?? '',
      vendorId: p.vendor ? String(p.vendor.id) : '',
      defaultBomId: p.defaultBom ? String(p.defaultBom.id) : '',
    });
  }, [product.data]);

  if (!isNew && !product.data) return product.error ? <ErrorBanner message={product.error} /> : <Spinner />;
  const p = product.data;
  const editable = isNew
    ? can('PRODUCTS', 'create')
    : can('PRODUCTS', 'edit') && (user?.access.PRODUCTS === 'ADMIN' || user?.isSystemAdmin || p?.createdById === user?.id);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    const body = {
      name: form.name,
      unit: form.unit || 'Units',
      salesPrice: Number(form.salesPrice),
      costPrice: Number(form.costPrice),
      procureOnDemand: form.procureOnDemand,
      procurementType: form.procurementType || null,
      vendorId: form.vendorId ? Number(form.vendorId) : null,
      defaultBomId: form.defaultBomId ? Number(form.defaultBomId) : null,
    };
    if (isNew) {
      const created = await action.run(() =>
        api.post<ProductDTO>('/products', { ...body, initialStock: Number(form.initialStock || 0) }),
      );
      if (created) navigate(`/products/${created.id}`, { replace: true });
    } else {
      const updated = await action.run(() => api.patch<ProductDTO>(`/products/${id}`, body));
      if (updated) {
        product.setData(updated);
        setSaved('Saved.');
      }
    }
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={isNew ? 'New product' : p?.name}
        back={
          <Link to="/products" className="text-sm text-slate-500 hover:text-slate-800">
            ← Products
          </Link>
        }
      >
        {p && can('PRODUCTS', 'adjust') && (
          <button type="button" className="btn-secondary" onClick={() => setAdjustOpen(true)}>
            Adjust stock
          </button>
        )}
        {p && <LogsButton module="PRODUCTS" recordId={p.id} />}
      </PageHeader>
      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {saved && <Notice tone="success">{saved}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <form onSubmit={submit} className="card grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product name" className="sm:col-span-2">
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                disabled={!editable}
                required
              />
            </Field>
            <Field label="Sales price (₹)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.salesPrice}
                onChange={(e) => set('salesPrice', e.target.value)}
                disabled={!editable}
                required
              />
            </Field>
            <Field label="Cost price (₹)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => set('costPrice', e.target.value)}
                disabled={!editable}
                required
              />
            </Field>
            <Field label="Unit">
              <input className="input" value={form.unit} onChange={(e) => set('unit', e.target.value)} disabled={!editable} />
            </Field>
            {isNew && (
              <Field label="Opening stock quantity">
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.initialStock}
                  onChange={(e) => set('initialStock', e.target.value)}
                />
              </Field>
            )}
          </div>

          <fieldset className="rounded-md border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium">Procurement</legend>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.procureOnDemand}
                onChange={(e) => set('procureOnDemand', e.target.checked)}
                disabled={!editable}
              />
              Procure on demand (make to order — auto-create a PO or MO when a sale is short)
            </label>
            {form.procureOnDemand && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Procurement type">
                  <select
                    className="input"
                    value={form.procurementType}
                    onChange={(e) => set('procurementType', e.target.value as Form['procurementType'])}
                    disabled={!editable}
                    required
                  >
                    <option value="">Choose…</option>
                    <option value="PURCHASE">Purchase</option>
                    <option value="MANUFACTURING">Manufacturing</option>
                  </select>
                </Field>
                {form.procurementType === 'PURCHASE' && (
                  <Field label="Vendor">
                    <select
                      className="input"
                      value={form.vendorId}
                      onChange={(e) => set('vendorId', e.target.value)}
                      disabled={!editable}
                      required
                    >
                      <option value="">Choose a vendor…</option>
                      {vendors.data?.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {form.procurementType === 'MANUFACTURING' && (
                  <Field label="Bill of materials">
                    {isNew ? (
                      <p className="text-sm text-slate-500">Save the product, create its bill of materials, then pick it here.</p>
                    ) : (
                      <select
                        className="input"
                        value={form.defaultBomId}
                        onChange={(e) => set('defaultBomId', e.target.value)}
                        disabled={!editable}
                        required
                      >
                        <option value="">Choose a BoM…</option>
                        {boms.data?.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.reference}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
              </div>
            )}
          </fieldset>

          {editable && (
            <div>
              <button type="submit" className="btn-primary" disabled={action.busy}>
                {action.busy ? 'Saving…' : isNew ? 'Create product' : 'Save'}
              </button>
            </div>
          )}
        </form>

        {p && (
          <div className="card h-fit p-5">
            <h2 className="mb-3 font-semibold">Stock</h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">On hand</dt>
                <dd className="font-medium">
                  {qty(p.onHand)} {p.unit}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Reserved</dt>
                <dd className="font-medium">{qty(p.reserved)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <dt className="text-slate-500">Free to use</dt>
                <dd className={`font-semibold ${p.free < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{qty(p.free)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Free to use = on hand − reserved by confirmed sales and manufacturing orders.
            </p>
          </div>
        )}
      </div>

      {p && (
        <div className="card mt-4 overflow-x-auto">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Stock ledger</h2>
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Date</th>
                <th className="th">Reference</th>
                <th className="th">Type</th>
                <th className="th text-right">Quantity</th>
                <th className="th">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ledger.data?.items.map((m) => (
                <tr key={m.id}>
                  <td className="td">{dateTime(m.createdAt)}</td>
                  <td className="td">{m.reference}</td>
                  <td className="td">{label(m.type)}</td>
                  <td className={`td text-right font-medium ${m.quantity < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {m.quantity > 0 ? '+' : ''}
                    {qty(m.quantity)}
                  </td>
                  <td className="td">{m.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adjustOpen && p && (
        <AdjustDialog
          product={p}
          onClose={() => setAdjustOpen(false)}
          onPlaced={(op) => {
            setAdjustOpen(false);
            setSaved(`Adjustment ${op.reference} placed — stock changes once a manager confirms it on Stock Operations.`);
          }}
        />
      )}
    </div>
  );
}

function AdjustDialog({
  product,
  onClose,
  onPlaced,
}: {
  product: ProductDTO;
  onClose: () => void;
  onPlaced: (op: OperationDTO) => void;
}) {
  const [target, setTarget] = useState(String(product.onHand));
  const [reason, setReason] = useState('');
  const action = useAction();
  const submit = async () => {
    const op = await action.run(() =>
      api.post<OperationDTO>('/operations', { type: 'ADJUSTMENT', productId: product.id, targetQty: Number(target), reason }),
    );
    if (op) onPlaced(op);
  };
  return (
    <Modal
      title={`Adjust stock — ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={action.busy || reason.trim().length < 3} onClick={submit}>
            Place adjustment
          </button>
        </>
      }
    >
      <ErrorBanner message={action.error} />
      <p className="mb-3 text-sm text-slate-600">
        Currently {qty(product.onHand)} on hand. The new quantity is applied when the adjustment is confirmed.
      </p>
      <div className="grid gap-3">
        <Field label="Counted quantity">
          <input
            className="input"
            type="number"
            min="0"
            step="0.001"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="Reason">
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Cycle count, damaged goods"
          />
        </Field>
      </div>
    </Modal>
  );
}
