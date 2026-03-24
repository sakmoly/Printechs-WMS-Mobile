# EAS Build on Windows (when path has spaces)

If you see:

```text
Failed to upload the project tarball to EAS Build
Reason: git clone ... file:///D:/Development Project/Printechs Mobile/mobile ... exited with non-zero code: 128
```

the project path **"Development Project"** (space) breaks Git when EAS runs `git clone`. Use a path **without spaces**.

---

## Option 1: Virtual drive (no need to move the project)

1. **Open PowerShell as Administrator**  
   Right‑click PowerShell → **Run as administrator**.

2. **Run the helper script** (from the `mobile` folder):
   ```powershell
   cd "D:\Development Project\Printechs Mobile\mobile"
   .\scripts\build-ios-eas-no-spaces.ps1
   ```
   This maps `Z:` to your project and runs `eas build --platform ios` from `Z:\mobile`.

3. **To remove the virtual drive later** (optional):
   ```powershell
   subst Z: /D
   ```

---

## Option 2: Manual steps

1. **Open PowerShell as Administrator.**

2. **Create the virtual drive:**
   ```powershell
   subst Z: "D:\Development Project\Printechs Mobile"
   ```

3. **Open a normal PowerShell** (no need for Admin) and run:
   ```powershell
   cd Z:\mobile
   eas build --platform ios
   ```

---

## If "Failed to compute project fingerprint" (ENOENT) appears

After the upload succeeds, EAS may fail with a path like `Z:\mobile\D:\...\node_modules\...`. Skip the fingerprint step so the build can continue:

```powershell
$env:EAS_SKIP_AUTO_FINGERPRINT = "1"
eas build --platform ios
```

Or in one line from `Z:\mobile`:

```powershell
cd Z:\mobile; $env:EAS_SKIP_AUTO_FINGERPRINT = "1"; eas build --platform ios
```

The build script in Option 1 sets this variable for you.

---

## Option 3: Move project to a path without spaces

Copy or move the project to a folder without spaces, for example:

- `D:\PrintechsMobile\mobile`

Then run:

```powershell
cd D:\PrintechsMobile\mobile
eas build --platform ios
```
