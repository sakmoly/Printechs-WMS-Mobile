import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { AppProvider } from './src/context/AppContext';
import { getDatabase } from './src/database/database';
import { seedDemoData } from './src/database/seeder';
import { getSettings } from './src/services/settings.service';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import StartInboundScreen from './src/screens/StartInboundScreen';
import UnloadScreen from './src/screens/UnloadScreen';
import ReceiveSortScreen from './src/screens/ReceiveSortScreen';
import BoxManagementScreen from './src/screens/BoxManagementScreen';
import PackingScreen from './src/screens/PackingScreen';
import DispatchScreen from './src/screens/DispatchScreen';
import SyncCenterScreen from './src/screens/SyncCenterScreen';

const Stack = createStackNavigator();

export default function App() {
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize database
      await getDatabase();
      
      // Check if demo mode is enabled and seed data
      const settings = await getSettings();
      if (settings.demo_mode === 1) {
        await seedDemoData();
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
    }
  };

  return (
    <AppProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{
            headerStyle: {
              backgroundColor: '#007AFF',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
            },
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="StartInbound" component={StartInboundScreen} />
          <Stack.Screen name="Unload" component={UnloadScreen} />
          <Stack.Screen name="ReceiveSort" component={ReceiveSortScreen} />
          <Stack.Screen name="BoxManagement" component={BoxManagementScreen} />
          <Stack.Screen name="Packing" component={PackingScreen} />
          <Stack.Screen name="Dispatch" component={DispatchScreen} />
          <Stack.Screen name="SyncCenter" component={SyncCenterScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppProvider>
  );
}

