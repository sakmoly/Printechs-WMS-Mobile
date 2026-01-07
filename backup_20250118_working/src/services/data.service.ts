import { getDatabase } from '../database/database';
import { ASNItem, TransferOrderAllocation, Box, TransferCarton, CartonStatus } from '../types';
import { normalizeASN } from '../utils/asn';

export const dataService = {
  // ASN Operations
  getASN: async (asn_no: string) => {
    const db = await getDatabase();
    return await db.getFirstAsync<{ asn_no: string; payload_json: string; updated_on: string }>(
      'SELECT * FROM asn_cache WHERE asn_no = ?',
      [asn_no]
    );
  },

  getCartonItems: async (asn_no: string, carton_id: string): Promise<ASNItem[]> => {
    const db = await getDatabase();
    return await db.getAllAsync<ASNItem>(
      'SELECT * FROM asn_carton_map WHERE asn_no = ? AND carton_id = ?',
      [asn_no, carton_id]
    );
  },

  // Check if carton belongs to ASN (with ASN normalization)
  isCartonInASN: async (asn_no: string, carton_id: string): Promise<boolean> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    
    // Check with normalized ASN
    let result = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))',
      [normalizedASN, carton_id]
    );
    
    if ((result?.count || 0) > 0) {
      return true;
    }
    
    // Also check with original ASN format (in case data wasn't normalized)
    if (asn_no !== normalizedASN) {
      result = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))',
        [asn_no, carton_id]
      );
      
      if ((result?.count || 0) > 0) {
        return true;
      }
    }
    
    // Try to find any carton with this ID and check all possible ASN formats
    const allCartons = await db.getAllAsync<{ asn_no: string }>(
      'SELECT DISTINCT asn_no FROM asn_carton_map WHERE UPPER(TRIM(carton_id)) = UPPER(TRIM(?))',
      [carton_id]
    );
    
    // Check if any of the found ASNs match (normalized)
    for (const row of allCartons) {
      if (normalizeASN(row.asn_no) === normalizedASN) {
        return true;
      }
    }
    
    return false;
  },

  // Get all cartons for an ASN
  getASNCartons: async (asn_no: string): Promise<string[]> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    
    // Try with normalized ASN first
    let result = await db.getAllAsync<{ carton_id: string }>(
      'SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?',
      [normalizedASN]
    );
    
    // If no results and ASN was normalized, try with original format
    if (result.length === 0 && asn_no !== normalizedASN) {
      result = await db.getAllAsync<{ carton_id: string }>(
        'SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?',
        [asn_no]
      );
    }
    
    return result.map(r => r.carton_id);
  },

  // Transfer Order Operations
  getTransferOrderAllocations: async (asn_no: string, store?: string): Promise<TransferOrderAllocation[]> => {
    const db = await getDatabase();
    if (store) {
      return await db.getAllAsync<TransferOrderAllocation>(
        'SELECT * FROM transfer_order_cache WHERE asn_no = ? AND store = ?',
        [asn_no, store]
      );
    }
    return await db.getAllAsync<TransferOrderAllocation>(
      'SELECT * FROM transfer_order_cache WHERE asn_no = ?',
      [asn_no]
    );
  },

  // Box Operations
  getBoxes: async (asn_no?: string, store?: string): Promise<Box[]> => {
    const db = await getDatabase();
    let query = 'SELECT * FROM box_cache WHERE 1=1';
    const params: any[] = [];

    if (asn_no) {
      query += ' AND asn_no = ?';
      params.push(asn_no);
    }
    if (store) {
      query += ' AND store = ?';
      params.push(store);
    }

    query += ' ORDER BY updated_on DESC';
    return await db.getAllAsync<Box>(query, params);
  },

  saveBox: async (box: Box) => {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)',
      [box.box_id, box.asn_no, box.to_no, box.store, box.status, box.updated_on]
    );
  },

  updateBoxStatus: async (box_id: string, status: string) => {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE box_cache SET status = ?, updated_on = ? WHERE box_id = ?',
      [status, new Date().toISOString(), box_id]
    );
  },

  // Transfer Carton Operations
  getTransferCartons: async (asn_no?: string, store?: string): Promise<TransferCarton[]> => {
    const db = await getDatabase();
    let query = 'SELECT * FROM tc_cache WHERE 1=1';
    const params: any[] = [];

    if (asn_no) {
      query += ' AND asn_no = ?';
      params.push(asn_no);
    }
    if (store) {
      query += ' AND store = ?';
      params.push(store);
    }

    query += ' ORDER BY updated_on DESC';
    return await db.getAllAsync<TransferCarton>(query, params);
  },

  saveTransferCarton: async (tc: TransferCarton) => {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO tc_cache (tc_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)',
      [tc.tc_id, tc.asn_no, tc.to_no, tc.store, tc.status, tc.updated_on]
    );
  },

  updateTransferCartonStatus: async (tc_id: string, status: string) => {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE tc_cache SET status = ?, updated_on = ? WHERE tc_id = ?',
      [status, new Date().toISOString(), tc_id]
    );
  },

  // Carton Status Operations
  getCartonStatus: async (asn_no: string, inbound_session: string, carton_id: string): Promise<CartonStatus | null> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    
    // Try with normalized ASN first
    let result = await db.getFirstAsync<CartonStatus>(
      'SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? AND carton_id = ?',
      [normalizedASN, inbound_session, carton_id.trim().toUpperCase()]
    );
    
    if (result) {
      return result;
    }
    
    // Fallback: try with original ASN format (in case data wasn't normalized)
    if (asn_no !== normalizedASN) {
      result = await db.getFirstAsync<CartonStatus>(
        'SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? AND carton_id = ?',
        [asn_no, inbound_session, carton_id.trim().toUpperCase()]
      );
    }
    
    return result || null;
  },

  getAllCartonStatuses: async (asn_no: string, inbound_session: string): Promise<CartonStatus[]> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    
    // Try with normalized ASN first
    let results = await db.getAllAsync<CartonStatus>(
      'SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? ORDER BY carton_id',
      [normalizedASN, inbound_session]
    );
    
    // If no results and ASN was normalized, try with original format
    if (results.length === 0 && asn_no !== normalizedASN) {
      results = await db.getAllAsync<CartonStatus>(
        'SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? ORDER BY carton_id',
        [asn_no, inbound_session]
      );
    }
    
    return results;
  },

  updateCartonStatus: async (status: CartonStatus) => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO carton_status_cache 
       (asn_no, inbound_session, carton_id, status, locked_by, locked_on, updated_on) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        status.asn_no,
        status.inbound_session,
        status.carton_id,
        status.status,
        status.locked_by || null,
        status.locked_on || null,
        status.updated_on,
      ]
    );
  },
};

