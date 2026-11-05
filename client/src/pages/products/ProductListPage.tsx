import type { ProductDTO } from '../../api/types';
import ListPage from '../../components/ListPage';
import { label, money, qty } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export default function ProductListPage() {
  const { can } = useAuth();
  return (
    <ListPage<ProductDTO>
      title="Products"
      endpoint="/products"
      searchPlaceholder="Search products…"
      newPath={can('PRODUCTS', 'create') ? '/products/new' : undefined}
      rowPath={(p) => `/products/${p.id}`}
      columns={[
        { header: 'Product', cell: (p) => <span className="font-medium">{p.name}</span> },
        { header: 'Sales price', cell: (p) => money(p.salesPrice), className: 'text-right' },
        { header: 'Cost', cell: (p) => money(p.costPrice), className: 'text-right' },
        { header: 'On hand', cell: (p) => qty(p.onHand), className: 'text-right' },
        { header: 'Reserved', cell: (p) => qty(p.reserved), className: 'text-right' },
        {
          header: 'Free to use',
          cell: (p) => <span className={p.free < 0 ? 'font-semibold text-rose-600' : ''}>{qty(p.free)}</span>,
          className: 'text-right',
        },
        {
          header: 'Procurement',
          cell: (p) => (p.procureOnDemand && p.procurementType ? `On demand · ${label(p.procurementType)}` : 'Make to stock'),
        },
      ]}
    />
  );
}
