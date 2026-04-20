# ASN Received Qty: Desktop 70 vs Mobile 150 – Analysis & Fix

## Problem

- **Desktop (ASN-0003):** Shows **Total Shipped Qty: 150**, but **Recvd Qty** per item sums to **70** (e.g. 10+20+0+40+0).
- **Mobile:** User received all **150** items (scanned and finished cartons).
- **Result:** Desktop shows only 70 received; mobile “thinks” 150 were received.

## Root Cause (Analysis)

### 1. Mobile was not sending `parent_title` (session ID) to the backend

- The **receive-lines** API expects:
  - **`parent_title`** (required) = inbound session ID, so the backend knows which ASN/session the lines belong to.
  - **`receive_lines`** = array of `{ carton_id, item_code, expected_qty, received_qty, ... }`.
- The mobile was calling the API with **only** `receive_lines`, and **no top-level `parent_title`**.
- Without `parent_title`, the backend may:
  - Not associate the lines with the correct ASN/session.
  - Apply lines to the wrong session or overwrite/merge incorrectly.
  - Only persist part of the data (e.g. only first carton’s lines), which matches “desktop shows 70”.

So the main mobile bug was: **missing `parent_title`** in the createReceiveLines request.

### 2. How mobile sends receive data

- When the user **finishes a carton** on mobile, the app:
  1. Reads scanned items for **that carton** from local DB.
  2. Builds **receive_lines** per item (aggregated by `item_code` for that carton).
  3. Calls **`createReceiveLines`** once per carton finish.
- So with 2 cartons:
  - Finish carton 1 → one API call with that carton’s lines (e.g. 70 qty).
  - Finish carton 2 → another API call with carton 2’s lines (e.g. 80 qty).
- If the backend does **not** have a valid session (because `parent_title` was missing), it might:
  - Only apply the first call, or
  - Apply lines in a way that doesn’t add up correctly on the desktop (e.g. replace instead of add, or wrong session).

### 3. Backend behavior that can cause “only 70” to show

- If the backend **replaces** received_qty per item instead of **adding** when it gets receive_lines for carton 2, then only one carton’s data would be visible (e.g. 70).
- If the backend keys by (session, item_code, carton_id) but the desktop screen shows **Recvd Qty** summed only by (ASN, item_code) and the backend didn’t link to the right session (no `parent_title`), some cartons’ quantities might not be included in that sum.

So the discrepancy is explained by:

1. **Mobile:** Missing `parent_title` → backend cannot reliably associate receive_lines with the correct ASN/session.
2. **Backend:** Either only applying one carton’s data, or applying in a way that doesn’t sum correctly for the desktop view.

## Fix Applied on Mobile

- **File:** `src/screens/ReceiveSortScreen.tsx` (inside `handleFinishCartonInternal`).
- **Change:** When calling `apiService.createReceiveLines(...)`, the app now **always sends `parent_title`** set to the current inbound session ID (`activeSession`).
- **Code:**  
  `createReceiveLines({ parent_title: activeSession, receive_lines: receiveLines })`
- This allows the backend to:
  - Associate every receive_lines payload with the correct ASN/session.
  - Add (or set) received_qty per (session, item_code) correctly so that the desktop “Recvd Qty” sum matches what was received on mobile.

## What the Backend Must Do (Recommendations)

1. **Use `parent_title`**  
   - Treat `parent_title` as the inbound session ID and link receive_lines to the correct ASN/session.  
   - Do not process receive_lines without a valid session (e.g. return 400 if `parent_title` is missing).

2. **Apply received_qty: UPSERT by (session, carton_id, item_code)**  
   - **Critical:** Treat each line as the **authoritative** received_qty for (session, carton_id, item_code). **SET** (upsert) that value; do **not ADD**. Mobile sends full state; if backend adds on each sync, Recvd Qty doubles (e.g. 20 instead of 10).  
   - Do **not** replace the total received_qty for the ASN/item with only the last carton’s received_qty.

3. **Idempotency / duplicates**  
   - Mobile may resend the same data (Sync). Backend **must** upsert by (session, carton_id, item_code) and SET received_qty so each sync does not double the displayed Recvd Qty.

