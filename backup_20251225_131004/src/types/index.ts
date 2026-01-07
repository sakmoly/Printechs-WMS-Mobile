export interface Settings {
  api_url?: string;
  device_id?: string;
  user_id?: string;
  user_code?: string;
  password?: string;
  demo_mode: number;
  active_asn?: string;
  active_session?: string;
  auth_token?: string;
  auth_token_expires?: string;
}

export interface ASNItem {
  carton_id: string;
  item_code: string;
  shipped_qty: number;
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
  to_no: string;
  store: string;
  status: string;
  purpose?: "STORE" | "PUTAWAY";
  updated_on: string;
}

export interface TransferCarton {
  tc_id: string;
  asn_no: string;
  to_no: string;
  store: string;
  status: string;
  updated_on: string;
}

export interface CartonStatus {
  asn_no: string;
  inbound_session: string;
  carton_id: string;
  status: "Pending" | "Unloaded" | "Receiving" | "Received";
  locked_by?: string;
  locked_on?: string;
  updated_on: string;
}

export interface ScanEvent {
  offline_uuid: string;
  event_type:
    | "UNLOAD_SCAN"
    | "RECEIVE_ITEM_SCAN"
    | "SORT_TO_BOX"
    | "PACK_BOX_TO_TC"
    | "TC_DISPATCH"
    | "PUTAWAY_ITEM_SCAN"
    | "PUTAWAY_TO_BOX"
    | "PUTAWAY_TO_RACK"
    | "PUTAWAY_DISPATCH";
  asn_no?: string;
  to_no?: string;
  inbound_session?: string;
  carton_id?: string;
  item_code?: string;
  qty?: number;
  store?: string;
  box_id?: string;
  tc_id?: string;
  rack?: string;
  bin?: string;
  device_id?: string;
  user_id?: string;
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
  item_name?: string;
}
