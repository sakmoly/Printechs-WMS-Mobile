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
import { addEvent } from '../services/event-queue.service';
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

  // Dispatch function (used by both scan and double-tap)
  const dispatchTC = async (tcId: string, showSuccessAlert: boolean = true) => {
    // First, check the actual status from database (not just from the filtered list)
    const allTCs = await dataService.getTransferCartons(activeASN);
    const tc = allTCs.find(t => t.tc_id === tcId);

    if (!tc) {
      Alert.alert('Error', `Transfer Carton ${tcId} not found for this ASN.`);
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

  // Handle double-tap on TC item - show warning dialog
  const handleTCDoubleTap = (tcId: string) => {
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

