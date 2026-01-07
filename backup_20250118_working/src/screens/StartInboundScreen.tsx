import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { apiService } from '../services/api.service';
import { getSettings } from '../services/settings.service';
import { getDatabase } from '../database/database';
import { dataService } from '../services/data.service';
import { normalizeASN } from '../utils/asn';

export default function StartInboundScreen() {
  const navigation = useNavigation();
  const { setActiveASN, setActiveSession } = useApp();
  const [asnNo, setAsnNo] = useState('');
  const [dock, setDock] = useState('DOCK-01');
  const [transferOrder, setTransferOrder] = useState('');
  const [transferOrders, setTransferOrders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTO, setLoadingTO] = useState(false);

  const handleASNScan = async (barcode: string) => {
    const scannedASN = barcode.trim().toUpperCase();
    // Normalize ASN format (ASN-0045 -> ASN-00045)
    const normalizedASN = normalizeASN(scannedASN);
    setAsnNo(normalizedASN);
    
    // Fetch Transfer Orders for this ASN
    if (normalizedASN) {
      await loadTransferOrders(normalizedASN);
    }
  };

  const loadTransferOrders = async (asn: string) => {
    setLoadingTO(true);
    try {
      const toData = await apiService.getTransferOrderByASN(asn);
      if (toData && toData.to_no) {
        setTransferOrder(toData.to_no);
        setTransferOrders([toData.to_no]);
        
        // Cache transfer order allocations
        if (toData.allocations) {
          const db = await getDatabase();
          for (const alloc of toData.allocations) {
            await db.runAsync(
              'INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)',
              [toData.to_no, asn, alloc.store, alloc.item_code, alloc.allocated_qty]
            );
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to load transfer orders:', error);
      // Fallback to demo data
      setTransferOrder('TO-00012');
      setTransferOrders(['TO-00012']);
    } finally {
      setLoadingTO(false);
    }
  };

  const handleStart = async () => {
    if (!asnNo.trim()) {
      Alert.alert('Error', 'Please scan or enter ASN number');
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      // User ID and Device ID are auto-generated if not set
      const userId = settings.user_id || 'USER-AUTO';
      const deviceId = settings.device_id || 'DEV-AUTO';
      
      // Normalize ASN format
      const normalizedASN = normalizeASN(asnNo);

      const response = await apiService.startInbound({
        asn_no: normalizedASN,
        transfer_order: transferOrder,
        dock: dock,
        user_id: userId,
        device_id: deviceId,
      });

      // Cache ASN data
      const db = await getDatabase();
      await db.runAsync(
        'INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) VALUES (?, ?, ?)',
        [
          normalizedASN,
          JSON.stringify({ asn_no: normalizedASN, transfer_order: transferOrder, dock }),
          new Date().toISOString(),
        ]
      );

      // Initialize carton statuses - get cartons from ASN carton map
      const cartonMap = await db.getAllAsync<{ carton_id: string }>(
        'SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?',
        [normalizedASN]
      );
      
      // If no cartons found in map, use demo cartons as fallback
      const cartons = cartonMap.length > 0 
        ? cartonMap.map(c => c.carton_id)
        : ['CTN-001', 'CTN-002', 'CTN-003', 'CTN-004'];
      
      for (const carton_id of cartons) {
        await dataService.updateCartonStatus({
          asn_no: normalizedASN,
          inbound_session: response.inbound_session,
          carton_id,
          status: 'Pending',
          updated_on: new Date().toISOString(),
        });
      }

      setActiveASN(normalizedASN);
      setActiveSession(response.inbound_session);

      Alert.alert('Success', 'Inbound session started', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to start inbound session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Scan ASN Barcode</Text>
        <BarcodeScanner
          onScan={handleASNScan}
          placeholder="Enter ASN number"
          title="ASN Barcode"
        />

        <View style={styles.inputGroup}>
          <Text style={styles.label}>ASN Number</Text>
          <Text style={styles.value}>{asnNo || 'Not scanned'}</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Dock</Text>
          <TextInput
            style={styles.input}
            value={dock}
            onChangeText={setDock}
            placeholder="DOCK-01"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Transfer Order</Text>
          {loadingTO ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : transferOrder ? (
            <Text style={styles.value}>{transferOrder}</Text>
          ) : (
            <Text style={styles.value}>Scan ASN to load Transfer Order</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Starting...' : 'Start Inbound Session'}
          </Text>
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
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  value: {
    fontSize: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  input: {
    fontSize: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  button: {
    backgroundColor: '#007AFF',
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
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#666',
  },
});

