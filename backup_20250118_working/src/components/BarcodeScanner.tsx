import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getSettings } from '../services/settings.service';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  placeholder?: string;
  title?: string;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  placeholder = 'Scan or enter barcode',
  title = 'Scan Barcode',
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    checkDemoMode();
  }, []);

  const checkDemoMode = async () => {
    const settings = await getSettings();
    setDemoMode(settings.demo_mode === 1);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (!scanned) {
      setScanned(true);
      onScan(data);
      // Reset after 2 seconds
      setTimeout(() => setScanned(false), 2000);
    }
  };

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      onScan(manualInput.trim());
      setManualInput('');
    }
  };

  // Handle hardware scanner input (auto-submit on Enter)
  const handleKeyPress = (e: any) => {
    // Hardware scanners typically send Enter/Return after barcode
    if (e.nativeEvent.key === 'Enter' || e.nativeEvent.key === 'Return') {
      handleManualSubmit();
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera permission denied</Text>
        <Text style={styles.text}>Please use manual input below</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Request Permission</Text>
        </TouchableOpacity>
        <View style={styles.manualContainer}>
          <TextInput
            style={styles.input}
            value={manualInput}
            onChangeText={setManualInput}
            placeholder={placeholder}
            onSubmitEditing={handleManualSubmit}
            autoFocus
          />
          <TouchableOpacity style={styles.button} onPress={handleManualSubmit}>
            <Text style={styles.buttonText}>Submit</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      
      {!demoMode && permission.granted ? (
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.scanner}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc', 'code128', 'code39'],
            }}
          />
          {scanned && (
            <View style={styles.overlay}>
              <Text style={styles.scannedText}>Scanned!</Text>
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.manualContainer}>
        <TextInput
          style={styles.input}
          value={manualInput}
          onChangeText={setManualInput}
          placeholder={placeholder}
          onSubmitEditing={handleManualSubmit}
          onKeyPress={handleKeyPress}
          autoFocus={demoMode}
          returnKeyType="done"
          blurOnSubmit={false}
        />
        <TouchableOpacity style={styles.button} onPress={handleManualSubmit}>
          <Text style={styles.buttonText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  scannerContainer: {
    height: 300,
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  scanner: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 255, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannedText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  manualContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  text: {
    fontSize: 16,
    textAlign: 'center',
    marginVertical: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#ff0000',
    textAlign: 'center',
    marginVertical: 8,
  },
});

