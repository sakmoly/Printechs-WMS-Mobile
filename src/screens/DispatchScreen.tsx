import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { StatusBadge } from '../components/StatusBadge';
import { ProgressIndicator } from '../components/ProgressIndicator';
import { dataService } from '../services/data.service';
import { apiService } from '../services/api.service';
import { addEvent, resyncTransferCartonEvents, getEventsForTransferCarton, syncEvents } from '../services/event-queue.service';
import { getSettings } from '../services/settings.service';

function tcStatusUpper(s: string | undefined | null): string {
  return String(s ?? '')
    .trim()
    .toUpperCase();
}

function isTcSealed(status: string | undefined | null): boolean {
  return tcStatusUpper(status) === 'SEALED';
}

function isTcDispatched(status: string | undefined | null): boolean {
  return tcStatusUpper(status) === 'DISPATCHED';
}

/** Backend 400: already dispatched — align local cache instead of showing raw API error */
function errorIndicatesAlreadyDispatched(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('current status') && m.includes('dispatched')) return true;
  if (m.includes('already dispatched')) return true;
  if (m.includes('must be sealed') && m.includes('dispatched')) return true;
  try {
    const jsonStart = message.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(message.slice(jsonStart)) as {
        message?: string;
        code?: string;
      };
      const inner = String(parsed?.message || '').toLowerCase();
      if (inner.includes('dispatched') && inner.includes('sealed')) return true;
      if (inner.includes('current status') && inner.includes('dispatched'))
        return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function extractRemoteTcStatus(remote: unknown): string | null {
  if (remote == null) return null;
  const r = remote as Record<string, unknown>;
  const body = (r.data as Record<string, unknown> | undefined) ?? r;
  const nested =
    (body.transfer_carton as Record<string, unknown> | undefined) ?? body;
  const s =
    (nested.status as string) ??
    (nested.tc_status as string) ??
    (body.status as string);
  return s != null ? String(s) : null;
}

function normalizeDocValue(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text || text === '-' || text.toLowerCase() === 'null') return '';
  return text;
}

function normalizeDocKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase();
}

function findFirstDocValue(
  input: unknown,
  keys: string[],
  depth = 0
): string {
  if (input == null || depth > 5) return '';
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findFirstDocValue(item, keys, depth + 1);
      if (value) return value;
    }
    return '';
  }
  if (typeof input !== 'object') return '';

  const wanted = new Set(keys.map(normalizeDocKey));
  const obj = input as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    if (wanted.has(normalizeDocKey(key))) {
      const normalized = normalizeDocValue(value);
      if (normalized) return normalized;
    }
  }

  for (const value of Object.values(obj)) {
    const nested = findFirstDocValue(value, keys, depth + 1);
    if (nested) return nested;
  }

  return '';
}

function findFirstStringMatching(
  input: unknown,
  pattern: RegExp,
  depth = 0
): string {
  if (input == null || depth > 6) return '';
  if (typeof input === 'string' || typeof input === 'number') {
    const text = normalizeDocValue(input);
    if (text && pattern.test(text)) return text;
    return '';
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findFirstStringMatching(item, pattern, depth + 1);
      if (value) return value;
    }
    return '';
  }
  if (typeof input !== 'object') return '';

  for (const value of Object.values(input as Record<string, unknown>)) {
    const nested = findFirstStringMatching(value, pattern, depth + 1);
    if (nested) return nested;
  }

  return '';
}

function extractRemoteTcDocs(remote: unknown): {
  purchaseReceipt: string;
  stockEntry: string;
  dispatchReady: boolean;
} {
  if (remote == null) {
    return { purchaseReceipt: '', stockEntry: '', dispatchReady: false };
  }

  const purchaseReceipt =
    findFirstDocValue(remote, [
      'purchase_receipt',
      'purchaseReceipt',
      'purchase_receipt_no',
      'purchaseReceiptNo',
      'purchase_receipt_number',
      'purchaseReceiptNumber',
      'purchase_receipt_id',
      'purchase_receipt_name',
      'purchaseReceiptName',
      'purchase_receipt_doc',
      'purchaseReceiptDoc',
      'erp_purchase_receipt',
      'erpPurchaseReceipt',
      'pr',
    ]) ||
    findFirstStringMatching(remote, /\b(?:MAT-)?PRE-\d{4}-\d+\b/i);
  const stockEntry =
    findFirstDocValue(remote, [
      'stock_entry',
      'stockEntry',
      'stock_entry_no',
      'stockEntryNo',
      'stock_entry_number',
      'stockEntryNumber',
      'stock_entry_id',
      'stock_entry_name',
      'stockEntryName',
      'stock_entry_doc',
      'stockEntryDoc',
      'erp_stock_entry',
      'erpStockEntry',
      'se',
    ]) ||
    findFirstStringMatching(remote, /\b(?:MAT-)?STE-\d{4}-\d+\b/i);

  return {
    purchaseReceipt,
    stockEntry,
    dispatchReady: !!purchaseReceipt && !!stockEntry,
  };
}

