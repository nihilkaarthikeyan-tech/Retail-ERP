# Setting up your billing counter

A guide for the shop. It takes about 30 minutes for the first counter and 10 minutes for each one after that.

Retail ERP runs in the web browser, so there is **nothing to install for billing itself**. The only program you
install is the small **Till Helper**, and only if you want printed receipts and a cash drawer that opens by itself.

---

## What you need at each counter

| Item | Needed? | Notes |
| --- | --- | --- |
| A Windows computer or laptop | Yes | Windows 10 or 11. Any recent computer is fine. |
| Google Chrome or Microsoft Edge | Yes | Keep it up to date. |
| Internet | Yes | Billing carries on if the line drops for a while (see below). |
| USB barcode scanner | Recommended | Any scanner that works like a keyboard. Nothing to install. |
| Thermal receipt printer | Recommended | 80 mm or 58 mm, using the common ESC/POS commands: Epson, TVS, Posiflex, Rugtek, Everycom and most shop printers. USB or network. |
| Cash drawer | Optional | Plugged into the printer's drawer socket (marked DK), not into the computer. |
| Label printer | Optional | For price tags. Prints from the browser onto label rolls or A4 sticker sheets. |

Before you start, the shop owner (or a manager) should already have: items with prices, at least one store,
and staff logins for the cashiers.

---

## Part 1. In Retail ERP (owner or manager, once per counter)

### 1. Add the counter
1. Log in at **https://retailerp.52digit.com**.
2. In the menu, open **Billing counter → Tills**.
3. Click **Add till**. Give it a code and a name, for example **T1** and **Counter 1**, and choose the store it
   belongs to. Save.

### 2. Check how customers can pay
Open **Billing counter → Payment methods**. Cash, card and UPI are there already. Switch off any your shop does
not take.

### 3. Give each cashier a till PIN
Each cashier opens **Billing counter → My till PIN** once and sets a PIN of 4 to 6 digits. The PIN is how cashiers switch
at the counter without logging out. Managers set a PIN too: it approves things like a large discount or
cancelling a bill.

---

## Part 2. At the counter computer (once)

### 4. Make this computer the counter
1. On the counter computer, open Chrome or Edge and log in to Retail ERP.
2. Open **Billing counter → Tills**, click the till you made (for example **T1**).
3. Type a name for this computer, for example *Front counter PC*, and click **Use this computer as till T1**,
   then **Yes, use this computer**.

Only one computer can be a given till. If you replace the computer later, repeat this step on the new one; the old
one stops working as that till.

**Tip:** add the billing screen to the taskbar so the cashier opens it with one click: open
**Billing counter → Open the till**, then in the browser menu choose *Save and share → Install page as app* (Chrome)
or *Apps → Install this site as an app* (Edge).

### 5. Plug in the barcode scanner
Plug it into a USB port. That is all. Test it: on the billing screen, click the search box and scan any product;
the item should appear on the bill.

---

## Part 3. Receipt printer and cash drawer (Till Helper)

Skip this part if you do not print receipts. Billing works without it; receipts can still be printed through
the browser's normal print window.

### 6. Connect the printer to Windows
**USB printer (most common):**
1. Connect the printer and install it in Windows with the maker's driver. If there is no driver, add it as
   **Generic / Text Only**.
2. Open *Settings → Bluetooth & devices → Printers & scanners →* your printer *→ Printer properties → Sharing*.
3. Tick **Share this printer** and type a short name with no spaces: **RECEIPT**. Click OK.

**Network printer (with a network cable or Wi-Fi):** print its self-test page (hold the FEED button while switching
it on) and note its IP address, for example `192.168.1.50`. Ask whoever looks after your network to keep that
address fixed.

### 7. Install the Till Helper
Your Retail ERP contact gives you the Till Helper folder.
1. Install **Node.js LTS** from https://nodejs.org (accept the normal options).
2. Copy the Till Helper folder to `C:\RetailERP\till-helper`.
3. Open the folder, click the address bar, type `cmd` and press Enter. In the black window type:
   ```
   node dist/main.js
   ```
   The first time, it creates a settings file and shows a **pairing code** of 6 digits. Leave the window open.