4. **Desktop “Recvd Qty”**  
   - Ensure the desktop screen that shows “Recvd Qty” per item is summing **all** received quantities for that ASN/item (e.g. across cartons and receive_lines linked to that ASN/session).

## How to Verify After Fix

1. **Mobile:** Finish 2 cartons for an ASN (e.g. 70 + 80 = 150).  
2. **Backend:** Check that each `createReceiveLines` request includes `parent_title: <inbound_session>`.  
3. **Backend:** Confirm that after both cartons, stored received_qty per item sums to 150 (or the correct total).  
4. **Desktop:** Open the same ASN and confirm “Recvd Qty” per item and total match what was received on mobile (e.g. 150).

## Summary

| Item | Before | After |
|------|--------|--------|
| Mobile send `parent_title` | Not sent | Sent as `activeSession` (inbound session ID) |
| Backend can associate lines to session | Unreliable | Reliable if backend uses `parent_title` |
| Desktop Recvd Qty vs mobile | 70 vs 150 (example) | Should match once backend adds by (session, item_code) and uses `parent_title` |

The mobile fix ensures the backend receives the session ID with every receive_lines call so it can correctly associate and accumulate received quantities; backend must use `parent_title` and add received_qty per (session, item_code) so desktop and mobile stay in sync.

---

## How to Get Updated Qty in ASN (After Backend Update)

After the backend is updated to store and return correct received_qty, the mobile app **pulls the updated qty** from the backend so the summary matches the desktop.

### APIs used

1. **GET /api/asn/{asn_no}** – returns ASN details. Backend may include:
   - `details[]` with `item_code`, `received_qty` (or `recvd_qty`), or
   - `cartons[].items[]` with `item_code`, `received_qty`.
2. **GET /api/inbound/receive-lines?parent_title={inbound_session}** – returns receive lines for the session. Response may have `receive_lines[]` with `item_code`, `received_qty`.

### When the mobile refreshes

- **After finishing a carton** – right after a successful `createReceiveLines` call, the app calls `refreshASNReceivedQtyFromBackend()` so the summary shows the latest backend received qty.
- **When the screen gains focus** – in `useFocusEffect`, the app calls `refreshASNReceivedQtyFromBackend()` so returning to Receive/Sort shows the updated qty (e.g. after desktop or another device updated).

### How it works in the app

- **State:** `backendReceivedByItem` = `Record<item_code, received_qty>` from the last successful refresh (or `null` if not yet loaded / error).
- **Refresh:** `refreshASNReceivedQtyFromBackend()`:
  1. Calls `apiService.getASN(activeASN)` and parses `details[]` or `cartons[].items[]` for `item_code` and `received_qty`.
  2. If no item-level received qty is found, calls `apiService.getReceiveLines(activeSession)` and parses `receive_lines[]` for `item_code` and `received_qty`.
  3. Sets `backendReceivedByItem` so the summary uses backend qty when available.
- **Summary:** When `backendReceivedByItem` is set, “Scanned” and “TO Allocation Status” use the sum of backend received qty (and TO allocated scanned is derived from it). Otherwise the app falls back to local `scanned_items` as before.

### Backend response shapes supported

- **getASN:** `details[]` or `data.details[]` with `item_code`, `received_qty` (or `recvd_qty`, `receivedQty`); or `cartons[].items[]` with `item_code`, `received_qty`.
- **getReceiveLines:** `receive_lines[]` or `data.receive_lines[]` with `item_code`, `received_qty` (or `recvd_qty`, `receivedQty`).

This way, once the backend returns updated received_qty, the mobile summary reflects it without requiring a full app restart.

---

## "Backend still not updated" – Desktop Recvd Qty shows 0 for some items

If the **desktop ASN details** table still shows **Recvd Qty = 0** for some items (e.g. 108228, 108230) while others show the correct received qty, the mobile is already sending data correctly; the issue is on the **backend**.

### What the mobile sends (verified)

- On **Finish Carton**, the app calls `createReceiveLines` with:
  - **`parent_title`** = inbound session ID (e.g. `SESSION-ASN0003-DEV4`)
  - **`receive_lines`** = array of `{ carton_id, item_code, expected_qty, received_qty, ... }` for that carton
- So every item scanned and finished (including 108228, 108230) is sent with the same `parent_title` as the session.

### What the backend must do