function extractTransferCartonsList(response: unknown): any[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];
  const body = response as Record<string, any>;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.transfer_cartons)) return body.transfer_cartons;
  if (Array.isArray(body.transferCartons)) return body.transferCartons;
  if (Array.isArray(body.data?.transfer_cartons)) {
    return body.data.transfer_cartons;
  }
  if (Array.isArray(body.data?.items)) return body.data.items;
  return [];
}

export default function DispatchScreen() {
  const navigation = useNavigation();
  const { activeASN, activeSession } = useApp();
  const [transferCartons, setTransferCartons] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastTap, setLastTap] = useState<{ tcId: string; time: number } | null>(null);

  useEffect(() => {
    loadTransferCartons();
  }, [activeASN]);

  // Refresh when screen is focused to get latest data
  useFocusEffect(
    useCallback(() => {
      loadTransferCartons();
    }, [activeASN])
  );

  const loadTransferCartons = async () => {
    if (!activeASN) return;
    const localTCs = await dataService.getTransferCartons(activeASN);
    let backendTCs: any[] = [];

    try {
      const backendResponse = await apiService.getTransferCartons({
        asn: activeASN,
      });
      backendTCs = extractTransferCartonsList(backendResponse).filter(
        (tc) => tc?.tc_id
      );
      for (const tc of backendTCs) {
        await dataService.saveTransferCarton({
          tc_id: tc.tc_id,
          asn_no: tc.asn_no || tc.advance_shipping_notice || activeASN,
          to_no: tc.to_no || tc.transfer_order || null,
          store: tc.store || tc.showroom || '',
          status: tc.status === 'Created' ? 'Open' : tc.status || 'Open',
          updated_on: tc.updated_on || tc.updated_at || new Date().toISOString(),
        } as any);
      }
    } catch (error: any) {
      console.warn(
        'DispatchScreen: could not load backend Transfer Cartons:',
        error?.message
      );
    }

    const tcList = [...localTCs, ...backendTCs];
    // Filter to only Sealed TCs (case-insensitive) and remove duplicates by tc_id
    const sealedTCs = tcList.filter((tc) => isTcSealed(tc.status));
    // Remove duplicates by creating a Map with tc_id as key
    const uniqueTCs = Array.from(
      new Map(
        sealedTCs.map((tc) => [
          tc.tc_id,
          {
            ...tc,
            store: tc.store || tc.showroom || '',
            updated_on: tc.updated_on || tc.updated_at || new Date().toISOString(),
          },
        ])
      ).values()
    );
    const enrichedTCs = await Promise.all(
      uniqueTCs.map(async (tc) => {
        const listDocs = extractRemoteTcDocs(tc);
        try {
          const remote = await apiService.getTransferCarton(tc.tc_id);
          const remoteDocs = extractRemoteTcDocs(remote);
          const docs = {
            purchaseReceipt:
              remoteDocs.purchaseReceipt || listDocs.purchaseReceipt,
            stockEntry: remoteDocs.stockEntry || listDocs.stockEntry,
          };
          const dispatchReady = !!docs.purchaseReceipt && !!docs.stockEntry;
          return {
            ...tc,
            purchase_receipt: docs.purchaseReceipt,
            stock_entry: docs.stockEntry,
            dispatch_ready: dispatchReady,
            dispatch_block_reason: dispatchReady
              ? ''
              : 'Waiting for Purchase Receipt and Stock Entry from ERP',
          };
        } catch (error: any) {
          console.warn(
            `DispatchScreen: could not load ERP docs for ${tc.tc_id}:`,
            error?.message
          );
          const dispatchReady =
            !!listDocs.purchaseReceipt && !!listDocs.stockEntry;
          return {
            ...tc,
            purchase_receipt: listDocs.purchaseReceipt,
            stock_entry: listDocs.stockEntry,
            dispatch_ready: dispatchReady,
            dispatch_block_reason: dispatchReady
              ? ''
              : 'Cannot verify Purchase Receipt and Stock Entry from backend',
          };
        }
      })
    );
    setTransferCartons(enrichedTCs);
  };

  // Check if a store is a warehouse
  const isWarehouseStore = async (store: string): Promise<boolean> => {
    if (!store) return false;
    return await dataService.isWarehouse(store);
  };

  // Dispatch function (used by both scan and double-tap)
  const dispatchTC = async (tcId: string, showSuccessAlert: boolean = true) => {
    // First, check the actual status from database (not just from the filtered list)
    const allTCs = await dataService.getTransferCartons(activeASN);
    const tc = allTCs.find(t => t.tc_id === tcId);

    if (!tc) {
      Alert.alert('Error', `Transfer Carton ${tcId} not found for this ASN.`);
      return;
    }

    // Check if this is a warehouse TC - if so, skip dispatch and go directly to Putaway
    const isWarehouse = await isWarehouseStore(tc.store || '');
    if (isWarehouse) {
      // Warehouse TC - skip dispatch, go directly to Putaway
      Alert.alert(
        'Move to Putaway',
        `Transfer Carton ${tcId} is for warehouse (${tc.store}).\n\nMoving directly to Putaway list.`,
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate to Putaway screen
              navigation.navigate('PutAway' as never);
            },
          },
        ]
      );
      return;
    }

    // Check if TC is already dispatched (local cache — case-insensitive)
    if (isTcDispatched(tc.status)) {
      Alert.alert(
        'Already Dispatched',
        `Transfer Carton ${tcId} has already been dispatched.\n\nStatus: ${tc.status}\n\nYou cannot dispatch the same Transfer Carton again.`
      );
      await loadTransferCartons(); // Refresh the list
      return;
    }

    // Check if TC is sealed (required for dispatch)
    if (!isTcSealed(tc.status)) {
      Alert.alert(
        'Not Sealed',
        `Transfer Carton ${tcId} is not sealed.\n\nCurrent status: ${tc.status}\n\nOnly sealed Transfer Cartons can be dispatched.`
      );
      await loadTransferCartons(); // Refresh the list
      return;
    }

    // Server may have been updated from desktop/backend while mobile cache is stale
    try {
      const remote = await apiService.getTransferCarton(tcId);
      const remoteStatus = extractRemoteTcStatus(remote);
      let listDocs = { purchaseReceipt: '', stockEntry: '', dispatchReady: false };
      try {
        const backendList = await apiService.getTransferCartons({
          asn: activeASN || undefined,
        });
        const listRow = extractTransferCartonsList(backendList).find(
          (row) => row?.tc_id === tcId
        );
        listDocs = extractRemoteTcDocs(listRow);
      } catch {
        /* detail response remains the primary source */
      }
      const detailDocs = extractRemoteTcDocs(remote);
      const remoteDocs = {
        purchaseReceipt:
          detailDocs.purchaseReceipt || listDocs.purchaseReceipt,
        stockEntry: detailDocs.stockEntry || listDocs.stockEntry,
        dispatchReady:
          !!(detailDocs.purchaseReceipt || listDocs.purchaseReceipt) &&
          !!(detailDocs.stockEntry || listDocs.stockEntry),
      };
      if (isTcDispatched(remoteStatus)) {
        await dataService.updateTransferCartonStatus(tcId, 'Dispatched');
        await loadTransferCartons();
        if (showSuccessAlert) {
          Alert.alert(
            'Already Dispatched',
            `Transfer carton ${tcId} was already dispatched on the server.\n\nThe app list has been updated — no further action needed.`
          );
        }
        return;
      }
      if (!remoteDocs.dispatchReady) {
        Alert.alert(
          'Dispatch Not Ready',
          `Transfer Carton ${tcId} cannot be dispatched yet.\n\nPurchase Receipt: ${remoteDocs.purchaseReceipt || 'Not available'}\nStock Entry: ${remoteDocs.stockEntry || 'Not available'}\n\nPlease wait until ERP documents are created on the backend.`
        );
        await loadTransferCartons();
        return;
      }
    } catch (e: any) {
      console.warn(
        'DispatchScreen: could not refresh TC from server before dispatch:',
        e?.message
      );
      Alert.alert(
        'Dispatch Not Ready',
        `Cannot verify Purchase Receipt and Stock Entry for ${tcId} from backend.\n\nDispatch was not performed.`
      );
      await loadTransferCartons();
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();

      try {
        await syncEvents();
      } catch (syncError: any) {
        console.warn(
          'DispatchScreen: pending event sync failed before dispatch:',
          syncError?.message || syncError
        );
      }

      await apiService.dispatchTransferCarton({ 
        tc_id: tcId,
        dispatched_by: settings.user_id || settings.user_code || undefined,
      });
      
      // Create TC_DISPATCH event
      await addEvent({
        event_type: 'TC_DISPATCH',
        asn_no: activeASN,
        inbound_session: activeSession,
        tc_id: tcId,
        store: tc.store,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      try {
        await syncEvents();
      } catch (syncError: any) {
        console.warn(
          'DispatchScreen: dispatch event live sync failed:',
          syncError?.message || syncError
        );
      }

      await dataService.updateTransferCartonStatus(tcId, 'Dispatched');
      await loadTransferCartons();
      if (showSuccessAlert) {
        Alert.alert('Success', `Transfer Carton ${tcId} dispatched`);
      }
    } catch (error: any) {
      const msg = error?.message || 'Failed to dispatch Transfer Carton';
      if (errorIndicatesAlreadyDispatched(String(msg))) {
        try {
          await dataService.updateTransferCartonStatus(tcId, 'Dispatched');
        } catch (e: any) {
          console.warn('Failed to patch local TC status:', e?.message);
        }
        await loadTransferCartons();
        Alert.alert(
          'Already Dispatched',
          `Transfer carton ${tcId} is already dispatched on the server (for example from the backend).\n\nLocal status has been updated to match.`
        );
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle barcode scan - no warning, direct dispatch
  const handleTCScan = async (barcode: string) => {
    const tcId = barcode.trim().toUpperCase();
    await dispatchTC(tcId, true);
  };

  // Handle double-tap on TC item - check if warehouse, then dispatch or move to Putaway
  const handleTCDoubleTap = async (tcId: string) => {
    // Check if this is a warehouse TC
    const allTCs = await dataService.getTransferCartons(activeASN);
    const tc = allTCs.find(t => t.tc_id === tcId);
    
    if (tc) {
      const isWarehouse = await isWarehouseStore(tc.store || '');
      if (isWarehouse) {
        // Warehouse TC - move directly to Putaway (no dispatch needed)
        Alert.alert(
          'Move to Putaway',
          `Transfer Carton ${tcId} is for warehouse.\n\nMoving directly to Putaway list.`,
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigate to Putaway screen
                navigation.navigate('PutAway' as never);
              },
            },
          ]
        );
        return;
      }
    }

    // Regular store TC - show dispatch confirmation
    Alert.alert(
      'Confirm Dispatch',
      'Selected Transfer Carton Ready to Dispatch',
      [
        {
          text: 'No',
          style: 'cancel',
          onPress: () => {
            // Return - do nothing
          },
        },
        {
          text: 'Yes',
          onPress: () => {
            dispatchTC(tcId, true);
          },
        },
      ]
    );
  };

  // Handle single tap on TC item - detect double-tap
  const handleTCTap = (tc: any) => {
    const tcId = tc.tc_id;
    if (tc.dispatch_ready === false) {
      Alert.alert(
        'Dispatch Not Ready',
        `${tcId} cannot be dispatched yet.\n\nPurchase Receipt: ${
          tc.purchase_receipt || 'Not available'
        }\nStock Entry: ${
          tc.stock_entry || 'Not available'
        }\n\n${tc.dispatch_block_reason || 'Waiting for ERP documents.'}`
      );
      return;
    }

    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300; // 300ms window for double-tap

    if (lastTap && lastTap.tcId === tcId && now - lastTap.time < DOUBLE_TAP_DELAY) {
      // Double-tap detected
      setLastTap(null);
      handleTCDoubleTap(tcId);
    } else {
      // First tap - record it
      setLastTap({ tcId, time: now });
      // Clear after delay
      setTimeout(() => {
        setLastTap(null);
      }, DOUBLE_TAP_DELAY);
    }
  };

  // Resync events for a specific transfer carton
  const handleResyncEvents = async (tcId: string) => {
    setLoading(true);
    try {
      // Check if there are any PACK_BOX_TO_TC events for this TC
      const events = await getEventsForTransferCarton(tcId);
      
      // Also check backend to see what it currently has
      let backendContents: any = null;
      try {
        backendContents = await apiService.getTransferCarton(tcId);
        console.log(`📦 Backend TC contents:`, backendContents);
        const contentsCount = backendContents?.data?.contents?.length || backendContents?.contents?.length || 0;
        console.log(`📊 Backend has ${contentsCount} item(s) in Transfer Carton ${tcId}`);
      } catch (error: any) {
        console.log(`ℹ️ Could not fetch backend TC contents:`, error.message);
      }

      const backendItemCount =
        backendContents?.data?.contents?.length ||
        backendContents?.contents?.length ||
        0;
      
      if (events.length === 0) {
        // No local events found - check if backend has contents
        const backendData = backendContents?.data || backendContents;
        const backendHasContents = backendData?.contents && backendData.contents.length > 0;
        
        if (backendHasContents) {
          Alert.alert(
            'No Local Events Found',
            `No PACK_BOX_TO_TC events found locally for Transfer Carton ${tcId}.\n\nHowever, the backend shows ${backendData.contents.length} item(s) in this Transfer Carton.\n\nThis means the events were synced and then removed from local storage, or the backend has the data from another source.\n\nIf you need to update the backend, you may need to recreate the events by packing boxes again.`,
            [
              {
                text: 'OK',
                style: 'cancel',
              },
              {
                text: 'Check Backend Details',
                onPress: () => {
                  const contentsSummary = backendData.contents
                    .map((c: any, idx: number) => `${idx + 1}. ${c.item_code || c.box_id || 'Unknown'}: ${c.quantity || c.qty || 0}`)
                    .join('\n');
                  Alert.alert(
                    'Backend Transfer Carton Contents',
                    `Transfer Carton: ${tcId}\n\nItems in Backend:\n${contentsSummary || 'None'}\n\nTotal Items: ${backendData.contents?.length || 0}`
                  );
                },
              },
            ]
          );
        } else {
          Alert.alert(
            'No Events Found',
            `No PACK_BOX_TO_TC events found for Transfer Carton ${tcId}.\n\nLocal Events: 0\nBackend Contents: ${backendItemCount} item(s)\n\nEvents are created when boxes are packed into this Transfer Carton in the Packing screen.\n\nTo populate this Transfer Carton:\n1. Go to Packing screen\n2. Select this Transfer Carton\n3. Pack boxes into it\n\nThis will create the necessary events.`
          );
        }
        return;
      }

      const syncedCount = events.filter(e => e.synced === 1).length;
      const unsyncedCount = events.filter(e => e.synced === 0).length;
      
      // Log detailed event information
      console.log(`📊 Event details for TC ${tcId}:`, {
        total_events: events.length,
        synced: syncedCount,
        unsynced: unsyncedCount,
        backend_items: backendItemCount,
        events: events.map(e => ({
          uuid: e.offline_uuid.substring(0, 8) + '...',
          synced: e.synced,
          box_id: e.box_id,
          tc_id: e.tc_id,
          event_time: e.event_time
        }))
      });

      Alert.alert(
        'Resync Transfer Carton Events',
        `Transfer Carton: ${tcId}\n\nLocal Events:\n- Total: ${events.length}\n- Synced: ${syncedCount}\n- Unsynced: ${unsyncedCount}\n\nBackend Contents: ${backendItemCount} item(s)\n\nThis will mark all PACK_BOX_TO_TC events as unsynced and resend them to the backend. This will update the Transfer Carton contents in the backend.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Resync',
            onPress: async () => {
              try {
                const result = await resyncTransferCartonEvents(tcId);
                Alert.alert(
                  'Resync Complete',
                  `Events resynced for ${tcId}:\n\nTotal: ${result.total}\nSynced: ${result.synced}\nFailed: ${result.failed}\n\nThe backend should now show the Transfer Carton contents.`
                );
                // Refresh the list
                await loadTransferCartons();
              } catch (error: any) {
                Alert.alert('Resync Error', error.message || 'Failed to resync events');
              }
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to check events');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator currentStep={6} totalSteps={6} stepName="Dispatch" />
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Scan Transfer Carton to Dispatch</Text>
        <BarcodeScanner
          onScan={handleTCScan}
          placeholder="Scan TC barcode"
          title="Transfer Carton Barcode"
        />

        <View style={styles.listSection}>
          <Text style={styles.sectionTitle}>Sealed Transfer Cartons</Text>
          {transferCartons.length === 0 ? (
            <Text style={styles.emptyText}>No sealed Transfer Cartons available</Text>
          ) : (
            <FlatList
              data={transferCartons}
              keyExtractor={(item) => item.tc_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.tcItem,
                    item.dispatch_ready === false && styles.tcItemDisabled,
                  ]}
                  onPress={() => handleTCTap(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.tcHeader}>
                    <Text style={styles.tcId}>{item.tc_id}</Text>
                    <View style={styles.tcStatusBadge}>
                      <StatusBadge status={item.status} />
                    </View>
                  </View>
                  <Text style={styles.tcStore}>Store: {item.store}</Text>
                  <Text style={styles.tcDate}>
                    Updated: {new Date(item.updated_on).toLocaleString()}
                  </Text>
                  <View style={styles.erpDocPanel}>
                    <Text
                      style={[
                        styles.erpDocText,
                        item.purchase_receipt
                          ? styles.erpDocReady
                          : styles.erpDocMissing,
                      ]}
                    >
                      PR: {item.purchase_receipt || 'Not available'}
                    </Text>
                    <Text
                      style={[
                        styles.erpDocText,
                        item.stock_entry
                          ? styles.erpDocReady
                          : styles.erpDocMissing,
                      ]}
                    >
                      Stock Entry: {item.stock_entry || 'Not available'}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.tapHint,
                      item.dispatch_ready === false && styles.tapHintDisabled,
                    ]}
                  >
                    {item.dispatch_ready === false
                      ? 'Dispatch disabled until ERP documents are available'
                      : 'Double tap to dispatch'}
                  </Text>
                  <TouchableOpacity
                    style={styles.resyncButton}
                    onPress={() => handleResyncEvents(item.tc_id)}
                    disabled={loading}
                  >
                    <Text style={styles.resyncButtonText}>
                      🔄 Resync Events to Backend
                    </Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
              scrollEnabled={false}
            />
          )}
        </View>

        <TouchableOpacity
          style={styles.completeButton}
          onPress={() => {
            Alert.alert(
              'Inbound Process Complete',
              'All steps have been completed. Returning to home screen.',
              [
                {
                  text: 'OK',
                  onPress: () => navigation.navigate('Home' as never),
                },
              ]
            );
          }}
        >
          <Text style={styles.completeButtonText}>Complete Inbound Process</Text>
          <Text style={styles.completeButtonSubtext}>Return to Home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  listSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  tcItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tcItemDisabled: {
    opacity: 0.65,
    backgroundColor: '#F5F5F5',
  },
  tcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  tcId: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    flexShrink: 1,
    paddingRight: 8,
  },
  tcStatusBadge: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  tcStore: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  tcDate: {
    fontSize: 12,
    color: '#999',
  },
  erpDocPanel: {
    backgroundColor: '#F7F9FC',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  erpDocText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 3,
  },
  erpDocReady: {
    color: '#2E7D32',
  },
  erpDocMissing: {
    color: '#D32F2F',
  },
  tapHint: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 8,
    fontStyle: 'italic',
  },
  tapHintDisabled: {
    color: '#F44336',
  },
  resyncButton: {
    backgroundColor: '#FF9800',
    padding: 10,
    borderRadius: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  resyncButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
  completeButton: {
    backgroundColor: '#4CAF50',
    padding: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  completeButtonSubtext: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    marginTop: 4,
  },
});

