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
import { useApp } from '../context/AppContext';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { StatusBadge } from '../components/StatusBadge';
import { dataService } from '../services/data.service';
import { apiService } from '../services/api.service';
import { addEvent } from '../services/event-queue.service';
import { getSettings } from '../services/settings.service';

export default function PackingScreen() {
  const { activeASN, activeSession } = useApp();
  const [selectedStore, setSelectedStore] = useState('SR-01');
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [packedBoxes, setPackedBoxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBoxes();
  }, [activeASN, selectedStore]);

  const loadBoxes = async () => {
    if (!activeASN) return;
    const boxList = await dataService.getBoxes(activeASN, selectedStore);
    setBoxes(boxList.filter(b => b.status === 'Closed'));
  };

  const handleCreateTC = async () => {
    if (!activeASN) {
      Alert.alert('Error', 'No active ASN');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.createTransferCarton({
        asn_no: activeASN,
        to_no: 'TO-00012',
        store: selectedStore,
      });

      const newTC: any = {
        tc_id: response.tc_id,
        asn_no: activeASN,
        to_no: 'TO-00012',
        store: selectedStore,
        status: 'Open',
        updated_on: new Date().toISOString(),
      };

      await dataService.saveTransferCarton(newTC);
      setTransferCarton(response.tc_id);
      setPackedBoxes([]);
      Alert.alert('Success', `Transfer Carton ${response.tc_id} created`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create Transfer Carton');
    } finally {
      setLoading(false);
    }
  };

  const handleBoxScan = async (barcode: string) => {
    if (!transferCarton) {
      Alert.alert('Error', 'Please create a Transfer Carton first');
      return;
    }

    const boxId = barcode.trim().toUpperCase();
    const box = boxes.find(b => b.box_id === boxId);
    
    if (!box) {
      Alert.alert('Error', 'BOX not found or not closed');
      return;
    }

    if (packedBoxes.includes(boxId)) {
      Alert.alert('Info', 'BOX already packed');
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();

      // Create PACK_BOX_TO_TC event
      await addEvent({
        event_type: 'PACK_BOX_TO_TC',
        asn_no: activeASN,
        inbound_session: activeSession,
        box_id: boxId,
        tc_id: transferCarton,
        store: box.store,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      setPackedBoxes([...packedBoxes, boxId]);
      Alert.alert('Success', `BOX ${boxId} packed to ${transferCarton}`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to pack BOX');
    } finally {
      setLoading(false);
    }
  };

  const handleSeal = async () => {
    if (!transferCarton) return;

    setLoading(true);
    try {
      await apiService.sealTransferCarton({ tc_id: transferCarton });
      await dataService.updateTransferCartonStatus(transferCarton, 'Sealed');
      Alert.alert('Success', `Transfer Carton ${transferCarton} sealed`, [
        {
          text: 'OK',
          onPress: () => {
            setTransferCarton(null);
            setPackedBoxes([]);
            loadBoxes();
          },
        },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to seal Transfer Carton');
    } finally {
      setLoading(false);
    }
  };

  const stores = ['SR-01', 'SR-02', 'SR-03'];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Store</Text>
          <View style={styles.storeSelector}>
            {stores.map((store) => (
              <TouchableOpacity
                key={store}
                style={[
                  styles.storeButton,
                  selectedStore === store && styles.storeButtonActive,
                ]}
                onPress={() => {
                  setSelectedStore(store);
                  setTransferCarton(null);
                  setPackedBoxes([]);
                }}
              >
                <Text
                  style={[
                    styles.storeButtonText,
                    selectedStore === store && styles.storeButtonTextActive,
                  ]}
                >
                  {store}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {!transferCarton ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleCreateTC}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Creating...' : 'Create Transfer Carton'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.tcInfo}>
              <Text style={styles.tcText}>TC: {transferCarton}</Text>
              <Text style={styles.tcText}>Store: {selectedStore}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scan BOX to Pack</Text>
              <BarcodeScanner
                onScan={handleBoxScan}
                placeholder="Scan BOX barcode"
                title="BOX Barcode"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Packed BOXes</Text>
              {packedBoxes.length === 0 ? (
                <Text style={styles.emptyText}>No BOXes packed yet</Text>
              ) : (
                <FlatList
                  data={packedBoxes}
                  keyExtractor={(item) => item}
                  renderItem={({ item }) => (
                    <View style={styles.packedItem}>
                      <Text style={styles.packedBoxId}>{item}</Text>
                    </View>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>

            <TouchableOpacity
              style={[styles.button, styles.sealButton, loading && styles.buttonDisabled]}
              onPress={handleSeal}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Sealing...' : 'Seal Transfer Carton'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Closed BOXes</Text>
          {boxes.length === 0 ? (
            <Text style={styles.emptyText}>No closed BOXes available</Text>
          ) : (
            <FlatList
              data={boxes}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => (
                <View style={styles.boxItem}>
                  <Text style={styles.boxId}>{item.box_id}</Text>
                  <StatusBadge status={item.status} />
                </View>
              )}
              scrollEnabled={false}
            />
          )}
        </View>
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
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  storeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  storeButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  storeButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#E3F2FD',
  },
  storeButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '600',
  },
  storeButtonTextActive: {
    color: '#007AFF',
  },
  tcInfo: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  tcText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 4,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  sealButton: {
    backgroundColor: '#FF9800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  packedItem: {
    padding: 12,
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    marginBottom: 8,
  },
  packedBoxId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4CAF50',
  },
  boxItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  boxId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
});

