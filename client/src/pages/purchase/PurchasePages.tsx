import type { PurchaseOrderDTO } from '../../api/types';
import LevelBar from '../../components/LevelBar';
import ListPage from '../../components/ListPage';
import { date, money, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import OrderFormPage from '../orders/OrderFormPage';
import { PURCHASE_STATUSES, purchaseConfig } from './purchaseConfig';

export function PurchaseListPage() {
  const { can } = useAuth();
  return (
    <ListPage<PurchaseOrderDTO>
      title="Purchase Orders"
      endpoint="/purchase"
      searchPlaceholder="Search reference or vendor…"
      newPath={can('PURCHASE', 'create') ? '/purchase/new' : undefined}
      rowPath={(o) => `/purchase/${o.id}`}
      statuses={PURCHASE_STATUSES}
      statusOf={(o) => o.status}
      orderFilters
      kanbanTitle={(o) => o.reference}
      kanbanBody={(o) => (
        <>
          {o.vendor.name} · {money(o.total)}
          {o.origin && <span className="ml-1">· from {o.origin}</span>}
          {o.late && <span className="ml-1 font-medium text-rose-600">· Late</span>}
          <div className="mt-2">
            <LevelBar progress={o.progress} size="sm" />
          </div>
        </>
      )}
      columns={[
        { header: 'Reference', cell: (o) => <span className="font-medium">{o.reference}</span> },
        { header: 'Vendor', cell: (o) => o.vendor.name },
        { header: 'Source', cell: (o) => o.origin ?? '—' },
        { header: 'Expected', cell: (o) => date(o.expectedDate) },
        { header: 'Total', cell: (o) => money(o.total), className: 'text-right' },
        { header: 'Progress', cell: (o) => <LevelBar progress={o.progress} size="sm" /> },
        {
          header: 'Status',
          cell: (o) => (
            <span className="flex gap-1">
              <StatusBadge status={o.status} />
              {o.late && <StatusBadge status="LATE" />}
            </span>
          ),
        },
      ]}
    />
  );
}

export function PurchaseFormPage() {
  return <OrderFormPage config={purchaseConfig} />;
}
