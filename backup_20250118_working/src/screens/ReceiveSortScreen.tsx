import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { StatusBadge } from '../components/StatusBadge';
import { addEvent } from '../services/event-queue.service';
import { dataService } from '../services/data.service';
import { apiService } from '../services/api.service';
import { getSettings } from '../services/settings.service';
import { resolveItemFromBarcode } from '../services/item-master.service';
import { normalizeASN } from '../utils/asn';

type WorkflowState = 'SELECT_CARTON' | 'SCAN_ITEM' | 'SCAN_BOX';

export default function ReceiveSortScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { activeASN, activeSession } = useApp();
  const [workflowState, setWorkflowState] = useState<WorkflowState>('SELECT_CARTON');
  const [lockedCarton, setLockedCarton] = useState<string | null>(null);
  const [cartonItems, setCartonItems] = useState<any[]>([]);
  const [scannedItems, setScannedItems] = useState<any[]>([]);
  const [scannedQuantities, setScannedQuantities] = useState<Record<string, number>>({});
  const [currentItem, setCurrentItem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-lock carton if passed from Unload screen
  useEffect(() => {
    const params = route.params as { cartonId?: string } | undefined;
    if (params?.cartonId && activeASN && activeSession && !lockedCarton && workflowState === 'SELECT_CARTON') {
      // Small delay to ensure database is updated
      const timer = setTimeout(() => {
        // Automatically trigger carton lock
        const autoLockCarton = async () => {
          const cartonId = params.cartonId!.trim().toUpperCase();
          const normalizedASN = normalizeASN(activeASN);
          setLoading(true);

          try {
            // Check if carton is unloaded (normalize ASN for lookup)
            // Try multiple times with slight delay in case of race condition
            let status = await dataService.getCartonStatus(normalizedASN, activeSession, cartonId);
            
            // If not found, wait a bit and try again (for race conditions)
            if (!status) {
              await new Promise(resolve => setTimeout(resolve, 200));
              status = await dataService.getCartonStatus(normalizedASN, activeSession, cartonId);
            }
            
            // Debug logging (removed for cleaner console)
            // console.log('Auto-lock check:', {
            //   cartonId,
            //   normalizedASN,
            //   activeSession,
            //   status: status ? status.status : 'null',
            // });
            
            if (!status) {
              Alert.alert(
                'Error',
                `Carton ${cartonId} status not found. Please ensure the carton has been unloaded first.\n\nASN: ${normalizedASN}\nSession: ${activeSession}`
              );
              setLoading(false);
              return;
            }
            
            if (status.status.toLowerCase() !== 'unloaded') {
              Alert.alert(
                'Error',
                `Carton ${cartonId} is not unloaded. Current status: ${status.status}`
              );
              setLoading(false);
              return;
            }

          // Lock carton
          const settings = await getSettings();
          const lockResponse = await apiService.lockCarton({
            inbound_session: activeSession,
            asn_no: normalizedASN,
            carton_id: cartonId,
            user_id: settings.user_id!,
            device_id: settings.device_id!,
          });

          if (!lockResponse.locked) {
            Alert.alert('Error', lockResponse.message || 'Failed to lock carton');
            setLoading(false);
            return;
          }

          // Update local status
          await dataService.updateCartonStatus({
            asn_no: normalizedASN,
            inbound_session: activeSession,
            carton_id: cartonId,
            status: 'InReceiving',
            locked_by: settings.user_id,
            locked_on: new Date().toISOString(),
            updated_on: new Date().toISOString(),
          });

          setLockedCarton(cartonId);
          setWorkflowState('SCAN_ITEM');
          setScannedItems([]);
          setScannedQuantities({});
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to lock carton');
          } finally {
            setLoading(false);
          }
        };
        autoLockCarton();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [route.params, activeASN, activeSession, lockedCarton, workflowState]);

  useEffect(() => {
    if (lockedCarton && activeASN) {
      loadCartonItems();
    }
  }, [lockedCarton, activeASN]);

  const loadCartonItems = async () => {
    if (!activeASN || !lockedCarton) return;
    const items = await dataService.getCartonItems(activeASN, lockedCarton);
    setCartonItems(items);
  };

  const handleCartonScan = async (barcode: string) => {
    if (!activeASN || !activeSession) {
      Alert.alert('Error', 'No active inbound session');
      return;
    }

    const cartonId = barcode.trim().toUpperCase();
    const normalizedASN = normalizeASN(activeASN);
    setLoading(true);

    try {
      // Check if carton is unloaded (normalize ASN for lookup)
      const status = await dataService.getCartonStatus(normalizedASN, activeSession, cartonId);
      if (!status || status.status.toLowerCase() !== 'unloaded') {
        Alert.alert('Error', 'Carton must be unloaded first');
        setLoading(false);
        return;
      }

      // Lock carton
      const settings = await getSettings();
      const lockResponse = await apiService.lockCarton({
        inbound_session: activeSession,
        asn_no: normalizedASN,
        carton_id: cartonId,
        user_id: settings.user_id!,
        device_id: settings.device_id!,
      });

      if (!lockResponse.locked) {
        Alert.alert('Error', lockResponse.message || 'Failed to lock carton');
        setLoading(false);
        return;
      }

      // Update local status
      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        status: 'InReceiving',
        locked_by: settings.user_id,
        locked_on: new Date().toISOString(),
        updated_on: new Date().toISOString(),
      });

      setLockedCarton(cartonId);
      setWorkflowState('SCAN_ITEM');
      setScannedItems([]);
      setScannedQuantities({});
      Alert.alert('Success', `Carton ${cartonId} locked`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to lock carton');
    } finally {
      setLoading(false);
    }
  };

  const handleItemScan = async (barcode: string) => {
    if (!activeASN || !activeSession || !lockedCarton) return;

    // Resolve item_code from barcode or item code
    const item = await resolveItemFromBarcode(barcode);
    if (!item) {
      Alert.alert(
        'Item Not Found',
        `Item not found for: ${barcode}\n\nPlease scan the item barcode or item code.`
      );
      return;
    }

    // Check if item is expected in this carton
    const expectedItem = cartonItems.find(ci => ci.item_code === item.item_code);
    if (!expectedItem) {
      Alert.alert('Error', `Item ${item.item_code} is not expected in this carton`);
      return;
    }

    // Check remaining quantity
    const scannedQty = scannedQuantities[item.item_code] || 0;
    const remainingQty = expectedItem.shipped_qty - scannedQty;
    
    if (remainingQty <= 0) {
      Alert.alert(
        'Quantity Exceeded',
        `All ${expectedItem.shipped_qty} units of ${item.item_code} have already been scanned.`
      );
      return;
    }

    setCurrentItem(item.item_code);
    setWorkflowState('SCAN_BOX');
  };

  const handleBoxScan = async (barcode: string) => {
    if (!activeASN || !activeSession || !lockedCarton || !currentItem) return;

    const boxId = barcode.trim().toUpperCase();
    setLoading(true);

    try {
      // Validate box exists and get store
      const boxes = await dataService.getBoxes(activeASN);
      const box = boxes.find(b => b.box_id === boxId);
      if (!box) {
        Alert.alert('Error', 'BOX not found: ' + boxId);
        setLoading(false);
        return;
      }

      // Validate allocation (soft validation)
      const allocations = await dataService.getTransferOrderAllocations(activeASN, box.store);
      const allocation = allocations.find(a => a.item_code === currentItem);
      if (!allocation || allocation.allocated_qty <= 0) {
        Alert.alert('Warning', `No allocation for ${currentItem} to ${box.store}`);
      }

      const settings = await getSettings();

      // Create RECEIVE_ITEM_SCAN event
      await addEvent({
        event_type: 'RECEIVE_ITEM_SCAN',
        asn_no: activeASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        item_code: currentItem,
        qty: 1,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Create SORT_TO_BOX event
      await addEvent({
        event_type: 'SORT_TO_BOX',
        asn_no: activeASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        item_code: currentItem,
        box_id: boxId,
        store: box.store,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Update scanned items list and quantities
      setScannedItems([...scannedItems, { item_code: currentItem, box_id: boxId }]);
      
      // Increment scanned quantity for this item
      const currentScannedQty = scannedQuantities[currentItem] || 0;
      setScannedQuantities({
        ...scannedQuantities,
        [currentItem]: currentScannedQty + 1,
      });
      
      setCurrentItem(null);
      setWorkflowState('SCAN_ITEM');
      Alert.alert('Success', `Item ${currentItem} sorted to ${boxId}`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to sort item');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishCarton = async () => {
    if (!activeASN || !activeSession || !lockedCarton) return;

    setLoading(true);
    try {
      const settings = await getSettings();
      await apiService.completeCarton({
        inbound_session: activeSession,
        asn_no: activeASN,
        carton_id: lockedCarton,
        user_id: settings.user_id!,
        device_id: settings.device_id!,
      });

      await dataService.updateCartonStatus({
        asn_no: activeASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        status: 'Received',
        updated_on: new Date().toISOString(),
      });

      Alert.alert('Success', `Carton ${lockedCarton} completed`, [
        {
          text: 'OK',
          onPress: () => {
            setLockedCarton(null);
            setWorkflowState('SELECT_CARTON');
            setScannedItems([]);
            setScannedQuantities({});
            setCurrentItem(null);
          },
        },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete carton');
    } finally {
      setLoading(false);
    }
  };

  const getScannerTitle = () => {
    switch (workflowState) {
      case 'SELECT_CARTON':
        return 'Scan Supplier Carton';
      case 'SCAN_ITEM':
        return 'Scan Item from Carton';
      case 'SCAN_BOX':
        return 'Scan Destination BOX';
      default:
        return 'Scan';
    }
  };

  const getScannerPlaceholder = () => {
    switch (workflowState) {
      case 'SELECT_CARTON':
        return 'Scan carton barcode';
      case 'SCAN_ITEM':
        return 'Scan item barcode';
      case 'SCAN_BOX':
        return 'Scan BOX barcode';
      default:
        return 'Scan barcode';
    }
  };

  const handleScan = (barcode: string) => {
    switch (workflowState) {
      case 'SELECT_CARTON':
        handleCartonScan(barcode);
        break;
      case 'SCAN_ITEM':
        handleItemScan(barcode);
        break;
      case 'SCAN_BOX':
        handleBoxScan(barcode);
        break;
    }
  };

  if (!activeASN || !activeSession) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No active inbound session</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.stateIndicator}>
          <Text style={styles.stateText}>
            {workflowState === 'SELECT_CARTON' && 'Step 1: Select Carton'}
            {workflowState === 'SCAN_ITEM' && 'Step 2: Scan Items'}
            {workflowState === 'SCAN_BOX' && 'Step 3: Scan Destination BOX'}
          </Text>
          {lockedCarton && (
            <View style={styles.cartonBadge}>
              <Text style={styles.cartonText}>Carton: {lockedCarton}</Text>
            </View>
          )}
        </View>

        <BarcodeScanner
          onScan={handleScan}
          placeholder={getScannerPlaceholder()}
          title={getScannerTitle()}
        />

        {lockedCarton && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Expected Items</Text>
              <FlatList
                data={cartonItems}
                keyExtractor={(item) => `${item.item_code}-${item.carton_id}`}
                renderItem={({ item }) => {
                  const scannedQty = scannedQuantities[item.item_code] || 0;
                  const remainingQty = item.shipped_qty - scannedQty;
                  const isComplete = remainingQty <= 0;
                  
                  return (
                    <View style={[styles.itemRow, isComplete && styles.itemRowComplete]}>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemCode}>{item.item_code}</Text>
                        <View style={styles.qtyContainer}>
                          <View style={styles.qtyRow}>
                            <Text style={styles.qtyLabel}>ASN Qty:</Text>
                            <Text style={styles.qtyValue}> {item.shipped_qty}</Text>
                          </View>
                          <View style={styles.qtyRow}>
                            <Text style={styles.qtyLabel}>Scanned:</Text>
                            <Text style={[styles.qtyValue, scannedQty > 0 && styles.qtyValueScanned]}>
                              {' '}{scannedQty}
                            </Text>
                          </View>
                          <View style={styles.qtyRow}>
                            <Text style={styles.qtyLabel}>Remaining:</Text>
                            <Text style={[
                              styles.qtyValue,
                              remainingQty === 0 && styles.qtyValueComplete,
                              remainingQty > 0 && remainingQty <= item.shipped_qty * 0.2 && styles.qtyValueLow
                            ]}>
                              {' '}{remainingQty}
                            </Text>
                          </View>
                        </View>
                      </View>
                      {isComplete && (
                        <View style={styles.completeBadge}>
                          <Text style={styles.completeText}>✓</Text>
                        </View>
                      )}
                    </View>
                  );
                }}
                scrollEnabled={false}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scanned Items</Text>
              {scannedItems.length === 0 ? (
                <Text style={styles.emptyText}>No items scanned yet</Text>
              ) : (
                <FlatList
                  data={scannedItems}
                  keyExtractor={(item, index) => `${item.item_code}-${index}`}
                  renderItem={({ item }) => (
                    <View style={styles.scannedItemRow}>
                      <Text style={styles.itemCode}>{item.item_code}</Text>
                      <Text style={styles.boxId}>→ {item.box_id}</Text>
                    </View>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleFinishCarton}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Completing...' : 'Finish Carton'}
              </Text>
            </TouchableOpacity>
          </>
        )}
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
  stateIndicator: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  stateText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cartonBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 8,
    borderRadius: 4,
  },
  cartonText: {
    color: '#fff',
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  itemRowComplete: {
    backgroundColor: '#E8F5E9',
    opacity: 0.7,
  },
  itemInfo: {
    flex: 1,
  },
  itemCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  qtyContainer: {
    flexDirection: 'row',
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  qtyLabel: {
    fontSize: 12,
    color: '#666',
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  qtyValueScanned: {
    color: '#2196F3',
  },
  qtyValueComplete: {
    color: '#4CAF50',
  },
  qtyValueLow: {
    color: '#FF9800',
  },
  completeBadge: {
    backgroundColor: '#4CAF50',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  completeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scannedItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#E8F5E9',
  },
  boxId: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
    padding: 12,
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F44336',
    textAlign: 'center',
    marginTop: 100,
  },
});

