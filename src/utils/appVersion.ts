import Constants from "expo-constants";

/**
 * Display string for support / QA (e.g. sharing with customer during UAT).
 * Uses app.json `version` when available; appends native build when present.
 */
export function getAppVersionDetails(): string {
  const version =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "—";

  const buildRaw =
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    (Constants.expoConfig?.android?.versionCode != null
      ? String(Constants.expoConfig.android.versionCode)
      : "");

  const build =
    typeof buildRaw === "string" ? buildRaw.trim() : String(buildRaw ?? "");

  if (build.length > 0 && build !== "undefined") {
    return `${version} (build ${build})`;
  }
  return version;
}
