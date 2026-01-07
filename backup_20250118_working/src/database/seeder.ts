import { getDatabase } from './database';

export const seedDemoData = async () => {
  const db = await getDatabase();

  // Seed ASN Cache
  const asnPayload = JSON.stringify({
    asn_no: 'ASN-00045',
    transfer_order: 'TO-00012',
    dock: 'DOCK-01',
  });

  await db.runAsync(
    'INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) VALUES (?, ?, ?)',
    ['ASN-00045', asnPayload, new Date().toISOString()]
  );

  // Seed ASN Carton Map
  const cartonMap = [
    { carton_id: 'CTN-001', item_code: 'ITEM-0001', shipped_qty: 2 },
    { carton_id: 'CTN-001', item_code: 'ITEM-0002', shipped_qty: 1 },
    { carton_id: 'CTN-002', item_code: 'ITEM-0001', shipped_qty: 1 },
    { carton_id: 'CTN-002', item_code: 'ITEM-0003', shipped_qty: 2 },
    { carton_id: 'CTN-003', item_code: 'ITEM-0004', shipped_qty: 2 },
    { carton_id: 'CTN-004', item_code: 'ITEM-0002', shipped_qty: 2 },
    { carton_id: 'CTN-004', item_code: 'ITEM-0005', shipped_qty: 1 },
  ];

  for (const map of cartonMap) {
    await db.runAsync(
      'INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES (?, ?, ?, ?)',
      ['ASN-00045', map.carton_id, map.item_code, map.shipped_qty]
    );
  }

  // Seed Transfer Order Cache
  const toAllocations = [
    { store: 'SR-01', item_code: 'ITEM-0001', allocated_qty: 2 },
    { store: 'SR-01', item_code: 'ITEM-0002', allocated_qty: 2 },
    { store: 'SR-02', item_code: 'ITEM-0001', allocated_qty: 1 },
    { store: 'SR-02', item_code: 'ITEM-0003', allocated_qty: 2 },
    { store: 'SR-03', item_code: 'ITEM-0004', allocated_qty: 2 },
    { store: 'SR-03', item_code: 'ITEM-0005', allocated_qty: 1 },
  ];

  for (const alloc of toAllocations) {
    await db.runAsync(
      'INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)',
      ['TO-00012', 'ASN-00045', alloc.store, alloc.item_code, alloc.allocated_qty]
    );
  }

  // Seed Box Cache
  const boxes = [
    { box_id: 'BOX-SR01-001', store: 'SR-01', status: 'Open' },
    { box_id: 'BOX-SR02-001', store: 'SR-02', status: 'Open' },
    { box_id: 'BOX-SR03-001', store: 'SR-03', status: 'Open' },
  ];

  for (const box of boxes) {
    await db.runAsync(
      'INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)',
      [box.box_id, 'ASN-00045', 'TO-00012', box.store, box.status, new Date().toISOString()]
    );
  }

  // Seed Carton Status Cache (all Pending initially)
  const cartons = ['CTN-001', 'CTN-002', 'CTN-003', 'CTN-004'];
  for (const carton_id of cartons) {
    await db.runAsync(
      'INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES (?, ?, ?, ?, ?)',
      ['ASN-00045', '', carton_id, 'Pending', new Date().toISOString()]
    );
  }
};

