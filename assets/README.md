# App Assets

## Required Assets

Place your app icons and splash screens here:

- **`icon.png`** – App icon (1024×1024 px). Used as:
  - Home screen / App Store icon
  - Login screen logo (top of the screen)
  - Profile avatar fallback when server image is missing
- `splash.png` – Splash screen (1284×2778 px)
- `adaptive-icon.png` – Android adaptive icon (1024×1024 px)
- `favicon.png` – Web favicon (48×48 px)

## Why the Printechs icon might not show

If you previously had a Printechs icon and it no longer appears:

1. **Replace `icon.png`** in this folder with your Printechs logo/icon (1024×1024 px).  
   The repo may only contain a tiny placeholder PNG; overwrite it with your real asset.
2. The **login screen** and **profile fallback** both use `icon.png`. Once you restore the correct file, they will show the Printechs icon again.

To customize:

1. Create your icons using a tool like Canva or Figma
2. Replace the placeholder files
3. Run `npm start` to see changes

## Recommended Tools

- **Canva**: https://canva.com (free templates)
- **Figma**: https://figma.com (professional design)
- **App Icon Generator**: https://www.appicon.co/

## Icon Guidelines

- Use your company logo
- Keep it simple and recognizable
- Use brand colors
- Test on both light and dark backgrounds
