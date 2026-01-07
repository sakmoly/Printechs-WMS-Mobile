/**
 * Demo Data Migration
 * Direct SQL INSERT statements for demo data
 * This ensures consistent demo data across all environments
 */

export const INSERT_DEMO_DATA_SQL = `
-- Clear existing demo data for ASN-00045
DELETE FROM asn_carton_map WHERE asn_no = 'ASN-00045';
DELETE FROM transfer_order_cache WHERE asn_no = 'ASN-00045';
DELETE FROM box_cache WHERE asn_no = 'ASN-00045';
DELETE FROM asn_cache WHERE asn_no = 'ASN-00045';
DELETE FROM carton_status_cache WHERE asn_no = 'ASN-00045';

-- Insert ASN Cache
INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) 
VALUES ('ASN-00045', '{"asn_no":"ASN-00045","transfer_order":"TO-00012","dock":"DOCK-01"}', datetime('now'));

-- Insert ASN Carton Map
-- CTN-001: ITEM-0001 (2), ITEM-0002 (1)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-001', 'ITEM-0001', 2);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-001', 'ITEM-0002', 1);

-- CTN-002: ITEM-0001 (1), ITEM-0003 (2)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-002', 'ITEM-0001', 1);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-002', 'ITEM-0003', 2);

-- CTN-003: ITEM-0004 (2), ITEM-0006 (1)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-003', 'ITEM-0004', 2);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-003', 'ITEM-0006', 1);

-- CTN-004: ITEM-0002 (2), ITEM-0005 (1)
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-004', 'ITEM-0002', 2);
INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES ('ASN-00045', 'CTN-004', 'ITEM-0005', 1);

-- Insert Transfer Order Allocations
-- SR-01: ITEM-0001 (2), ITEM-0002 (1), ITEM-0004 (1)
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-01', 'ITEM-0001', 2);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-01', 'ITEM-0002', 1);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-01', 'ITEM-0004', 1);

-- SR-02: ITEM-0001 (1), ITEM-0003 (2), ITEM-0006 (1)
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-02', 'ITEM-0001', 1);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-02', 'ITEM-0003', 2);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-02', 'ITEM-0006', 1);

-- SR-03: ITEM-0002 (2), ITEM-0004 (1), ITEM-0005 (1)
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-03', 'ITEM-0002', 2);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-03', 'ITEM-0004', 1);
INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES ('TO-00012', 'ASN-00045', 'SR-03', 'ITEM-0005', 1);

-- Insert Box Cache
INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES ('BOX-SR01-001', 'ASN-00045', 'TO-00012', 'SR-01', 'Open', datetime('now'));
INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES ('BOX-SR02-001', 'ASN-00045', 'TO-00012', 'SR-02', 'Open', datetime('now'));
INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES ('BOX-SR03-001', 'ASN-00045', 'TO-00012', 'SR-03', 'Open', datetime('now'));

-- Insert Carton Status Cache (all Pending initially)
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-001', 'Pending', datetime('now'));
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-002', 'Pending', datetime('now'));
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-003', 'Pending', datetime('now'));
INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES ('ASN-00045', '', 'CTN-004', 'Pending', datetime('now'));
`;

/**
 * Execute demo data migration
 * This directly executes SQL statements to insert demo data
 * Uses runAsync for each statement for reliability
 */
