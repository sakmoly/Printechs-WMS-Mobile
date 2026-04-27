import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import {
  clearScannerTimer,
  onScannerTextChange,
} from '../utils/hardwareScannerInput';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  placeholder?: string;
  title?: string;
  scanType?: 'item' | 'box' | 'carton';
  autoSubmit?: boolean; // Auto-submit after delay (for scanners that don't send Enter)
  autoSubmitDelay?: number; // Delay in milliseconds (default: 500ms)
  /** When false, render nothing (modal-style usage). */
  visible?: boolean;
  onClose?: () => void;
  /** Alias for onClose used by some screens */
  onCancel?: () => void;
  /** Controlled value (optional); when set with onChangeText, pairs with parent state */
  value?: string;
  onChangeText?: (text: string) => void;
  /** Change this value to force-focus the underlying barcode input. */
  focusSignal?: unknown;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  placeholder = 'Scan or enter barcode',
  title = 'Scan Barcode',
  scanType = 'item',
  autoSubmit = true, // Enable auto-submit by default
  autoSubmitDelay = 300, // 300ms delay (scanners are usually fast)
  visible = true,
  onClose,
  onCancel,
  value: valueProp,
  onChangeText: onChangeTextProp,
  focusSignal,
}) => {
  const [input, setInput] = useState(valueProp ?? '');
  const inputRef = useRef<TextInput>(null);
  const latestInputRef = useRef('');
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (valueProp !== undefined) setInput(valueProp);
  }, [valueProp]);

  // Auto-focus when component mounts or scanType changes
  useEffect(() => {
    if (!visible) return;
    // Small delay to ensure the input is rendered
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [scanType, title, visible]);

  useEffect(() => {
    if (!visible || focusSignal === undefined) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [focusSignal, visible]);

  // Clear auto-submit timer when input changes or component unmounts
  useEffect(() => {
    return () => {
      clearScannerTimer(autoSubmitTimerRef);
    };
  }, []);

  const handleSubmit = () => {
    const v = latestInputRef.current.trim() || input.trim();
    if (v) {
      clearScannerTimer(autoSubmitTimerRef);

      onScan(v);
      latestInputRef.current = '';
      setInput('');
      onChangeTextProp?.('');
      // Refocus after submission
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  if (visible === false) {
    return null;
  }

  const dismiss = () => {
    (onClose ?? onCancel)?.();
  };

  // Handle text input changes with auto-submit
  const handleTextChange = (text: string) => {
    const commit = (barcode: string) => {
      const trimmed = barcode.trim();
      if (!trimmed) return;
      onScan(trimmed);
      latestInputRef.current = '';
      setInput('');
      onChangeTextProp?.('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    };

    onScannerTextChange(
      text,
      (s: string) => {
        latestInputRef.current = String(s).replace(/[\r\n\t\u0000]+/g, "");
        setInput(s);
        onChangeTextProp?.(s);
      },
      autoSubmitTimerRef,
      commit,
      {
        delayMs: autoSubmitDelay,
        autoIdleSubmit: autoSubmit,
        getLatestDisplay: () => latestInputRef.current,
      }
    );
  };

  // Handle hardware scanner input (auto-submit on Enter)
  // Hardware scanners typically send Enter/Return after barcode
  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === 'Enter' || e.nativeEvent.key === 'Return') {
      clearScannerTimer(autoSubmitTimerRef);
      handleSubmit();
    }
  };

  // Determine styles based on scan type
  const isBoxScan = scanType === 'box' || (title && title.toLowerCase().includes('box'));
  const containerStyle = isBoxScan ? styles.containerBox : styles.containerItem;
  const titleStyle = isBoxScan ? styles.titleBox : styles.titleItem;
  const inputStyle = isBoxScan ? styles.inputBox : styles.inputItem;
  const buttonStyle = isBoxScan ? styles.buttonBox : styles.buttonItem;

  return (
    <View style={[styles.container, containerStyle]}>
      {title && <Text style={[styles.title, titleStyle]}>{title}</Text>}
      {(onClose || onCancel) && (
        <TouchableOpacity
          style={styles.closeRow}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
        >
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      )}
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={[styles.input, inputStyle]}
          value={valueProp !== undefined ? valueProp : input}
          onChangeText={handleTextChange}
          placeholder={placeholder}
          placeholderTextColor={isBoxScan ? '#9E9E9E' : '#999'}
          onSubmitEditing={() => {
            clearScannerTimer(autoSubmitTimerRef);
            handleSubmit();
          }}
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
    padding: 0,
    borderRadius: 0,
    marginBottom: 0,
  },
  containerItem: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  containerBox: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'left',
    color: '#1976D2',
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
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    fontWeight: '500',
    backgroundColor: '#fff',
  },
  inputItem: {
    borderColor: '#BBDEFB',
    color: '#333',
  },
  inputBox: {
    borderColor: '#C8E6C9',
    color: '#333',
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
    minWidth: 80,
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
  closeRow: {
    alignSelf: 'flex-end',
    marginBottom: 8,
  },
  closeText: {
    color: '#1976D2',
    fontSize: 14,
    fontWeight: '600',
  },
});

