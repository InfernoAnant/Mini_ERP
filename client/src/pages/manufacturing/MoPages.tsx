import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAction, useLoad } from '../../api/hooks';
import type { MoDTO, OperationDTO, ProductOption, Ref } from '../../api/types';
import ListPage from '../../components/ListPage';
import LogsButton from '../../components/LogsButton';
import OperationsPanel from '../../components/OperationsPanel';
import { date, dateInput, ErrorBanner, Field, Notice, PageHeader, qty, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

const MO_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED'];
const ACTIVE = ['CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'];

export function MoListPage() {
  const { can } = useAuth();
  return (
    <ListPage<MoDTO>
      title="Manufacturing Orders"
      endpoint="/manufacturing"
      searchPlaceholder="Search reference or product…"
      newPath={can('MANUFACTURING', 'create') ? '/manufacturing/new' : undefined}
      rowPath={(m) => `/manufacturing/${m.id}`}
      statuses={MO_STATUSES}
      statusOf={(m) => m.status}
      orderFilters
      kanbanTitle={(m) => m.reference}
      kanbanBody={(m) => (
        <>
          {qty(m.quantity)} × {m.product.name}
          {m.origin && <span> · from {m.origin}</span>}
          {m.late && <span className="ml-1 font-medium text-rose-600">· Late</span>}
        </>
      )}
      columns={[
        { header: 'Reference', cell: (m) => <span className="font-medium">{m.reference}</span> },
        { header: 'Product', cell: (m) => m.product.name },
        { header: 'Quantity', cell: (m) => qty(m.quantity), className: 'text-right' },
        { header: 'Source', cell: (m) => m.origin ?? '—' },
        { header: 'Assignee', cell: (m) => m.assignee?.name ?? '—' },
        { header: 'Deadline', cell: (m) => date(m.deadline) },
        {
          header: 'Status',
          cell: (m) => (
            <span className="flex gap-1">
              <StatusBadge status={m.status} />
              {m.late && <StatusBadge status="LATE" />}
            </span>
          ),
        },
      ]}
    />
  );
}

export function MoFormPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user, can, canPlaceOperation } = useAuth();
  const mo = useLoad(() => (isNew ? Promise.resolve(null) : api.get<MoDTO>(`/manufacturing/${id}`)), [id]);
  const products = useLoad(() => api.get<ProductOption[]>('/products/options'), []);
  const people = useLoad(() => api.get<Ref[]>('/users/options'), []);
  const [form, setForm] = useState({ productId: '', quantity: '1', bomId: '', assigneeId: '', deadline: '' });
  const boms = useLoad(
    () => (form.productId ? api.get<{ id: number; reference: string }[]>('/boms/options', { productId: form.productId }) : Promise.resolve([])),
    [form.productId],
  );
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'components' | 'work'>('components');
  const [minutes, setMinutes] = useState<Record<number, string>>({});
  const action = useAction();
  const m = mo.data;

  const resetForm = (d: MoDTO) =>
    setForm({ productId: String(d.product.id), quantity: String(d.quantity), bomId: String(d.bom.id), assigneeId: d.assignee ? String(d.assignee.id) : '', deadline: dateInput(d.deadline) });
  useEffect(() => {
    if (m) resetForm(m);
  }, [m]);
  useEffect(() => {
    // Default to the product's own BoM when choosing a product on a draft.
    if (!boms.data || form.bomId && boms.data.some((b) => String(b.id) === form.bomId)) return;
    const product = products.data?.find((p) => String(p.id) === form.productId);
    const preferred = boms.data.find((b) => b.id === product?.defaultBomId) ?? boms.data[0];
    setForm((f) => ({ ...f, bomId: preferred ? String(preferred.id) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boms.data]);

  if (!isNew && !m) return mo.error ? <ErrorBanner message={mo.error} /> : <Spinner />;

  const isDraft = m?.status === 'DRAFT';
  const active = !!m && ACTIVE.includes(m.status);
  const mayEdit = isNew ? can('MANUFACTURING', 'create') : can('MANUFACTURING', 'edit') && (user?.access.MANUFACTURING === 'ADMIN' || user?.isSystemAdmin || (isDraft && m?.createdById === user?.id));
  const headerEditable = isNew || (mayEdit && (isDraft || (active && editing)));
  const pendingProduction = m?.operations.some((o) => o.type === 'PRODUCTION' && o.status === 'PLACED');

  const body = () => ({
    productId: Number(form.productId),
    quantity: Number(form.quantity),
    bomId: Number(form.bomId),
    assigneeId: form.assigneeId ? Number(form.assigneeId) : null,
    deadline: form.deadline ? new Date(`${form.deadline}T12:00:00`).toISOString() : null,
  });

  const save = async () => {
    setNotice(null);
    if (isNew) {
      const created = await action.run(() => api.post<MoDTO>('/manufacturing', body()));
      if (created) navigate(`/manufacturing/${created.id}`, { replace: true });
      return;
    }
    const payload = isDraft ? body() : { quantity: Number(form.quantity), assigneeId: body().assigneeId, deadline: body().deadline };
    const res = await action.run(() => api.patch<MoDTO & { procured: string[] }>(`/manufacturing/${id}`, payload));
    if (res) {
      mo.setData(res);
      setEditing(false);
      setNotice(res.procured.length ? `Saved. Auto-created: ${res.procured.join(', ')}` : 'Saved.');
    }
  };

  const confirm = async () => {
    setNotice(null);
    if (mayEdit && !(await action.run(() => api.patch(`/manufacturing/${id}`, body())))) return;
    const res = await action.run(() => api.post<{ order: MoDTO; procured: string[] }>(`/manufacturing/${id}/confirm`));
    if (res) {
      mo.setData(res.order);
      setNotice(res.procured.length ? `Confirmed. Components reserved; auto-created: ${res.procured.join(', ')}` : 'Confirmed. Components reserved.');
    }
  };

  const cancel = async () => {
    const res = await action.run(() => api.post<MoDTO>(`/manufacturing/${id}/cancel`));
    if (res) {
      mo.setData(res);
      setNotice('Cancelled.');
    }
  };

  const produce = async () => {
    const op = await action.run(() => api.post<OperationDTO>('/operations', { type: 'PRODUCTION', manufacturingOrderId: Number(id) }));
    if (op) {
      setNotice(`${op.reference} placed — stock moves once a supervisor or manager confirms it.`);
      void mo.reload();
    }
  };

  const completeWo = async (woId: number, expected: number) => {
    const res = await action.run(() => api.post<MoDTO>(`/manufacturing/${id}/work-orders/${woId}/complete`, { realMinutes: Number(minutes[woId] ?? expected) }));
    if (res) mo.setData(res);
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isNew ? 'New manufacturing order' : m?.reference}
            {m && <StatusBadge status={m.status} />}
            {m?.late && <StatusBadge status="LATE" />}
          </span>
        }
        back={
          <Link to="/manufacturing" className="text-sm text-slate-500 hover:text-slate-800">
            ← Back
          </Link>
        }
      >
        {(isNew || (isDraft && mayEdit)) && (
          <button type="button" className={isNew ? 'btn-primary' : 'btn-secondary'} disabled={action.busy} onClick={() => void save()}>
            {isNew ? 'Create' : 'Save'}
          </button>
        )}
        {isDraft && can('MANUFACTURING', 'confirm') && (
          <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void confirm()}>
            Confirm
          </button>
        )}
        {active && mayEdit && !editing && !pendingProduction && (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {active && editing && (
          <>
            <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void save()}>
              Save changes
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (m) resetForm(m);
                setEditing(false);
              }}
            >
              Discard
            </button>
          </>
        )}
        {active && !editing && canPlaceOperation('PRODUCTION') && !pendingProduction && (
          <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void produce()}>
            Produce
          </button>
        )}
        {(isDraft || active) && can('MANUFACTURING', 'cancel') && !editing && (
          <button type="button" className="btn-danger" disabled={action.busy} onClick={() => void cancel()}>
            Cancel order
          </button>
        )}
        {isDraft && can('MANUFACTURING', 'delete') && (
          <button
            type="button"
            className="btn-danger"
            disabled={action.busy}
            onClick={async () => {
              if (await action.run(() => api.del(`/manufacturing/${id}`))) navigate('/manufacturing');
            }}
          >
            Delete
          </button>
        )}
        {m && <LogsButton module="MANUFACTURING" recordId={m.id} />}
      </PageHeader>

      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {notice && <Notice tone="success">{notice}</Notice>}

      <div className="card grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Finished product">
          <select className="input" value={form.productId} disabled={!(isNew || (isDraft && mayEdit))} onChange={(e) => setForm({ ...form, productId: e.target.value, bomId: '' })} required>
            <option value="">Choose…</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input className="input" type="number" min="0.001" step="0.001" value={form.quantity} disabled={!headerEditable} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        </Field>
        <Field label="Bill of materials">
          <select className="input" value={form.bomId} disabled={!(isNew || (isDraft && mayEdit))} onChange={(e) => setForm({ ...form, bomId: e.target.value })} required>
            <option value="">{form.productId ? 'No BoM for this product' : 'Choose a product first'}</option>
            {boms.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.reference}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select className="input" value={form.assigneeId} disabled={!headerEditable} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">—</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deadline">
          <input className="input" type="date" value={form.deadline} disabled={!headerEditable} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </Field>
        {m?.origin && (
          <Field label="Source document">
            <Link to={`/${m.origin.startsWith('SO') ? 'sales' : 'manufacturing'}?q=${m.origin}`} className="input block text-indigo-600 hover:underline">
              {m.origin}
            </Link>
          </Field>
        )}
      </div>

      {m && (
        <div className="card mt-4">
          <div className="flex border-b border-slate-200">
            {(
              [
                ['components', 'Components'],
                ['work', 'Work orders'],
              ] as const
            ).map(([key, text]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-4 py-3 text-sm font-medium ${tab === key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {text}
              </button>
            ))}
          </div>
          {tab === 'components' ? (
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Component</th>
                  <th className="th">Availability</th>
                  <th className="th text-right">To consume</th>
                  <th className="th text-right">Consumed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {m.components.map((c) => (
                  <tr key={c.id}>
                    <td className="td font-medium">{c.productName}</td>
                    <td className="td">
                      {m.status === 'DONE' ? (
                        <span className="text-xs text-slate-500">Consumed</span>
                      ) : c.available ? (
                        <span className="text-xs text-emerald-700">Available</span>
                      ) : (
                        <span className="text-xs font-medium text-rose-600">⚠ Not available</span>
                      )}
                    </td>
                    <td className="td text-right">
                      {qty(c.toConsume)} {c.unit}
                    </td>
                    <td className="td text-right">{qty(c.consumed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Operation</th>
                  <th className="th">Work center</th>
                  <th className="th text-right">Expected</th>
                  <th className="th text-right">Real</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {m.workOrders.map((w) => {
                  const canDo = w.status === 'PENDING' && (m.status === 'CONFIRMED' || m.status === 'IN_PROGRESS') && can('MANUFACTURING', 'operate');
                  return (
                    <tr key={w.id}>
                      <td className="td font-medium">{w.name}</td>
                      <td className="td">{w.workCenter.name}</td>
                      <td className="td text-right">{w.expectedMinutes} min</td>
                      <td className="td text-right">
                        {canDo ? (
                          <input
                            className="input ml-auto w-24 text-right"
                            type="number"
                            min="0"
                            value={minutes[w.id] ?? String(w.expectedMinutes)}
                            aria-label={`Real minutes for ${w.name}`}
                            onChange={(e) => setMinutes({ ...minutes, [w.id]: e.target.value })}
                          />
                        ) : w.realMinutes !== null ? (
                          `${w.realMinutes} min`
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="td">
                        {canDo ? (
                          <button type="button" className="btn-secondary" disabled={action.busy} onClick={() => void completeWo(w.id, w.expectedMinutes)}>
                            Mark done
                          </button>
                        ) : (
                          <StatusBadge status={w.status} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {m && <OperationsPanel operations={m.operations} onChanged={() => void mo.reload()} />}
    </div>
  );
}
