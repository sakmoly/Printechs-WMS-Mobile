import { getDatabase } from "../database/database";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";

interface UserSyncResult {
  synced: number;
  failed: number;
}

export const syncUsers = async (): Promise<UserSyncResult> => {
  const settings = await getSettings();

  // Check if in demo mode
  if (settings.demo_mode === 1) {
    throw new Error("Cannot sync users in demo mode");
  }

  if (!settings.api_url) {
    throw new Error("API URL not configured");
  }

  const result: UserSyncResult = {
    synced: 0,
    failed: 0,
  };

  const db = await getDatabase();
  if (!db) throw new Error("Database not initialized");

  try {
    // Pull users from API
    const response = await apiService.pullUsers();

    console.log(
      "📥 Users API response:",
      JSON.stringify(response).substring(0, 500)
    );

    // Handle different response formats
    // Format 1: Direct array [ {...}, {...} ]
    // Format 2: Nested { data: [...], success: true }
    // Format 3: Nested { data: { users: [...] }, success: true }
    let users: any[] = [];

    if (Array.isArray(response)) {
      users = response;
    } else if (response && typeof response === "object") {
      // Check for nested data
      if (Array.isArray(response.data)) {
        users = response.data;
      } else if (Array.isArray(response.data?.users)) {
        users = response.data.users;
      } else if (Array.isArray(response.users)) {
        users = response.users;
      } else {
        console.warn("⚠️ Unexpected response format:", response);
      }
    }

    console.log(`📊 Found ${users.length} users to sync`);

    if (users.length > 0) {
      for (const user of users) {
        try {
          // Map server fields to our database fields
          // Server might use: user_code, name, password_hash, role, active
          // We need: user_code, user_name, password, device_id, is_active
          const userCode = user.user_code || user.userCode;
          const userName = user.name || user.user_name || user.userName;
          const password = user.password || user.password_hash || null;
          const deviceId = user.device_id || user.deviceId || null;
          const isActive =
            user.active !== undefined
              ? user.active
                ? 1
                : 0
              : user.is_active !== undefined
              ? user.is_active
                ? 1
                : 0
              : 1;
          const updatedOn =
            user.updated_on ||
            user.updatedAt ||
            user.updated_at ||
            new Date().toISOString();

          if (!userCode) {
            console.warn("⚠️ Skipping user without user_code:", user);
            result.failed++;
            continue;
          }

          await db.runAsync(
            `INSERT OR REPLACE INTO users 
             (user_code, user_name, password, device_id, is_active, updated_on) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              userCode,
              userName || null,
              password,
              deviceId,
              isActive,
              updatedOn,
            ]
          );
          console.log(`✅ Synced user: ${userCode}`);
          result.synced++;
        } catch (error: any) {
          console.error(
            `❌ Failed to sync user ${user.user_code || "unknown"}:`,
            error
          );
          result.failed++;
        }
      }
    } else {
      console.warn("⚠️ No users found in API response");
    }
  } catch (error: any) {
    const errorMsg = error.message || error.toString() || "Unknown error";
    console.error("❌ Failed to pull users:", errorMsg);
    result.failed++;
  }

  return result;
};
