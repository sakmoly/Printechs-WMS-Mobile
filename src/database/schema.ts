export const CREATE_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS settings (
    api_url TEXT,
    device_id TEXT,
    user_id TEXT,
    demo_mode INTEGER DEFAULT 0,
    active_asn TEXT,
    active_session TEXT
  );
`;

export const CREATE_ASN_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS asn_cache (
    asn_no TEXT PRIMARY KEY,
    asn_no_original TEXT,
    status TEXT,
    purchase_order TEXT,
    supplier TEXT,
    shipment_date TEXT,
    expected_arrival_date TEXT,
    total_shipped_qty REAL,
    total_carton_count INTEGER,
    airway_bill_no TEXT,
    shipment_type TEXT,
    payload_json TEXT,
    updated_on TEXT
  );
`;

export const CREATE_ASN_CARTON_MAP_TABLE = `
  CREATE TABLE IF NOT EXISTS asn_carton_map (
    asn_no TEXT,
    carton_id TEXT,
    item_code TEXT,
    shipped_qty REAL,
    PRIMARY KEY (asn_no, carton_id, item_code)
  );
`;

export const CREATE_TRANSFER_ORDER_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS transfer_order_cache (
    to_no TEXT,
    asn_no TEXT,
    store TEXT,
    item_code TEXT,
    allocated_qty REAL,
    PRIMARY KEY (to_no, store, item_code)
  );
`;

export const CREATE_BOX_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS box_cache (
    box_id TEXT PRIMARY KEY,
    asn_no TEXT,
    to_no TEXT,
    store TEXT,
    status TEXT,
    purpose TEXT DEFAULT 'STORE',
    updated_on TEXT
  );
`;

export const CREATE_TC_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS tc_cache (
    tc_id TEXT PRIMARY KEY,
    asn_no TEXT,
    to_no TEXT,
    store TEXT,
    status TEXT,
    updated_on TEXT
  );
`;

export const CREATE_CARTON_STATUS_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS carton_status_cache (
    asn_no TEXT,
    inbound_session TEXT,
    carton_id TEXT,
    status TEXT,
    locked_by TEXT,
    locked_on TEXT,
    updated_on TEXT,
    PRIMARY KEY (asn_no, inbound_session, carton_id)
  );
`;

export const CREATE_EVENT_QUEUE_TABLE = `
  CREATE TABLE IF NOT EXISTS event_queue (
    offline_uuid TEXT PRIMARY KEY,
    event_type TEXT,
    asn_no TEXT,
    to_no TEXT,
    inbound_session TEXT,
    carton_id TEXT,
    item_code TEXT,
    qty REAL,
    store TEXT,
    box_id TEXT,
    tc_id TEXT,
    rack TEXT,
    bin TEXT,
    source_bin TEXT,
    location_id TEXT,
    device_id TEXT,
    user_id TEXT,
    event_time TEXT,
    synced INTEGER DEFAULT 0,
    error_msg TEXT,
    material_request TEXT,
    transfer_in TEXT,
    cycle_count_title TEXT
  );
`;

export const CREATE_WORKFLOW_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS workflow_state_cache (
    asn_no TEXT,
    inbound_session TEXT,
    screen_name TEXT,
    workflow_state TEXT,
    locked_carton TEXT,
    current_item TEXT,
    scanned_items_json TEXT,
    scanned_quantities_json TEXT,
    updated_on TEXT,
    PRIMARY KEY (asn_no, inbound_session, screen_name)
  );
`;

export const CREATE_SCANNED_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS scanned_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asn_no TEXT,
    inbound_session TEXT,
    carton_id TEXT,
    item_code TEXT,
    box_id TEXT,
    store TEXT,
    scanned_qty INTEGER DEFAULT 1,
    scanned_on TEXT,
    device_id TEXT,
    user_id TEXT,
    UNIQUE(asn_no, inbound_session, carton_id, item_code, box_id)
  );
`;

export const CREATE_PUTAWAY_ITEMS_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS putaway_items_cache (
    asn_no TEXT,
    item_code TEXT,
    remaining_qty INTEGER,
    putaway_box_id TEXT,
    rack_id TEXT,
    bin_id TEXT,
    putaway_on TEXT,
    device_id TEXT,
    user_id TEXT,
    PRIMARY KEY (asn_no, item_code, putaway_box_id)
  );