1. **Persist receive_lines with session**
   - When `createReceiveLines` is called with `parent_title` = session ID, store each line linked to that session (and to the ASN that owns the session).
   - Ensure **every** item in `receive_lines` is stored (no filtering by item_code/carton that could drop 108228/108230).

2. **Compute "Recvd Qty" for the ASN details view**
   - The desktop "ASN Item Details" column **Recvd Qty** must be the **sum of `received_qty`** from all stored receive_lines for that ASN/session for that **item_code**.
   - Formula: for each (ASN/session, item_code), sum all `received_qty` from receive_lines where session matches.
   - Do **not** show Recvd Qty from a different source (e.g. only from carton header or first carton); it must include all receive_lines for that item in that session.

3. **Check for bugs**
   - If only the **first carton’s** receive_lines are applied, items that appear only in the second carton will show 0. Fix: apply and aggregate **all** createReceiveLines calls for the same `parent_title`.
   - If the ASN details screen reads from a table that is **not** updated when receive_lines are created via API (e.g. only updated by desktop receiving), change it to read from the same receive_lines (or derived summary) that the API writes to.

### Quick backend checklist

| Check | Action |
|-------|--------|
| Receive_lines stored per session | Every `createReceiveLines(parent_title, receive_lines)` persists all lines with that session. |
| Recvd Qty = sum by item | ASN details "Recvd Qty" = sum of `received_qty` over receive_lines for that ASN/session and item_code. |
| No "first carton only" | Both (and all) cartons’ createReceiveLines calls are applied; no overwrite of previous carton’s lines. |
| API and desktop use same data | The same receive_lines (or aggregated view) feed both the API response and the desktop "Recvd Qty" column. |

Once the backend aggregates and displays Recvd Qty from **all** receive_lines for the session (by item_code), the desktop will show the same totals as the mobile (e.g. 30 and 50 for 108228 and 108230 after they are received).

---

## After "Sync Now" – data still not updated on desktop

If you tapped **Sync Now** (Settings or Sync Center) and the success message shows **"Items sent: 108226 (10), 108227 (20), 108228 (30), 108229 (40), 108230 (50)"** (or similar) but the desktop **Recvd Qty** still shows 0 for 108228 and 108230:

- The **mobile is sending the correct data** (session + all items and quantities).
- The issue is on the **backend**: it is not persisting or not aggregating `receive_lines` into the ASN details "Recvd Qty" column. The backend team should:
  1. Confirm that `POST /api/inbound/receive-lines` receives `parent_title` = session (e.g. `SESSION-ASN0003-DEV4`) and the full `receive_lines` array.
  2. Persist every line with that session and **sum** `received_qty` by `(session, item_code)` when updating the ASN details view (do not overwrite; add across cartons).

If the message says **"No active ASN/session stored"**: the device has no current inbound session saved. Start an inbound for ASN-0003 (or the relevant ASN) and either use **Receive + Sort → Sync receive data** from that screen, or run **Sync Now** again after starting the inbound so the session is stored.

---

## Duplicate data on sync + 0 item not updated (backend UPSERT required)

If after syncing you see **Recvd Qty doubled** (e.g. 108226: 20 instead of 10, 108227: 40 instead of 20) and **some items still 0** (e.g. 108228, 108230):

- **Cause:**  
  - Mobile sends **full state** (all carton items with received_qty). When user taps "Sync" or "Sync receive data" again, the same payload is sent. If the backend **adds** received_qty to existing, each sync doubles the total.  
  - Items showing 0 can be due to backend only applying the first carton, or not persisting every (session, carton_id, item_code) from the payload.

- **Mobile changes (done):**  
  - **Finish carton:** receive_lines now include **every** carton item (missing items get received_qty 0) so no item is omitted.  
  - **Resend/Sync:** we send **every** carton item from `getCartonItems` with received_qty from scanned items (or 0), so 108228 and 108230 are always included.

- **Backend must:**  
  1. **UPSERT** receive_lines by **(session, carton_id, item_code)** and **SET** received_qty to the value in the request (do not add).  
  2. Desktop "Recvd Qty" per item = **sum** of received_qty over all receive_lines for that session and item_code (across cartons).  
  3. Then: one sync or multiple syncs produce the same correct total; no double-counting; no missing items.
