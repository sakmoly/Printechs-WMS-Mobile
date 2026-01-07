import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { saveSettings, getSettings } from '../services/settings.service';
import { seedDemoData } from '../database/seeder';

export default function LoginScreen() {
  const navigation = useNavigation();
  const { refreshSettings } = useApp();
  const [apiUrl, setApiUrl] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [userId, setUserId] = useState('');
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const settings = await getSettings();
    setApiUrl(settings.api_url || '');
    setDeviceId(settings.device_id || '');
    setUserId(settings.user_id || '');
    setDemoMode(settings.demo_mode === 1);
  };

  const handleSave = async () => {
    if (!demoMode && (!apiUrl || !deviceId || !userId)) {
      Alert.alert('Error', 'Please fill all fields or enable Demo Mode');
      return;
    }

    if (demoMode) {
      // Seed demo data when enabling demo mode
      await seedDemoData();
    }

    await saveSettings({
      api_url: apiUrl,
      device_id: deviceId,
      user_id: userId,
      demo_mode: demoMode ? 1 : 0,
    });

    await refreshSettings();
    navigation.navigate('Home' as never);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Printechs WMS</Text>
        <Text style={styles.subtitle}>Device Setup</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.switchContainer}>
          <Text style={styles.label}>Demo Mode</Text>
          <Switch value={demoMode} onValueChange={setDemoMode} />
        </View>

        {!demoMode && (
          <>
            <Text style={styles.label}>API URL</Text>
            <TextInput
              style={styles.input}
              value={apiUrl}
              onChangeText={setApiUrl}
              placeholder="https://api.example.com"
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={styles.label}>Device ID</Text>
            <TextInput
              style={styles.input}
              value={deviceId}
              onChangeText={setDeviceId}
              placeholder="DEVICE-001"
              autoCapitalize="characters"
            />

            <Text style={styles.label}>User ID</Text>
            <TextInput
              style={styles.input}
              value={userId}
              onChangeText={setUserId}
              placeholder="USER-001"
              autoCapitalize="characters"
            />
          </>
        )}

        {demoMode && (
          <View style={styles.demoInfo}>
            <Text style={styles.demoText}>
              Demo Mode enabled. Using mock data for testing.
            </Text>
          </View>
        )}

        <TouchableOpacity style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>Save & Continue</Text>
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
  header: {
    backgroundColor: '#007AFF',
    padding: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#fff',
    opacity: 0.9,
  },
  form: {
    padding: 24,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  demoInfo: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  demoText: {
    color: '#1976D2',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

