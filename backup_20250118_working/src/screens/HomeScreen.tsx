import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/StatusBadge';

export default function HomeScreen() {
  const navigation = useNavigation();
  const {
    settings,
    pendingEventsCount,
    activeASN,
    activeSession,
    refreshPendingEvents,
  } = useApp();

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      refreshPendingEvents();
    });
    return unsubscribe;
  }, [navigation]);

  const menuItems = [
    { title: 'Start Inbound', screen: 'StartInbound', color: '#007AFF' },
    { title: 'Unload', screen: 'Unload', color: '#4CAF50' },
    { title: 'Receive + Sort', screen: 'ReceiveSort', color: '#FF9800' },
    { title: 'BOX Management', screen: 'BoxManagement', color: '#9C27B0' },
    { title: 'Packing', screen: 'Packing', color: '#2196F3' },
    { title: 'Dispatch', screen: 'Dispatch', color: '#F44336' },
    { title: 'Sync Center', screen: 'SyncCenter', color: '#607D8B' },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Active Session</Text>
        {activeASN ? (
          <>
            <Text style={styles.bannerText}>ASN: {activeASN}</Text>
            {activeSession && (
              <Text style={styles.bannerText}>Session: {activeSession}</Text>
            )}
          </>
        ) : (
          <Text style={styles.bannerText}>No active session</Text>
        )}
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingText}>
            Pending Events: {pendingEventsCount}
          </Text>
        </View>
      </View>

      <View style={styles.menu}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.menuItem, { borderLeftColor: item.color }]}
            onPress={() => navigation.navigate(item.screen as never)}
          >
            <Text style={styles.menuItemText}>{item.title}</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.info}>
        <Text style={styles.infoText}>
          Mode: {settings?.demo_mode ? 'Demo' : 'Production'}
        </Text>
        {settings?.user_id && (
          <Text style={styles.infoText}>User: {settings.user_id}</Text>
        )}
        {settings?.device_id && (
          <Text style={styles.infoText}>Device: {settings.device_id}</Text>
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
  banner: {
    backgroundColor: '#007AFF',
    padding: 20,
    marginBottom: 16,
  },
  bannerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  bannerText: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 4,
  },
  pendingBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 8,
    borderRadius: 4,
  },
  pendingText: {
    color: '#fff',
    fontWeight: '600',
  },
  menu: {
    padding: 16,
  },
  menuItem: {
    backgroundColor: '#fff',
    padding: 20,
    marginBottom: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  menuItemText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  menuItemArrow: {
    fontSize: 24,
    color: '#999',
  },
  info: {
    padding: 16,
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
});

