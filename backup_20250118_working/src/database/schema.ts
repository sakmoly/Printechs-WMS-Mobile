export const CREATE_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS settings (
    api_url TEXT,
    device_id TEXT,
    user_id TEXT,
    demo_mode INTEGER DEFAULT 0
  );
`;

export const CREATE_ASN_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS asn_cache (
    asn_no TEXT PRIMARY KEY,
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
    device_id TEXT,
    user_id TEXT,
    event_time TEXT,
    synced INTEGER DEFAULT 0,
    error_msg TEXT
  );
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
];

