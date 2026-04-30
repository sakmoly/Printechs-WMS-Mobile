import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSubmitEditingEventData,
} from "react-native";
import {
  clearScannerTimer,
  onScannerTextChange,
} from "../utils/hardwareScannerInput";

export type BarcodeInputProps = {
  /** Controlled value; omit for uncontrolled (recommended for wedge scanning). */
  value?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Idle debounce when scanner does not send Enter (default 220ms). */
  debounceMs?: number;
  /** Do not auto-submit scanner input shorter than this length. Useful for devices that send Enter too early. */
  minBarcodeLength?: number;
  /**
   * Called after trim. Return `false` to keep the field text (validation failed).
   * Return `true` or `undefined` to clear and refocus after success.
   */
  onBarcodeScanned: (
    barcode: string
  ) => boolean | void | Promise<boolean | void>;
  onError?: (message: string, error?: unknown) => void;
  disabled?: boolean;
  /** Mirror uncontrolled text changes when needed (optional). */
  onChangeText?: (text: string) => void;
  /** Layout */
  containerStyle?: object;
  inputStyle?: object;
  actionsContainerStyle?: object;
  submitButtonStyle?: object;
  submitTextStyle?: object;
  /** Keep false for handheld-scanner flows where focus should not open soft keyboard. */
  showSoftInputOnFocus?: boolean;
  /** Optional manual keyboard button for scanner-first flows. */
  showKeyboardButton?: boolean;
  keyboardButtonStyle?: object;
  keyboardButtonTextStyle?: object;
  keyboardButtonLabel?: string;
  /** Label for the manual submit control (default "Submit"). */
  submitLabel?: string;
};

export type BarcodeInputHandle = {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  /** Last raw value from `onChangeText` (for optional manual Submit next to the field). */
  getLastText: () => string;
};

/** Idle time after last character before auto-submit (no Enter from scanner). */
const DEFAULT_DEBOUNCE_MS = 180;

/** Some Android wedges deliver the same scan twice in one string before the field clears. */
function dedupeRepeatedPayload(s: string): string {
  const len = s.length;
  if (len >= 8 && len % 2 === 0) {
    const half = len / 2;
    const a = s.slice(0, half);
    const b = s.slice(half);
    if (a === b) return a;
  }
  return s;
}

/**
 * Stable barcode field for Android wedge scanners + soft keyboard on focus.
 * - Tapping the field shows the soft keyboard for manual entry; wedge input still works.
 * - Submit: accepts current text like Enter / idle submit (for manual backup).
 */
