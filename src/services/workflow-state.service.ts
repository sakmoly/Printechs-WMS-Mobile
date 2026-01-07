import { getDatabase } from '../database/database';

export interface WorkflowState {
  asn_no: string;
  inbound_session: string;
  screen_name: string;
  workflow_state: string;
  locked_carton: string | null;
  current_item: string | null;
  scanned_items: any[];
  scanned_quantities: Record<string, number>;
}

export const saveWorkflowState = async (state: WorkflowState) => {
  const db = await getDatabase();
  
  await db.runAsync(
    `INSERT OR REPLACE INTO workflow_state_cache 
     (asn_no, inbound_session, screen_name, workflow_state, locked_carton, current_item, scanned_items_json, scanned_quantities_json, updated_on) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      state.asn_no,
      state.inbound_session,
      state.screen_name,
      state.workflow_state,
      state.locked_carton || null,
      state.current_item || null,
      JSON.stringify(state.scanned_items),
      JSON.stringify(state.scanned_quantities),
      new Date().toISOString(),
    ]
  );
};

export const loadWorkflowState = async (
  asn_no: string,
  inbound_session: string,
  screen_name: string
): Promise<WorkflowState | null> => {
  const db = await getDatabase();
  
  const result = await db.getFirstAsync<{
    asn_no: string;
    inbound_session: string;
    screen_name: string;
    workflow_state: string;
    locked_carton: string | null;
    current_item: string | null;
    scanned_items_json: string;
    scanned_quantities_json: string;
  }>(
    'SELECT * FROM workflow_state_cache WHERE asn_no = ? AND inbound_session = ? AND screen_name = ?',
    [asn_no, inbound_session, screen_name]
  );

  if (!result) {
    return null;
  }

  return {
    asn_no: result.asn_no,
    inbound_session: result.inbound_session,
    screen_name: result.screen_name,
    workflow_state: result.workflow_state,
    locked_carton: result.locked_carton,
    current_item: result.current_item,
    scanned_items: JSON.parse(result.scanned_items_json || '[]'),
    scanned_quantities: JSON.parse(result.scanned_quantities_json || '{}'),
  };
};

export const clearWorkflowState = async (
  asn_no: string,
  inbound_session: string,
  screen_name: string
) => {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM workflow_state_cache WHERE asn_no = ? AND inbound_session = ? AND screen_name = ?',
    [asn_no, inbound_session, screen_name]
  );
};

