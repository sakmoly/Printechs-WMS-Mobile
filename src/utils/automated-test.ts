/**
 * Automated Test Utility
 * Simulates the complete workflow for testing purposes
 */

import { getDatabase } from '../database/database';
import { dataService } from '../services/data.service';
import { apiService } from '../services/api.service';
import { getSettings, saveSettings } from '../services/settings.service';
import { addEvent } from '../services/event-queue.service';
import { normalizeASN } from './asn';

interface TestProgress {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message?: string;
  data?: any;
}

export class AutomatedTest {
  private progress: TestProgress[] = [];
  private asnNo: string = 'ASN-00045';
  private sessionId: string | null = null;
  private cartons: string[] = [];
  private scannedItems: Array<{ item_code: string; box_id: string }> = [];

  async runCompleteScenario(): Promise<TestProgress[]> {
    this.progress = [];
    
    try {
      // Step 1: Start Inbound Session
      await this.logProgress('1', 'in_progress', 'Starting inbound session for ASN-00045...');
      await this.startInboundSession();
      await this.logProgress('1', 'completed', 'Inbound session started', { sessionId: this.sessionId });

      // Step 2: Unload all cartons
      await this.logProgress('2', 'in_progress', 'Unloading all cartons...');
      await this.unloadAllCartons();
      await this.logProgress('2', 'completed', `Unloaded ${this.cartons.length} cartons`, { cartons: this.cartons });

      // Step 3: Lock CTN-001 and scan one item + one box
      await this.logProgress('3', 'in_progress', 'Locking CTN-001 and scanning items...');
      await this.lockAndScanCTN001();
      await this.logProgress('3', 'completed', 'Scanned first item and box', { 
        scannedItems: this.scannedItems.length 
      });

      // Step 4: Simulate going back to home (save state)
      await this.logProgress('4', 'in_progress', 'Simulating return to home page...');
      await this.simulateReturnToHome();
      await this.logProgress('4', 'completed', 'State saved, ready to resume');

      // Step 5: Resume and complete scanning
      await this.logProgress('5', 'in_progress', 'Resuming work and completing scanning...');
      await this.resumeAndCompleteScanning();
      await this.logProgress('5', 'completed', 'All items scanned and carton completed');

      return this.progress;
    } catch (error: any) {
      await this.logProgress('ERROR', 'failed', `Test failed: ${error.message}`, { error });
      throw error;
    }
  }

  private async logProgress(step: string, status: TestProgress['status'], message: string, data?: any) {
    const progressItem: TestProgress = {
      step,
      status,
      message,
      data,
    };
    this.progress.push(progressItem);
    console.log(`🧪 [TEST ${step}] ${status.toUpperCase()}: ${message}`, data || '');
  }

  private async startInboundSession() {
    const settings = await getSettings();
    const normalizedASN = normalizeASN(this.asnNo);
    
    // Start inbound session
    const response = await apiService.startInbound({
      asn_no: normalizedASN,
      transfer_order: 'TO-00012',
      dock: 'DOCK-01',
      user_id: settings.user_id!,
      device_id: settings.device_id!,
    });

    this.sessionId = response.inbound_session;

    // Save active ASN and session to settings
    await saveSettings({
      active_asn: normalizedASN,
      active_session: this.sessionId,
    });

    // Get all cartons for this ASN
    this.cartons = await dataService.getASNCartons(normalizedASN);
    console.log(`📦 Found ${this.cartons.length} cartons: ${this.cartons.join(', ')}`);
  }

  private async unloadAllCartons() {
    if (!this.sessionId) throw new Error('Session not started');
    
    const settings = await getSettings();
    const normalizedASN = normalizeASN(this.asnNo);

    for (const cartonId of this.cartons) {
      // Create UNLOAD_SCAN event
      await addEvent({
        event_type: 'UNLOAD_SCAN',
        asn_no: normalizedASN,
        inbound_session: this.sessionId,
        carton_id: cartonId,
        device_id: settings.device_id!,
        user_id: settings.user_id!,
      });

      // Update carton status to Unloaded
      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: this.sessionId,
        carton_id: cartonId,
        status: 'Unloaded',
        updated_on: new Date().toISOString(),
      });