export const BarcodeInput = forwardRef<BarcodeInputHandle, BarcodeInputProps>(
  function BarcodeInput(
    {
      value: controlledValue,
      placeholder = "Scan or enter barcode",
      autoFocus = false,
      debounceMs = DEFAULT_DEBOUNCE_MS,
      minBarcodeLength = 1,
      onBarcodeScanned,
      onError,
      disabled = false,
      onChangeText,
      containerStyle,
      inputStyle,
      actionsContainerStyle,
      submitButtonStyle,
      submitTextStyle,
      showSoftInputOnFocus = true,
      showKeyboardButton = false,
      keyboardButtonStyle,
      keyboardButtonTextStyle,
      keyboardButtonLabel = "Keyboard",
      submitLabel = "Submit",
    },
    ref
  ) {
    const inputRef = useRef<TextInput>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestTextRef = useRef("");
    const [internalText, setInternalText] = useState("");
    const [softKeyboardEnabled, setSoftKeyboardEnabled] = useState(
      showSoftInputOnFocus
    );
    const isControlled = controlledValue !== undefined;
    const text = isControlled ? controlledValue : internalText;

    /** Sync from state for display; see handleChangeText for immediate native sync (submit/Enter). */
    latestTextRef.current = text;

    /** Remount TextInput after a good read so Android cannot re-apply a stale native buffer via onChangeText. */
    const [inputInstanceKey, setInputInstanceKey] = useState(0);

    /**
     * While `onBarcodeScanned` is async, a second wedge scan can arrive — without a queue
     * the early return left text stuck in the field (looked like Enter never fired).
     */
    const commitLockRef = useRef(false);
    const pendingBarcodeRef = useRef<string | null>(null);
    const manualKeyboardRequestRef = useRef(false);
    /** Payload currently being processed (guards duplicate \n path + onSubmitEditing). */
    const inFlightPayloadRef = useRef<string | null>(null);
    const lastClosedPayloadRef = useRef<{ payload: string; at: number }>({
      payload: "",
      at: 0,
    });

    const setText = useCallback(
      (next: string) => {
        if (!isControlled) setInternalText(next);
        onChangeText?.(next);
      },
      [isControlled, onChangeText]
    );

    /** Forces RN + native editor to drop buffered text (some wedges leave junk visible). */
    const flushInputClear = useCallback(() => {
      setText("");
      latestTextRef.current = "";
      inputRef.current?.setNativeProps?.({ text: "" });
      requestAnimationFrame(() => {
        inputRef.current?.setNativeProps?.({ text: "" });
      });
    }, [setText]);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      clear: () => flushInputClear(),
      getLastText: () => latestTextRef.current,
    }));

    const processBarcode = useCallback(
      async (raw: string) => {
        const cleaned = dedupeRepeatedPayload(
          raw.replace(/[\r\n\t\u0000]+/g, "").trim()
        );
        if (!cleaned || disabled) return;

        if (commitLockRef.current) {
          if (cleaned === inFlightPayloadRef.current) {
            flushInputClear();
            return;
          }
          pendingBarcodeRef.current = cleaned;
          return;
        }

        commitLockRef.current = true;
        inFlightPayloadRef.current = cleaned;

        // Clear immediately so the box does not sit full during async work and Android
        // cannot append a second copy into the native buffer before React catches up.
        flushInputClear();

        try {
          const outcome = await Promise.resolve(onBarcodeScanned(cleaned));
          if (outcome === false) {
            setText(cleaned);
            latestTextRef.current = cleaned;
            requestAnimationFrame(() => {
              inputRef.current?.setNativeProps?.({ text: cleaned });
            });
            return;
          }
          lastClosedPayloadRef.current = { payload: cleaned, at: Date.now() };
          setInputInstanceKey((k) => k + 1);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : String(err ?? "Unknown error");
          onError?.(message, err);
          setText(cleaned);
          latestTextRef.current = cleaned;
          requestAnimationFrame(() => {
            inputRef.current?.setNativeProps?.({ text: cleaned });
            inputRef.current?.focus();
          });
        } finally {
          commitLockRef.current = false;
          inFlightPayloadRef.current = null;

          const queued = pendingBarcodeRef.current;
          pendingBarcodeRef.current = null;
          if (queued?.trim()) {
            setTimeout(() => {
              void processBarcode(queued);
            }, 0);
          }
        }
      },
      [disabled, onBarcodeScanned, onError, flushInputClear, setText]
    );

    const timerRefMutable = timerRef as React.MutableRefObject<
      ReturnType<typeof setTimeout> | null
    >;

    useEffect(() => {
      if (showSoftInputOnFocus) {
        setSoftKeyboardEnabled(true);
        return;
      }

      setSoftKeyboardEnabled(false);
    }, [showSoftInputOnFocus]);

    const handleChangeText = useCallback(
      (next: string) => {
        // Must mirror native text immediately — onSubmitEditing/onKeyPress often run before the next render,
        // so latestTextRef cannot rely on `text` state alone (fixes empty submit on 2nd scan / Enter).
        latestTextRef.current = next;

        const cleanedNext = dedupeRepeatedPayload(
          next.replace(/[\r\n\t\u0000]+/g, "").trim()
        );

        // Native layer often echoes the previous scan back through onChangeText after we cleared
        // React state — ignore until lock lifts or payload differs (new scan).
        const inflight = inFlightPayloadRef.current;
        if (commitLockRef.current && inflight && cleanedNext === inflight) {
          flushInputClear();
          return;
        }

        if (/[\r\n\t]/.test(next) && cleanedNext.length > 0 && cleanedNext.length < minBarcodeLength) {
          setText(cleanedNext);
          clearScannerTimer(timerRefMutable);
          timerRefMutable.current = setTimeout(() => {
            timerRefMutable.current = null;
            const latest = latestTextRef.current.replace(/[\r\n\t\u0000]+/g, "").trim();
            if (latest.length >= minBarcodeLength) {
              setText("");
              void processBarcode(latest);
            }
          }, debounceMs);
          return;
        }

        onScannerTextChange(
          next,
          setText,
          timerRefMutable,
          (cleaned) => {
            void processBarcode(cleaned);
          },
          { delayMs: debounceMs, autoIdleSubmit: true }
        );
      },
      [debounceMs, minBarcodeLength, processBarcode, setText, flushInputClear]
    );

    useLayoutEffect(() => {
      if (inputInstanceKey === 0) return;
      inputRef.current?.focus();
    }, [inputInstanceKey]);

    const onSubmitEditing = useCallback(
      (_e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
        clearScannerTimer(timerRefMutable);
        void processBarcode(latestTextRef.current);
      },
      [processBarcode]
    );

    const onKeyPress = useCallback(
      (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const key = e.nativeEvent.key;
        if (key === "Enter" || key === "\n" || key === "\r") {
          const latest = latestTextRef.current.replace(/[\r\n\t\u0000]+/g, "").trim();
          if (latest.length > 0 && latest.length < minBarcodeLength) {
            clearScannerTimer(timerRefMutable);
            timerRefMutable.current = setTimeout(() => {
              timerRefMutable.current = null;
              const delayedLatest = latestTextRef.current.replace(/[\r\n\t\u0000]+/g, "").trim();
              if (delayedLatest.length >= minBarcodeLength) {
                void processBarcode(delayedLatest);
              }
            }, debounceMs);
            return;
          }
          clearScannerTimer(timerRefMutable);
          void processBarcode(latestTextRef.current);
        }
      },
      [debounceMs, minBarcodeLength, processBarcode]
    );

    const handleManualSubmit = useCallback(() => {
      if (disabled) return;
      clearScannerTimer(timerRefMutable);
      void processBarcode(latestTextRef.current);
    }, [disabled, processBarcode]);

    const handleEnableKeyboard = useCallback(() => {
      if (disabled) return;
      manualKeyboardRequestRef.current = true;
      setSoftKeyboardEnabled(true);
      inputRef.current?.blur();
      requestAnimationFrame(() => inputRef.current?.focus());
    }, [disabled]);

    const handleInputFocus = useCallback(() => {
      if (showSoftInputOnFocus || manualKeyboardRequestRef.current) return;
      setSoftKeyboardEnabled(false);
    }, [showSoftInputOnFocus]);

    const handleInputPressIn = useCallback(() => {
      if (showSoftInputOnFocus || manualKeyboardRequestRef.current) return;
      setSoftKeyboardEnabled(false);
    }, [showSoftInputOnFocus]);

    const handleInputBlur = useCallback(() => {
      manualKeyboardRequestRef.current = false;
      if (!showSoftInputOnFocus) {
        setSoftKeyboardEnabled(false);
      }
    }, [showSoftInputOnFocus]);

    useEffect(() => {
      return () => clearScannerTimer(timerRefMutable);
    }, []);

    return (
      <View style={[styles.row, containerStyle]}>
        <TextInput
          key={inputInstanceKey}
          ref={inputRef}
          style={[styles.input, inputStyle]}
          value={text}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor="#999"
          editable={!disabled}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="done"
          showSoftInputOnFocus={softKeyboardEnabled}
          keyboardType="default"
          onFocus={handleInputFocus}
          onPressIn={handleInputPressIn}
          onBlur={handleInputBlur}
          onSubmitEditing={onSubmitEditing}
          onKeyPress={onKeyPress}
          {...(Platform.OS === "ios" ||
          (Platform.OS === "android" && Number(Platform.Version) >= 21)
            ? // Keeps single-line submit without inserting newline on some OEM keyboards
              ({ submitBehavior: "submit" } as object)
            : {})}
        />

        <View style={[styles.actions, actionsContainerStyle]}>
          {showKeyboardButton ? (
            <TouchableOpacity
              style={[styles.iconBtn, styles.keyboardBtn, keyboardButtonStyle]}
              onPress={handleEnableKeyboard}
              accessibilityLabel="Enable manual keyboard"
              disabled={disabled}
            >
              <Text style={[styles.keyboardBtnText, keyboardButtonTextStyle]}>
                {keyboardButtonLabel}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Manual submit if wedge idle-debounce did not fire or Enter was not sent */}
          <TouchableOpacity
            style={[styles.iconBtn, styles.submitBtn, submitButtonStyle]}
            onPress={handleManualSubmit}
            accessibilityLabel="Submit barcode"
            disabled={disabled}
          >
            <Text style={[styles.submitBtnText, submitTextStyle]}>
              {submitLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#BBDEFB",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 18,
    fontWeight: "500",
    color: "#333",
    backgroundColor: "#fff",
    minHeight: 60,
  },
  iconBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  submitBtn: {
    minWidth: 72,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  keyboardBtn: {
    minWidth: 84,
    paddingHorizontal: 10,
    flexShrink: 0,
    backgroundColor: "#E3F2FD",
    borderColor: "#BBDEFB",
  },
  keyboardBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1976D2",
  },
});
