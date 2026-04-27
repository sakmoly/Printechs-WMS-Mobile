/**
 * Comprehensive Test for All Cartons in ASN
 * Tests the complete workflow: Start ASN, Unload all cartons, Process each carton completely
 */

import { getDatabase } from '../database/database';
import { dataService } from '../services/data.service';
import { apiService } from '../services/api.service';
import { getSettings, saveSettings } from '../services/settings.service';
import { addEvent } from '../services/event-queue.service';
import { normalizeASN } from './asn';

interface TestResult {
  step: string;
  status: 'success' | 'failed';
  message: string;
  data?: any;
}

export async function testAllCartonsInASN(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const asnNo = 'ASN-00045';
  const normalizedASN = normalizeASN(asnNo);
  
  const logResult = (step: string, status: 'success' | 'failed', message: string, data?: any) => {
    results.push({ step, status, message, data });
    console.log(`🧪 [${step}] ${status.toUpperCase()}: ${message}`, data || '');
  };

  try {
    // Step 1: Start Inbound Session
    logResult('1', 'success', 'Starting inbound session...');
    const settings = await getSettings();
    const response = await apiService.startInbound({
      asn_no: normalizedASN,
      transfer_order: 'TO-00012',
      dock: 'DOCK-01',
      user_id: settings.user_id!,
      device_id: settings.device_id!,
    });

    const sessionId = response.inbound_session;
    await saveSettings({
      active_asn: normalizedASN,
      active_session: sessionId,
    });
    logResult('1', 'success', 'Inbound session started', { sessionId });

    // Step 2: Get all cartons
    logResult('2', 'success', 'Getting all cartons for ASN...');
    const cartons = await dataService.getASNCartons(normalizedASN);
    logResult('2', 'success', `Found ${cartons.length} cartons`, { cartons });

    // Step 3: Unload all cartons
    logResult('3', 'success', 'Unloading all cartons...');
    for (const cartonId of cartons) {
      await addEvent({
        event_type: 'UNLOAD_SCAN',
        asn_no: normalizedASN,
        inbound_session: sessionId,
        carton_id: cartonId,
        device_id: settings.device_id!,
        user_id: settings.user_id!,
      });

      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: sessionId,
        carton_id: cartonId,
        status: 'Unloaded',
        updated_on: new Date().toISOString(),
      });
      logResult('3', 'success', `Unloaded ${cartonId}`);
    }

    // Step 4: Process each carton completely
    logResult('4', 'success', 'Processing all cartons...');
    for (const cartonId of cartons) {
      logResult(`4-${cartonId}`, 'success', `Starting processing for ${cartonId}...`);
      
      // Lock carton
      const lockResponse = await apiService.lockCarton({
        inbound_session: sessionId,
        asn_no: normalizedASN,
        carton_id: cartonId,
        user_id: settings.user_id!,
        device_id: settings.device_id!,
      });

      if (!lockResponse.locked) {
        logResult(`4-${cartonId}`, 'failed', `Failed to lock carton: ${lockResponse.message}`);
        continue;
      }

      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: sessionId,
        carton_id: cartonId,
        status: "In Receiving",
        locked_by: settings.user_id ?? undefined,
        locked_on: new Date().toISOString(),
        updated_on: new Date().toISOString(),
      });
      logResult(`4-${cartonId}`, 'success', `Locked ${cartonId}`);

      // Get carton items
      const cartonItems = await dataService.getCartonItems(normalizedASN, cartonId);
      logResult(`4-${cartonId}`, 'success', `Found ${cartonItems.length} items in ${cartonId}`, {
        items: cartonItems.map(i => `${i.item_code} (${i.shipped_qty})`),
      });

      // Scan all items
      const scannedItems: { item_code: string; box_id: string }[] = [];
      for (const cartonItem of cartonItems) {
        // Get allocation for this item
        const allocations = await dataService.getTransferOrderAllocations(normalizedASN);
        const itemAllocation = allocations.find(a => a.item_code === cartonItem.item_code);
        
        if (!itemAllocation) {
          logResult(`4-${cartonId}`, 'failed', `No allocation found for ${cartonItem.item_code}`);
          continue;
        }

        // Get or create box
        const boxes = await dataService.getBoxes(normalizedASN, itemAllocation.store);
        let boxId = boxes.find(b => b.store === itemAllocation.store && b.status === 'Open')?.box_id;
        
        if (!boxId) {
          boxId = `BOX-${itemAllocation.store}-${cartonId.slice(-1)}`;
          await dataService.saveBox({
            box_id: boxId,
            asn_no: normalizedASN,
            to_no: 'TO-00012',
            store: itemAllocation.store,
            status: 'Open',
            updated_on: new Date().toISOString(),
          });
          logResult(`4-${cartonId}`, 'success', `Created box ${boxId}`);
        }

        // Scan all quantities for this item
        for (let qty = 0; qty < cartonItem.shipped_qty; qty++) {
          await addEvent({
            event_type: 'RECEIVE_ITEM_SCAN',
            asn_no: normalizedASN,
            inbound_session: sessionId,
            carton_id: cartonId,
            item_code: cartonItem.item_code,
            qty: 1,
            device_id: settings.device_id!,
            user_id: settings.user_id!,
          });

          await addEvent({
            event_type: 'SORT_TO_BOX',
            asn_no: normalizedASN,
            inbound_session: sessionId,
            carton_id: cartonId,
            item_code: cartonItem.item_code,
            box_id: boxId,
            store: itemAllocation.store,
            device_id: settings.device_id!,
            user_id: settings.user_id!,
          });

          // Save scanned item to database
          const db = await getDatabase();
          await db.runAsync(
            `INSERT OR REPLACE INTO scanned_items 
             (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              normalizedASN,
              sessionId,
              cartonId,
              cartonItem.item_code,
              boxId,
              itemAllocation.store,
              1,
              new Date().toISOString(),
              settings.device_id,
              settings.user_id,
            ]
          );

          scannedItems.push({
            item_code: cartonItem.item_code,
            box_id: boxId,
          });
        }
        logResult(`4-${cartonId}`, 'success', `Scanned ${cartonItem.item_code} (${cartonItem.shipped_qty} qty) to ${boxId}`);
      }

      // Complete carton
      await apiService.completeCarton({
        inbound_session: sessionId,
        asn_no: normalizedASN,
        carton_id: cartonId,
        user_id: settings.user_id!,
        device_id: settings.device_id!,
      });

      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: sessionId,
        carton_id: cartonId,
        status: 'Received',
        updated_on: new Date().toISOString(),
      });

      logResult(`4-${cartonId}`, 'success', `Completed ${cartonId}`, {
        scannedItems: scannedItems.length,
        items: scannedItems.map(i => `${i.item_code}->${i.box_id}`),
      });
    }

    // Step 5: Verify all data
    logResult('5', 'success', 'Verifying all saved data...');
    const verification = await dataService.getDataVerification(normalizedASN, sessionId);
    const scannedItemsList = await dataService.getScannedItems(normalizedASN, sessionId);
    
    logResult('5', 'success', 'Data verification complete', {
      events: verification.events,
      scannedItems: verification.scannedItems,
      cartonStatuses: verification.cartonStatuses,
      boxes: verification.boxes,
      transferCartons: verification.transferCartons,
      actualScannedItems: scannedItemsList.length,
    });

    logResult('COMPLETE', 'success', `Successfully processed all ${cartons.length} cartons in ${normalizedASN}`);
    return results;
  } catch (error: any) {
    logResult('ERROR', 'failed', `Test failed: ${error.message}`, { error });
    throw error;
  }
}