### 8. Tell the Till Helper about your printer
Open `C:\RetailERP\till-helper\till-helper.config.json` in Notepad and set it like this:

```json
{
  "port": 47120,
  "allowedOrigins": ["https://retailerp.52digit.com"],
  "paperWidth": 80,
  "printer": { "kind": "windows", "share": "RECEIPT" },
  "drawer": { "enabled": true, "pin": 2 }
}
```

- `paperWidth`: **80** for 80 mm paper, **58** for 58 mm paper.
- For a **network printer**, use `"printer": { "kind": "network", "host": "192.168.1.50", "port": 9100 }` with your
  printer's address.
- No cash drawer? Use `"drawer": { "enabled": false }`.

Save the file, close the black window, and start it again with `node dist/main.js`. Note the new pairing code.

### 9. Pair the billing screen with the Till Helper
1. Open **Billing counter → Open the till**.
2. Click **Printer** (at the bottom right of the billing screen).
3. Type the 6-digit pairing code and click **Pair**.

This is needed once per counter. The code works once; after 5 wrong tries, restart the Till Helper for a new one.

### 10. Start the Till Helper automatically
So the cashier never has to start it by hand, set it to start when Windows starts:
1. Open **Task Scheduler** (search for it in the Start menu) → **Create Task…**
2. **General:** name it *Retail ERP Till Helper*; choose *Run only when user is logged on*.
3. **Triggers:** *New… → At log on*.
4. **Actions:** *New… → Start a program*
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `dist\main.js`
   - Start in: `C:\RetailERP\till-helper`
5. **Settings:** tick *If the task fails, restart every 1 minute*; untick *Stop the task if it runs longer than…*.
6. Save, then right-click the task and choose **Run** to check it.

---

## Part 4. A test bill (5 minutes)

1. Open **Billing counter → Open the till**.
2. **Open the shift:** count the cash in the drawer, type it as the starting cash and click **Open shift**.
3. Scan an item (or press **F2** and type its name). Press **F4** to pay, choose **Cash**, enter the amount, and save.
4. The receipt should print and the drawer should open.
5. Check the bill under **Billing counter → Till bills**.

When you go live for real, the owner can clear all test bills once under **Administration → Going live**.

---

## Every day at the counter

| When | What to do |
| --- | --- |
| Opening | **Open the shift** with the cash counted in the drawer. |
| During the day | Scan and bill. **F8** parks a bill while a customer keeps shopping; **F9** brings it back. **F7** takes a return. **F6** adds the customer. |
| Change of cashier | **Lock / switch cashier** (top of the screen); the next cashier types their PIN. |
| Cash taken out or put in | **Cash in / out**, with a reason. |
| Closing | **Close shift**: count the cash, and the system shows straight away if anything is short or over. |

### Keyboard keys
| Key | Does |
| --- | --- |
| F2 | Search for an item |
| F3 | Salesperson (if your shop uses it) |
| F4 | Pay |
| F6 | Customer |
| F7 | Return |
| F8 | Park the bill |
| F9 | Recall a parked bill |
| + / − | Change quantity |
| Del | Remove the line |
| Esc | Close or clear |

### When the internet drops
Keep billing. The counter computer keeps the bills and sends them as soon as the line is back, each bill exactly
once. The status at the top of the billing screen shows **Online**, or **Offline** with how many bills are waiting. Do not clear the
browser's data or switch computers while bills are waiting.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "This computer is not set up as a till" | Do step 4 on this computer. |
| The receipt opens in the browser's print window instead of printing | Billing is fine. Check the printer is on, has paper and its cable is in, and that the Till Helper is running. Then press **Printer** and pair again if asked. |
| The scanner types nothing | Click into the search box first; check the scanner's cable. |
| Receipt prints but the drawer does not open | Check the drawer cable is in the printer's DK socket. In the settings file try `"pin": 5`. |
| "Network name cannot be found" in the Till Helper window | The share name in the settings is not the printer's share name, or the printer is not shared (step 6). |
| The ₹ sign prints as "Rs." | Normal: most receipt printers do not have the ₹ sign. |
| "Too many tries" when logging in | Wait a few minutes and try again. |

For anything else, contact your Retail ERP support.
