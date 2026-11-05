import type { SalesOrderDTO } from '../../api/types';
import ListPage from '../../components/ListPage';
import { date, money, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import OrderFormPage from '../orders/OrderFormPage';
import { SALES_STATUSES, salesConfig } from './salesConfig';

export function SalesListPage() {
  const { can } = useAuth();
  return (
    <ListPage<SalesOrderDTO>
      title="Sale Orders"
      endpoint="/sales"
      searchPlaceholder="Search reference or customer…"
      newPath={can('SALES', 'create') ? '/sales/new' : undefined}
      rowPath={(o) => `/sales/${o.id}`}
      statuses={SALES_STATUSES}
      statusOf={(o) => o.status}
      orderFilters
      kanbanTitle={(o) => o.reference}
      kanbanBody={(o) => (
        <>
          {o.customer.name} · {money(o.total)}
          {o.late && <span className="ml-1 font-medium text-rose-600">· Late</span>}
        </>
      )}
      columns={[
        { header: 'Reference', cell: (o) => <span className="font-medium">{o.reference}</span> },
        { header: 'Customer', cell: (o) => o.customer.name },
        { header: 'Salesperson', cell: (o) => o.salesperson?.name ?? '—' },
        { header: 'Scheduled', cell: (o) => date(o.scheduledDate) },
        { header: 'Total', cell: (o) => money(o.total), className: 'text-right' },
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

export function SalesFormPage() {
  return <OrderFormPage config={salesConfig} />;
}
