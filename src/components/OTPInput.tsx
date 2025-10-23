import React, { useState, useRef, useEffect } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
} from "react-native";

interface OTPInputProps {
  length?: number;
  onComplete: (otp: string) => void;
  onResend?: () => void;
  disabled?: boolean;
  error?: string;
  showSubmitButton?: boolean;
  receivedOTP?: string; // For autofill from email
  displayOTP?: string; // OTP to display above keyboard
}

export const OTPInput: React.FC<OTPInputProps> = ({
  length = 6,
  onComplete,
  onResend,
  disabled = false,
  error,
  showSubmitButton = true,
  receivedOTP,
  displayOTP,
}) => {
  const [otp, setOtp] = useState<string[]>(new Array(length).fill(""));
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isComplete, setIsComplete] = useState<boolean>(false);
  const inputRefs = useRef<TextInput[]>([]);

  useEffect(() => {
    // Focus first input when component mounts
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  // Check completion state changes
  useEffect(() => {
    const otpString = otp.join("");
    // Fixed completion logic - check if all digits are filled and no empty strings
    const hasEmptyDigits = otp.some(
      (digit) => digit === "" || digit === undefined
    );
    const isCompleteNow = otpString.length === length && !hasEmptyDigits;

    // Force update completion state if it's different
    if (isCompleteNow !== isComplete) {
      setIsComplete(isCompleteNow);
    }
  }, [otp, isComplete, length]);

  // Autofill OTP when receivedOTP is provided
  useEffect(() => {
    if (
      receivedOTP &&
      receivedOTP.length === length &&
      /^\d+$/.test(receivedOTP)
    ) {
      console.log("📧 Autofilling OTP:", receivedOTP);
      const otpArray = receivedOTP.split("");
      setOtp(otpArray);
      setIsComplete(true);

      // Auto-submit after a short delay
      setTimeout(() => {
        onComplete(receivedOTP);
      }, 500);
    }
  }, [receivedOTP, length, onComplete]);

  const handleChange = (value: string, index: number) => {
    // Only allow single digit
    if (value.length > 1) {
      value = value.slice(-1);
    }

    // Only allow numbers
    if (!/^\d*$/.test(value)) {
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Move to next input if value is entered
    if (value && index < length - 1) {
      setActiveIndex(index + 1);
      inputRefs.current[index + 1]?.focus();
    }

    // Check if OTP is complete and trigger auto-submit
    const otpString = newOtp.join("");
    const hasEmptyDigits = newOtp.some(
      (digit) => digit === "" || digit === undefined
    );
    const isCompleteNow = otpString.length === length && !hasEmptyDigits;

    setIsComplete(isCompleteNow);

    if (isCompleteNow) {
      // Small delay to ensure UI updates
      setTimeout(() => {
        onComplete(otpString);
      }, 100);
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !otp[index] && index > 0) {
      // Move to previous input on backspace
      setActiveIndex(index - 1);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleFocus = (index: number) => {
    setActiveIndex(index);
  };

  const handleResend = () => {
    if (onResend) {
      onResend();
    }
  };

  const clearOTP = () => {
    setOtp(new Array(length).fill(""));
    setActiveIndex(0);
    setIsComplete(false);
    inputRefs.current[0]?.focus();
  };

  const handleManualSubmit = () => {
    const otpString = otp.join("");
    if (otpString.length === length && !otpString.includes("")) {
      console.log("🔢 Manual Submit - OTP:", otpString);
      onComplete(otpString);
    } else {
      Alert.alert("Incomplete OTP", "Please enter all 6 digits");
    }
  };

  const isOTPComplete = () => {
    const otpString = otp.join("");
    const hasEmptyDigits = otp.some(
      (digit) => digit === "" || digit === undefined
    );
    const isComplete = otpString.length === length && !hasEmptyDigits;
    return isComplete;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>
        We've sent a 6-digit code to your email
      </Text>

      {receivedOTP && (
        <Text style={styles.autofillText}>
          📧 OTP detected from email - Auto-filling...
        </Text>
      )}

      {isComplete && !receivedOTP && (
        <Text style={styles.completeText}>
          ✅ OTP Complete - Tap "Verify OTP" or wait for auto-submit
        </Text>
      )}

      <View style={styles.otpContainer}>
        {otp.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              if (ref) inputRefs.current[index] = ref;
            }}
            style={[
              styles.input,
              activeIndex === index && styles.activeInput,
              error && styles.errorInput,
              disabled && styles.disabledInput,
            ]}
            value={digit}
            onChangeText={(value) => handleChange(value, index)}
            onKeyPress={({ nativeEvent }) =>
              handleKeyPress(nativeEvent.key, index)
            }
            onFocus={() => handleFocus(index)}
            keyboardType="numeric"
            maxLength={1}
            editable={!disabled}
            selectTextOnFocus
            textAlign="center"
          />
        ))}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Submit Button */}
      {showSubmitButton && (
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!isComplete || disabled) && styles.submitButtonDisabled,
          ]}
          onPress={handleManualSubmit}
          disabled={!isComplete || disabled}
        >
          <Text
            style={[
              styles.submitButtonText,
              (!isComplete || disabled) && styles.submitButtonTextDisabled,
            ]}
          >
            {disabled ? "Verifying..." : "Verify OTP"}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.resendButton, disabled && styles.disabledButton]}
          onPress={handleResend}
          disabled={disabled}
        >
          <Text style={[styles.resendText, disabled && styles.disabledText]}>
            Resend OTP
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.clearButton, disabled && styles.disabledButton]}
          onPress={clearOTP}
          disabled={disabled}
        >
          <Text style={[styles.clearText, disabled && styles.disabledText]}>
            Clear
          </Text>
        </TouchableOpacity>
      </View>

      {/* OTP Display above keyboard */}
      {displayOTP && (
        <View style={styles.keyboardOTPContainer}>
          <Text style={styles.keyboardOTPLabel}>Your OTP:</Text>
          <Text style={styles.keyboardOTPText}>{displayOTP}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  completeText: {
    fontSize: 14,
    color: "#34C759",
    textAlign: "center",
    marginBottom: 16,
    fontWeight: "600",
  },
  autofillText: {
    fontSize: 14,
    color: "#007AFF",
    textAlign: "center",
    marginBottom: 16,
    fontWeight: "600",
  },
  otpContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  input: {
    width: 45,
    height: 55,
    borderWidth: 2,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    fontSize: 24,
    fontWeight: "bold",
    color: "#1a1a1a",
    backgroundColor: "#fff",
    textAlign: "center",
  },
  activeInput: {
    borderColor: "#007AFF",
    backgroundColor: "#f0f8ff",
  },
  errorInput: {
    borderColor: "#FF3B30",
    backgroundColor: "#fff5f5",
  },
  disabledInput: {
    backgroundColor: "#f5f5f5",
    borderColor: "#d0d0d0",
    color: "#999",
  },
  errorText: {
    color: "#FF3B30",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: "center",
  },
  submitButtonDisabled: {
    backgroundColor: "#C7C7CC",
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "bold",
  },
  submitButtonTextDisabled: {
    color: "#8E8E93",
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 20,
  },
  resendButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  clearButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  disabledButton: {
    backgroundColor: "#e0e0e0",
  },
  resendText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  clearText: {
    color: "#FF3B30",
    fontSize: 16,
    fontWeight: "600",
  },
  disabledText: {
    color: "#999",
  },
  keyboardOTPContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#f8f9fa",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: "#e9ecef",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  keyboardOTPLabel: {
    fontSize: 16,
    color: "#495057",
    fontWeight: "600",
    marginRight: 8,
  },
  keyboardOTPText: {
    fontSize: 20,
    color: "#007AFF",
    fontWeight: "700",
    letterSpacing: 2,
  },
});
