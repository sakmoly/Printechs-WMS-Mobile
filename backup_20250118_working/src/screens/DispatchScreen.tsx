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

export default function DispatchScreen() {
  const { activeASN, activeSession } = useApp();
  const [transferCartons, setTransferCartons] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTransferCartons();
  }, [activeASN]);

  const loadTransferCartons = async () => {
    if (!activeASN) return;
    const tcList = await dataService.getTransferCartons(activeASN);
    setTransferCartons(tcList.filter(tc => tc.status === 'Sealed'));
  };

  const handleTCScan = async (barcode: string) => {
    const tcId = barcode.trim().toUpperCase();
    const tc = transferCartons.find(t => t.tc_id === tcId);

    if (!tc) {
      Alert.alert('Error', 'Transfer Carton not found or not sealed');
      return;
    }

    setLoading(true);
    try {
      await apiService.dispatchTransferCarton({ tc_id: tcId });
      
      // Create TC_DISPATCH event
      const settings = await getSettings();
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
      Alert.alert('Success', `Transfer Carton ${tcId} dispatched`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to dispatch Transfer Carton');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
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
                <View style={styles.tcItem}>
                  <View style={styles.tcHeader}>
                    <Text style={styles.tcId}>{item.tc_id}</Text>
                    <StatusBadge status={item.status} />
                  </View>
                  <Text style={styles.tcStore}>Store: {item.store}</Text>
                  <Text style={styles.tcDate}>
                    Updated: {new Date(item.updated_on).toLocaleString()}
                  </Text>
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
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
});

