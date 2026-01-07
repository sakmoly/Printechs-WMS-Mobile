import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  TextInput,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/StatusBadge';
import { dataService } from '../services/data.service';
import { apiService } from '../services/api.service';

export default function BoxManagementScreen() {
  const { activeASN } = useApp();
  const [boxes, setBoxes] = useState<any[]>([]);
  const [selectedStore, setSelectedStore] = useState('SR-01');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBoxes();
  }, [activeASN]);

  const loadBoxes = async () => {
    if (!activeASN) return;
    const boxList = await dataService.getBoxes(activeASN);
    setBoxes(boxList);
  };

  const handleCreateBox = async () => {
    if (!activeASN) {
      Alert.alert('Error', 'No active ASN');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.createBox({
        asn_no: activeASN,
        to_no: 'TO-00012',
        store: selectedStore,
      });

      const newBox: any = {
        box_id: response.box_id,
        asn_no: activeASN,
        to_no: 'TO-00012',
        store: selectedStore,
        status: 'Open',
        updated_on: new Date().toISOString(),
      };

      await dataService.saveBox(newBox);
      await loadBoxes();
      Alert.alert('Success', `BOX ${response.box_id} created`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create BOX');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseBox = async (boxId: string) => {
    setLoading(true);
    try {
      await apiService.closeBox({ box_id: boxId });
      await dataService.updateBoxStatus(boxId, 'Closed');
      await loadBoxes();
      Alert.alert('Success', `BOX ${boxId} closed`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to close BOX');
    } finally {
      setLoading(false);
    }
  };

  const handleReopenBox = async (boxId: string) => {
    setLoading(true);
    try {
      await apiService.reopenBox({ box_id: boxId });
      await dataService.updateBoxStatus(boxId, 'Open');
      await loadBoxes();
      Alert.alert('Success', `BOX ${boxId} reopened`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reopen BOX');
    } finally {
      setLoading(false);
    }
  };

  const stores = ['SR-01', 'SR-02', 'SR-03'];
  const filteredBoxes = boxes.filter(b => b.store === selectedStore);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.createSection}>
          <Text style={styles.sectionTitle}>Create New BOX</Text>
          <View style={styles.storeSelector}>
            {stores.map((store) => (
              <TouchableOpacity
                key={store}
                style={[
                  styles.storeButton,
                  selectedStore === store && styles.storeButtonActive,
                ]}
                onPress={() => setSelectedStore(store)}
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
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreateBox}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating...' : 'Create BOX'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listSection}>
          <Text style={styles.sectionTitle}>
            BOXes for {selectedStore}
          </Text>
          {filteredBoxes.length === 0 ? (
            <Text style={styles.emptyText}>No BOXes found</Text>
          ) : (
            <FlatList
              data={filteredBoxes}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => (
                <View style={styles.boxItem}>
                  <View style={styles.boxHeader}>
                    <Text style={styles.boxId}>{item.box_id}</Text>
                    <StatusBadge status={item.status} />
                  </View>
                  <Text style={styles.boxStore}>Store: {item.store}</Text>
                  <View style={styles.boxActions}>
                    {item.status === 'Open' ? (
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleCloseBox(item.box_id)}
                      >
                        <Text style={styles.actionButtonText}>Close</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionButton, styles.actionButtonSecondary]}
                        onPress={() => handleReopenBox(item.box_id)}
                      >
                        <Text style={styles.actionButtonText}>Reopen</Text>
                      </TouchableOpacity>
                    )}
                  </View>
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
  createSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  listSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
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
    marginBottom: 16,
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
  button: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  boxItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  boxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  boxId: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  boxStore: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  boxActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#F44336',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  actionButtonSecondary: {
    backgroundColor: '#4CAF50',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
});