`;

export const CREATE_WAREHOUSE_RACK_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS warehouse_rack_cache (
    rack_id TEXT PRIMARY KEY,
    bin_id TEXT,
    location_code TEXT,
    capacity INTEGER,
    current_qty INTEGER DEFAULT 0,
    updated_on TEXT
  );
`;

export const CREATE_ITEM_MASTER_TABLE = `
  CREATE TABLE IF NOT EXISTS item_master (
    item_code TEXT PRIMARY KEY,
    barcode TEXT UNIQUE NOT NULL,
    item_name TEXT,
    updated_on TEXT
  );
`;

export const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    user_code TEXT PRIMARY KEY,
    user_name TEXT,
    password TEXT,
    device_id TEXT,
    is_active INTEGER DEFAULT 1,
    updated_on TEXT
  );
`;

export const CREATE_WAREHOUSE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS warehouse_cache (
    warehouse_id TEXT PRIMARY KEY,
    warehouse_name TEXT,
    location TEXT,
    is_active INTEGER DEFAULT 1,
    updated_on TEXT
  );
`;

export const CREATE_WAREHOUSE_STORE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS warehouse_store_cache (
    code TEXT PRIMARY KEY,
    name TEXT,
    warehouse_type TEXT,
    is_group INTEGER DEFAULT 0,
    parent_warehouse TEXT,
    updated_on TEXT
  );
`;

export const CREATE_LOCATION_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS location_cache (
    location_id TEXT PRIMARY KEY,
    warehouse TEXT,
    zone TEXT,
    aisle TEXT,
    parent_rack TEXT,
    level TEXT,
    bin_id TEXT,
    location_type TEXT,
    location_type_detailed TEXT,
    is_available INTEGER DEFAULT 1,
    capacity_volume_weight REAL,
    updated_on TEXT
  );
`;

export const CREATE_INBOUND_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS inbound_sessions (
    inbound_session TEXT PRIMARY KEY,
    asn_no TEXT,
    transfer_in TEXT,
    transfer_order TEXT,
    dock TEXT,
    status TEXT DEFAULT 'Active',
    completed_cartons INTEGER DEFAULT 0,
    total_cartons INTEGER DEFAULT 0,
    started_by TEXT,
    started_on TEXT,
    completed_on TEXT,
    synced INTEGER DEFAULT 0,
    updated_on TEXT
  );
`;

// Transfer In Cache Table
export const CREATE_TRANSFER_IN_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS transfer_in_cache (
    title TEXT PRIMARY KEY,
    from_showroom TEXT,
    to_warehouse TEXT,
    transfer_date TEXT,
    status TEXT,
    items_json TEXT,
    prepared_by TEXT,
    created_on TEXT,
    updated_on TEXT
  );
`;

// Material Request Cache Table
export const CREATE_MATERIAL_REQUEST_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS material_request_cache (
    title TEXT PRIMARY KEY,
    from_warehouse TEXT,
    to_showroom TEXT,
    request_date TEXT,
    status TEXT,
    items_json TEXT,
    requested_by TEXT,
    created_on TEXT,
    updated_on TEXT
  );
`;

// Material Request Picking Sessions Table (for draft/resume functionality)
export const CREATE_MATERIAL_REQUEST_PICKING_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS material_request_picking_sessions (
    session_id TEXT PRIMARY KEY,
    material_request_title TEXT,
    tc_id TEXT,
    bin_location TEXT,
    carton_id TEXT,
    store TEXT,
    status TEXT DEFAULT 'Draft',
    started_by TEXT,
    started_at TEXT,
    updated_at TEXT,
    synced INTEGER DEFAULT 0,
    FOREIGN KEY (material_request_title) REFERENCES material_request_cache(title)
  );
`;

// Cycle Count Cache Table
export const CREATE_CYCLE_COUNT_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS cycle_count_cache (
    title TEXT PRIMARY KEY,
    warehouse TEXT,
    zone TEXT,
    status TEXT,
    items_json TEXT,
    counted_items_json TEXT,
    created_by TEXT,
    created_on TEXT,
    updated_on TEXT
  );
`;

// New Bin-Based Cycle Count Tables
export const CREATE_CYCLE_COUNT_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS cycle_count_sessions (
    session_id TEXT PRIMARY KEY,
    count_type TEXT,
    warehouse_id TEXT,
    bin_id TEXT,
    bin_code TEXT,
    started_by TEXT,
    started_at TEXT,
    completed_at TEXT,
    status TEXT,
    is_blind_count INTEGER DEFAULT 0,
    device_id TEXT,
    remarks TEXT,
    synced INTEGER DEFAULT 0,
    server_session_id TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`;

