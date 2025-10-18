# Create simple placeholder images for Expo
# This creates minimal PNG files to satisfy Expo's requirements

# Create a simple 1x1 pixel PNG (base64 encoded)
$iconData = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
$splashData = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
$faviconData = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
$adaptiveIconData = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

# Write the files
[System.IO.File]::WriteAllBytes("icon.png", $iconData)
[System.IO.File]::WriteAllBytes("splash.png", $splashData)
[System.IO.File]::WriteAllBytes("favicon.png", $faviconData)
[System.IO.File]::WriteAllBytes("adaptive-icon.png", $adaptiveIconData)

Write-Host "✅ Created placeholder asset files"
