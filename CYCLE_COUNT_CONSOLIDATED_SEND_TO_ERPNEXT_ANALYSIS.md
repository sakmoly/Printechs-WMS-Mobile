# Cycle Count – Consolidated Send to ERPNext (Analysis)

**Purpose:** You have multiple cycle count tasks, with multiple users and devices scanning. When each task is completed you need to send data to ERPNext, but you want **consolidated items and qty** (one consolidated push) instead of sending each cycle count task separately. This document analyzes the current flow and recommends how to **manage** this without any development changes right now.

---

## Current Behaviour (No Changes Assumed)

### Mobile app

- Each **cycle count task** has a **title** (e.g. `CC-0001`, `CC-0002`).
- Per task, the app:
  1. **Start:** `POST /api/cycle-count/{title}/start`
  2. **Count (multiple times):** `POST /api/cycle-count/{title}/count` with lines (item_code, counted_qty, expected_qty, etc.)
  3. **Submit:** `POST /api/cycle-count/{title}/submit`
  4. **Complete:** `POST /api/cycle-count/{title}/complete`
- So **each task is sent to your backend separately** (per task title). Multiple users/devices = multiple tasks, each with its own submit/complete.

### Backend / ERPNext

- The backend receives **one task at a time** (per title). “Send to ERPNext” is assumed to happen either:
  - Inside your backend when it receives submit/complete, or
  - From a desktop/operations console that reads backend data and pushes to ERPNext.
- There is **no consolidation step** described in the app: the app does not aggregate across tasks.

---

## The Gap

- **Need:** One **consolidated** payload to ERPNext (e.g. all items and qtys from multiple completed cycle count tasks for a day/warehouse/campaign).
- **Current:** Data reaches the backend **per task**. If “send to ERPNext” is triggered per task, ERPNext gets many small updates instead of one consolidated update.

So the **management** question is: **who consolidates, and when?**

---

## Recommended Way for the User to Manage (No App Changes)

You can achieve consolidated send to ERPNext **without changing the mobile app** by doing consolidation **after** the mobile has sent each task (on backend or desktop).

### Option A – Consolidate on the backend (recommended)

- **Idea:** Mobile keeps sending each task as today (submit/complete per task). Backend **stores** each completed task’s lines (item, qty, bin, etc.) but **does not** send to ERPNext immediately per task.
- **User process:**
  - Users complete tasks on mobile as usual (submit → complete per task).
  - On the **backend** (or a small admin job):
    - Define a “batch” (e.g. by **date**, or **warehouse**, or **list of task titles**).
    - Run a **single** “Consolidate and send to ERPNext” action for that batch:
      - Aggregate all lines from all completed tasks in the batch (same item + same UOM + same warehouse/bin → sum qty).
      - Call ERPNext **once** with this consolidated list (items + qtys).
- **Who manages:** Backend admin or scheduled job; no change for mobile users.

### Option B – Consolidate on the desktop (Printechs WMS Operations Console / ERPNext)

- **Idea:** Backend still receives and stores each task from mobile. A **desktop** user runs a report or action that:
  - Selects a **date range** (and optionally warehouse / task list).
  - Exports or “Send to ERPNext” for that selection, with the backend (or desktop) aggregating completed tasks into one consolidated payload before sending.
- **Who manages:** Supervisor or planner on desktop, once per day (or per shift) after mobile users have completed their tasks.

### Option C – Manual / semi-manual consolidation

- **Idea:** Use existing backend/ERPNext reports or exports that show **completed cycle count tasks** (e.g. by date). User:
  - Runs the report for “all completed tasks for date X”.
  - Uses a spreadsheet or a single “Import to ERPNext” file that **combines** all tasks (same item + qty summed), then does **one** import/send to ERPNext.
- **Who manages:** One person responsible for closing the day’s cycle count and doing the single consolidated send.

---

## Practical Recommendation (No Development Right Now)

- **Short term:** Use **Option C** if you already have reports or exports of completed cycle count tasks: pick a date (or task list), export, consolidate items/qtys in a sheet or one file, then one import/send to ERPNext. One person can own “consolidate and send” at end of day.
- **Medium term:** Implement **Option A** on the backend: keep receiving per-task submit/complete from mobile unchanged; add a “Consolidate and send to ERPNext” by date (or warehouse/batch) so the **user** triggers one consolidated push from backend/admin instead of sending each task to ERPNext.

In both cases, **users and devices keep using the app as today**; consolidation and single send to ERPNext are handled **after** the data is in your backend/desktop, not on the mobile app.

---

## Summary

| Aspect | Current | Desired | How to manage (no app change) |
|--------|--------|--------|-------------------------------|
| Mobile | Sends each task separately (submit/complete per title) | No change | Keep as is |
| Backend | Receives per task | Store; don’t send to ERPNext per task | Add consolidation step by date/batch |
| Send to ERPNext | Per task (if at all) | One consolidated payload (items + qty) | Backend or desktop: aggregate completed tasks → one call/import to ERPNext |
| Who manages | N/A | One consolidated send per day/batch | One person (or scheduled job) runs “Consolidate and send” for selected date/batch |

No changes are required on the mobile app at this stage; consolidation and single send to ERPNext are done on the backend or desktop side.
