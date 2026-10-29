# Hands-on test on a real till    (audit 5)

Do this once on a real Windows till with the real receipt printer, cash drawer and barcode scanner, using the slowest computer the shop will use. Write OK or what happened next to each step, and send the page back.

Before you start: the shop has its full item list and prices loaded, the Till Helper is installed, and you are signed in at the till.

## 1. Till Helper (the small program that talks to the printer and drawer)

1. Start the Till Helper. Its window shows `127.0.0.1:47120`, the shop's web address and the printer.
2. On a different computer, open `http://<till's IP address>:47120/status` in a browser. It must **not** open. ___
3. On the till, open the till screen → Receipt printer → pair with the 6-digit code. ___
4. Also pair once from the back office: POS → Tills → this till. ___
5. Type a wrong code 5 times: the helper locks pairing. ___

## 2. Cash drawer

6. Cash sale: the drawer opens and the receipt prints. ___
7. Card or UPI sale: the drawer stays shut. ___
8. Cash refund (a return): the drawer opens. ___
9. "No-sale / open drawer": asks for a manager's PIN, then opens. The opening shows in the shift's record. ___

## 3. Receipts

10. A bill with 40 lines, one item name 60 letters long, a ₹1,25,000 item, a 5% and an 18% item, and a discount. Print on the shop's paper (80 mm or 58 mm). Check that names wrap, the GST table, "Rs." and the totals are right. ___
11. "Receipt copies" set to 2 in POS settings: a sale prints 2 copies. Set it back. ___
12. Switch the printer off and make a sale. The till must tell the cashier, and print in the browser instead. Switch it on: no old receipt should come out by itself. ___
13. Take the paper out and make a sale (network printer): the till says "no paper". ___
14. Close the Till Helper window and make a sale: the bill still finishes and the browser print window opens. Start the helper again and press Reprint: it prints marked "DUPLICATE". ___

## 4. Barcode scanner

15. Scan 20 items as fast as you can. Note roughly how long each takes to appear: ___ seconds.
16. Scan the same item twice: quantity becomes 2. ___
17. Scan a barcode the till does not know, then a known one straight away: only the known item is added, with a clear message for the unknown one. ___
18. With the cash amount box selected, scan an item by mistake: the bill must **not** finish; the till asks to check the amount. ___
19. Scan straight after "Bill finished": the item goes on the new bill. ___
19a. Windows and Chrome are set to English (India), so date boxes show day first (27/10/2026). ___

## 5. Internet off

20. Unplug the network. Make a cash sale: the drawer opens and the receipt prints. ___
21. Plug it back in: the bill is sent once (check it appears once in the till register). Reprint now gives the server's copy. ___
22. Leave a bill in "could not be sent" (ask us how to make one), then try to close the shift: it must refuse until the office posts it. ___

## 6. After a restart

23. Restart the till computer. The Till Helper starts by itself, the browser does not ask to "allow access to apps on this device" (if it does, click Allow and note it), and the first receipt prints through the helper. ___

Tested by: ________________  Date: __________  Till / printer model: ____________________
