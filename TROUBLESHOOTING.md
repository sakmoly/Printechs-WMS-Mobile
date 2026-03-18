# Troubleshooting

## ENOENT: InternalBytecode.js / Metro symbolication error

If you see:

```
Error: ENOENT: no such file or directory, open '...\InternalBytecode.js'
```

this comes from Metro trying to symbolicate a stack trace that references React Native’s internal bytecode. The file doesn’t exist on disk, so the bundler throws.

**Fix:** Clear Metro’s cache and restart:

```bash
cd mobile
npx expo start -c
```

Or:

```bash
npm start -- --clear
```

If it still happens, close the dev server, delete `node_modules/.cache` (if present), then run `npx expo start -c` again.

---

## 417 / "Invalid or expired OTP" when using 408057

The code **408057** is a **dev-only UI test code**. It is not valid on your server, so the API correctly returns **417** and "Invalid or expired code".

- In **development**, if you tap "[Dev] Test Auto-fill OTP", the app now shows an alert and does **not** call the server, so you won’t see 417 from that.
- To actually log in, use the **6-digit code from your email** after "Send OTP".

Production builds do not show the test button, so reviewers will only use real OTPs.
