import { z } from "zod";

const envSchema = z.object({
  ERP_BASE_URL: z.string().url(),
  BUILD_VARIANT: z.enum(["dev", "uat", "prod"]).default("dev"),
  API_KEY: z.string().optional(),
  API_SECRET: z.string().optional(),
  API_KEY_PROD: z.string().optional(),
  API_SECRET_PROD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// For development, you can hardcode values here
// In production, use expo-constants to read from app.config.js
const getRawEnv = (): Record<string, string | undefined> => {
  // TODO: Replace with your ERPNext instance URL and API credentials
  return {
    ERP_BASE_URL: "https://printechs.com",
    BUILD_VARIANT: "dev",

    // API Authentication - Update these with your actual API credentials
    API_KEY: "your_api_key_here",
    API_SECRET: "your_api_secret_here",

    // Production API credentials (if different)
    API_KEY_PROD: "prod_api_key_here",
    API_SECRET_PROD: "prod_api_secret_here",
  };
};

let cachedEnv: Env | null = null;

export const getEnv = (): Env => {
  if (cachedEnv) return cachedEnv;

  try {
    const raw = getRawEnv();
    console.log("🔧 Environment config:", raw);

    const parsed = envSchema.safeParse(raw);

    if (!parsed.success) {
      console.error("❌ Invalid environment config:", parsed.error.format());
      throw new Error("Invalid environment configuration");
    }

    cachedEnv = parsed.data;
    console.log("✅ Environment config loaded successfully:", cachedEnv);
    return cachedEnv;
  } catch (error) {
    console.error("❌ Error loading environment config:", error);
    throw new Error("Failed to load environment configuration");
  }
};

export const env = getEnv();
