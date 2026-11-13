import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useLoad } from '../api/hooks';
import type { JourneyNode } from '../api/types';
import LevelBar from './LevelBar';
import { StatusBadge } from './ui';

const PATH: Record<JourneyNode['kind'], string> = { SO: 'sales', PO: 'purchase', MO: 'manufacturing' };
const ICON: Record<JourneyNode['kind'], string> = { SO: '🧾', PO: '🚚', MO: '🏭' };

/** The supply chain behind an order: what it is waiting on, each with its own mini level bar. */
export default function JourneyPanel({ kind, id, refreshKey }: { kind: JourneyNode['kind']; id: number; refreshKey: string }) {
  const { data } = useLoad(() => api.get<JourneyNode>(`/${PATH[kind]}/${id}/journey`), [kind, id, refreshKey]);
  if (!data || data.children.length === 0) return null;
  return (
    <div className="card mb-4 p-4">
      <h2 className="mb-1 font-semibold">Supply chain</h2>
      <p className="mb-3 text-xs text-slate-500">
        Orders created automatically to fulfil this one — it levels up as they finish.
      </p>
      <ul className="grid gap-2">
        {data.children.map((c) => (
          <Row key={`${c.kind}-${c.id}`} node={c} depth={0} />
        ))}
      </ul>
    </div>
  );
}

function Row({ node, depth }: { node: JourneyNode; depth: number }) {
  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2"
        style={{ marginLeft: depth * 24 }}
      >
        <span aria-hidden>{depth > 0 ? '└' : ''}</span>
        <span aria-hidden>{ICON[node.kind]}</span>
        {node.canOpen ? (
          <Link to={`/${PATH[node.kind]}/${node.id}`} className="font-medium text-indigo-700 hover:underline">
            {node.reference}
          </Link>
        ) : (
          <span className="font-medium text-slate-700" title="You don't have access to this module">
            {node.reference}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{node.title}</span>
        <div className="w-40">
          <LevelBar progress={node.progress} size="sm" />
        </div>
        <StatusBadge status={node.status} />
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {node.children.map((c) => (
            <Row key={`${c.kind}-${c.id}`} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
