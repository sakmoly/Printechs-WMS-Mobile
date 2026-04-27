/** Item master sync: full replaces local table; incremental uses modified_since watermark. */
export type ItemMasterSyncMode = "full" | "incremental";

export interface Settings {
  api_url?: string | null;
  device_id?: string | null;
  user_id?: string | null;
  user_code?: string | null;
  password?: string | null;
  demo_mode: number;
  active_asn?: string | null;
  active_session?: string | null;
  auth_token?: string;
  auth_token_expires?: string;
  /** Optional default warehouse context for putaway / relocation */
  warehouse?: string | null;
  warehouse_id?: string | null;
  /** Default full. Incremental uses item_master_modified_watermark when set. */
  item_master_sync_mode?: ItemMasterSyncMode | string | null;
  /** Server page size (rows per request). Default 5000. */
  item_master_page_size?: number | null;
  /** ISO timestamp: last successful incremental sync high-water mark. */
  item_master_modified_watermark?: string | null;
}

export interface ASNItem {
  carton_id: string;
  item_code: string;
  shipped_qty: number;
  barcode?: string; // Optional barcode from item_master for matching
}

export interface TransferOrderAllocation {
  to_no: string;
  asn_no: string;
  store: string;
  item_code: string;
  allocated_qty: number;
}

export interface Box {
  box_id: string;
  asn_no: string;
  to_no?: string | null;
  store: string;
  status: string;
  purpose?: "STORE" | "PUTAWAY" | string;
  updated_on: string;
  /** ERP / mobile: who created the sort box (sysadmin, USER-…, etc.) */
  created_by?: string | null;
}

export interface TransferCarton {
  tc_id: string;
  asn_no: string;
  to_no?: string | null;
  store: string;
  status: string;
  /** Present for rows from tc_cache; optional when building UI-only task rows */
  updated_on?: string;
  /** UI / putaway task linkage (not always from tc_cache row) */
  purpose?: string;
}

export interface CartonStatus {
  asn_no: string;
  inbound_session: string;
  carton_id: string;
  /** Legacy DB / ERP value normalized in app code to "Receiving". */
  status:
    | "Pending"
    | "Unloaded"
    | "Receiving"
    | "Received"
    | "Received with Shortage"
    | "In Receiving";
  locked_by?: string;
  locked_on?: string;
  /** User id / code / name who recorded unload (from unload-line or this device). */
  unloaded_by?: string | null;
  updated_on: string;
}

export interface ScanEvent {
  offline_uuid: string;
  event_type:
    | "UNLOAD_SCAN"
    | "RECEIVE_ITEM_SCAN"
    | "SORT_TO_BOX"
    | "PACK_BOX_TO_TC"
    | "PACK_ITEM_TO_TC"
    | "TC_DISPATCH"
    | "PUTAWAY_ITEM_SCAN"
    | "PUTAWAY_TO_BOX"
    | "PUTAWAY_TO_RACK"
    | "PUTAWAY_DISPATCH"
    | "CYCLE_COUNT_RECORD"
    | "MATERIAL_REQUEST_PICK"
    | "TRANSFER_IN_RECEIVE"
    | "RELOCATION_MOVE";
  asn_no?: string | null;
  transfer_in?: string | null;
  material_request?: string | null;
  cycle_count_title?: string | null;
  to_no?: string | null;
  inbound_session?: string | null;
  carton_id?: string | null;
  item_code?: string | null;
  qty?: number;
  store?: string | null;
  box_id?: string | null;
  tc_id?: string | null;
  rack?: string | null;
  bin?: string | null;
  source_bin?: string | null;
  location_id?: string | null;
  from_bin?: string | null;
  from_carton?: string | null;
  to_bin?: string | null;
  to_carton?: string | null;
  device_id?: string | null;
  user_id?: string | null;
  event_time: string;
  synced: number;
  error_msg?: string;
}

export interface RemainingItem {
  item_code: string;
  shipped_qty: number;
  allocated_qty: number;
  remaining_qty: number;
  scanned_to_stores: number;
  box_id?: string;
}

