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
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { StatusBadge } from '../components/StatusBadge';
import { addEvent } from '../services/event-queue.service';
import { dataService } from '../services/data.service';
import { getSettings } from '../services/settings.service';
import { normalizeASN } from '../utils/asn';

export default function UnloadScreen() {
  const navigation = useNavigation();
  const { activeASN, activeSession } = useApp();
  const [cartons, setCartons] = useState<any[]>([]);
  const [totalCartons, setTotalCartons] = useState<number>(0);
  const [scannedCartons, setScannedCartons] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCartons();
  }, [activeASN, activeSession]);

  const loadCartons = async () => {
    if (!activeASN || !activeSession) return;

    const normalizedASN = normalizeASN(activeASN);
    
    // Get all cartons for this ASN
    const allCartons = await dataService.getASNCartons(normalizedASN);
    setTotalCartons(allCartons.length);
    
    // Get carton statuses
    const statuses = await dataService.getAllCartonStatuses(normalizedASN, activeSession);
    setCartons(statuses);
    
    // Count scanned cartons (Unloaded, InReceiving, or Received)
    const scannedCount = statuses.filter(
      c => c.status === 'Unloaded' || c.status === 'InReceiving' || c.status === 'Received'
    ).length;
    setScannedCartons(scannedCount);
  };

  const handleCartonScan = async (barcode: string) => {
    if (!activeASN || !activeSession) {
      Alert.alert('Error', 'No active inbound session');
      return;
    }

    const cartonId = barcode.trim().toUpperCase();
    const normalizedASN = normalizeASN(activeASN);
    
    // Validate that carton belongs to the active ASN
    const isValidCarton = await dataService.isCartonInASN(normalizedASN, cartonId);
    if (!isValidCarton) {
      Alert.alert(
        'Invalid Carton',
        `Carton ${cartonId} does not belong to ASN ${normalizedASN}.\n\nPlease scan a carton from the current shipment.`
      );
      return;
    }
    
    // Check if already unloaded
    const existing = cartons.find(c => c.carton_id === cartonId);
    if (existing && existing.status === 'Unloaded') {
      Alert.alert('Info', 'Carton already unloaded');
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();

      // Create UNLOAD_SCAN event
      await addEvent({
        event_type: 'UNLOAD_SCAN',
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Update carton status
      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        status: 'Unloaded',
        updated_on: new Date().toISOString(),
      });

      await loadCartons();
      Alert.alert('Success', `Carton ${cartonId} unloaded`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to unload carton');
    } finally {
      setLoading(false);
    }
  };

  if (!activeASN || !activeSession) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No active inbound session</Text>
        <Text style={styles.errorSubtext}>
          Please start an inbound session first
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.asnInfo}>
          <Text style={styles.asnLabel}>Active ASN:</Text>
          <Text style={styles.asnValue}>{normalizeASN(activeASN || '')}</Text>
        </View>
        
        <View style={styles.summaryContainer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Number of CTN ASN:</Text>
            <Text style={styles.summaryValue}>{totalCartons}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Number of CTN Scanned:</Text>
            <Text style={[styles.summaryValue, styles.summaryValueScanned]}>
              {scannedCartons}
            </Text>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Scan Supplier Carton</Text>
        <Text style={styles.hintText}>
          Only cartons from ASN {normalizeASN(activeASN || '')} can be unloaded
        </Text>
        <BarcodeScanner
          onScan={handleCartonScan}
          placeholder="Scan carton barcode"
          title="Carton Barcode"
        />

        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>Carton Status</Text>
          <FlatList
            data={cartons}
            keyExtractor={(item) => item.carton_id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.cartonItem,
                  item.status === 'Unloaded' && styles.cartonItemClickable,
                ]}
                onPress={() => {
                  if (item.status === 'Unloaded') {
                    // Navigate to Receive + Sort screen with carton ID
                    navigation.navigate('ReceiveSort' as never, {
                      cartonId: item.carton_id,
                    } as never);
                  }
                }}
                disabled={item.status !== 'Unloaded'}
              >
                <View style={styles.cartonInfo}>
                  <Text
                    style={[
                      styles.cartonId,
                      item.status === 'Unloaded' && styles.cartonIdClickable,
                    ]}
                  >
                    {item.carton_id}
                  </Text>
                  <StatusBadge status={item.status} />
                </View>
                {item.status === 'Unloaded' && (
                  <Text style={styles.tapHint}>Tap to receive & sort →</Text>
                )}
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
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
  asnInfo: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  asnLabel: {
    fontSize: 14,
    color: '#1976D2',
    fontWeight: '600',
  },
  asnValue: {
    fontSize: 16,
    color: '#1976D2',
    fontWeight: 'bold',
  },
  summaryContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: 'bold',
  },
  summaryValueScanned: {
    color: '#4CAF50',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  hintText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  listContainer: {
    marginTop: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  cartonItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  cartonItemClickable: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    marginBottom: 4,
    borderBottomWidth: 0,
  },
  cartonInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartonId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  cartonIdClickable: {
    color: '#4CAF50',
  },
  tapHint: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 4,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F44336',
    textAlign: 'center',
    marginTop: 100,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
});