      console.log(`✅ Unloaded: ${cartonId}`);
    }
  }

  private async lockAndScanCTN001() {
    if (!this.sessionId) throw new Error('Session not started');
    
    const settings = await getSettings();
    const normalizedASN = normalizeASN(this.asnNo);
    const cartonId = 'CTN-001';

    // Lock the carton
    const lockResponse = await apiService.lockCarton({
      inbound_session: this.sessionId,
      asn_no: normalizedASN,
      carton_id: cartonId,
      user_id: settings.user_id!,
      device_id: settings.device_id!,
    });

    if (!lockResponse.locked) {
      throw new Error(`Failed to lock carton: ${lockResponse.message}`);
    }

    // Update carton status to InReceiving
    await dataService.updateCartonStatus({
      asn_no: normalizedASN,
      inbound_session: this.sessionId,
      carton_id: cartonId,
      status: 'InReceiving',
      locked_by: settings.user_id,
      locked_on: new Date().toISOString(),
      updated_on: new Date().toISOString(),
    });

    console.log(`✅ Locked: ${cartonId}`);

    // Get carton items
    const cartonItems = await dataService.getCartonItems(normalizedASN, cartonId);
    if (cartonItems.length === 0) {
      throw new Error(`No items found for carton ${cartonId}`);
    }

    // Scan first item
    const firstItem = cartonItems[0];
    console.log(`📦 Scanning item: ${firstItem.item_code}`);

    // Get available boxes for the item's store
    const allocations = await dataService.getTransferOrderAllocations(normalizedASN);
    const itemAllocation = allocations.find(a => a.item_code === firstItem.item_code);
    
    if (!itemAllocation) {
      throw new Error(`No allocation found for item ${firstItem.item_code}`);
    }

    // Get or create a box for the store
    const boxes = await dataService.getBoxes(normalizedASN, itemAllocation.store);
    let boxId = boxes.find(b => b.store === itemAllocation.store && b.status === 'Open')?.box_id;
    
    if (!boxId) {
      // Create a new box
      boxId = `BOX-${itemAllocation.store}-001`;
      await dataService.saveBox({
        box_id: boxId,
        asn_no: normalizedASN,
        to_no: 'TO-00012',
        store: itemAllocation.store,
        status: 'Open',
        updated_on: new Date().toISOString(),
      });
      console.log(`📦 Created box: ${boxId}`);
    }

    // Create RECEIVE_ITEM_SCAN event
    await addEvent({
      event_type: 'RECEIVE_ITEM_SCAN',
      asn_no: normalizedASN,
      inbound_session: this.sessionId,
      carton_id: cartonId,
      item_code: firstItem.item_code,
      device_id: settings.device_id!,
      user_id: settings.user_id!,
    });

    // Create SORT_TO_BOX event
    await addEvent({
      event_type: 'SORT_TO_BOX',
      asn_no: normalizedASN,
      inbound_session: this.sessionId,
      carton_id: cartonId,
      item_code: firstItem.item_code,
      box_id: boxId,
      store: itemAllocation.store,
      device_id: settings.device_id!,
      user_id: settings.user_id!,
    });

    // Save scanned item
    this.scannedItems.push({
      item_code: firstItem.item_code,
      box_id: boxId,
    });

    console.log(`✅ Scanned item ${firstItem.item_code} to box ${boxId}`);

    // Save workflow state
    const { saveWorkflowState } = await import('../services/workflow-state.service');
    await saveWorkflowState({
      asn_no: normalizedASN,
      inbound_session: this.sessionId,
      screen_name: 'ReceiveSort',
      workflow_state: 'SCAN_ITEM',
      locked_carton: cartonId,
      current_item: null,
      scanned_items: this.scannedItems,
      scanned_quantities: {
        [firstItem.item_code]: 1,
      },
    });

    console.log(`✅ Saved workflow state with ${this.scannedItems.length} scanned items`);
  }

  private async simulateReturnToHome() {
    // This simulates the user going back to home
    // The state is already saved in the previous step
    // In a real scenario, the app would unmount the ReceiveSort screen
    console.log('🏠 Simulating return to home page...');
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to simulate navigation
  }

  private async resumeAndCompleteScanning() {
    if (!this.sessionId) throw new Error('Session not started');
    
    const settings = await getSettings();
    const normalizedASN = normalizeASN(this.asnNo);
    const cartonId = 'CTN-001';

    // Load saved workflow state
    const { loadWorkflowState } = await import('../services/workflow-state.service');
    const savedState = await loadWorkflowState(normalizedASN, this.sessionId, 'ReceiveSort');
    
    if (savedState && savedState.locked_carton === cartonId) {
      console.log(`📂 Resumed workflow state with ${savedState.scanned_items?.length || 0} scanned items`);
      this.scannedItems = savedState.scanned_items || [];
    }

    // Get all carton items
    const cartonItems = await dataService.getCartonItems(normalizedASN, cartonId);
    console.log(`📦 Carton ${cartonId} has ${cartonItems.length} items`);

    // Get scanned quantities
    const scannedQuantities: Record<string, number> = {};
    this.scannedItems.forEach(item => {
      scannedQuantities[item.item_code] = (scannedQuantities[item.item_code] || 0) + 1;
    });

    // Scan remaining items
    for (const cartonItem of cartonItems) {
      const alreadyScanned = scannedQuantities[cartonItem.item_code] || 0;
      const remaining = cartonItem.shipped_qty - alreadyScanned;

      if (remaining <= 0) {
        console.log(`⏭️ Skipping ${cartonItem.item_code} - already scanned ${alreadyScanned}/${cartonItem.shipped_qty}`);
        continue;
      }

      console.log(`📦 Scanning ${cartonItem.item_code}: ${alreadyScanned}/${cartonItem.shipped_qty} already scanned, ${remaining} remaining`);

      // Get allocation for this item
      const allocations = await dataService.getTransferOrderAllocations(normalizedASN);
      const itemAllocation = allocations.find(a => a.item_code === cartonItem.item_code);
      
      if (!itemAllocation) {
        console.warn(`⚠️ No allocation found for ${cartonItem.item_code}, skipping`);
        continue;
      }

      // Get or create box for the store
      const boxes = await dataService.getBoxes(normalizedASN, itemAllocation.store);
      let boxId = boxes.find(b => b.store === itemAllocation.store && b.status === 'Open')?.box_id;
      
      if (!boxId) {
        boxId = `BOX-${itemAllocation.store}-001`;
        await dataService.saveBox({
          box_id: boxId,
          asn_no: normalizedASN,
          to_no: 'TO-00012',
          store: itemAllocation.store,
          status: 'Open',
          updated_on: new Date().toISOString(),
        });
        console.log(`📦 Created box: ${boxId}`);
      }

      // Scan remaining quantity
      for (let i = 0; i < remaining; i++) {
        // Create RECEIVE_ITEM_SCAN event
        await addEvent({
          event_type: 'RECEIVE_ITEM_SCAN',
          asn_no: normalizedASN,
          inbound_session: this.sessionId,
          carton_id: cartonId,
          item_code: cartonItem.item_code,
          device_id: settings.device_id!,
          user_id: settings.user_id!,
        });

        // Create SORT_TO_BOX event
        await addEvent({
          event_type: 'SORT_TO_BOX',
          asn_no: normalizedASN,
          inbound_session: this.sessionId,
          carton_id: cartonId,
          item_code: cartonItem.item_code,
          box_id: boxId,
          store: itemAllocation.store,
          device_id: settings.device_id!,
          user_id: settings.user_id!,
        });

        this.scannedItems.push({
          item_code: cartonItem.item_code,
          box_id: boxId,
        });

        scannedQuantities[cartonItem.item_code] = (scannedQuantities[cartonItem.item_code] || 0) + 1;
        console.log(`  ✅ Scanned ${cartonItem.item_code} (${i + 1}/${remaining}) to ${boxId}`);
      }
    }

    // Update workflow state with all scanned items
    const finalScannedQuantities: Record<string, number> = {};
    this.scannedItems.forEach(item => {
      finalScannedQuantities[item.item_code] = (finalScannedQuantities[item.item_code] || 0) + 1;
    });

    await (await import('../services/workflow-state.service')).saveWorkflowState({
      asn_no: normalizedASN,
      inbound_session: this.sessionId,
      screen_name: 'ReceiveSort',
      workflow_state: 'SCAN_ITEM',
      locked_carton: cartonId,
      current_item: null,
      scanned_items: this.scannedItems,
      scanned_quantities: finalScannedQuantities,
    });

    // Mark carton as Received
    await dataService.updateCartonStatus({
      asn_no: normalizedASN,
      inbound_session: this.sessionId,
      carton_id: cartonId,
      status: 'Received',
      updated_on: new Date().toISOString(),
    });

    console.log(`✅ Completed scanning carton ${cartonId}`);
    console.log(`📊 Total scanned items: ${this.scannedItems.length}`);
    console.log(`📊 Scanned quantities:`, finalScannedQuantities);
  }

  getProgress(): TestProgress[] {
    return this.progress;
  }
}

/**
 * Run the automated test scenario
 */
export async function runAutomatedTest(): Promise<TestProgress[]> {
  const test = new AutomatedTest();
  return await test.runCompleteScenario();
}

