# EAS Build on Windows when project path contains spaces
# Run this script in PowerShell AS ADMINISTRATOR (right-click PowerShell -> Run as administrator)
#
# Why: EAS uses "git clone file:///D:/Development Project/..." and the space breaks the clone (exit 128).
# Fix: Map a drive letter so the path has no spaces (Z:\mobile), then run the build from there.

$projectRoot = "D:\Development Project\Printechs Mobile"
$virtualDrive = "Z:"

# Create virtual drive (requires Admin)
if (-not (Test-Path "${virtualDrive}\")) {
    try {
        subst ${virtualDrive} $projectRoot
        Write-Host "Created $virtualDrive -> $projectRoot" -ForegroundColor Green
    } catch {
        Write-Host "ERROR: Could not create subst. Run PowerShell as Administrator." -ForegroundColor Red
        Write-Host "Right-click PowerShell -> Run as administrator" -ForegroundColor Yellow
        exit 1
    }
} else {
    $current = (Get-Item ${virtualDrive}\).Target
    if ($current -ne $projectRoot) {
        Write-Host "WARNING: $virtualDrive is already in use ($current). Using it anyway." -ForegroundColor Yellow
    }
}

Set-Location "${virtualDrive}\mobile"
Write-Host "Working directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host "Starting EAS Build for iOS..." -ForegroundColor Cyan
# Skip fingerprint to avoid ENOENT when Z: path is mixed with D: paths in node_modules
$env:EAS_SKIP_AUTO_FINGERPRINT = "1"
eas build --platform ios
