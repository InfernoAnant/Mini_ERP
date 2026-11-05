export type Module = 'SALES' | 'PURCHASE' | 'MANUFACTURING' | 'BOM' | 'PRODUCTS';
export type AuditModule = Module | 'STOCK' | 'USERS';
export type AccessLevel = 'ADMIN' | 'USER' | 'NONE';
export type Action = 'view' | 'create' | 'edit' | 'delete' | 'confirm' | 'cancel' | 'operate' | 'adjust';
export type OperationType = 'DELIVERY' | 'RECEIPT' | 'PRODUCTION' | 'ADJUSTMENT';
export type OperationStatus = 'PLACED' | 'CONFIRMED' | 'REJECTED';
export type SalesStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_DELIVERED' | 'FULLY_DELIVERED' | 'CANCELLED';
export type PurchaseStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED' | 'CANCELLED';
export type MoStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'TO_CLOSE' | 'DONE' | 'CANCELLED';

export type Ref = { id: number; name: string };
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

export type AuthUser = {
  id: number;
  loginId: string;
  name: string;
  email: string;
  position: string | null;
  isSystemAdmin: boolean;
  readOnly: boolean;
  isDemoLocked: boolean;
  access: Record<Module, AccessLevel>;
};

export type UserDTO = AuthUser & { address: string | null; mobile: string | null; photoUrl: string | null; createdAt: string };

export type Contact = { id: number; name: string; address: string | null; type: 'CUSTOMER' | 'VENDOR' };
export type WorkCenter = { id: number; name: string };

export type ProductDTO = {
  id: number;
  name: string;
  unit: string;
  salesPrice: number;
  costPrice: number;
  onHand: number;
  reserved: number;
  free: number;
  procureOnDemand: boolean;
  procurementType: 'PURCHASE' | 'MANUFACTURING' | null;
  vendor: Ref | null;
  defaultBom: { id: number; reference: string } | null;
  createdById: number;
  updatedAt: string;
};

export type ProductOption = {
  id: number;
  name: string;
  unit: string;
  salesPrice: number;
  costPrice: number;
  onHand: number;
  free: number;
  defaultBomId: number | null;
};

export type LedgerRow = {
  id: number;
  productId: number;
  quantity: number;
  type: string;
  reference: string;
  userName: string;
  createdAt: string;
};

export type BomDTO = {
  id: number;
  reference: string;
  product: Ref;
  outputQty: number;
  components: { productId: number; productName: string; quantity: number }[];
  operations: { sequence: number; name: string; workCenter: Ref; durationMinutes: number }[];
  createdAt: string;
};

export type OperationDTO = {
  id: number;
  reference: string;
  type: OperationType;
  status: OperationStatus;
  source: { kind: 'SO' | 'PO' | 'MO' | 'PRODUCT'; id: number; reference: string };
  lines: { productId: number; productName: string; quantity: number }[];
  targetQty: number | null;
  reason: string | null;
  placedBy: Ref | null;
  placedAt: string;
  decidedBy: Ref | null;
  decidedAt: string | null;
  rejectReason: string | null;
};

export type OrderLine = {
  id: number;
  productId: number;
  productName: string;
  unit: string;
  quantity: number;
  pendingQty: number;
  total: number;
};

export type SalesLine = OrderLine & { deliveredQty: number; unitPrice: number; available: boolean; freeToUse: number };
export type PurchaseLine = OrderLine & { receivedQty: number; unitCost: number };

export type Procurement = { id: number; reference: string; type: 'PO' | 'MO'; status: string };

export type SalesOrderDTO = {
  id: number;
  reference: string;
  customer: Ref;
  customerAddress: string | null;
  salesperson: Ref | null;
  createdBy: Ref | null;
  createdById: number;
  scheduledDate: string | null;
  status: SalesStatus;
  createdAt: string;
  confirmedAt: string | null;
  lines: SalesLine[];
  total: number;
  late: boolean;
  procurements: Procurement[];
  operations: OperationDTO[];
};

export type PurchaseOrderDTO = {
  id: number;
  reference: string;
  vendor: Ref;
  vendorAddress: string | null;
  responsible: Ref | null;
  createdBy: Ref | null;
  createdById: number;
  expectedDate: string | null;
  status: PurchaseStatus;
  origin: string | null;
  createdAt: string;
  lines: PurchaseLine[];
  total: number;
  late: boolean;
  operations: OperationDTO[];
};

export type MoDTO = {
  id: number;
  reference: string;
  product: { id: number; name: string; unit: string };
  quantity: number;
  bom: { id: number; reference: string };
  assignee: Ref | null;
  createdBy: Ref | null;
  createdById: number;
  deadline: string | null;
  status: MoStatus;
  origin: string | null;
  createdAt: string;
  late: boolean;
  components: { id: number; productId: number; productName: string; unit: string; toConsume: number; consumed: number; available: boolean }[];
  workOrders: { id: number; sequence: number; name: string; workCenter: Ref; expectedMinutes: number; realMinutes: number | null; status: 'PENDING' | 'DONE' }[];
  operations: OperationDTO[];
};

export type Section = { all: Record<string, number>; my: Record<string, number>; late: number; myLate: number };
export type DashboardDTO = {
  sales: Section | null;
  purchase: Section | null;
  manufacturing: Section | null;
  awaitingConfirmation: number;
  shortages: { productId: number; name: string; onHand: number; reserved: number; free: number }[];
};

export type AuditRowDTO = {
  id: number;
  createdAt: string;
  user: Ref | null;
  module: AuditModule;
  recordType: string;
  recordId: number;
  reference: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
};
export type AuditPage = Paged<AuditRowDTO> & { summary: { total: number; created: number; updated: number; deleted: number } };
