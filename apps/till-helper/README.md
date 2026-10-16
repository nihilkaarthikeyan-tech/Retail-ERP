# Retail ERP Till Helper

A small program that runs on each till computer (Windows). It lets the till screen in the browser
print receipts on the thermal receipt printer and open the cash drawer.

- The ERP decides **what** to print. The helper only turns the receipt into printer commands and sends them.
- It only works on the till computer itself (address `127.0.0.1`). Nobody on the network can reach it.
- It only accepts requests from our ERP's web address, and only after the till screen is paired with it.
- **If the helper or the printer is not working, billing does not stop.** The till prints the receipt through
  the browser's normal print window instead.

Works with 80 mm and 58 mm thermal printers that use the common ESC/POS commands (Epson, TVS, Posiflex,
Rugtek, Everycom and most other shop printers). The cash drawer must be plugged into the printer's drawer socket.

---

## 1. Install (once per till)

1. Install **Node.js LTS** (version 20 or newer) from https://nodejs.org. Accept the normal options.
2. Copy the `apps/till-helper` folder to the till computer, for example to `C:\RetailERP\till-helper`.
   (On a developer computer with the whole project, run `pnpm --filter till-helper build` from the project folder instead.)
3. If you copied the folder without a `dist` folder inside it, build it once on a computer that has the project:
   ```
   pnpm --filter till-helper build
   ```
   and copy the `dist` folder and `package.json` across. The helper needs no other files or downloads.
4. Start it:
   ```
   cd C:\RetailERP\till-helper
   node dist/main.js
   ```
   The first time, it creates a settings file `till-helper.config.json` in the same folder and shows a
   **pairing code** (6 digits).

## 2. Set it up (settings file)

Open `till-helper.config.json` in Notepad. Change it, save, then close and restart the helper.

```json
{
  "port": 47120,
  "allowedOrigins": ["https://erp.ourcompany.in"],
  "paperWidth": 80,
  "printer": { "kind": "windows", "share": "RECEIPT" },
  "drawer": { "enabled": true, "pin": 2 }
}
```

| Setting | What to put |
| --- | --- |
| `port` | Leave at `47120` unless something else on the till already uses it. |
| `allowedOrigins` | The web address of our ERP, exactly as in the browser's address bar, without any path. On a developer computer: `http://localhost:3000`. |
| `paperWidth` | `80` for 80 mm paper (48 characters per line) or `58` for 58 mm paper (32 characters). |
| `printer` | How the printer is connected. See below. |
| `drawer` | `"enabled": false` if there is no cash drawer. `"pin": 5` only if the drawer does not open with pin 2. |

### Printer connected by USB (most common)

Windows must be able to send raw data to it, through a printer **share**:

1. Install the printer in Windows (the maker's driver, or **Generic / Text Only** if there is no driver).
2. Open *Settings → Bluetooth & devices → Printers & scanners → (your printer) → Printer properties → Sharing*.
3. Tick **Share this printer** and give a short share name without spaces, for example `RECEIPT`.
4. In the settings file: `"printer": { "kind": "windows", "share": "RECEIPT" }`

The helper sends the receipt the same way as the Windows command `copy /b receipt.bin \\localhost\RECEIPT`.
Sharing does not make the printer visible outside the till if Windows file and printer sharing is off on the network.

### Network printer (has a network cable / Wi-Fi)

Print the printer's self-test page (hold the FEED button while switching it on) to see its IP address. Ask whoever
manages the network to give the printer a fixed address. Then:

`"printer": { "kind": "network", "host": "192.168.1.50", "port": 9100 }`

### Serial printer (COM port)

`"printer": { "kind": "serial", "port": "COM3", "baudRate": 9600 }`

Use the port and speed shown in Device Manager and on the printer's self-test page. (This uses only Windows'
own `mode` command; it has not yet been tried on every printer model — use USB or network where possible.)

### No printer yet

`"printer": { "kind": "none" }` — the till will print through the browser.

## 3. Pair the till screen

Each time the helper starts it shows a new **pairing code**:

```
  PAIRING CODE: 123456
```

On the till screen, open the printer settings, choose **Pair Till Helper** and type the code. The till screen
remembers the pairing, so this is needed only once per till (and again only if the helper's secret is reset).

- The code works **once**. After 5 wrong tries it stops working; restart the helper to get a new one.
- The code and the secret token are also saved in `till-helper.pairing.json` next to the settings file.
  **Keep this file private.** Do not copy it to another computer.
- To cancel all pairings (for example after a till computer is replaced), start once with
  `node dist/main.js --reset-token`. Every till screen must then pair again.

## 4. Start it automatically when the till is switched on

Use Windows **Task Scheduler**:

1. Open *Task Scheduler → Create Task…*
2. **General:** name `Retail ERP Till Helper`; choose *Run only when user is logged on* (the cashier's Windows user).
3. **Triggers:** *New… → Begin the task: At log on*.
4. **Actions:** *New… → Start a program*
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `dist\main.js`
   - Start in: `C:\RetailERP\till-helper`
5. **Settings:** tick *If the task fails, restart every 1 minute*; untick *Stop the task if it runs longer than…*.
6. Save, then right-click the task → **Run** to check. The pairing code is in `till-helper.pairing.json`
   when the helper runs without a window.

## 5. When something is wrong

| What you see | What to do |
| --- | --- |
| Till says "printer not found" or prints through the browser window | Billing carries on. Check the printer is on, has paper and its cable is in. Check the helper is running (restart the till or run the Task Scheduler task). |
| Helper window says "Settings problem: …" | The message says which setting is wrong. Fix it in `till-helper.config.json`. |
| "The port is already in use" | The helper is already running (check Task Manager for `node.exe`), or change `port`. |
| USB printer: "The network name cannot be found" | The share name in the settings does not match the printer's share name, or the printer is not shared. |
| Network printer: "timed out" or "connection refused" | Wrong IP address, or the printer is off / not on the network. |
| Receipt prints but the drawer does not open | Check the drawer cable is in the printer's DK socket; try `"pin": 5`. |
| Till says the helper refused it | Pair again with the new code shown when the helper starts. Check `allowedOrigins` is exactly the ERP address in the browser. |

The ₹ sign is printed as **Rs.** because most thermal printers do not have it.

---

## For developers

```
pnpm --filter till-helper build      # compile to dist/
pnpm --filter till-helper test       # tests (ESC/POS bytes, layout, HTTP security)
pnpm --filter till-helper lint
node apps/till-helper/dist/main.js --config <path-to-settings.json>
```

The service, for the till screen (all requests from an allowed `Origin`; all but `/pair` need `x-helper-token`):

| Request | Answer |
| --- | --- |
| `POST /pair` `{ "code": "123456" }` | `{ ok: true, token }` — the till keeps the token |
| `GET /status` | `{ ok: true, version, paperWidth, printer: { configured, kind, name }, drawer: { configured } }` |
| `POST /print` `{ "receipt": { … } }` | `{ ok: true }`; `400` bad receipt; `503` printer missing or not answering |
| `POST /drawer/open` | `{ ok: true }`; `409` no drawer; `503` printer missing or not answering |

Refusals: `401` no token, `403` wrong token, wrong `Origin`, or wrong host name. `OPTIONS` pre-checks are answered only
for allowed origins (including Chrome's private-network header).

No third-party libraries are used at run time: the printer commands, the HTTP service and the printer connections
use only our own code and Node.js itself.
