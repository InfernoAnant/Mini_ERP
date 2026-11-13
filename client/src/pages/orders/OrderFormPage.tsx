import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAction, useLoad } from '../../api/hooks';
import type { Contact, Module, OperationDTO, OperationType, ProductOption, Progress, Ref } from '../../api/types';
import JourneyPanel from '../../components/JourneyPanel';
import LevelBar, { useCelebration } from '../../components/LevelBar';
import LinesEditor, { type EditableLine, newLineKey } from '../../components/LinesEditor';
import LogsButton from '../../components/LogsButton';
import OperationsPanel from '../../components/OperationsPanel';
import { date, dateInput, ErrorBanner, Field, Modal, Notice, PageHeader, qty, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

/** Common view of a sales or purchase order. */
export type OrderView = {
  id: number;
  reference: string;
  status: string;
  partner: Ref;
  address: string | null;
  person: Ref | null;
  date: string | null;
  createdAt: string;
  createdById: number;
  late: boolean;
  origin?: string | null;
  lines: { id: number; productId: number; productName: string; quantity: number; done: number; pending: number; price: number; available?: boolean; freeToUse?: number }[];
  operations: OperationDTO[];
  progress: Progress;
  procurements?: { id: number; reference: string; type: 'PO' | 'MO'; status: string }[];
};

export type OrderConfig<D> = {
  module: Module;
  journeyKind: 'SO' | 'PO';
  endpoint: string;
  listPath: string;
  title: string;
  partnerType: 'CUSTOMER' | 'VENDOR';
  partnerLabel: string;
  personLabel: string;
  dateLabel: string;
  doneLabel: string;
  operationType: OperationType;
  operationVerb: string;
  priceFrom: 'salesPrice' | 'costPrice';
  openStatuses: string[];
  showAvailability: boolean;
  fromDto: (dto: D) => OrderView;
  toBody: (form: HeaderForm, lines: EditableLine[]) => Record<string, unknown>;
  operationBody: (order: OrderView, quantities: Record<number, string>) => Record<string, unknown>;
};

export type HeaderForm = { partnerId: string; address: string; personId: string; date: string };

const linesFromView = (v: OrderView): EditableLine[] =>
  v.lines.map((l) => ({
    key: `line-${l.id}`,
    id: l.id,
    productId: l.productId,
    quantity: String(l.quantity),
    price: String(l.price),
    done: l.done,
    pending: l.pending,
    available: l.available,
    freeToUse: l.freeToUse,
  }));

export default function OrderFormPage<D>({ config }: { config: OrderConfig<D> }) {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user, can, canPlaceOperation } = useAuth();
  const order = useLoad(async () => (isNew ? null : config.fromDto(await api.get<D>(`${config.endpoint}/${id}`))), [id]);
  const partners = useLoad(() => api.get<Contact[]>('/contacts', { type: config.partnerType }), []);
  const products = useLoad(() => api.get<ProductOption[]>('/products/options'), []);
  const people = useLoad(() => api.get<Ref[]>('/users/options'), []);
  const [header, setHeader] = useState<HeaderForm>({ partnerId: '', address: '', personId: '', date: '' });
  const [lines, setLines] = useState<EditableLine[]>([{ key: newLineKey(), productId: '', quantity: '1', price: '0', done: 0, pending: 0 }]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [opOpen, setOpOpen] = useState(false);
  const action = useAction();
  const v = order.data;
  const party = useCelebration(v?.progress, `${v?.id ?? ''}`);

  const resetForm = (view: OrderView) => {
    setHeader({ partnerId: String(view.partner.id), address: view.address ?? '', personId: view.person ? String(view.person.id) : '', date: dateInput(view.date) });
    setLines(linesFromView(view));
  };
  useEffect(() => {
    if (v) resetForm(v);
  }, [v]);
  useEffect(() => {
    if (isNew && user) setHeader((h) => ({ ...h, personId: h.personId || String(user.id) }));
  }, [isNew, user]);

  const isDraft = v?.status === 'DRAFT';
  const isOpen = !!v && config.openStatuses.includes(v.status);
  const ownDraft = !!v && isDraft && v.createdById === user?.id;
  const mayEdit = isNew ? can(config.module, 'create') : can(config.module, 'edit') && (user?.access[config.module] === 'ADMIN' || user?.isSystemAdmin || ownDraft);
  const formEditable = isNew || (mayEdit && (isDraft || (isOpen && editing)));
  const remainingTotal = useMemo(() => (v ? v.lines.reduce((s, l) => s + (l.quantity - l.done - l.pending), 0) : 0), [v]);

  if (!isNew && !v) return order.error ? <ErrorBanner message={order.error} /> : <Spinner />;

  const reloadWith = (view: OrderView) => {
    order.setData(view);
    setEditing(false);
  };
  const procuredNotice = (verb: string, refs: string[]) => setNotice(refs.length ? `${verb}. Auto-created: ${refs.join(', ')}` : `${verb}.`);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setNotice(null);
    if (lines.some((l) => !l.productId)) return action.setError('Choose a product on every line');
    const body = config.toBody(header, lines);
    if (isNew) {
      const created = await action.run(() => api.post<D>(config.endpoint, body));
      if (created) navigate(`${config.listPath}/${config.fromDto(created).id}`, { replace: true });
      return;
    }
    const res = await action.run(() => api.patch<D & { procured?: string[] }>(`${config.endpoint}/${id}`, body));
    if (res) {
      reloadWith(config.fromDto(res));
      procuredNotice('Saved', res.procured ?? []);
    }
  };

  const transition = async (verb: 'confirm' | 'cancel') => {
    setNotice(null);
    if (verb === 'confirm' && isDraft && mayEdit) {
      // Save pending draft edits first so what is confirmed is what is on screen.
      const saved = await action.run(() => api.patch<D>(`${config.endpoint}/${id}`, config.toBody(header, lines)));
      if (!saved) return;
    }
    const res = await action.run(() => api.post<{ order: D; procured: string[] } | D>(`${config.endpoint}/${id}/${verb}`));
    if (!res) return;
    if (verb === 'confirm') {
      const r = res as { order: D; procured: string[] };
      reloadWith(config.fromDto(r.order));
      procuredNotice('Confirmed', r.procured);
    } else {
      reloadWith(config.fromDto(res as D));
      setNotice('Cancelled. Any pending stock operations were rejected.');
    }
  };

  const remove = async () => {
    if (await action.run(() => api.del(`${config.endpoint}/${id}`))) navigate(config.listPath);
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {isNew ? `New ${config.title.toLowerCase()}` : v?.reference}
            {v && <StatusBadge status={v.status} />}
            {v?.late && <StatusBadge status="LATE" />}
          </span>
        }
        back={
          <Link to={config.listPath} className="text-sm text-slate-500 hover:text-slate-800">
            ← Back
          </Link>
        }
      >
        {isNew && (
          <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void save()}>
            Create
          </button>
        )}
        {isDraft && mayEdit && (
          <button type="button" className="btn-secondary" disabled={action.busy} onClick={() => void save()}>
            Save
          </button>
        )}
        {isDraft && can(config.module, 'confirm') && (
          <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void transition('confirm')}>
            Confirm
          </button>
        )}
        {isOpen && mayEdit && !editing && (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {isOpen && editing && (
          <>
            <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void save()}>
              Save changes
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (v) resetForm(v);
                setEditing(false);
              }}
            >
              Discard
            </button>
          </>
        )}
        {isOpen && !editing && canPlaceOperation(config.operationType) && remainingTotal > 0 && (
          <button type="button" className="btn-primary" onClick={() => setOpOpen(true)}>
            {config.operationVerb}
          </button>
        )}
        {(isDraft || isOpen) && can(config.module, 'cancel') && !editing && (
          <button type="button" className="btn-danger" disabled={action.busy} onClick={() => void transition('cancel')}>
            Cancel order
          </button>
        )}
        {isDraft && can(config.module, 'delete') && (
          <button type="button" className="btn-danger" disabled={action.busy} onClick={() => void remove()}>
            Delete
          </button>
        )}
        {v && <LogsButton module={config.module} recordId={v.id} />}
      </PageHeader>

      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {notice && <Notice tone="success">{notice}</Notice>}
      {isOpen && editing && (
        <Notice tone="warn">
          Editing a confirmed order: quantities can't go below what's already {config.doneLabel.toLowerCase()} or pending. Raising a quantity re-runs auto-procurement for the extra.
        </Notice>
      )}

      {v && <LevelBar progress={v.progress} size="lg" celebrate={party.celebrate} onCelebrated={party.done} />}
      {v && <JourneyPanel kind={config.journeyKind} id={v.id} refreshKey={`${v.status}-${v.progress.percent}-${v.operations.length}`} />}

      <form onSubmit={save} className="card p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={config.partnerLabel}>
            <select
              className="input"
              value={header.partnerId}
              disabled={!formEditable}
              required
              onChange={(e) => {
                const p = partners.data?.find((x) => x.id === Number(e.target.value));
                setHeader({ ...header, partnerId: e.target.value, address: header.address || p?.address || '' });
              }}
            >
              <option value="">Choose…</option>
              {partners.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Address">
            <input className="input" value={header.address} disabled={!formEditable} onChange={(e) => setHeader({ ...header, address: e.target.value })} maxLength={300} />
          </Field>
          <Field label={config.personLabel}>
            <select className="input" value={header.personId} disabled={!formEditable} onChange={(e) => setHeader({ ...header, personId: e.target.value })}>
              <option value="">—</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={config.dateLabel}>
            <input className="input" type="date" value={header.date} disabled={!formEditable} onChange={(e) => setHeader({ ...header, date: e.target.value })} />
          </Field>
          {v && (
            <Field label="Created">
              <input className="input" value={date(v.createdAt)} disabled />
            </Field>
          )}
          {v?.origin && (
            <Field label="Source document">
              <Link to={`/${v.origin.startsWith('SO') ? 'sales' : 'manufacturing'}?q=${v.origin}`} className="input block text-indigo-600 hover:underline">
                {v.origin}
              </Link>
            </Field>
          )}
        </div>
      </form>

      <div className="card mt-4">
        <LinesEditor
          lines={lines}
          onChange={setLines}
          products={products.data ?? []}
          editable={formEditable}
          priceFrom={config.priceFrom}
          doneLabel={config.doneLabel}
          showAvailability={config.showAvailability}
        />
      </div>

      {v && <OperationsPanel operations={v.operations} onChanged={() => {
            setNotice(null);
            void order.reload();
          }} />}

      {opOpen && v && (
        <PlaceOperationDialog
          config={config}
          order={v}
          onClose={() => setOpOpen(false)}
          onPlaced={(ref) => {
            setOpOpen(false);
            setNotice(`${ref} placed — stock moves once a supervisor or manager confirms it.`);
            void order.reload();
          }}
        />
      )}
    </div>
  );
}