export const executeDemoDataMigration = async () => {
  const { getDatabase } = await import("./database");
  const db = await getDatabase();

  console.log(
    "📦 Executing demo data migration (direct SQL INSERT statements)..."
  );

  try {
    const normalizedASN = "ASN-00045";
    const toNo = "TO-00012";
    const now = new Date().toISOString();

    // Clear existing demo data
    console.log("🗑️ Clearing old demo data...");
    await db.runAsync("DELETE FROM asn_carton_map WHERE asn_no = ?", [
      normalizedASN,
    ]);
    await db.runAsync("DELETE FROM transfer_order_cache WHERE asn_no = ?", [
      normalizedASN,
    ]);
    await db.runAsync("DELETE FROM box_cache WHERE asn_no = ?", [
      normalizedASN,
    ]);
    await db.runAsync("DELETE FROM asn_cache WHERE asn_no = ?", [
      normalizedASN,
    ]);

    // Preserve carton statuses that are in progress (InReceiving or Received)
    // Only clear Pending and Unloaded statuses to allow fresh start
    // This prevents losing work in progress when refreshing demo data
    console.log("📋 Preserving in-progress carton statuses...");
    await db.runAsync(
      "DELETE FROM carton_status_cache WHERE asn_no = ? AND status IN (?, ?)",
      [normalizedASN, "Pending", "Unloaded"]
    );

    // Item Master data should be synced from API, not seeded
    console.log(
      "📦 Skipping item master data insertion - should be synced from API"
    );

    // Insert ASN Cache
    console.log("📝 Inserting ASN cache...");
    await db.runAsync(
      "INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) VALUES (?, ?, ?)",
      [
        normalizedASN,
        '{"asn_no":"ASN-00045","transfer_order":"TO-00012","dock":"DOCK-01"}',
        now,
      ]
    );

    // Insert ASN Carton Map - Clear scenario: Some items fully allocated, some partially, some Put Away only
    console.log("📦 Inserting carton map with clear Put Away scenario...");
    const cartonMap = [
      // CTN-001: ITEM-0001 (5), ITEM-0002 (3), ITEM-0007 (2) - ITEM-0007 is Put Away only
      ["CTN-001", "ITEM-0001", 5],
      ["CTN-001", "ITEM-0002", 3],
      ["CTN-001", "ITEM-0007", 2], // Put Away only (no store allocation)
      // CTN-002: ITEM-0001 (2), ITEM-0003 (4), ITEM-0008 (3) - ITEM-0008 is Put Away only
      ["CTN-002", "ITEM-0001", 2],
      ["CTN-002", "ITEM-0003", 4],
      ["CTN-002", "ITEM-0008", 3], // Put Away only (no store allocation)
      // CTN-003: ITEM-0004 (4), ITEM-0006 (2)
      ["CTN-003", "ITEM-0004", 4],
      ["CTN-003", "ITEM-0006", 2],
      // CTN-004: ITEM-0002 (2), ITEM-0005 (3), ITEM-0009 (2) - ITEM-0009 is Put Away only
      ["CTN-004", "ITEM-0002", 2],
      ["CTN-004", "ITEM-0005", 3],
      ["CTN-004", "ITEM-0009", 2], // Put Away only (no store allocation)
    ];

    console.log("📦 Carton mapping (clear Put Away scenario):");
    console.log(
      "  CTN-001: ITEM-0001 (5), ITEM-0002 (3), ITEM-0007 (2) [Put Away only]"
    );
    console.log(
      "  CTN-002: ITEM-0001 (2), ITEM-0003 (4), ITEM-0008 (3) [Put Away only]"
    );
    console.log("  CTN-003: ITEM-0004 (4), ITEM-0006 (2)");
    console.log(
      "  CTN-004: ITEM-0002 (2), ITEM-0005 (3), ITEM-0009 (2) [Put Away only]"
    );

    for (const [cartonId, itemCode, qty] of cartonMap) {
      await db.runAsync(
        "INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES (?, ?, ?, ?)",
        [normalizedASN, cartonId, itemCode, qty]
      );
    }

    // Verify the data was inserted correctly
    const verifyCartons = await db.getAllAsync<{
      carton_id: string;
      item_code: string;
      shipped_qty: number;
    }>(
      "SELECT carton_id, item_code, shipped_qty FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id, item_code",
      [normalizedASN]
    );

    console.log(
      `✅ Verified ${verifyCartons.length} carton mappings for ASN ${normalizedASN}:`
    );
    const cartonGroups: Record<
      string,
      Array<{ item_code: string; shipped_qty: number }>
    > = {};
    verifyCartons.forEach((c) => {
      if (!cartonGroups[c.carton_id]) {
        cartonGroups[c.carton_id] = [];
      }
      cartonGroups[c.carton_id].push({
        item_code: c.item_code,
        shipped_qty: c.shipped_qty,
      });
    });

    Object.keys(cartonGroups)
      .sort()
      .forEach((cartonId) => {
        const items = cartonGroups[cartonId]
          .map((i) => `${i.item_code} (${i.shipped_qty})`)
          .join(", ");
        console.log(`  ${cartonId}: ${items}`);
      });

    // Verify each carton has the expected items
    const expectedCartons = {
      "CTN-001": ["ITEM-0001", "ITEM-0002", "ITEM-0007"],
      "CTN-002": ["ITEM-0001", "ITEM-0003", "ITEM-0008"],
      "CTN-003": ["ITEM-0004", "ITEM-0006"],
      "CTN-004": ["ITEM-0002", "ITEM-0005", "ITEM-0009"],
    };

    console.log("📊 Expected Put Away Remaining Items (after allocations):");
    console.log("  ITEM-0001: Shipped 7 (5+2), Allocated 3 → Remaining: 4");
    console.log("  ITEM-0002: Shipped 5 (3+2), Allocated 3 → Remaining: 2");
    console.log("  ITEM-0003: Shipped 4, Allocated 2 → Remaining: 2");
    console.log("  ITEM-0004: Shipped 4, Allocated 2 → Remaining: 2");
    console.log("  ITEM-0005: Shipped 3, Allocated 1 → Remaining: 2");
    console.log("  ITEM-0006: Shipped 2, Allocated 1 → Remaining: 1");
    console.log(
      "  ITEM-0007: Shipped 2, Allocated 0 → Remaining: 2 [Put Away only]"
    );
    console.log(
      "  ITEM-0008: Shipped 3, Allocated 0 → Remaining: 3 [Put Away only]"
    );
    console.log(
      "  ITEM-0009: Shipped 2, Allocated 0 → Remaining: 2 [Put Away only]"
    );

    let allCorrect = true;
    Object.keys(expectedCartons).forEach((cartonId) => {
      const expectedItems =
        expectedCartons[cartonId as keyof typeof expectedCartons];
      const actualItems = cartonGroups[cartonId]?.map((i) => i.item_code) || [];
      const missing = expectedItems.filter((e) => !actualItems.includes(e));
      const extra = actualItems.filter((a) => !expectedItems.includes(a));

      if (missing.length > 0 || extra.length > 0) {
        console.error(
          `❌ ${cartonId} mismatch! Expected: ${expectedItems.join(
            ", "
          )}, Got: ${actualItems.join(", ")}`
        );
        allCorrect = false;
      } else {
        console.log(
          `✅ ${cartonId} has correct items: ${actualItems.join(", ")}`
        );
      }
    });

    if (!allCorrect) {
      throw new Error(
        "Carton mappings verification failed! Some cartons have incorrect items."
      );
    }

    // Insert Transfer Order Allocations
    // Clear scenario: Some items fully allocated, some partially allocated, some Put Away only
    console.log(
      "📊 Inserting transfer order allocations (clear Put Away scenario)..."
    );
    const allocations = [
      // SR-01: ITEM-0001 (2), ITEM-0002 (1), ITEM-0004 (1)
      // Total allocated: ITEM-0001=3 (2+1), ITEM-0002=3 (1+2), ITEM-0004=2 (1+1)
      // Shipped: ITEM-0001=7, ITEM-0002=5, ITEM-0004=4
      // Remaining: ITEM-0001=4, ITEM-0002=2, ITEM-0004=2
      ["SR-01", "ITEM-0001", 2],
      ["SR-01", "ITEM-0002", 1],
      ["SR-01", "ITEM-0004", 1],
      // SR-02: ITEM-0001 (1), ITEM-0003 (2), ITEM-0006 (1)
      // Total allocated: ITEM-0001=3 (2+1), ITEM-0003=2, ITEM-0006=1
      // Shipped: ITEM-0001=7, ITEM-0003=4, ITEM-0006=2
      // Remaining: ITEM-0001=4, ITEM-0003=2, ITEM-0006=1
      ["SR-02", "ITEM-0001", 1],
      ["SR-02", "ITEM-0003", 2],
      ["SR-02", "ITEM-0006", 1],
      // SR-03: ITEM-0002 (2), ITEM-0004 (1), ITEM-0005 (1)
      // Total allocated: ITEM-0002=3 (1+2), ITEM-0004=2 (1+1), ITEM-0005=1
      // Shipped: ITEM-0002=5, ITEM-0004=4, ITEM-0005=3
      // Remaining: ITEM-0002=2, ITEM-0004=2, ITEM-0005=2
      // Note: ITEM-0007, ITEM-0008, ITEM-0009 have NO allocations (Put Away only)
      ["SR-03", "ITEM-0002", 2],
      ["SR-03", "ITEM-0004", 1],
      ["SR-03", "ITEM-0005", 1],
    ];

    for (const [store, itemCode, qty] of allocations) {
      await db.runAsync(
        "INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)",
        [toNo, normalizedASN, store, itemCode, qty]
      );
    }

    // Insert Box Cache
    console.log("📦 Inserting boxes...");
    const boxes = [
      ["BOX-SR01-001", "SR-01"],
      ["BOX-SR02-001", "SR-02"],
      ["BOX-SR03-001", "SR-03"],
    ];

    for (const [boxId, store] of boxes) {
      await db.runAsync(
        "INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)",
        [boxId, normalizedASN, toNo, store, "Open", now]
      );
    }

    // Insert Carton Status Cache (only for cartons that don't already have status)
    // This preserves in-progress cartons (InReceiving, Received) from being reset
    console.log(
      "📋 Inserting carton statuses (preserving in-progress ones)..."
    );
    const cartons = ["CTN-001", "CTN-002", "CTN-003", "CTN-004"];
    for (const cartonId of cartons) {
      // Check if carton already has a status (might be InReceiving or Received)
      const existingStatus = await db.getFirstAsync<{ status: string }>(
        "SELECT status FROM carton_status_cache WHERE asn_no = ? AND carton_id = ?",
        [normalizedASN, cartonId]
      );

      if (
        !existingStatus ||
        existingStatus.status === "Pending" ||
        existingStatus.status === "Unloaded"
      ) {
        // Only insert/update if no status exists or if it's Pending/Unloaded
        await db.runAsync(
          "INSERT OR REPLACE INTO carton_status_cache (asn_no, inbound_session, carton_id, status, updated_on) VALUES (?, ?, ?, ?, ?)",
          [normalizedASN, "", cartonId, "Pending", now]
        );
      } else {
        console.log(
          `  ⚠️ Preserving ${cartonId} status: ${existingStatus.status}`
        );
      }
    }

    console.log("✅ Demo data migration completed successfully");

    // Verify data was inserted
    const allocCount = await db.getAllAsync(
      "SELECT COUNT(*) as count FROM transfer_order_cache WHERE asn_no = ?",
      [normalizedASN]
    );

    const cartonCount = await db.getAllAsync(
      "SELECT COUNT(*) as count FROM asn_carton_map WHERE asn_no = ?",
      [normalizedASN]
    );

    const boxCount = await db.getAllAsync(
      "SELECT COUNT(*) as count FROM box_cache WHERE asn_no = ?",
      [normalizedASN]
    );

    console.log(
      `✅ Verified: ${allocCount[0]?.count || 0} allocations, ${
        cartonCount[0]?.count || 0
      } carton items, ${boxCount[0]?.count || 0} boxes`
    );

    return true;
  } catch (error: any) {
    console.error("❌ Demo data migration failed:", error);
    throw error;
  }
};
