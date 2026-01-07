import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  placeholder?: string;
  title?: string;
  scanType?: 'item' | 'box' | 'carton';
  autoSubmit?: boolean; // Auto-submit after delay (for scanners that don't send Enter)
  autoSubmitDelay?: number; // Delay in milliseconds (default: 500ms)
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  placeholder = 'Scan or enter barcode',
  title = 'Scan Barcode',
  scanType = 'item',
  autoSubmit = true, // Enable auto-submit by default
  autoSubmitDelay = 300, // 300ms delay (scanners are usually fast)
}) => {
  const [input, setInput] = useState('');
  const inputRef = useRef<TextInput>(null);
  const autoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-focus when component mounts or scanType changes
  useEffect(() => {
    // Small delay to ensure the input is rendered
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [scanType, title]);

  // Clear auto-submit timer when input changes or component unmounts
  useEffect(() => {
    return () => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = () => {
    if (input.trim()) {
      // Clear any pending auto-submit timer
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      
      onScan(input.trim());
      setInput('');
      // Refocus after submission
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  // Handle text input changes with auto-submit
  const handleTextChange = (text: string) => {
    setInput(text);
    
    // Clear previous timer if exists
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    
    // If auto-submit is enabled and text is not empty, set a timer
    // This handles scanners that don't send Enter key
    if (autoSubmit && text.trim().length > 0) {
      autoSubmitTimerRef.current = setTimeout(() => {
        // Auto-submit after delay (scanner has finished)
        const currentText = text.trim();
        if (currentText.length > 0) {
          onScan(currentText);
          setInput('');
          // Refocus after submission
          setTimeout(() => {
            inputRef.current?.focus();
          }, 100);
        }
      }, autoSubmitDelay);
    }
  };

  // Handle hardware scanner input (auto-submit on Enter)
  // Hardware scanners typically send Enter/Return after barcode
  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === 'Enter' || e.nativeEvent.key === 'Return') {
      handleSubmit();
    }
  };

  // Determine styles based on scan type
  const isBoxScan = scanType === 'box' || title.toLowerCase().includes('box');
  const containerStyle = isBoxScan ? styles.containerBox : styles.containerItem;
  const titleStyle = isBoxScan ? styles.titleBox : styles.titleItem;
  const inputStyle = isBoxScan ? styles.inputBox : styles.inputItem;
  const buttonStyle = isBoxScan ? styles.buttonBox : styles.buttonItem;

  return (
    <View style={[styles.container, containerStyle]}>
      {title && <Text style={[styles.title, titleStyle]}>{title}</Text>}
      
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={[styles.input, inputStyle]}
          value={input}
          onChangeText={handleTextChange}
          placeholder={placeholder}
          placeholderTextColor={isBoxScan ? '#9E9E9E' : '#999'}
          onSubmitEditing={handleSubmit}
          onKeyPress={handleKeyPress}
          autoFocus={true}
          returnKeyType="done"
          blurOnSubmit={false}
          showSoftInputOnFocus={false}
        />
        <TouchableOpacity style={[styles.button, buttonStyle]} onPress={handleSubmit}>
          <Text style={styles.buttonText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  containerItem: {
    backgroundColor: '#E3F2FD',
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  containerBox: {
    backgroundColor: '#F1F8F4',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  titleItem: {
    color: '#1976D2',
  },
  titleBox: {
    color: '#2E7D32',
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  inputItem: {
    borderColor: '#2196F3',
    backgroundColor: '#fff',
    color: '#1976D2',
  },
  inputBox: {
    borderColor: '#4CAF50',
    backgroundColor: '#fff',
    color: '#2E7D32',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  buttonItem: {
    backgroundColor: '#2196F3',
  },
  buttonBox: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

