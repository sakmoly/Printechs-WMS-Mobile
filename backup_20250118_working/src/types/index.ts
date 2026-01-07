export interface Settings {
  api_url?: string;
  device_id?: string;
  user_id?: string;
  demo_mode: number;
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
  status: 'Pending' | 'Unloaded' | 'InReceiving' | 'Received';
  locked_by?: string;
  locked_on?: string;
  updated_on: string;
}

export interface ScanEvent {
  offline_uuid: string;
  event_type: 'UNLOAD_SCAN' | 'RECEIVE_ITEM_SCAN' | 'SORT_TO_BOX' | 'PACK_BOX_TO_TC' | 'TC_DISPATCH';
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

export interface ItemMaster {
  item_code: string;
  barcode: string;
  item_name?: string;
}

// Demo item master data
export const DEMO_ITEMS: ItemMaster[] = [
  { item_code: 'ITEM-0001', barcode: '100000000001', item_name: 'Product 1' },
  { item_code: 'ITEM-0002', barcode: '100000000002', item_name: 'Product 2' },
  { item_code: 'ITEM-0003', barcode: '100000000003', item_name: 'Product 3' },
  { item_code: 'ITEM-0004', barcode: '100000000004', item_name: 'Product 4' },
  { item_code: 'ITEM-0005', barcode: '100000000005', item_name: 'Product 5' },
  { item_code: 'ITEM-0006', barcode: '100000000006', item_name: 'Product 6' },
];

