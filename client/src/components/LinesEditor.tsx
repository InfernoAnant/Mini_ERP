import type { ProductOption } from '../api/types';
import { money, qty } from './ui';

export type EditableLine = {
  key: string;
  id?: number;
  productId: number | '';
  quantity: string;
  price: string;
  done: number;
  pending: number;
  available?: boolean;
  freeToUse?: number;
};

type Props = {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  products: ProductOption[];
  editable: boolean;
  priceFrom: 'salesPrice' | 'costPrice';
  doneLabel: string;
  showAvailability: boolean;
};

let keySeq = 0;
export const newLineKey = () => `new-${++keySeq}`;

export default function LinesEditor({ lines, onChange, products, editable, priceFrom, doneLabel, showAvailability }: Props) {
  const update = (key: string, patch: Partial<EditableLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.price || 0), 0);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="th">Product</th>
            {showAvailability && <th className="th">Availability</th>}
            <th className="th text-right">Ordered</th>
            <th className="th text-right">{doneLabel}</th>
            <th className="th text-right">Pending</th>
            <th className="th text-right">Unit price</th>
            <th className="th text-right">Total</th>
            {editable && <th className="th" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => {
            const committed = l.done + l.pending;
            const product = products.find((p) => p.id === l.productId);
            return (
              <tr key={l.key}>
                <td className="td min-w-48">
                  {editable && committed === 0 ? (
                    <select
                      className="input"
                      value={l.productId}
                      aria-label="Product"
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        const p = products.find((x) => x.id === id);
                        update(l.key, {
                          productId: id || '',
                          price: p ? String(p[priceFrom]) : l.price,
                          available: undefined,
                          freeToUse: p?.free,
                        });
                      }}
                    >
                      <option value="">Choose a product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-medium">{product?.name ?? '—'}</span>
                  )}
                </td>
                {showAvailability && (
                  <td className="td">
                    <Availability line={l} product={product} />
                  </td>
                )}
                <td className="td text-right">
                  {editable ? (
                    <input
                      className="input w-24 text-right"
                      type="number"
                      min={committed || 0.001}
                      step="0.001"
                      value={l.quantity}
                      aria-label="Quantity"
                      onChange={(e) => update(l.key, { quantity: e.target.value })}
                    />
                  ) : (
                    qty(Number(l.quantity))
                  )}
                </td>
                <td className="td text-right">{qty(l.done)}</td>
                <td className="td text-right">{l.pending ? <span className="text-amber-700">{qty(l.pending)}</span> : '—'}</td>
                <td className="td text-right">
                  {editable ? (
                    <input
                      className="input w-28 text-right"
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.price}
                      aria-label="Unit price"
                      onChange={(e) => update(l.key, { price: e.target.value })}
                    />
                  ) : (
                    money(Number(l.price))
                  )}
                </td>
                <td className="td text-right">{money(Number(l.quantity || 0) * Number(l.price || 0))}</td>
                {editable && (
                  <td className="td">
                    {committed === 0 && (
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-600"
                        aria-label="Remove line"
                        onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-3 py-2">
        {editable ? (
          <button
            type="button"
            className="text-sm text-indigo-600 hover:underline"
            onClick={() =>
              onChange([...lines, { key: newLineKey(), productId: '', quantity: '1', price: '0', done: 0, pending: 0 }])
            }
          >
            + Add a product
          </button>
        ) : (
          <span />
        )}
        <span className="text-sm">
          Total: <span className="font-semibold">{money(total)}</span>
        </span>
      </div>
    </div>
  );
}

function Availability({ line, product }: { line: EditableLine; product?: ProductOption }) {
  if (!line.productId) return null;
  const remaining = Number(line.quantity || 0) - line.done;
  if (remaining <= 0) return <span className="text-xs text-emerald-700">Delivered</span>;
  const ok = line.available ?? (product ? product.free >= remaining : true);
  const free = line.freeToUse ?? product?.free ?? 0;
  return ok ? (
    <span className="text-xs text-emerald-700">Available</span>
  ) : (
    <span className="text-xs font-medium text-rose-600" title={`Only ${qty(free)} free to use`}>
      ⚠ Only {qty(Math.max(free, 0))} free
    </span>
  );
}
