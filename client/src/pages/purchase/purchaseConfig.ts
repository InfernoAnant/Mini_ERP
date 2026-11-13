import type { PurchaseOrderDTO } from '../../api/types';
import { headerBody, type OrderConfig, opLines } from '../orders/OrderFormPage';

export const PURCHASE_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'];

export const purchaseConfig: OrderConfig<PurchaseOrderDTO> = {
  module: 'PURCHASE',
  journeyKind: 'PO',
  endpoint: '/purchase',
  listPath: '/purchase',
  title: 'Purchase order',
  partnerType: 'VENDOR',
  partnerLabel: 'Vendor',
  personLabel: 'Responsible',
  dateLabel: 'Expected arrival',
  doneLabel: 'Received',
  operationType: 'RECEIPT',
  operationVerb: 'Receive',
  priceFrom: 'costPrice',
  openStatuses: ['CONFIRMED', 'PARTIALLY_RECEIVED'],
  showAvailability: false,
  fromDto: (d) => ({
    id: d.id,
    reference: d.reference,
    status: d.status,
    partner: d.vendor,
    address: d.vendorAddress,
    person: d.responsible,
    date: d.expectedDate,
    createdAt: d.createdAt,
    createdById: d.createdById,
    late: d.late,
    origin: d.origin,
    lines: d.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      done: l.receivedQty,
      pending: l.pendingQty,
      price: l.unitCost,
    })),
    operations: d.operations,
    progress: d.progress,
  }),
  toBody: (form, lines) => {
    const b = headerBody(form, lines);
    return { vendorId: Number(form.partnerId), vendorAddress: b.address, responsibleId: b.person, expectedDate: b.date, lines: b.lines };
  },
  operationBody: (order, q) => ({ type: 'RECEIPT', purchaseOrderId: order.id, lines: opLines(q, 'purchaseOrderLineId') }),
};