export const CREATE_CYCLE_COUNT_LINES_TABLE = `
  CREATE TABLE IF NOT EXISTS cycle_count_lines (
    line_id TEXT PRIMARY KEY,
    session_id TEXT,
    item_code TEXT,
    barcode TEXT,
    carton_id TEXT,
    uom TEXT,
    expected_qty REAL,
    counted_qty REAL,
    variance_qty REAL,
    variance_value REAL,
    is_unexpected_item INTEGER DEFAULT 0,
    reason_code TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (session_id) REFERENCES cycle_count_sessions(session_id) ON DELETE CASCADE
  );
`;

export const CREATE_BIN_MASTER_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS bin_master_cache (
    bin_id TEXT PRIMARY KEY,
    bin_code TEXT UNIQUE,
    bin_barcode TEXT,
    warehouse_id TEXT,
    zone TEXT,
    aisle TEXT,
    rack TEXT,
    level TEXT,
    is_active INTEGER DEFAULT 1,
    updated_on TEXT
  );
`;

export const CREATE_ITEM_BARCODE_MAP_TABLE = `
  CREATE TABLE IF NOT EXISTS item_barcode_map (
    barcode TEXT PRIMARY KEY,
    item_code TEXT,
    uom TEXT,
    pack_size REAL DEFAULT 1,
    barcode_type TEXT,
    updated_on TEXT
  );
`;

// Stock Ledger Cache Table
export const CREATE_STOCK_LEDGER_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS stock_ledger_cache (
    item_code TEXT,
    warehouse TEXT,
    bin_location TEXT,
    qty REAL DEFAULT 0,
    reserved_qty REAL DEFAULT 0,
    available_qty REAL DEFAULT 0,
    last_transaction_date TEXT,
    updated_on TEXT,
    PRIMARY KEY (item_code, warehouse, bin_location)
  );
`;

// Stock Transaction Cache Table
export const CREATE_STOCK_TRANSACTION_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS stock_transaction_cache (
    transaction_id TEXT PRIMARY KEY,
    item_code TEXT,
    warehouse TEXT,
    bin_location TEXT,
    transaction_type TEXT,
    qty_change REAL,
    before_qty REAL,
    after_qty REAL,
    reference_doc TEXT,
    transaction_date TEXT,
    user_id TEXT,
    updated_on TEXT
  );
`;

// Migration: Add active_asn and active_session columns to settings table
export const MIGRATE_SETTINGS_ADD_ACTIVE_FIELDS = `
  -- Add active_asn column if it doesn't exist
  -- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
  -- We'll check and add the column in the database.ts file
`;

export const ALL_MIGRATIONS = [
  CREATE_SETTINGS_TABLE,
  CREATE_ASN_CACHE_TABLE,
  CREATE_ASN_CARTON_MAP_TABLE,
  CREATE_TRANSFER_ORDER_CACHE_TABLE,
  CREATE_BOX_CACHE_TABLE,
  CREATE_TC_CACHE_TABLE,
  CREATE_CARTON_STATUS_CACHE_TABLE,
  CREATE_EVENT_QUEUE_TABLE,
  CREATE_WORKFLOW_STATE_TABLE,
  CREATE_SCANNED_ITEMS_TABLE,
  CREATE_PUTAWAY_ITEMS_CACHE_TABLE,
  CREATE_WAREHOUSE_RACK_CACHE_TABLE,
  CREATE_ITEM_MASTER_TABLE,
  CREATE_USERS_TABLE,
  CREATE_WAREHOUSE_CACHE_TABLE,
  CREATE_WAREHOUSE_STORE_CACHE_TABLE,
  CREATE_LOCATION_CACHE_TABLE,
  CREATE_INBOUND_SESSIONS_TABLE,
  CREATE_TRANSFER_IN_CACHE_TABLE,
  CREATE_MATERIAL_REQUEST_CACHE_TABLE,
  CREATE_CYCLE_COUNT_CACHE_TABLE,
  CREATE_CYCLE_COUNT_SESSIONS_TABLE,
  CREATE_CYCLE_COUNT_LINES_TABLE,
  CREATE_BIN_MASTER_CACHE_TABLE,
  CREATE_ITEM_BARCODE_MAP_TABLE,
  CREATE_STOCK_LEDGER_CACHE_TABLE,
  CREATE_STOCK_TRANSACTION_CACHE_TABLE,
  CREATE_MATERIAL_REQUEST_PICKING_SESSIONS_TABLE,
];
