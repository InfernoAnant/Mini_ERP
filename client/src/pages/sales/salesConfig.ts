import type { SalesOrderDTO } from '../../api/types';
import { headerBody, type OrderConfig, opLines } from '../orders/OrderFormPage';

export const SALES_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED', 'CANCELLED'];

export const salesConfig: OrderConfig<SalesOrderDTO> = {
  module: 'SALES',
  endpoint: '/sales',
  listPath: '/sales',
  title: 'Sales order',
  partnerType: 'CUSTOMER',
  partnerLabel: 'Customer',
  personLabel: 'Salesperson',
  dateLabel: 'Scheduled delivery',
  doneLabel: 'Delivered',
  operationType: 'DELIVERY',
  operationVerb: 'Deliver',
  priceFrom: 'salesPrice',
  openStatuses: ['CONFIRMED', 'PARTIALLY_DELIVERED'],
  showAvailability: true,
  fromDto: (d) => ({
    id: d.id,
    reference: d.reference,
    status: d.status,
    partner: d.customer,
    address: d.customerAddress,
    person: d.salesperson,
    date: d.scheduledDate,
    createdAt: d.createdAt,
    createdById: d.createdById,
    late: d.late,
    lines: d.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      done: l.deliveredQty,
      pending: l.pendingQty,
      price: l.unitPrice,
      available: l.available,
      freeToUse: l.freeToUse,
    })),
    operations: d.operations,
    procurements: d.procurements,
  }),
  toBody: (form, lines) => {
    const b = headerBody(form, lines);
    return { customerId: Number(form.partnerId), customerAddress: b.address, salespersonId: b.person, scheduledDate: b.date, lines: b.lines };
  },
  operationBody: (order, q) => ({ type: 'DELIVERY', salesOrderId: order.id, lines: opLines(q, 'salesOrderLineId') }),
};
