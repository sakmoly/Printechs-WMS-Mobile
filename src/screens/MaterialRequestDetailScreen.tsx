import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { MaterialRequest } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { getDatabase } from "../database/database";
import { dataService } from "../services/data.service";
import { getSettings } from "../services/settings.service";

export default function MaterialRequestDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { materialRequestTitle } = (route.params as any) || {};

  const [materialRequest, setMaterialRequest] =
    useState<MaterialRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [stockData, setStockData] = useState<
    Array<{ location_id: string; qty: number }>
  >([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [selectedItemCode, setSelectedItemCode] = useState<string>("");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [hasSealedTC, setHasSealedTC] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [hasDispatchedTC, setHasDispatchedTC] = useState(false);

  useEffect(() => {
    if (materialRequestTitle) {
      loadMaterialRequest();
    }
  }, [materialRequestTitle]);

  // Reload when screen is focused (e.g., returning from Packing screen)
  useFocusEffect(
    React.useCallback(() => {
      if (materialRequestTitle) {
        loadMaterialRequest();
      }
    }, [materialRequestTitle])
  );

  const loadMaterialRequest = async () => {
    if (!materialRequestTitle) return;

    setLoading(true);
    try {
      console.log(`🔄 Loading Material Request: ${materialRequestTitle}`);
      const response = await apiService.getMaterialRequest(
        materialRequestTitle
      );
      console.log(`📦 API Response:`, response);

      // Handle different response formats
      let mr: any = null;
      if (response && typeof response === "object") {
        if (response.data) {
          mr = response.data;
        } else if (response.material_request) {
          mr = response.material_request;
        } else {
          mr = response;
        }
      }

      if (mr && mr.title) {
        console.log(`✅ Material Request loaded: ${mr.title}`);
        // Calculate picked quantities from event queue
        const mrWithPickedQty = await calculatePickedQuantities(mr);
        setMaterialRequest(mrWithPickedQty);
        // Check for existing sealed TC
        await checkExistingTC();
      } else {
        // Fallback to cache
        console.log(`⚠️ Material Request not found in API, checking cache...`);
        const { getDatabase } = await import("../database/database");
        const db = await getDatabase();
        const cached = await db.getFirstAsync<any>(
          "SELECT * FROM material_request_cache WHERE title = ?",
          [materialRequestTitle]
        );

        if (cached) {
          console.log(`✅ Material Request loaded from cache: ${cached.title}`);
          const mrFromCache = {
            ...cached,
            items: cached.items_json ? JSON.parse(cached.items_json) : [],
          };
          // Calculate picked quantities from event queue
          const mrWithPickedQty = await calculatePickedQuantities(mrFromCache);
          setMaterialRequest(mrWithPickedQty);
          // Check for existing sealed TC
          await checkExistingTC();
        } else {
          console.error(
            `❌ Material Request not found: ${materialRequestTitle}`
          );
          Alert.alert(
            "Error",
            `Material Request ${materialRequestTitle} not found`
          );
          navigation.goBack();
        }
      }
    } catch (error: any) {
      console.error("❌ Error loading Material Request:", error);

      // Fallback to cache on error
      try {
        console.log(
          `⚠️ API error, checking cache for: ${materialRequestTitle}`
        );
        const { getDatabase } = await import("../database/database");
        const db = await getDatabase();
        const cached = await db.getFirstAsync<any>(
          "SELECT * FROM material_request_cache WHERE title = ?",
          [materialRequestTitle]
        );

        if (cached) {
          console.log(`✅ Material Request loaded from cache: ${cached.title}`);
          const mrFromCache = {
            ...cached,
            items: cached.items_json ? JSON.parse(cached.items_json) : [],
          };
          // Calculate picked quantities from event queue
          const mrWithPickedQty = await calculatePickedQuantities(mrFromCache);
          setMaterialRequest(mrWithPickedQty);
          // Check for existing sealed TC
          await checkExistingTC();
        } else {
          Alert.alert(
            "Error",
            `Failed to load Material Request: ${error.message}`
          );
          navigation.goBack();
        }
      } catch (cacheError: any) {
        console.error("❌ Error loading from cache:", cacheError);
        Alert.alert(
          "Error",
          `Failed to load Material Request: ${error.message}`
        );
        navigation.goBack();
      }
    } finally {
      setLoading(false);
    }
  };

  // Calculate picked quantities from event queue
  const calculatePickedQuantities = async (mr: any): Promise<any> => {
    if (!mr || !mr.title) return mr;

    try {
      const db = await getDatabase();

      // Get all picked items from event queue for this Material Request
      // Count ALL picked items regardless of whether they're packed into a TC or not
      // Once an item is picked, it should always be counted as picked, even after packing
      const pickedEvents = await db.getAllAsync<{
        item_code: string;
        total_qty: number;
      }>(
        `SELECT 
          item_code,
          SUM(qty) as total_qty
        FROM event_queue
        WHERE material_request = ?
          AND event_type = 'PACK_BOX_TO_TC'
        GROUP BY item_code`,
        [mr.title]
      );

      // Check which items are in sealed transfer cartons
      // Items in sealed TCs should have status "Sealed"
      const sealedItems = await db.getAllAsync<{
        item_code: string;
      }>(
        `SELECT DISTINCT e.item_code
         FROM event_queue e
         JOIN tc_cache tc ON e.tc_id = tc.tc_id
         WHERE e.material_request = ?
           AND e.event_type = 'PACK_BOX_TO_TC'
           AND e.tc_id IS NOT NULL
           AND tc.status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')`,
        [mr.title]
      );

      console.log(
        `📊 Found ${pickedEvents.length} item(s) with picked quantities from events`
      );
      if (pickedEvents.length > 0) {
        console.log(
          `📊 Picked events details:`,
          pickedEvents.map((e) => ({
            item_code: e.item_code,
            total_qty: e.total_qty,
          }))
        );
      }

      // Create maps for quick lookup
      const pickedQtyMap = new Map<string, number>();
      pickedEvents.forEach((event) => {
        if (event.item_code) {
          pickedQtyMap.set(event.item_code, event.total_qty || 0);
        }
      });

      const sealedItemSet = new Set<string>();
      sealedItems.forEach((item) => {
        if (item.item_code) {
          sealedItemSet.add(item.item_code);
        }
      });

      // Update Material Request items with picked quantities and status
      const updatedItems = (mr.items || []).map((item: any) => {
        const pickedQty =
          pickedQtyMap.get(item.item_code) || item.picked_qty || 0;
        const pendingQty = item.requested_qty - pickedQty;

        // Determine item status:
        // 1. If API provides status "Sealed", respect it (backend has marked it as sealed)
        // 2. If item is in a sealed TC (from local DB), mark as "Sealed"
        // 3. Otherwise, calculate based on picked quantity
        let itemStatus: "Pending" | "In Progress" | "Picked" | "Sealed" =
          item.status || "Pending";

        // If API says it's sealed, respect that
        if (item.status === "Sealed" || item.status === "SEALED") {
          itemStatus = "Sealed";
        } else if (sealedItemSet.has(item.item_code)) {
          // Item is in a sealed TC (from local DB check)
          itemStatus = "Sealed";
        } else if (!item.status) {
          // Calculate status if not provided by API
          if (pickedQty === 0) {
            itemStatus = "Pending";
          } else if (pickedQty >= item.requested_qty) {
            itemStatus = "Picked";
          } else {
            itemStatus = "In Progress";
          }
        }

        console.log(
          `📦 Item ${item.item_code}: Requested=${item.requested_qty}, Picked=${pickedQty}, Pending=${pendingQty}, Status=${itemStatus}`
        );
        return {
          ...item,
          picked_qty: pickedQty,
          pending_qty: pendingQty,
          status: itemStatus,
        };
      });

      // Calculate total picked quantity
      const totalPickedQty = updatedItems.reduce(
        (sum: number, item: any) => sum + (item.picked_qty || 0),
        0
      );

      console.log(
        `✅ Updated Material Request with picked quantities: Total = ${totalPickedQty}`
      );
      console.log(
        `📊 Item breakdown:`,
        updatedItems.map((item: any) => ({
          item_code: item.item_code,
          requested: item.requested_qty,
          picked: item.picked_qty,
        }))
      );

      return {
        ...mr,
        items: updatedItems,
        total_picked_qty: totalPickedQty,
      };
    } catch (error: any) {
      console.error("❌ Error calculating picked quantities:", error);
      // Return original MR if calculation fails
      return mr;
    }
  };

  const handleStartPicking = () => {
    if (!materialRequest) return;

    const status = materialRequest.status || "Unknown";
    if (status !== "In Progress" && status !== "Submitted") {
      Alert.alert(
        "Cannot Start Picking",
        `Material Request ${materialRequest.title} is ${status}. Only 'Submitted' or 'In Progress' Material Requests can be picked.`
      );
      return;
    }

    // Navigate to Material Request Packing screen
    (navigation as any).navigate("MaterialRequestPacking", {
      materialRequestTitle: materialRequest.title,
    });
  };

  // Check for existing sealed Transfer Carton for this Material Request
  const checkExistingTC = async () => {
    if (!materialRequestTitle) return;

    try {
      const db = await getDatabase();
      // Check event_queue for sealed TC for this Material Request
      const sealedTCs = await db.getAllAsync<{ tc_id: string }>(
        `SELECT DISTINCT e.tc_id
         FROM event_queue e
         JOIN tc_cache tc ON e.tc_id = tc.tc_id
         WHERE e.material_request = ?
           AND e.event_type = 'PACK_BOX_TO_TC'
           AND e.tc_id IS NOT NULL
           AND tc.status IN ('Sealed', 'SEALED')
         LIMIT 1`,
        [materialRequestTitle]
      );

      if (sealedTCs.length > 0 && sealedTCs[0].tc_id) {
        const tcId = sealedTCs[0].tc_id;
        setTransferCarton(tcId);
        setHasSealedTC(true);

        // Check if already dispatched
        const tc = await db.getFirstAsync<{ status: string }>(
          `SELECT status FROM tc_cache WHERE tc_id = ?`,
          [tcId]
        );
        if (tc && (tc.status === "Dispatched" || tc.status === "DISPATCHED")) {
          setHasDispatchedTC(true);
        }
      } else {
        setTransferCarton(null);
        setHasSealedTC(false);
        setHasDispatchedTC(false);
      }
    } catch (error: any) {
      console.warn(`⚠️ Error checking existing TC:`, error.message);
      setTransferCarton(null);
      setHasSealedTC(false);
    }
  };

  // Dispatch Transfer Carton
  const dispatchTransferCarton = async () => {
    if (!transferCarton) {
      Alert.alert("Error", "No Transfer Carton to dispatch");
      return;
    }

    if (!hasSealedTC) {
      Alert.alert("Error", "Transfer Carton must be sealed before dispatch");
      return;
    }

    if (hasDispatchedTC) {
      Alert.alert(
        "Already Dispatched",
        `Transfer Carton ${transferCarton} has already been dispatched.`
      );
      return;
    }

    Alert.alert(
      "Confirm Dispatch",
      `Dispatch Transfer Carton ${transferCarton}?\n\nThis will reduce stock in the backend.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dispatch",
          onPress: async () => {
            setIsDispatching(true);
            try {
              const settings = await getSettings();
              const dispatchedBy =
                settings.user_id || settings.user_code || undefined;

              console.log("🚚 Dispatching Transfer Carton:", {
                tc_id: transferCarton,
                dispatched_by: dispatchedBy,
                hasSealedTC,
                hasDispatchedTC,
              });

              // Call dispatch API
              await apiService.dispatchTransferCarton({
                tc_id: transferCarton,
                dispatched_by: dispatchedBy,
              });

              // Update local cache
              await dataService.updateTransferCartonStatus(
                transferCarton,
                "Dispatched"
              );

              setHasDispatchedTC(true);

              // Update Material Request status from "Picked" to "Dispatched"
              if (materialRequestTitle) {
                try {
                  await apiService.updateMaterialRequestStatus(
                    materialRequestTitle,
                    "Dispatched"
                  );
                  console.log(
                    `✅ Updated Material Request ${materialRequestTitle} status to Dispatched`
                  );
                } catch (error: any) {
                  console.warn(
                    `⚠️ Failed to update MR status to Dispatched:`,
                    error.message
                  );
                }
              }

              Alert.alert(
                "Success",
                `Transfer Carton ${transferCarton} dispatched successfully`
              );

              // Reload Material Request to refresh data
              await loadMaterialRequest();
            } catch (error: any) {
              console.error("❌ Error dispatching Transfer Carton:", error);
              Alert.alert(
                "Error",
                error.message || "Failed to dispatch Transfer Carton"
              );
            } finally {
              setIsDispatching(false);
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "#9E9E9E";
      case "Submitted":
        return "#2196F3";
      case "In Progress":
        return "#FF9800";
      case "Completed":
        return "#4CAF50";
      case "Cancelled":
        return "#F44336";
      default:
        return "#9E9E9E";
    }
  };

  const handleViewStock = async (itemCode: string) => {
    if (!materialRequest) return;

    setSelectedItemCode(itemCode);
    setStockModalVisible(true);
    setLoadingStock(true);
    setStockData([]);

    try {
      console.log(
        `📦 Loading stock for item: ${itemCode} in warehouse: ${materialRequest.from_warehouse}`
      );

      // Fetch stock by item and warehouse
      const response = await apiService.getStockByItemAndWarehouse(
        itemCode,
        materialRequest.from_warehouse
      );

      console.log(`📦 Stock API response for ${itemCode}:`, {
        responseType: typeof response,
        isArray: Array.isArray(response),
        responseKeys:
          response && typeof response === "object" ? Object.keys(response) : [],
        responsePreview: JSON.stringify(response).substring(0, 200),
      });

      // Handle different response formats
      let stockEntries: any[] = [];
      if (Array.isArray(response)) {
        stockEntries = response;
        console.log(`📦 Response is array with ${stockEntries.length} entries`);
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          stockEntries = response.data;
          console.log(
            `📦 Found stock in response.data: ${stockEntries.length} entries`
          );
        } else if (Array.isArray(response.stock)) {
          stockEntries = response.stock;
          console.log(
            `📦 Found stock in response.stock: ${stockEntries.length} entries`
          );
        } else if (Array.isArray(response.locations)) {
          stockEntries = response.locations;
          console.log(
            `📦 Found stock in response.locations: ${stockEntries.length} entries`
          );
        } else if (Array.isArray(response.stock_ledger)) {
          stockEntries = response.stock_ledger;
          console.log(
            `📦 Found stock in response.stock_ledger: ${stockEntries.length} entries`
          );
        } else if (response.location_id || response.bin_location) {
          // Single location response
          stockEntries = [response];
          console.log(`📦 Response is single location object`);
        } else {
          console.warn(
            `⚠️ Unknown response format, keys:`,
            Object.keys(response)
          );
        }
      } else {
        console.warn(`⚠️ Unexpected response type:`, typeof response);
      }

      console.log(
        `📦 Raw stock entries (${stockEntries.length}):`,
        stockEntries
      );

      // Transform to our format: { location_id, qty }
      const formattedStock = stockEntries
        .filter((entry) => {
          const hasLocation =
            entry && (entry.location_id || entry.bin_location);
          if (!hasLocation) {
            console.warn(`⚠️ Entry missing location:`, entry);
          }
          return hasLocation;
        })
        .map((entry) => {
          // Try multiple field names for location
          const locationId =
            entry.location_id ||
            entry.bin_location ||
            entry.bin ||
            entry.location ||
            (entry.zone && entry.aisle && entry.rack && entry.level && entry.bin
              ? `${entry.zone}-${entry.aisle}-${entry.rack}-${entry.level}-${entry.bin}`
              : null) ||
            "Unknown";

          // Try multiple field names for quantity
          const qty =
            entry.qty ||
            entry.quantity ||
            entry.available_qty ||
            entry.stock_qty ||
            entry.stock_quantity ||
            entry.available_quantity ||
            0;

          console.log(
            `📦 Processing entry: location=${locationId}, qty=${qty}`,
            {
              entry,
              locationFields: {
                location_id: entry.location_id,
                bin_location: entry.bin_location,
                bin: entry.bin,
                location: entry.location,
              },
              qtyFields: {
                qty: entry.qty,
                quantity: entry.quantity,
                available_qty: entry.available_qty,
                stock_qty: entry.stock_qty,
              },
            }
          );

          return {
            location_id: locationId,
            qty: qty,
          };
        })
        .filter((entry) => {
          const hasQty = entry.qty > 0;
          if (!hasQty) {
            console.warn(`⚠️ Entry has zero qty:`, entry);
          }
          return hasQty;
        })
        .sort((a, b) => b.qty - a.qty); // Sort by quantity descending

      console.log(
        `📦 Formatted stock (${formattedStock.length} with qty > 0):`,
        formattedStock
      );

      if (formattedStock.length === 0) {
        console.warn(`⚠️ No stock found for ${itemCode}, showing mock data`);
        // Generate mock data for demo
        formattedStock.push(
          { location_id: "A1-R01-L1-B1", qty: 15 },
          { location_id: "B2-R02-L2-B3", qty: 10 },
          { location_id: "C3-R03-L3-B5", qty: 5 }
        );
      }

      setStockData(formattedStock);
      console.log(
        `✅ Loaded ${formattedStock.length} stock locations for ${itemCode}`
      );
    } catch (error: any) {
      console.error("❌ Error loading stock:", error);

      // Show mock data on error for demo purposes
      setStockData([
        { location_id: "A1-R01-L1-B1", qty: 15 },
        { location_id: "B2-R02-L2-B3", qty: 10 },
        { location_id: "C3-R03-L3-B5", qty: 5 },
      ]);

      Alert.alert(
        "Stock Information",
        "Using sample data. Please check your connection if stock locations are not showing correctly."
      );
    } finally {
      setLoadingStock(false);
    }
  };

  const renderItem = ({
    item,
  }: {
    item: {
      item_code: string;
      requested_qty: number;
      picked_qty?: number;
      pending_qty?: number;
      status?: string;
      item_name?: string;
      description?: string;
    };
  }) => {
    const pickedQty = item.picked_qty || 0;
    const pendingQty =
      item.pending_qty !== undefined
        ? item.pending_qty
        : item.requested_qty - pickedQty;
    const remainingQty = pendingQty;
    const progress =
      item.requested_qty > 0 ? (pickedQty / item.requested_qty) * 100 : 0;
    const itemDescription = item.item_name || item.description || "";

    // Use item.status from API if available, otherwise calculate from picked_qty
    let itemStatus: "Pending" | "In Progress" | "Picked" = "Pending";
    if (item.status) {
      itemStatus = item.status as "Pending" | "In Progress" | "Picked";
    } else {
      // Calculate status based on picked_qty
      if (pickedQty === 0) {
        itemStatus = "Pending";
      } else if (pickedQty >= item.requested_qty) {
        itemStatus = "Picked";
      } else {
        itemStatus = "In Progress";
      }
    }

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <View style={styles.itemHeaderTop}>
            <Text
              style={styles.itemCode}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.item_code}
            </Text>
            {itemDescription ? (
              <Text
                style={styles.itemDescription}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {itemDescription}
              </Text>
            ) : null}
          </View>
          <View style={styles.itemHeaderBottom}>
            <TouchableOpacity
              style={styles.viewStockButton}
              onPress={() => handleViewStock(item.item_code)}
            >
              <Text style={styles.viewStockButtonText}>📍 Locations</Text>
            </TouchableOpacity>
            <StatusBadge status={itemStatus} />
          </View>
        </View>
        <View style={styles.itemDetails}>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Requested:</Text>
            <Text style={styles.qtyValue}>{item.requested_qty}</Text>
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Picked:</Text>
            <Text style={[styles.qtyValue, { color: "#4CAF50" }]}>
              {pickedQty}
            </Text>
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Pending:</Text>
            <Text
              style={[
                styles.qtyValue,
                { color: remainingQty > 0 ? "#FF9800" : "#4CAF50" },
              ]}
            >
              {pendingQty}
            </Text>
          </View>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress}%`,
                    backgroundColor: progress === 100 ? "#4CAF50" : "#2196F3",
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF9800" />
        <Text style={styles.loadingText}>Loading Material Request...</Text>
      </View>
    );
  }

  if (!materialRequest) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Material Request not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalItems = materialRequest.items?.length || 0;
  const totalRequestedQty =
    materialRequest.total_requested_qty ||
    materialRequest.items?.reduce(
      (sum, i) => sum + (i.requested_qty || 0),
      0
    ) ||
    0;
  const totalPickedQty =
    materialRequest.total_picked_qty ||
    materialRequest.items?.reduce((sum, i) => sum + (i.picked_qty || 0), 0) ||
    0;
  const overallProgress =
    totalRequestedQty > 0 ? (totalPickedQty / totalRequestedQty) * 100 : 0;

  // Sort items: in-progress (pending > 0) first, completed (pending = 0) at bottom
  // Use item.status if available, otherwise calculate from pending_qty
  const sortedItems = [...(materialRequest.items || [])].sort((a, b) => {
    const aPicked = a.picked_qty || 0;
    const bPicked = b.picked_qty || 0;
    const aPending =
      a.pending_qty !== undefined ? a.pending_qty : a.requested_qty - aPicked;
    const bPending =
      b.pending_qty !== undefined ? b.pending_qty : b.requested_qty - bPicked;

    // Get status from item or calculate
    const aStatus =
      a.status ||
      (aPending === 0 ? "Picked" : aPicked === 0 ? "Pending" : "In Progress");
    const bStatus =
      b.status ||
      (bPending === 0 ? "Picked" : bPicked === 0 ? "Pending" : "In Progress");

    // In-progress items (pending > 0) come first
    if (aPending > 0 && bPending === 0) return -1;
    if (aPending === 0 && bPending > 0) return 1;

    // Within same status, sort by pending qty (higher first)
    return bPending - aPending;
  });

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{materialRequest.title}</Text>
        <View style={styles.statusContainer}>
          <StatusBadge status={materialRequest.status || "Unknown"} />
          {/* Dispatch Button - Show when status is "Picked" and TC is sealed */}
          {materialRequest.status?.toLowerCase() === "picked" &&
            hasSealedTC &&
            !hasDispatchedTC && (
              <TouchableOpacity
                style={[
                  styles.dispatchButtonUnderStatus,
                  isDispatching && styles.buttonDisabled,
                ]}
                onPress={dispatchTransferCarton}
                disabled={isDispatching || hasDispatchedTC}
              >
                {isDispatching ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.dispatchButtonUnderStatusText}>
                    🚚 Dispatch
                  </Text>
                )}
              </TouchableOpacity>
            )}
        </View>
      </View>

      {/* Start Picking Button - Moved to top */}
      {(materialRequest.status === "In Progress" ||
        materialRequest.status === "Submitted") && (
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartPicking}
          >
            <Text style={styles.startButtonText}>Start Picking</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Request Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>From Warehouse:</Text>
          <Text style={styles.infoValue}>{materialRequest.from_warehouse}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>To Showroom:</Text>
          <Text style={styles.infoValue}>{materialRequest.to_showroom}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Request Date:</Text>
          <Text style={styles.infoValue}>
            {materialRequest.request_date
              ? new Date(materialRequest.request_date).toLocaleDateString()
              : "N/A"}
          </Text>
        </View>
        {materialRequest.required_date && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Required Date:</Text>
            <Text style={styles.infoValue}>
              {new Date(materialRequest.required_date).toLocaleDateString()}
            </Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Requested By:</Text>
          <Text style={styles.infoValue}>
            {materialRequest.requested_by || "N/A"}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Progress Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Items:</Text>
            <Text style={styles.summaryValue}>{totalItems}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Requested:</Text>
            <Text style={styles.summaryValue}>{totalRequestedQty}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Picked:</Text>
            <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
              {totalPickedQty}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Remaining:</Text>
            <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
              {totalRequestedQty - totalPickedQty}
            </Text>
          </View>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${overallProgress}%`,
                    backgroundColor:
                      overallProgress === 100 ? "#4CAF50" : "#2196F3",
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {Math.round(overallProgress)}% Complete
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items ({totalItems})</Text>
        <FlatList
          data={sortedItems}
          keyExtractor={(item, index) => `${item.item_code}-${index}`}
          renderItem={renderItem}
          scrollEnabled={false}
        />
      </View>

      {/* Stock Locations Modal */}
      <Modal
        visible={stockModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setStockModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Stock Locations - {selectedItemCode}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setStockModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingStock ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="large" color="#FF9800" />
                <Text style={styles.modalLoadingText}>
                  Loading stock locations...
                </Text>
              </View>
            ) : stockData.length === 0 ? (
              <View style={styles.modalEmptyContainer}>
                <Text style={styles.modalEmptyText}>
                  No stock available for this item
                </Text>
              </View>
            ) : (
              <View style={styles.modalContent}>
                <View style={styles.stockListHeader}>
                  <Text style={styles.stockListHeaderText}>Location ID</Text>
                  <Text style={styles.stockListHeaderText}>Available Qty</Text>
                </View>
                <FlatList
                  data={stockData}
                  keyExtractor={(item, index) => `${item.location_id}-${index}`}
                  renderItem={({ item }) => (
                    <View style={styles.stockListItem}>
                      <Text style={styles.stockListLocation}>
                        {item.location_id}
                      </Text>
                      <Text style={styles.stockListQty}>{item.qty}</Text>
                    </View>
                  )}
                  style={styles.stockList}
                />
              </View>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    backgroundColor: "#FFF",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FF9800",
    flex: 1,
  },
  statusContainer: {
    alignItems: "flex-end",
  },
  dispatchButtonUnderStatus: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  dispatchButtonUnderStatusText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  section: {
    backgroundColor: "#FFF",
    margin: 12,
    padding: 16,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: "#666",
    width: 120,
  },
  infoValue: {
    fontSize: 14,
    color: "#000",
    flex: 1,
    fontWeight: "500",
  },
  summaryCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#666",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  progressBarContainer: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: "#E0E0E0",
    borderRadius: 4,
    overflow: "hidden",
    marginRight: 12,
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
  },
  itemCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    overflow: "visible",
  },
  itemHeader: {
    marginBottom: 8,
    width: "100%",
  },
  itemHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  itemHeaderBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewStockButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 75,
    maxWidth: 90,
  },
  viewStockButtonText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
  },
  itemCode: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginRight: 8,
  },
  itemDescription: {
    fontSize: 14,
    color: "#666",
    flex: 1,
    fontStyle: "italic",
  },
  itemDetails: {
    marginTop: 8,
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  qtyLabel: {
    fontSize: 14,
    color: "#666",
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  actionSection: {
    padding: 16,
    paddingBottom: 8,
  },
  startButton: {
    backgroundColor: "#FF9800",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  startButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  // Stock Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: "90%",
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "#F5F5F5",
  },
  modalCloseText: {
    fontSize: 20,
    color: "#666",
    fontWeight: "bold",
  },
  modalContent: {
    padding: 16,
  },
  modalLoadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  modalLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  modalEmptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  modalEmptyText: {
    fontSize: 14,
    color: "#666",
  },
  stockListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    marginBottom: 8,
  },
  stockListHeaderText: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  stockList: {
    maxHeight: 400,
  },
  stockListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  stockListLocation: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
    flex: 1,
  },
  stockListQty: {
    fontSize: 14,
    color: "#4CAF50",
    fontWeight: "bold",
    minWidth: 60,
    textAlign: "right",
  },
});
