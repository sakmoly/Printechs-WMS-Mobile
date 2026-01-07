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
import { addEvent, resyncTransferCartonEvents, getEventsForTransferCarton } from '../services/event-queue.service';
import { getSettings } from '../services/settings.service';

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
    const tcList = await dataService.getTransferCartons(activeASN);
    // Filter to only Sealed TCs and remove duplicates by tc_id
    const sealedTCs = tcList.filter(tc => tc.status === 'Sealed');
    // Remove duplicates by creating a Map with tc_id as key
    const uniqueTCs = Array.from(
      new Map(sealedTCs.map(tc => [tc.tc_id, tc])).values()
    );
    setTransferCartons(uniqueTCs);
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

    // Check if TC is already dispatched
    if (tc.status === 'Dispatched') {
      Alert.alert(
        'Already Dispatched',
        `Transfer Carton ${tcId} has already been dispatched.\n\nStatus: ${tc.status}\n\nYou cannot dispatch the same Transfer Carton again.`
      );
      await loadTransferCartons(); // Refresh the list
      return;
    }

    // Check if TC is sealed (required for dispatch)
    if (tc.status !== 'Sealed') {
      Alert.alert(
        'Not Sealed',
        `Transfer Carton ${tcId} is not sealed.\n\nCurrent status: ${tc.status}\n\nOnly sealed Transfer Cartons can be dispatched.`
      );
      await loadTransferCartons(); // Refresh the list
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
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

      await dataService.updateTransferCartonStatus(tcId, 'Dispatched');
      await loadTransferCartons();
      if (showSuccessAlert) {
        Alert.alert('Success', `Transfer Carton ${tcId} dispatched`);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to dispatch Transfer Carton');
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
  const handleTCTap = (tcId: string) => {
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
      const backendItemCount = backendContents?.data?.contents?.length || backendContents?.contents?.length || 0;
      
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
                  style={styles.tcItem}
                  onPress={() => handleTCTap(item.tc_id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.tcHeader}>
                    <Text style={styles.tcId}>{item.tc_id}</Text>
                    <StatusBadge status={item.status} />
                  </View>
                  <Text style={styles.tcStore}>Store: {item.store}</Text>
                  <Text style={styles.tcDate}>
                    Updated: {new Date(item.updated_on).toLocaleString()}
                  </Text>
                  <Text style={styles.tapHint}>Double tap to dispatch</Text>
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
  tcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tcId: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
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
  tapHint: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 8,
    fontStyle: 'italic',
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