export interface PutAwayItem {
  asn_no: string;
  item_code: string;
  remaining_qty: number;
  putaway_box_id?: string;
  rack_id?: string;
  bin_id?: string;
  putaway_on?: string;
}

export interface WarehouseRack {
  rack_id: string;
  bin_id?: string;
  location_code: string;
  capacity?: number;
  current_qty?: number;
  updated_on?: string;
}

export interface ItemMaster {
  item_code: string;
  barcode: string;
  item_name?: string | null;
}

// Transfer In Types
export interface TransferIn {
  title: string;
  from_showroom: string;
  to_warehouse: string;
  transfer_date: string;
  expected_arrival_date?: string;
  status: "Draft" | "Submitted" | "In Transit" | "Receiving" | "Received" | "Completed" | "Cancelled";
  items: {
    item_code: string;
    qty: number;
    received_qty?: number;
    carton_id?: string;
    status?: "Pending" | "Picking" | "Received"; // Item-level status
    line_id?: string | number; // Optional line identifier
  }[];
  prepared_by: string;
  received_by?: string;
  received_on?: string;
  total_qty?: number;
  created_on: string;
  updated_on: string;
  created_at?: string;
  updated_at?: string;
}

// Material Request Types
export interface MaterialRequest {
  title: string;
  from_warehouse: string;
  to_showroom: string;
  request_date: string;
  required_date?: string;
  status: "Draft" | "Submitted" | "In Progress" | "Picked" | "Dispatched" | "Completed" | "Cancelled";
  items: {
    item_code: string;
    requested_qty: number;
    picked_qty?: number;
    pending_qty?: number;
    status?: "Pending" | "In Progress" | "Picked" | "Sealed";
    item_name?: string;
    description?: string;
  }[];
  requested_by: string;
  total_requested_qty?: number;
  total_picked_qty?: number;
  created_on?: string;
  updated_on?: string;
  created_at?: string;
  updated_at?: string;
}

// Cycle Count Types
export interface CycleCount {
  title: string;
  warehouse: string;
  zone?: string;
  count_type?: "Full" | "Cycle" | "Spot";
  count_date?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  freeze_stock?: boolean;
  status:
    | "Draft"
    | "Scheduled"
    | "In Progress"
    | "Completed"
    | "Cancelled"
    | "Approved"
    | "Submitted";
  items: {
    id?: number;
    item_code: string;
    bin_location?: string;
    /** Actual bin when counted differs from planned location */
    actual_bin_location?: string;
    expected_qty: number;
    actual_qty?: number;
    discrepancy?: number;
    counted_by?: string;
    counted_on?: string;
    reviewed_by?: string;
    reviewed_on?: string;
    approval_required?: boolean;
    approved_by?: string;
    approved_on?: string;
    discrepancy_reason?: string;
    status?: "Pending" | "Counted" | "Reviewed" | "Approved";
  }[];
  created_by: string;
  assigned_to?: string;
  total_items?: number;
  counted_items?: number;
  items_with_discrepancy?: number;
  created_on: string;
  updated_on: string;
  created_at?: string;
  updated_at?: string;
}

// Stock Ledger Types
export interface StockLedger {
  item_code: string;
  warehouse: string;
  bin_location?: string | null;
  qty: number;
  reserved_qty: number;
  available_qty: number;
  last_transaction_date?: string;
  last_transaction_type?: string;
  last_transaction_ref?: string;
  updated_on: string;
  created_at?: string;
}

export interface StockTransaction {
  id?: number;
  transaction_id?: string;
  item_code: string;
  warehouse: string;
  bin_location?: string | null;
  transaction_type: "Receiving" | "Putaway" | "Picking" | "CycleCount" | "TransferIn" | "MaterialRequest";
  transaction_date: string;
  reference_doc_type?: string;
  reference_doc: string;
  wms_transaction_title?: string;
  qty_change: number;
  qty_before?: number;
  before_qty: number;
  qty_after?: number;
  after_qty: number;
  source_bin?: string | null;
  target_bin?: string | null;
  performed_by?: string;
  user_id?: string;
  notes?: string | null;
  created_at?: string;
}