function PlaceOperationDialog<D>({ config, order, onClose, onPlaced }: { config: OrderConfig<D>; order: OrderView; onClose: () => void; onPlaced: (ref: string) => void }) {
  const open = order.lines.filter((l) => l.quantity - l.done - l.pending > 0);
  const [quantities, setQuantities] = useState<Record<number, string>>(Object.fromEntries(open.map((l) => [l.id, String(l.quantity - l.done - l.pending)])));
  const action = useAction();
  const submit = async () => {
    const op = await action.run(() => api.post<OperationDTO>('/operations', config.operationBody(order, quantities)));
    if (op) onPlaced(op.reference);
  };
  return (
    <Modal
      title={`${config.operationVerb} — ${order.reference}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={action.busy} onClick={submit}>
            Place {config.operationVerb.toLowerCase()}
          </button>
        </>
      }
    >
      <ErrorBanner message={action.error} />
      <p className="mb-3 text-sm text-slate-600">Enter what is going out / coming in now. Leave 0 to skip a line.</p>
      <div className="grid gap-2">
        {open.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {l.productName} <span className="text-slate-500">(up to {qty(l.quantity - l.done - l.pending)})</span>
            </span>
            <input
              className="input w-28 text-right"
              type="number"
              min="0"
              step="0.001"
              max={l.quantity - l.done - l.pending}
              value={quantities[l.id] ?? ''}
              aria-label={`Quantity for ${l.productName}`}
              onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Lines with a positive quantity, in the shape the operations API expects. */
export function opLines(quantities: Record<number, string>, key: 'salesOrderLineId' | 'purchaseOrderLineId') {
  return Object.entries(quantities)
    .filter(([, q]) => Number(q) > 0)
    .map(([lineId, q]) => ({ [key]: Number(lineId), quantity: Number(q) }));
}

export function headerBody(form: HeaderForm, lines: EditableLine[]) {
  return {
    lines: lines.map((l) => ({ ...(l.id ? { id: l.id } : {}), productId: Number(l.productId), quantity: Number(l.quantity), price: Number(l.price) })),
    address: form.address || null,
    person: form.personId ? Number(form.personId) : null,
    date: form.date ? new Date(`${form.date}T12:00:00`).toISOString() : null,
  };
}
