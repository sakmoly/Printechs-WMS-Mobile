-- Demo Data Migration for Printechs WMS Mobile
-- This file contains all demo data as direct SQL INSERT statements
-- ASN: ASN-00045
-- Transfer Order: TO-00012

-- Clear existing demo data for ASN-00045
DELETE FROM asn_carton_map WHERE asn_no = 'ASN-00045';
DELETE FROM transfer_order_cache WHERE asn_no = 'ASN-00045';
DELETE FROM box_cache WHERE asn_no = 'ASN-00045';
DELETE FROM asn_cache WHERE asn_no = 'ASN-00045';
DELETE FROM carton_status_cache WHERE asn_no = 'ASN-00045';

-- Insert ASN Cache
INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) 
VALUES ('ASN-00045', '{"asn_no":"ASN-00045","transfer_order":"TO-00012","dock":"DOCK-01"}', datetime('now'));

-- Insert ASN Carton Map
-- CTN-001: ITEM-0001 (2), ITEM-0002 (1)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-001', 'ITEM-0001', 2);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-001', 'ITEM-0002', 1);

-- CTN-002: ITEM-0001 (1), ITEM-0003 (2)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-002', 'ITEM-0001', 1);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-002', 'ITEM-0003', 2);

-- CTN-003: ITEM-0004 (2), ITEM-0006 (1)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-003', 'ITEM-0004', 2);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-003', 'ITEM-0006', 1);

-- CTN-004: ITEM-0002 (2), ITEM-0005 (1)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-004', 'ITEM-0002', 2);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-004', 'ITEM-0005', 1);

-- Insert Transfer Order Allocations
-- SR-01: ITEM-0001 (2), ITEM-0002 (1), ITEM-0004 (1)
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-01', 'ITEM-0001', 2);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-01', 'ITEM-0002', 1);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-01', 'ITEM-0004', 1);

-- SR-02: ITEM-0001 (1), ITEM-0003 (2), ITEM-0006 (1)
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-02', 'ITEM-0001', 1);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-02', 'ITEM-0003', 2);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-02', 'ITEM-0006', 1);

-- SR-03: ITEM-0002 (2), ITEM-0004 (1), ITEM-0005 (1)
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-03', 'ITEM-0002', 2);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-03', 'ITEM-0004', 1);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-03', 'ITEM-0005', 1);

-- Insert Box Cache
INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES ('BOX-SR01-001', 'ASN-00045', 'TO-00012', 'SR-01', 'Open', datetime('now'));
INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES ('BOX-SR02-001', 'ASN-00045', 'TO-00012', 'SR-02', 'Open', datetime('now'));
INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES ('BOX-SR03-001', 'ASN-00045', 'TO-00012', 'SR-03', 'Open', datetime('now'));

-- Insert Carton Status Cache (all Pending initially)
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-001', 'Pending', datetime('now'));
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-002', 'Pending', datetime('now'));
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-003', 'Pending', datetime('now'));
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-004', 'Pending', datetime('now'));

