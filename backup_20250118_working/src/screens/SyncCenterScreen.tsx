import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { getUnsyncedEvents, syncEvents } from '../services/event-queue.service';
import { ScanEvent } from '../types';

export default function SyncCenterScreen() {
  const { refreshPendingEvents } = useApp();
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    const unsynced = await getUnsyncedEvents();
    setEvents(unsynced);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncEvents();
      await loadEvents();
      await refreshPendingEvents();
      
      Alert.alert(
        'Sync Complete',
        `Synced: ${result.synced}\nFailed: ${result.failed}`
      );
    } catch (error: any) {
      Alert.alert('Sync Error', error.message || 'Failed to sync events');
    } finally {
      setSyncing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  };

  const getEventTypeColor = (eventType: string) => {
    switch (eventType) {
      case 'UNLOAD_SCAN':
        return '#4CAF50';
      case 'RECEIVE_ITEM_SCAN':
        return '#2196F3';
      case 'SORT_TO_BOX':
        return '#FF9800';
      case 'PACK_BOX_TO_TC':
        return '#9C27B0';
      case 'TC_DISPATCH':
        return '#F44336';
      default:
        return '#757575';
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sync Center</Text>
          <Text style={styles.headerSubtitle}>
            {events.length} unsynced event{events.length !== 1 ? 's' : ''}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          <Text style={styles.syncButtonText}>
            {syncing ? 'Syncing...' : 'Sync Now'}
          </Text>
        </TouchableOpacity>

        <View style={styles.eventsSection}>
          <Text style={styles.sectionTitle}>Unsynced Events</Text>
          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>All events synced! ✓</Text>
            </View>
          ) : (
            <FlatList
              data={events}
              keyExtractor={(item) => item.offline_uuid}
              renderItem={({ item }) => (
                <View style={styles.eventItem}>
                  <View
                    style={[
                      styles.eventTypeBadge,
                      { backgroundColor: getEventTypeColor(item.event_type) },
                    ]}
                  >
                    <Text style={styles.eventTypeText}>{item.event_type}</Text>
                  </View>
                  <View style={styles.eventDetails}>
                    {item.asn_no && (
                      <Text style={styles.eventDetail}>ASN: {item.asn_no}</Text>
                    )}
                    {item.carton_id && (
                      <Text style={styles.eventDetail}>
                        Carton: {item.carton_id}
                      </Text>
                    )}
                    {item.item_code && (
                      <Text style={styles.eventDetail}>
                        Item: {item.item_code}
                      </Text>
                    )}
                    {item.box_id && (
                      <Text style={styles.eventDetail}>BOX: {item.box_id}</Text>
                    )}
                    {item.tc_id && (
                      <Text style={styles.eventDetail}>TC: {item.tc_id}</Text>
                    )}
                    <Text style={styles.eventTime}>
                      {new Date(item.event_time).toLocaleString()}
                    </Text>
                    {item.error_msg && (
                      <Text style={styles.errorText}>
                        Error: {item.error_msg}
                      </Text>
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
  header: {
    backgroundColor: '#007AFF',
    padding: 20,
    borderRadius: 8,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
  },
  syncButton: {
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  syncButtonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  eventsSection: {
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
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
  },
  eventItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  eventTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  eventTypeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  eventDetails: {
    marginTop: 8,
  },
  eventDetail: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  eventTime: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#F44336',
    marginTop: 4,
    fontStyle: 'italic',
  },
});

