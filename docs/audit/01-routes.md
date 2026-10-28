# API routes (apps/api/src/**/*.controller.ts)

Total: 452

| # | Verb | Path | File:line | Handler | Class decorators | Method decorators | Param marks |
|---|---|---|---|---|---|---|---|
| 1 | GET | /accounts | accounting/accounting.controller.ts:88 | tree |  | @RequireAnyPermission('accounts.view', 'journals.post', 'payments.post', 'cash.deposit') |  |
| 2 | POST | /accounts | accounting/accounting.controller.ts:91 | createAccount |  | @RequirePermission('accounts.manage') |  |
| 3 | PATCH | /accounts/:id | accounting/accounting.controller.ts:94 | updateAccount |  | @RequirePermission('accounts.manage') |  |
| 4 | POST | /accounts/:id/lock | accounting/accounting.controller.ts:97 | lockAccount |  | @RequirePermission('books.lock') |  |
| 5 | POST | /accounts/approve-chart | accounting/accounting.controller.ts:100 | approveChart |  | @RequirePermission('accounts.approve_chart') |  |
| 6 | GET | /accounting/settings | accounting/accounting.controller.ts:103 | settings |  | @RequireAnyPermission('accounts.view', 'journals.post', 'payments.post', 'cash.deposit') |  |
| 7 | GET | /accounting/defaults | accounting/accounting.controller.ts:106 | defaults |  | @RequireAnyPermission('accounts.view', 'accounts.manage') |  |
| 8 | PUT | /accounting/defaults | accounting/accounting.controller.ts:109 | setDefaults |  | @RequirePermission('accounts.manage') |  |
| 9 | GET | /bank-accounts | accounting/accounting.controller.ts:112 | bankAccounts |  | @RequireAnyPermission('accounts.view', 'payments.post', 'cash.deposit') |  |
| 10 | POST | /bank-accounts | accounting/accounting.controller.ts:115 | createBankAccount |  | @RequirePermission('accounts.manage') |  |
| 11 | PATCH | /bank-accounts/:id | accounting/accounting.controller.ts:118 | updateBankAccount |  | @RequirePermission('accounts.manage') |  |
| 12 | GET | /journals | accounting/accounting.controller.ts:123 | listJournals |  | @RequireAnyPermission('accounts.view', 'journals.post', 'cash.deposit') |  |
| 13 | GET | /journals/:id | accounting/accounting.controller.ts:126 | journal |  | @RequireAnyPermission('accounts.view', 'journals.post', 'cash.deposit') |  |
| 14 | POST | /journals | accounting/accounting.controller.ts:129 | createJournal |  | @RequireAnyPermission('journals.post', 'cash.deposit') |  |
| 15 | PATCH | /journals/:id | accounting/accounting.controller.ts:132 | updateJournal |  | @RequireAnyPermission('journals.post', 'cash.deposit') |  |
| 16 | POST | /journals/:id/post | accounting/accounting.controller.ts:135 | postJournal |  | @RequireAnyPermission('journals.post', 'cash.deposit') |  |
| 17 | POST | /journals/:id/cancel | accounting/accounting.controller.ts:138 | cancelJournal |  | @RequireAnyPermission('journals.post', 'cash.deposit') |  |
| 18 | GET | /payments | accounting/accounting.controller.ts:143 | listPayments |  | @RequireAnyPermission('accounts.view', 'payments.post', 'cash.deposit') |  |
| 19 | GET | /payments/:id | accounting/accounting.controller.ts:146 | payment |  | @RequireAnyPermission('accounts.view', 'payments.post', 'cash.deposit') |  |
| 20 | POST | /payments | accounting/accounting.controller.ts:149 | createPayment |  | @RequireAnyPermission('payments.post', 'cash.deposit') |  |
| 21 | PATCH | /payments/:id | accounting/accounting.controller.ts:152 | updatePayment |  | @RequireAnyPermission('payments.post', 'cash.deposit') |  |
| 22 | POST | /payments/:id/post | accounting/accounting.controller.ts:155 | postPayment |  | @RequireAnyPermission('payments.post', 'cash.deposit') |  |
| 23 | POST | /payments/:id/cancel | accounting/accounting.controller.ts:158 | cancelPayment |  | @RequireAnyPermission('payments.post', 'cash.deposit') |  |
| 24 | GET | /parties/:type/:id/open-items | accounting/accounting.controller.ts:161 | openItems |  | @RequireAnyPermission('accounts.view', 'payments.post', 'journals.post') |  |
| 25 | GET | /parties/:type/:id/settlements | accounting/accounting.controller.ts:164 | settlements |  | @RequireAnyPermission('accounts.view', 'payments.post') |  |
| 26 | POST | /settlements | accounting/accounting.controller.ts:167 | settle |  | @RequirePermission('payments.post') |  |
| 27 | POST | /settlements/:id/undo | accounting/accounting.controller.ts:170 | undoSettlement |  | @RequirePermission('payments.post') |  |
| 28 | GET | /expenses/options | accounting/accounting.controller.ts:175 | expenseOptions |  | @RequireModule('expenses') @RequireAnyPermission('expenses.post', 'accounts.view') |  |
| 29 | GET | /expenses | accounting/accounting.controller.ts:178 | listExpenses |  | @RequireModule('expenses') @RequireAnyPermission('expenses.post', 'accounts.view') |  |
| 30 | GET | /expenses/:id | accounting/accounting.controller.ts:181 | expense |  | @RequireModule('expenses') @RequireAnyPermission('expenses.post', 'accounts.view') |  |
| 31 | POST | /expenses | accounting/accounting.controller.ts:184 | createExpense |  | @RequireModule('expenses') @RequirePermission('expenses.post') |  |
| 32 | POST | /expenses/:id/cancel | accounting/accounting.controller.ts:187 | cancelExpense |  | @RequireModule('expenses') @RequirePermission('expenses.post') |  |
| 33 | GET | /opening-bills | accounting/accounting.controller.ts:192 | openingBills |  | @RequireAnyPermission('accounts.view', 'journals.post') |  |
| 34 | POST | /opening-bills | accounting/accounting.controller.ts:195 | createOpeningBill |  | @RequirePermission('journals.post') |  |
| 35 | POST | /opening-bills/:id/cancel | accounting/accounting.controller.ts:198 | cancelOpeningBill |  | @RequirePermission('journals.post') |  |
| 36 | GET | /accounting/opening-check | accounting/accounting.controller.ts:201 | openingCheck |  | @RequireAnyPermission('accounts.view', 'journals.post') |  |
| 37 | PATCH | /accounting/lock-date | accounting/accounting.controller.ts:204 | setLockDate |  | @RequirePermission('books.lock') |  |
| 38 | GET | /year-end-closings | accounting/accounting.controller.ts:207 | closings |  | @RequireAnyPermission('accounts.view', 'books.lock') |  |
| 39 | POST | /year-end-closings | accounting/accounting.controller.ts:210 | close |  | @RequirePermission('books.lock') |  |
| 40 | POST | /year-end-closings/:id/cancel | accounting/accounting.controller.ts:213 | cancelClosing |  | @RequirePermission('books.lock') |  |
| 41 | GET | /ledger/entries | accounting/accounting.controller.ts:218 | documentEntries |  | @RequirePermission('accounts.view') |  |
| 42 | GET | /reports/general-ledger | accounting/accounting.controller.ts:221 | generalLedger |  | @RequirePermission('accounts.view') |  |
| 43 | GET | /reports/cash-book | accounting/accounting.controller.ts:224 | cashBook |  | @RequireModule('expenses') @RequireAnyPermission('accounts.view', 'expenses.post') |  |
| 44 | GET | /reports/day-book | accounting/accounting.controller.ts:227 | dayBook |  | @RequirePermission('accounts.view') |  |
| 45 | GET | /reports/trial-balance | accounting/accounting.controller.ts:231 | trialBalance |  | @RequirePermission('accounts.view') |  |
| 46 | GET | /reports/profit-and-loss | accounting/accounting.controller.ts:235 | profitAndLoss |  | @RequirePermission('accounts.view') |  |
| 47 | GET | /reports/balance-sheet | accounting/accounting.controller.ts:239 | balanceSheet |  | @RequirePermission('accounts.view') |  |
| 48 | GET | /reports/party-statement/:type/:id | accounting/accounting.controller.ts:242 | partyStatement |  | @RequireAnyPermission('accounts.view', 'payments.post') |  |
| 49 | GET | /reports/ageing | accounting/accounting.controller.ts:250 | ageing |  | @RequireAnyPermission('accounts.view', 'payments.post') |  |
| 50 | GET | /reports/stock-vs-accounts | accounting/accounting.controller.ts:253 | stockVsAccounts |  | @RequirePermission('accounts.view') |  |
| 51 | GET | /reports/book-health | accounting/accounting.controller.ts:256 | bookHealth |  | @RequirePermission('accounts.view') |  |
| 52 | GET | /tally/ledger-map | accounting/accounting.controller.ts:261 | tallyLedgerMap |  | @RequireModule('tally') @RequireAnyPermission('tally.export', 'accounts.view') |  |
| 53 | PUT | /tally/ledger-map | accounting/accounting.controller.ts:264 | saveTallyLedgerMap |  | @RequireModule('tally') @RequireAnyPermission('tally.export', 'accounts.manage') |  |
| 54 | GET | /tally/vouchers | accounting/accounting.controller.ts:267 | tallyVouchers |  | @RequireModule('tally') @RequirePermission('tally.export') |  |
| 55 | GET | /tally/ledgers | accounting/accounting.controller.ts:270 | tallyLedgers |  | @RequireModule('tally') @RequirePermission('tally.export') |  |
| 56 | GET | /audit | audit/audit.controller.ts:18 | changes | @RequirePermission('audit.view') |  |  |
| 57 | GET | /audit/logins | audit/audit.controller.ts:24 | logins | @RequirePermission('audit.view') |  |  |
| 58 | POST | /auth/login | auth/auth.controller.ts:35 | login |  | @Public() @RateLimit('login') |  |
| 59 | POST | /auth/logout | auth/auth.controller.ts:51 | logout |  | @AllowPasswordChangePending() |  |
| 60 | GET | /auth/me | auth/auth.controller.ts:59 | me |  | @AllowPasswordChangePending() |  |
| 61 | POST | /auth/change-password | auth/auth.controller.ts:66 | changePassword |  | @AllowPasswordChangePending() |  |
| 62 | POST | /auth/forgot-password | auth/auth.controller.ts:81 | forgotPassword |  | @Public() @RateLimit('forgotPassword') |  |
| 63 | POST | /auth/reset-password | auth/auth.controller.ts:90 | newPasswordByLink |  | @Public() @RateLimit('emailLink') |  |
| 64 | POST | /auth/confirm-email | auth/auth.controller.ts:98 | confirmEmail |  | @Public() @RateLimit('emailLink') |  |
| 65 | POST | /auth/resend-confirmation | auth/auth.controller.ts:105 | resendConfirmation |  | @AllowPasswordChangePending() |  |
| 66 | GET | /auth/sessions | auth/auth.controller.ts:111 | sessions |  |  |  |
| 67 | DELETE | /auth/sessions/:id | auth/auth.controller.ts:116 | endSession |  |  |  |
| 68 | GET | /catalogue/units | catalogue/catalogue.controller.ts:51 | listUnits |  | @RequirePermission(VIEW) |  |
| 69 | POST | /catalogue/units | catalogue/catalogue.controller.ts:54 | createUnit |  | @RequirePermission(MANAGE) |  |
| 70 | PATCH | /catalogue/units/:id | catalogue/catalogue.controller.ts:57 | updateUnit |  | @RequirePermission(MANAGE) |  |
| 71 | GET | /catalogue/unit-conversions | catalogue/catalogue.controller.ts:64 | listConversions |  | @RequirePermission(VIEW) |  |
| 72 | POST | /catalogue/unit-conversions | catalogue/catalogue.controller.ts:67 | createConversion |  | @RequirePermission(MANAGE) |  |
| 73 | GET | /catalogue/item-groups | catalogue/catalogue.controller.ts:75 | groupTree |  | @RequirePermission(VIEW) |  |
| 74 | POST | /catalogue/item-groups | catalogue/catalogue.controller.ts:78 | createGroup |  | @RequirePermission(MANAGE) |  |
| 75 | PATCH | /catalogue/item-groups/:id | catalogue/catalogue.controller.ts:84 | updateGroup |  | @RequirePermission(MANAGE) |  |
| 76 | GET | /catalogue/brands | catalogue/catalogue.controller.ts:93 | listBrands |  | @RequirePermission(VIEW) |  |
| 77 | POST | /catalogue/brands | catalogue/catalogue.controller.ts:96 | createBrand |  | @RequirePermission(MANAGE) |  |
| 78 | PATCH | /catalogue/brands/:id | catalogue/catalogue.controller.ts:99 | updateBrand |  | @RequirePermission(MANAGE) |  |
| 79 | GET | /catalogue/official-hsn | catalogue/catalogue.controller.ts:108 | searchOfficialHsn |  | @RequireAnyPermission(VIEW, 'gst_rates.manage') |  |
| 80 | GET | /catalogue/official-hsn/:code | catalogue/catalogue.controller.ts:111 | officialHsnCode |  | @RequireAnyPermission(VIEW, 'gst_rates.manage') |  |
| 81 | GET | /catalogue/hsn-codes | catalogue/catalogue.controller.ts:117 | listHsn |  | @RequirePermission(VIEW) |  |
| 82 | POST | /catalogue/hsn-codes | catalogue/catalogue.controller.ts:120 | createHsn |  | @RequirePermission(MANAGE) |  |
| 83 | PATCH | /catalogue/hsn-codes/:id | catalogue/catalogue.controller.ts:123 | updateHsn |  | @RequirePermission(MANAGE) |  |
| 84 | GET | /catalogue/attributes | catalogue/catalogue.controller.ts:132 | listAttributes |  | @RequireModule('variants') @RequirePermission(VIEW) |  |
| 85 | POST | /catalogue/attributes | catalogue/catalogue.controller.ts:135 | createAttribute |  | @RequireModule('variants') @RequirePermission(MANAGE) |  |
| 86 | PATCH | /catalogue/attributes/:id | catalogue/catalogue.controller.ts:141 | updateAttribute |  | @RequireModule('variants') @RequirePermission(MANAGE) |  |
| 87 | GET | /catalogue/settings | catalogue/catalogue.controller.ts:150 | getSettings |  | @RequirePermission(VIEW) |  |
| 88 | PATCH | /catalogue/settings | catalogue/catalogue.controller.ts:153 | updateSettings |  | @OwnerAdminOnly() |  |
| 89 | GET | /company | company/company.controller.ts:20 | get |  | @RequirePermission('company.view') |  |
| 90 | PATCH | /company | company/company.controller.ts:26 | update |  | @RequirePermission('company.manage') |  |
| 91 | GET | /company/gst-registrations | company/company.controller.ts:32 | gstRegistrations |  | @RequirePermission('company.view') |  |
| 92 | POST | /company/gst-registrations | company/company.controller.ts:38 | createGstRegistration |  | @RequirePermission('company.manage') |  |
| 93 | PATCH | /company/gst-registrations/:id | company/company.controller.ts:47 | updateGstRegistration |  | @RequirePermission('company.manage') |  |
| 94 | GET | /print/settings | documents/documents.controller.ts:63 | printSettings |  | @RequireAnyPermission('print.settings', 'purchase.view', 'stock.view', 'accounts.view', 'payments.post', 'journals.post', 'cash.deposit', 'orders.manage', 'alterations.manage', 'pos.sell', 'pos.reports') |  |
| 95 | PUT | /print/settings | documents/documents.controller.ts:66 | savePrintSettings |  | @RequirePermission('print.settings') |  |
| 96 | GET | /print/logo | documents/documents.controller.ts:70 | printLogo |  | @RequireAnyPermission('print.settings', 'purchase.view', 'stock.view', 'accounts.view', 'payments.post', 'journals.post', 'cash.deposit', 'labels.print', 'orders.manage', 'alterations.manage', 'pos.sell', 'pos.reports') |  |
| 97 | POST | /print/logo | documents/documents.controller.ts:80 | saveLogo |  | @RequirePermission('print.settings') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 400_000 } })) |  |
| 98 | GET | /print/terms | documents/documents.controller.ts:83 | terms |  | @RequireAnyPermission('print.settings', 'purchase.view', 'accounts.view') |  |
| 99 | POST | /print/terms | documents/documents.controller.ts:86 | createTerms |  | @RequirePermission('print.settings') |  |
| 100 | PATCH | /print/terms/:id | documents/documents.controller.ts:89 | updateTerms |  | @RequirePermission('print.settings') |  |
| 101 | GET | /print/:kind/:id | documents/documents.controller.ts:93 | document |  | @RequireAnyPermission('purchase.view', 'stock.view', 'accounts.view', 'payments.post', 'journals.post', 'cash.deposit', 'orders.manage', 'alterations.manage', 'pos.sell', 'pos.reports') |  |
| 102 | GET | /labels/templates | documents/documents.controller.ts:103 | labelTemplates |  | @RequireAnyPermission('labels.print', 'print.settings') |  |
| 103 | POST | /labels/templates | documents/documents.controller.ts:106 | createLabelTemplate |  | @RequirePermission('print.settings') |  |
| 104 | PATCH | /labels/templates/:id | documents/documents.controller.ts:109 | updateLabelTemplate |  | @RequirePermission('print.settings') |  |
| 105 | POST | /labels/data | documents/documents.controller.ts:112 | labels |  | @RequirePermission('labels.print') |  |
| 106 | GET | /imports/kinds | documents/documents.controller.ts:117 | importKinds |  | @RequireAnyPermission('import.masters', 'import.opening') |  |
| 107 | GET | /imports/templates/:kind | documents/documents.controller.ts:120 | template |  | @RequireAnyPermission('import.masters', 'import.opening') |  |
| 108 | POST | /imports/preview | documents/documents.controller.ts:123 | preview |  | @RequireAnyPermission('import.masters', 'import.opening') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } })) |  |
| 109 | POST | /imports/:id/run | documents/documents.controller.ts:139 | run |  | @RequireAnyPermission('import.masters', 'import.opening') |  |
| 110 | GET | /imports | documents/documents.controller.ts:142 | importJobs |  | @RequireAnyPermission('import.masters', 'import.opening') |  |
| 111 | GET | /imports/:id | documents/documents.controller.ts:145 | importJob |  | @RequireAnyPermission('import.masters', 'import.opening') |  |
| 112 | GET | /imports/:id/failed-rows | documents/documents.controller.ts:148 | failedRows |  | @RequireAnyPermission('import.masters', 'import.opening') |  |
| 113 | GET | /exports/:kind | documents/documents.controller.ts:153 | export |  | @RequirePermission('export.masters') |  |
| 114 | GET | /data-export | documents/documents.controller.ts:162 | exportAll |  | @RequirePermission('data.export_all') |  |
| 115 | GET | /go-live | documents/documents.controller.ts:167 | goLiveStatus |  | @RequirePermission('golive.manage') |  |
| 116 | POST | /go-live/clear-trial-data | documents/documents.controller.ts:170 | clear |  | @RequirePermission('golive.manage') |  |
| 117 | POST | /go-live/date | documents/documents.controller.ts:173 | goLiveDate |  | @RequirePermission('golive.manage') |  |
| 118 | GET | /financial-years | financial-years/financial-years.controller.ts:19 | list |  | @RequirePermission('company.view') |  |
| 119 | POST | /financial-years | financial-years/financial-years.controller.ts:25 | create |  | @RequirePermission('financial_years.manage') |  |
| 120 | PATCH | /financial-years/:id | financial-years/financial-years.controller.ts:34 | update |  | @RequirePermission('financial_years.manage') |  |
| 121 | GET | /gst/e-invoices | gst-portal/gst-portal.controller.ts:58 | list |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') |  |
| 122 | GET | /gst/e-invoices/:id | gst-portal/gst-portal.controller.ts:61 | one |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') |  |
| 123 | POST | /gst/e-invoices/export | gst-portal/gst-portal.controller.ts:64 | exportFile |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') |  |
| 124 | POST | /gst/e-invoices/import | gst-portal/gst-portal.controller.ts:67 | importFile |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANSWER_FILE } })) |  |
| 125 | POST | /gst/e-invoices/:id/registration | gst-portal/gst-portal.controller.ts:70 | manual |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') |  |
| 126 | POST | /gst/e-invoices/:id/retry | gst-portal/gst-portal.controller.ts:73 | retry |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') |  |
| 127 | POST | /gst/e-invoices/:id/cancel | gst-portal/gst-portal.controller.ts:76 | cancel |  | @RequireModule('einvoice') @RequirePermission('einvoice.manage') |  |
| 128 | GET | /gst/e-way-bills | gst-portal/gst-portal.controller.ts:81 | ewayList |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 129 | GET | /gst/e-way-bills/needed | gst-portal/gst-portal.controller.ts:84 | needed |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 130 | GET | /gst/e-way-bills/for/:documentType/:documentId | gst-portal/gst-portal.controller.ts:87 | forDocument |  | @RequireModule('eway') @RequireAnyPermission('eway.manage', 'stock.view', 'pos.reports') |  |
| 131 | GET | /gst/e-way-bills/:id | gst-portal/gst-portal.controller.ts:94 | ewayOne |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 132 | POST | /gst/e-way-bills | gst-portal/gst-portal.controller.ts:97 | draft |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 133 | PATCH | /gst/e-way-bills/:id | gst-portal/gst-portal.controller.ts:100 | ewayUpdate |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 134 | POST | /gst/e-way-bills/export | gst-portal/gst-portal.controller.ts:103 | ewayExport |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 135 | POST | /gst/e-way-bills/import | gst-portal/gst-portal.controller.ts:106 | ewayImport |  | @RequireModule('eway') @RequirePermission('eway.manage') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANSWER_FILE } })) |  |
| 136 | POST | /gst/e-way-bills/:id/generated | gst-portal/gst-portal.controller.ts:109 | generated |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 137 | POST | /gst/e-way-bills/:id/cancel | gst-portal/gst-portal.controller.ts:112 | ewayCancel |  | @RequireModule('eway') @RequirePermission('eway.manage') |  |
| 138 | GET | /gst/settings | gst/gst-core.controller.ts:17 | settings |  | @RequireAnyPermission('gst_rates.manage', 'pos.setup', 'pos.sell', 'pos.reports') |  |
| 139 | PATCH | /gst/settings | gst/gst-core.controller.ts:21 | update |  | @RequirePermission('gst_rates.manage') |  |
| 140 | POST | /gstin/check | gst/gstin-check/gstin-check.controller.ts:16 | check |  | @RequireAnyPermission('customers.manage', 'suppliers.manage') |  |
| 141 | POST | /client-errors | health/client-errors.controller.ts:27 | report |  | @Public() @RateLimit('clientError') |  |
| 142 | GET | /health | health/health.controller.ts:17 | get | @Public() |  |  |
| 143 | GET | /stock/locations | inventory/inventory.controller.ts:48 | locations |  | @RequirePermission('stock.view') |  |
| 144 | POST | /stock/locations | inventory/inventory.controller.ts:51 | createLocation |  | @RequirePermission('stock.locations.manage') |  |
| 145 | PATCH | /stock/locations/:id | inventory/inventory.controller.ts:54 | updateLocation |  | @RequirePermission('stock.locations.manage') |  |
| 146 | GET | /stock/documents | inventory/inventory.controller.ts:59 | list |  | @RequirePermission('stock.view') |  |
| 147 | POST | /stock/documents | inventory/inventory.controller.ts:62 | create |  | @RequireAnyPermission('stock.count', 'stock.move') |  |
| 148 | GET | /stock/documents/:id | inventory/inventory.controller.ts:65 | get |  | @RequirePermission('stock.view') |  |
| 149 | PATCH | /stock/documents/:id | inventory/inventory.controller.ts:68 | update |  | @RequireAnyPermission('stock.count', 'stock.move') |  |
| 150 | POST | /stock/documents/:id/finalise | inventory/inventory.controller.ts:71 | finalise |  | @RequireAnyPermission('stock.adjust_finalise', 'stock.move') |  |
| 151 | POST | /stock/documents/:id/cancel | inventory/inventory.controller.ts:74 | cancel |  | @RequireAnyPermission('stock.adjust_finalise', 'stock.move', 'stock.count') |  |
| 152 | GET | /stock/transfers/in-transit | inventory/inventory.controller.ts:79 | inTransit |  | @RequireModule('transfers') @RequirePermission('stock.view') |  |
| 153 | POST | /stock/transfers/:id/receive | inventory/inventory.controller.ts:82 | receive |  | @RequireModule('transfers') @RequirePermission('stock.move') |  |
| 154 | POST | /stock/counts | inventory/inventory.controller.ts:87 | createCount |  | @RequirePermission('stock.count') |  |
| 155 | PATCH | /stock/counts/:id | inventory/inventory.controller.ts:90 | updateCount |  | @RequirePermission('stock.count') |  |
| 156 | GET | /stock/balance | inventory/inventory.controller.ts:95 | balance |  | @RequirePermission('stock.view') |  |
| 157 | GET | /stock/style-grid | inventory/inventory.controller.ts:99 | styleGrid |  | @RequireModule('variants') @RequirePermission('stock.view') |  |
| 158 | GET | /stock/ledger | inventory/inventory.controller.ts:102 | ledger |  | @RequirePermission('stock.view') |  |
| 159 | GET | /stock/lookup/:code | inventory/inventory.controller.ts:105 | lookup |  | @RequirePermission('stock.view') |  |
| 160 | GET | /stock/batches | inventory/inventory.controller.ts:108 | batches |  | @RequireModule('batches') @RequirePermission('stock.view') |  |
| 161 | GET | /stock/exceptions/negative | inventory/inventory.controller.ts:111 | negative |  | @RequirePermission('stock.view') |  |
| 162 | GET | /stock/consistency | inventory/inventory.controller.ts:114 | consistency |  | @RequirePermission('stock.lock') |  |
| 163 | GET | /stock/reorder-levels | inventory/inventory.controller.ts:119 | reorder |  | @RequirePermission('stock.view') |  |
| 164 | POST | /stock/reorder-levels | inventory/inventory.controller.ts:122 | setReorder |  | @RequirePermission('stock.locations.manage') |  |
| 165 | GET | /stock/settings | inventory/inventory.controller.ts:125 | settings |  | @RequirePermission('stock.view') |  |
| 166 | PATCH | /stock/settings | inventory/inventory.controller.ts:128 | updateSettings |  | @RequirePermission('stock.lock') |  |
| 167 | GET | /catalogue/scan/:code | items/items.controller.ts:42 | scan |  | @RequirePermission('catalogue.view') |  |
| 168 | GET | /items | items/items.controller.ts:48 | list |  | @RequirePermission('catalogue.view') |  |
| 169 | POST | /items | items/items.controller.ts:54 | create |  | @RequirePermission('catalogue.manage') |  |
| 170 | GET | /items/:id | items/items.controller.ts:60 | get |  | @RequirePermission('catalogue.view') |  |
| 171 | PATCH | /items/:id | items/items.controller.ts:66 | update |  | @RequirePermission('catalogue.manage') |  |
| 172 | PUT | /items/:id/units | items/items.controller.ts:77 | setUnits |  | @RequirePermission('catalogue.manage') |  |
| 173 | POST | /items/:id/barcodes | items/items.controller.ts:88 | addBarcode |  | @RequirePermission('catalogue.manage') |  |
| 174 | PATCH | /items/:id/barcodes/:barcodeId | items/items.controller.ts:94 | updateBarcode |  | @RequirePermission('catalogue.manage') |  |
| 175 | POST | /items/:id/apply-to-variants | items/items.controller.ts:106 | applyToVariants |  | @RequireModule('variants') @RequirePermission('catalogue.manage') |  |
| 176 | GET | /items/:id/variants | items/items.controller.ts:114 | variants |  | @RequireModule('variants') @RequirePermission('catalogue.view') |  |
| 177 | POST | /items/:id/variants | items/items.controller.ts:121 | createVariants |  | @RequireModule('variants') @RequirePermission('catalogue.manage') |  |
| 178 | GET | /seasons | items/items.controller.ts:135 | listSeasons |  | @RequireModule('seasons') @RequirePermission('catalogue.view') |  |
| 179 | POST | /seasons | items/items.controller.ts:142 | createSeason |  | @RequireModule('seasons') @RequirePermission('catalogue.manage') |  |
| 180 | PATCH | /seasons/:id | items/items.controller.ts:149 | updateSeason |  | @RequireModule('seasons') @RequirePermission('catalogue.manage') |  |
| 181 | GET | /items/:id/image | items/items.controller.ts:156 | image |  | @RequirePermission('catalogue.view') |  |
| 182 | PUT | /items/:id/image | items/items.controller.ts:165 | setImage |  | @RequirePermission('catalogue.manage') |  |
| 183 | DELETE | /items/:id/image | items/items.controller.ts:172 | deleteImage |  | @RequirePermission('catalogue.manage') |  |
| 184 | GET | /loyalty/settings | loyalty/loyalty.controller.ts:35 | settings | @RequireModule('loyalty') | @RequireAnyPermission('loyalty.view', 'loyalty.manage', 'pos.setup', 'pos.sell') |  |
| 185 | PATCH | /loyalty/settings | loyalty/loyalty.controller.ts:38 | updateSettings | @RequireModule('loyalty') | @RequirePermission('loyalty.manage') |  |
| 186 | POST | /loyalty/tiers | loyalty/loyalty.controller.ts:41 | createTier | @RequireModule('loyalty') | @RequirePermission('loyalty.manage') |  |
| 187 | PATCH | /loyalty/tiers/:id | loyalty/loyalty.controller.ts:44 | updateTier | @RequireModule('loyalty') | @RequirePermission('loyalty.manage') |  |
| 188 | DELETE | /loyalty/tiers/:id | loyalty/loyalty.controller.ts:47 | deleteTier | @RequireModule('loyalty') | @RequirePermission('loyalty.manage') |  |
| 189 | GET | /loyalty/customers/:id | loyalty/loyalty.controller.ts:52 | customer | @RequireModule('loyalty') | @RequireAnyPermission('customers.view', 'loyalty.view') |  |
| 190 | GET | /loyalty/reports/liability | loyalty/loyalty.controller.ts:56 | liability | @RequireModule('loyalty') | @RequirePermission('loyalty.view') |  |
| 191 | GET | /loyalty/reports/by-month | loyalty/loyalty.controller.ts:59 | byMonth | @RequireModule('loyalty') | @RequirePermission('loyalty.view') |  |
| 192 | GET | /loyalty/reports/expiring | loyalty/loyalty.controller.ts:62 | expiring | @RequireModule('loyalty') | @RequirePermission('loyalty.view') |  |
| 193 | POST | /loyalty/expiry/run | loyalty/loyalty.controller.ts:67 | runExpiry | @RequireModule('loyalty') | @RequirePermission('loyalty.manage') |  |
| 194 | GET | /gift-cards/settings | loyalty/loyalty.controller.ts:77 | settings | @RequireModule('gift_cards') | @RequireAnyPermission('giftcards.view', 'giftcards.sell', 'giftcards.manage') |  |
| 195 | GET | /gift-cards/reports/liability | loyalty/loyalty.controller.ts:80 | liability | @RequireModule('gift_cards') | @RequirePermission('giftcards.view') |  |
| 196 | GET | /gift-cards/reports/by-month | loyalty/loyalty.controller.ts:83 | byMonth | @RequireModule('gift_cards') | @RequirePermission('giftcards.view') |  |
| 197 | GET | /gift-cards/reports/expiring | loyalty/loyalty.controller.ts:86 | expiring | @RequireModule('gift_cards') | @RequirePermission('giftcards.view') |  |
| 198 | POST | /gift-cards/expiry/run | loyalty/loyalty.controller.ts:89 | runExpiry | @RequireModule('gift_cards') | @RequirePermission('giftcards.manage') |  |
| 199 | GET | /gift-cards | loyalty/loyalty.controller.ts:93 | list | @RequireModule('gift_cards') | @RequireAnyPermission('giftcards.view', 'giftcards.manage') |  |
| 200 | GET | /gift-cards/:id | loyalty/loyalty.controller.ts:96 | get | @RequireModule('gift_cards') | @RequireAnyPermission('giftcards.view', 'giftcards.manage') |  |
| 201 | POST | /gift-cards/:id/block | loyalty/loyalty.controller.ts:99 | block | @RequireModule('gift_cards') | @RequirePermission('giftcards.manage') |  |
| 202 | POST | /gift-cards/:id/unblock | loyalty/loyalty.controller.ts:102 | unblock | @RequireModule('gift_cards') | @RequirePermission('giftcards.manage') |  |
| 203 | GET | /modules | modules/modules.controller.ts:14 | state |  |  |  |
| 204 | POST | /modules/shop-type | modules/modules.controller.ts:20 | shopType |  | @OwnerAdminOnly() |  |
| 205 | PATCH | /modules/:key | modules/modules.controller.ts:27 | switch |  | @OwnerAdminOnly() |  |
| 206 | GET | /number-series | numbering/numbering.controller.ts:22 | list | @RequirePermission('numbering.manage') |  |  |
| 207 | POST | /number-series | numbering/numbering.controller.ts:27 | create | @RequirePermission('numbering.manage') |  |  |
| 208 | PATCH | /number-series/:id | numbering/numbering.controller.ts:32 | update | @RequirePermission('numbering.manage') |  |  |
| 209 | GET | /number-series/:id/preview | numbering/numbering.controller.ts:41 | preview | @RequirePermission('numbering.manage') |  |  |
| 210 | PATCH | /number-series/:id/counter | numbering/numbering.controller.ts:46 | changeCounter | @RequirePermission('numbering.manage') | @OwnerAdminOnly() |  |
| 211 | GET | /orders | orders/orders.controller.ts:44 | list |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 212 | GET | /orders/credit/:customerId | orders/orders.controller.ts:47 | credit |  | @RequireModule('customer_orders') @RequireAnyPermission('orders.manage', 'pos.sell') |  |
| 213 | GET | /orders/:id | orders/orders.controller.ts:50 | get |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 214 | POST | /orders | orders/orders.controller.ts:53 | create |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 215 | PATCH | /orders/:id | orders/orders.controller.ts:56 | update |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 216 | POST | /orders/:id/ready | orders/orders.controller.ts:59 | ready |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 217 | POST | /orders/:id/cancel | orders/orders.controller.ts:62 | cancel |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 218 | POST | /orders/:id/advances | orders/orders.controller.ts:65 | officeAdvance |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') |  |
| 219 | POST | /pos/orders/:id/advances | orders/orders.controller.ts:69 | tillAdvance |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') | till-token |
| 220 | POST | /pos/orders/:id/cancel | orders/orders.controller.ts:72 | tillCancel |  | @RequireModule('customer_orders') @RequirePermission('orders.manage') | till-token |
| 221 | GET | /alterations | orders/orders.controller.ts:77 | listJobs |  | @RequireModule('alterations') @RequirePermission('alterations.manage') |  |
| 222 | GET | /alterations/:id | orders/orders.controller.ts:80 | getJob |  | @RequireModule('alterations') @RequirePermission('alterations.manage') |  |
| 223 | POST | /alterations | orders/orders.controller.ts:83 | createJob |  | @RequireModule('alterations') @RequirePermission('alterations.manage') |  |
| 224 | PATCH | /alterations/:id | orders/orders.controller.ts:86 | updateJob |  | @RequireModule('alterations') @RequirePermission('alterations.manage') |  |
| 225 | POST | /alterations/:id/status | orders/orders.controller.ts:89 | status |  | @RequireModule('alterations') @RequirePermission('alterations.manage') |  |
| 226 | GET | /customers | parties/parties.controller.ts:67 | list |  | @RequirePermission('customers.view') |  |
| 227 | POST | /customers | parties/parties.controller.ts:70 | create |  | @RequirePermission('customers.manage') |  |
| 228 | POST | /customers/quick-add | parties/parties.controller.ts:73 | quickAdd |  | @RequirePermission('customers.quick_add') |  |
| 229 | GET | /customers/birthdays | parties/parties.controller.ts:77 | birthdays |  | @RequirePermission('customers.view') |  |
| 230 | GET | /customers/:id | parties/parties.controller.ts:80 | get |  | @RequirePermission('customers.view') |  |
| 231 | PATCH | /customers/:id | parties/parties.controller.ts:83 | update |  | @RequirePermission('customers.manage') |  |
| 232 | PATCH | /customers/:id/credit | parties/parties.controller.ts:86 | credit |  | @RequirePermission('customers.credit') |  |
| 233 | GET | /customers/:id/purchases | parties/parties.controller.ts:91 | purchases |  | @RequirePermission('customers.view') |  |
| 234 | GET | /customers/:id/addresses | parties/parties.controller.ts:99 | addresses |  | @RequirePermission('customers.view') |  |
| 235 | POST | /customers/:id/addresses | parties/parties.controller.ts:102 | addAddress |  | @RequirePermission('customers.manage') |  |
| 236 | PATCH | /customers/:id/addresses/:aid | parties/parties.controller.ts:105 | updateAddress |  | @RequirePermission('customers.manage') |  |
| 237 | GET | /customers/:id/contacts | parties/parties.controller.ts:113 | contactsOf |  | @RequirePermission('customers.view') |  |
| 238 | POST | /customers/:id/contacts | parties/parties.controller.ts:116 | addContact |  | @RequirePermission('customers.manage') |  |
| 239 | PATCH | /customers/:id/contacts/:cid | parties/parties.controller.ts:119 | updateContact |  | @RequirePermission('customers.manage') |  |
| 240 | GET | /suppliers | parties/parties.controller.ts:136 | list |  | @RequirePermission('suppliers.view') |  |
| 241 | POST | /suppliers | parties/parties.controller.ts:139 | create |  | @RequirePermission('suppliers.manage') |  |
| 242 | GET | /suppliers/:id | parties/parties.controller.ts:142 | get |  | @RequirePermission('suppliers.view') |  |
| 243 | PATCH | /suppliers/:id | parties/parties.controller.ts:145 | update |  | @RequirePermission('suppliers.manage') |  |
| 244 | PATCH | /suppliers/:id/hold | parties/parties.controller.ts:148 | hold |  | @RequirePermission('suppliers.hold') |  |
| 245 | GET | /suppliers/:id/addresses | parties/parties.controller.ts:152 | addresses |  | @RequirePermission('suppliers.view') |  |
| 246 | POST | /suppliers/:id/addresses | parties/parties.controller.ts:155 | addAddress |  | @RequirePermission('suppliers.manage') |  |
| 247 | PATCH | /suppliers/:id/addresses/:aid | parties/parties.controller.ts:158 | updateAddress |  | @RequirePermission('suppliers.manage') |  |
| 248 | GET | /suppliers/:id/contacts | parties/parties.controller.ts:166 | contactsOf |  | @RequirePermission('suppliers.view') |  |
| 249 | POST | /suppliers/:id/contacts | parties/parties.controller.ts:169 | addContact |  | @RequirePermission('suppliers.manage') |  |
| 250 | PATCH | /suppliers/:id/contacts/:cid | parties/parties.controller.ts:172 | updateContact |  | @RequirePermission('suppliers.manage') |  |
| 251 | GET | /customer-groups | parties/parties.controller.ts:190 | customerGroups |  | @RequirePermission('customers.view') |  |
| 252 | POST | /customer-groups | parties/parties.controller.ts:193 | createCustomerGroup |  | @RequirePermission('customers.manage') |  |
| 253 | PATCH | /customer-groups/:id | parties/parties.controller.ts:196 | updateCustomerGroup |  | @RequirePermission('customers.manage') |  |
| 254 | GET | /supplier-groups | parties/parties.controller.ts:200 | supplierGroups |  | @RequirePermission('suppliers.view') |  |
| 255 | POST | /supplier-groups | parties/parties.controller.ts:203 | createSupplierGroup |  | @RequirePermission('suppliers.manage') |  |
| 256 | PATCH | /supplier-groups/:id | parties/parties.controller.ts:206 | updateSupplierGroup |  | @RequirePermission('suppliers.manage') |  |
| 257 | GET | /payment-terms | parties/parties.controller.ts:211 | paymentTerms |  | @RequireAnyPermission('customers.view', 'suppliers.view') |  |
| 258 | POST | /payment-terms | parties/parties.controller.ts:214 | createTerms |  | @RequirePermission('payment_terms.manage') |  |
| 259 | PATCH | /payment-terms/:id | parties/parties.controller.ts:217 | updateTerms |  | @RequirePermission('payment_terms.manage') |  |
| 260 | GET | /payment-terms/:id/due-date | parties/parties.controller.ts:220 | dueDate |  | @RequireAnyPermission('customers.view', 'suppliers.view') |  |
| 261 | GET | /party-settings | parties/parties.controller.ts:224 | getSettings |  | @RequireAnyPermission('customers.view', 'suppliers.view') |  |
| 262 | PATCH | /party-settings | parties/parties.controller.ts:227 | updateSettings |  | @OwnerAdminOnly() |  |
| 263 | POST | /leads | platform/leads.controller.ts:33 | create |  | @Public() @RateLimit('contactForm') |  |
| 264 | POST | /platform/login | platform/platform.controller.ts:31 | login |  | @Public() @RateLimit('login') |  |
| 265 | POST | /platform/logout | platform/platform.controller.ts:41 | logout |  | @Public() @UseGuards(PlatformGuard) | platform-admin |
| 266 | GET | /platform/me | platform/platform.controller.ts:50 | me |  | @Public() @UseGuards(PlatformGuard) | platform-admin |
| 267 | GET | /platform/shops | platform/platform.controller.ts:57 | shops |  | @Public() @UseGuards(PlatformGuard) |  |
| 268 | PATCH | /platform/shops/:id | platform/platform.controller.ts:64 | switchShop |  | @Public() @UseGuards(PlatformGuard) | platform-admin |
| 269 | GET | /platform/leads | platform/platform.controller.ts:71 | leads |  | @Public() @UseGuards(PlatformGuard) |  |
| 270 | PATCH | /platform/leads/:id | platform/platform.controller.ts:78 | handleLead |  | @Public() @UseGuards(PlatformGuard) |  |
| 271 | GET | /pos/till/:id/loyalty/:customerId | pos/pos-loyalty.controller.ts:22 | points |  | @RequireModule('loyalty') @RequirePermission('pos.sell') |  |
| 272 | POST | /pos/till/:id/gift-cards/check | pos/pos-loyalty.controller.ts:26 | check |  | @RequireModule('gift_cards') @RequireAnyPermission('pos.sell', 'giftcards.sell') |  |
| 273 | POST | /pos/gift-cards/sell | pos/pos-loyalty.controller.ts:30 | sell |  | @RequireModule('gift_cards') @RequirePermission('giftcards.sell') | till-token |
| 274 | GET | /pos/gst-rates | pos/pos.controller.ts:86 | gstRates |  | @RequireAnyPermission('gst_rates.manage', 'pos.setup', 'pos.sell') |  |
| 275 | POST | /pos/gst-rates | pos/pos.controller.ts:89 | createGstRate |  | @RequirePermission('gst_rates.manage') |  |
| 276 | PATCH | /pos/gst-rates/:id | pos/pos.controller.ts:92 | updateGstRate |  | @RequirePermission('gst_rates.manage') |  |
| 277 | GET | /pos/payment-methods | pos/pos.controller.ts:97 | paymentMethods |  | @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') |  |
| 278 | POST | /pos/payment-methods | pos/pos.controller.ts:100 | createPaymentMethod |  | @RequirePermission('pos.setup') |  |
| 279 | PATCH | /pos/payment-methods/:id | pos/pos.controller.ts:103 | updatePaymentMethod |  | @RequirePermission('pos.setup') |  |
| 280 | GET | /pos/tills | pos/pos.controller.ts:106 | tills |  | @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') |  |
| 281 | POST | /pos/tills | pos/pos.controller.ts:109 | createTill |  | @RequirePermission('pos.setup') |  |
| 282 | GET | /pos/tills/:id | pos/pos.controller.ts:112 | till |  | @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') |  |
| 283 | PATCH | /pos/tills/:id | pos/pos.controller.ts:115 | updateTill |  | @RequirePermission('pos.setup') |  |
| 284 | POST | /pos/tills/:id/register | pos/pos.controller.ts:118 | register |  | @RequirePermission('pos.setup') |  |
| 285 | GET | /pos/settings | pos/pos.controller.ts:121 | settings |  | @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') |  |
| 286 | GET | /pos/delivery-charges | pos/pos.controller.ts:124 | deliveryCharges |  | @RequireModule('delivery') @RequireAnyPermission('pos.setup', 'deliveries.manage') |  |
| 287 | PATCH | /pos/stores/:id/delivery-charges | pos/pos.controller.ts:127 | updateDeliveryCharges |  | @RequireModule('delivery') @RequirePermission('pos.setup') |  |
| 288 | PATCH | /pos/settings | pos/pos.controller.ts:130 | updateSettings |  | @RequirePermission('pos.setup') |  |
| 289 | POST | /pos/pin | pos/pos.controller.ts:135 | setPin |  | @RequireAnyPermission('pos.sell', 'pos.approve') |  |
| 290 | GET | /pos/pin | pos/pos.controller.ts:138 | hasPin |  | @RequireAnyPermission('pos.sell', 'pos.approve') |  |
| 291 | DELETE | /pos/pins/:userId | pos/pos.controller.ts:141 | clearPin |  | @RequirePermission('pos.shift.manage') |  |
| 292 | GET | /pos/tills/:id/people | pos/pos.controller.ts:144 | people |  | @RequirePermission('pos.sell') |  |
| 293 | POST | /pos/approvals | pos/pos.controller.ts:147 | approve |  | @RequirePermission('pos.sell') |  |
| 294 | POST | /pos/switch-cashier | pos/pos.controller.ts:150 | switchCashier |  | @RequirePermission('pos.sell') |  |
| 295 | GET | /pos/offers | pos/pos.controller.ts:155 | listOffers |  | @RequireModule('offers') @RequireAnyPermission('offers.manage', 'pos.sell') |  |
| 296 | POST | /pos/offers | pos/pos.controller.ts:158 | createOffer |  | @RequireModule('offers') @RequirePermission('offers.manage') |  |
| 297 | PATCH | /pos/offers/:id | pos/pos.controller.ts:161 | updateOffer |  | @RequireModule('offers') @RequirePermission('offers.manage') |  |
| 298 | POST | /pos/coupons | pos/pos.controller.ts:164 | createCoupon |  | @RequireModule('offers') @RequirePermission('offers.manage') |  |
| 299 | GET | /pos/till/:id/snapshot | pos/pos.controller.ts:169 | snapshot |  | @RequirePermission('pos.sell') | till-token |
| 300 | GET | /pos/till/:id/shift | pos/pos.controller.ts:172 | currentShift |  | @RequirePermission('pos.sell') |  |
| 301 | POST | /pos/shifts | pos/pos.controller.ts:175 | openShift |  | @RequirePermission('pos.sell') | till-token |
| 302 | GET | /pos/shifts/:id | pos/pos.controller.ts:178 | shift |  | @RequireAnyPermission('pos.sell', 'pos.reports') |  |
| 303 | POST | /pos/shifts/:id/cash-movements | pos/pos.controller.ts:181 | cashMovement |  | @RequirePermission('pos.sell') | till-token |
| 304 | POST | /pos/shifts/:id/close | pos/pos.controller.ts:184 | closeShift |  | @RequirePermission('pos.close') | till-token |
| 305 | POST | /pos/shifts/:id/cancel | pos/pos.controller.ts:187 | cancelShift |  | @RequirePermission('pos.shift.manage') |  |
| 306 | POST | /pos/bills | pos/pos.controller.ts:190 | postBill |  | @RequirePermission('pos.sell') | till-token |
| 307 | GET | /pos/bills | pos/pos.controller.ts:193 | listBills |  | @RequireAnyPermission('pos.sell', 'pos.reports') |  |
| 308 | GET | /pos/bills/:id | pos/pos.controller.ts:196 | getBill |  | @RequireAnyPermission('pos.sell', 'pos.reports') |  |
| 309 | POST | /pos/bills/:id/cancel | pos/pos.controller.ts:199 | cancelBill |  | @RequirePermission('pos.sell') |  |
| 310 | POST | /pos/bills/:id/reprint | pos/pos.controller.ts:202 | reprint |  | @RequirePermission('pos.sell') |  |
| 311 | GET | /pos/deliveries | pos/pos.controller.ts:207 | listDeliveries |  | @RequireModule('delivery') @RequireAnyPermission('deliveries.manage', 'pos.reports') |  |
| 312 | POST | /pos/deliveries/:id/delivered | pos/pos.controller.ts:210 | delivered |  | @RequireModule('delivery') @RequirePermission('deliveries.manage') |  |
| 313 | POST | /pos/deliveries/:id/cancel | pos/pos.controller.ts:213 | cancelDelivery |  | @RequireModule('delivery') @RequirePermission('deliveries.manage') |  |
| 314 | GET | /pos/reports/by-salesperson | pos/pos.controller.ts:218 | bySalesperson |  | @RequireModule('salesperson') @RequirePermission('pos.reports') |  |
| 315 | GET | /pos/reports/register | pos/pos.controller.ts:221 | registerReport |  | @RequirePermission('pos.reports') |  |
| 316 | GET | /pos/reports/payments | pos/pos.controller.ts:224 | paymentsReport |  | @RequirePermission('pos.reports') |  |
| 317 | GET | /pos/reports/hourly | pos/pos.controller.ts:227 | hourly |  | @RequirePermission('pos.reports') |  |
| 318 | GET | /pos/reports/by-cashier | pos/pos.controller.ts:230 | byCashier |  | @RequirePermission('pos.reports') |  |
| 319 | GET | /pos/reports/shifts | pos/pos.controller.ts:233 | shiftsReport |  | @RequirePermission('pos.reports') |  |
| 320 | GET | /pos/reports/offline-check | pos/pos.controller.ts:236 | offlineCheck |  | @RequirePermission('pos.reports') |  |
| 321 | GET | /pos/reports/sync-problems | pos/pos.controller.ts:239 | syncProblems |  | @RequirePermission('pos.reports') |  |
| 322 | POST | /pos/sync-problems/:id/resolve | pos/pos.controller.ts:242 | resolve |  | @RequirePermission('pos.shift.manage') |  |
| 323 | GET | /sales-staff | pos/sales-staff.controller.ts:18 | list | @RequireModule('salesperson') | @RequireAnyPermission('sales_staff.manage', 'pos.sell', 'pos.reports') |  |
| 324 | POST | /sales-staff | pos/sales-staff.controller.ts:21 | create | @RequireModule('salesperson') | @RequirePermission('sales_staff.manage') |  |
| 325 | PATCH | /sales-staff/:id | pos/sales-staff.controller.ts:24 | update | @RequireModule('salesperson') | @RequirePermission('sales_staff.manage') |  |
| 326 | GET | /price-lists | pricing/pricing.controller.ts:37 | lists |  | @RequirePermission('prices.view') |  |
| 327 | POST | /price-lists | pricing/pricing.controller.ts:43 | createList |  | @RequirePermission('prices.manage') |  |
| 328 | PATCH | /price-lists/:id | pricing/pricing.controller.ts:49 | updateList |  | @RequirePermission('prices.manage') |  |
| 329 | GET | /prices | pricing/pricing.controller.ts:55 | prices |  | @RequirePermission('prices.view') |  |
| 330 | GET | /prices/lookup | pricing/pricing.controller.ts:61 | lookup |  | @RequirePermission('prices.view') |  |
| 331 | POST | /prices | pricing/pricing.controller.ts:67 | create |  | @RequirePermission('prices.manage') |  |
| 332 | POST | /prices/style | pricing/pricing.controller.ts:73 | createForStyle |  | @RequirePermission('prices.manage') |  |
| 333 | PATCH | /prices/:id | pricing/pricing.controller.ts:79 | update |  | @RequirePermission('prices.manage') |  |
| 334 | GET | /markdowns | pricing/pricing.controller.ts:92 | markdownList |  | @RequireModule('seasons') @RequirePermission('prices.view') |  |
| 335 | POST | /markdowns/preview | pricing/pricing.controller.ts:99 | markdownPreview |  | @RequireModule('seasons') @RequirePermission('prices.manage') |  |
| 336 | POST | /markdowns | pricing/pricing.controller.ts:107 | markdownApply |  | @RequireModule('seasons') @RequirePermission('prices.manage') |  |
| 337 | POST | /markdowns/:id/stop | pricing/pricing.controller.ts:115 | markdownStop |  | @RequireModule('seasons') @RequirePermission('prices.manage') |  |
| 338 | GET | /markdowns/:id | pricing/pricing.controller.ts:123 | markdown |  | @RequireModule('seasons') @RequirePermission('prices.view') |  |
| 339 | GET | /purchase/consignment/stock | purchasing/consignment.controller.ts:30 | stock | @RequireModule('consignment') | @RequirePermission('purchase.view') |  |
| 340 | GET | /purchase/consignment/check | purchasing/consignment.controller.ts:33 | check | @RequireModule('consignment') | @RequirePermission('accounts.view') |  |
| 341 | GET | /purchase/consignment/statements | purchasing/consignment.controller.ts:36 | list | @RequireModule('consignment') | @RequirePermission('purchase.view') |  |
| 342 | POST | /purchase/consignment/statements | purchasing/consignment.controller.ts:39 | create | @RequireModule('consignment') | @RequirePermission('purchase.bill') |  |
| 343 | GET | /purchase/consignment/statements/:id | purchasing/consignment.controller.ts:42 | get | @RequireModule('consignment') | @RequirePermission('purchase.view') |  |
| 344 | POST | /purchase/consignment/statements/:id/bill | purchasing/consignment.controller.ts:45 | bill | @RequireModule('consignment') | @RequirePermission('purchase.bill') |  |
| 345 | POST | /purchase/consignment/statements/:id/cancel | purchasing/consignment.controller.ts:48 | cancel | @RequireModule('consignment') | @RequirePermission('purchase.bill') |  |
| 346 | GET | /gst/purchase-register | purchasing/gst-inward.controller.ts:21 | register |  | @RequirePermission('gst.input_credit') |  |
| 347 | GET | /gst/inward-statements | purchasing/gst-inward.controller.ts:37 | statements |  | @RequirePermission('gst.input_credit') |  |
| 348 | POST | /gst/inward-statements | purchasing/gst-inward.controller.ts:41 | upload |  | @RequirePermission('gst.input_credit') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT } })) |  |
| 349 | GET | /gst/inward-statements/:id/match | purchasing/gst-inward.controller.ts:48 | match |  | @RequirePermission('gst.input_credit') |  |
| 350 | GET | /purchase/orders | purchasing/purchasing.controller.ts:73 | listOrders |  | @RequireModule('purchase_orders') @RequirePermission('purchase.view') |  |
| 351 | POST | /purchase/orders | purchasing/purchasing.controller.ts:76 | createOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.order') |  |
| 352 | GET | /purchase/orders/:id | purchasing/purchasing.controller.ts:79 | getOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.view') |  |
| 353 | GET | /purchase/orders/:id/open-lines | purchasing/purchasing.controller.ts:82 | openLines |  | @RequireModule('purchase_orders') @RequirePermission('purchase.view') |  |
| 354 | PATCH | /purchase/orders/:id | purchasing/purchasing.controller.ts:85 | updateOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.order') |  |
| 355 | POST | /purchase/orders/:id/finalise | purchasing/purchasing.controller.ts:88 | finaliseOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.order') |  |
| 356 | POST | /purchase/orders/:id/hold | purchasing/purchasing.controller.ts:91 | holdOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.approve') |  |
| 357 | POST | /purchase/orders/:id/release | purchasing/purchasing.controller.ts:94 | releaseOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.approve') |  |
| 358 | POST | /purchase/orders/:id/close | purchasing/purchasing.controller.ts:97 | closeOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.approve') |  |
| 359 | POST | /purchase/orders/:id/reopen | purchasing/purchasing.controller.ts:100 | reopenOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.approve') |  |
| 360 | POST | /purchase/orders/:id/cancel | purchasing/purchasing.controller.ts:103 | cancelOrder |  | @RequireModule('purchase_orders') @RequirePermission('purchase.order') |  |
| 361 | GET | /purchase/receipts | purchasing/purchasing.controller.ts:108 | listReceipts |  | @RequirePermission('purchase.view') |  |
| 362 | POST | /purchase/receipts | purchasing/purchasing.controller.ts:111 | createReceipt |  | @RequirePermission('purchase.receive') |  |
| 363 | GET | /purchase/receipts/:id | purchasing/purchasing.controller.ts:114 | getReceipt |  | @RequirePermission('purchase.view') |  |
| 364 | PATCH | /purchase/receipts/:id | purchasing/purchasing.controller.ts:117 | updateReceipt |  | @RequirePermission('purchase.receive') |  |
| 365 | POST | /purchase/receipts/:id/finalise | purchasing/purchasing.controller.ts:120 | finaliseReceipt |  | @RequirePermission('purchase.receive') |  |
| 366 | POST | /purchase/receipts/:id/check | purchasing/purchasing.controller.ts:123 | checkReceipt |  | @RequirePermission('purchase.receive') |  |
| 367 | POST | /purchase/receipts/:id/close | purchasing/purchasing.controller.ts:126 | closeReceipt |  | @RequirePermission('purchase.bill') |  |
| 368 | POST | /purchase/receipts/:id/cancel | purchasing/purchasing.controller.ts:129 | cancelReceipt |  | @RequireAnyPermission('purchase.receive', 'purchase.return') |  |
| 369 | POST | /purchase/receipts/:id/return | purchasing/purchasing.controller.ts:132 | returnGoods |  | @RequirePermission('purchase.return') |  |
| 370 | GET | /purchase/bills | purchasing/purchasing.controller.ts:137 | listBills |  | @RequirePermission('purchase.view') |  |
| 371 | POST | /purchase/bills | purchasing/purchasing.controller.ts:140 | createBill |  | @RequirePermission('purchase.bill') |  |
| 372 | GET | /purchase/bills/:id | purchasing/purchasing.controller.ts:143 | getBill |  | @RequirePermission('purchase.view') |  |
| 373 | PATCH | /purchase/bills/:id | purchasing/purchasing.controller.ts:146 | updateBill |  | @RequirePermission('purchase.bill') |  |
| 374 | POST | /purchase/bills/:id/finalise | purchasing/purchasing.controller.ts:149 | finaliseBill |  | @RequirePermission('purchase.bill') |  |
| 375 | POST | /purchase/bills/:id/cancel | purchasing/purchasing.controller.ts:152 | cancelBill |  | @RequireAnyPermission('purchase.bill', 'purchase.return') |  |
| 376 | POST | /purchase/bills/:id/hold | purchasing/purchasing.controller.ts:155 | holdBill |  | @RequirePermission('purchase.bill') |  |
| 377 | POST | /purchase/bills/:id/release | purchasing/purchasing.controller.ts:158 | releaseBill |  | @RequirePermission('purchase.bill') |  |
| 378 | POST | /purchase/bills/:id/debit-note | purchasing/purchasing.controller.ts:161 | debitNote |  | @RequirePermission('purchase.return') |  |
| 379 | GET | /purchase/charges | purchasing/purchasing.controller.ts:166 | listCharges |  | @RequirePermission('purchase.view') |  |
| 380 | POST | /purchase/charges/preview | purchasing/purchasing.controller.ts:169 | previewCharges |  | @RequirePermission('purchase.charges') |  |
| 381 | POST | /purchase/charges | purchasing/purchasing.controller.ts:172 | createCharge |  | @RequirePermission('purchase.charges') |  |
| 382 | GET | /purchase/charges/:id | purchasing/purchasing.controller.ts:175 | getCharge |  | @RequirePermission('purchase.view') |  |
| 383 | POST | /purchase/charges/:id/finalise | purchasing/purchasing.controller.ts:178 | finaliseCharge |  | @RequirePermission('purchase.charges') |  |
| 384 | POST | /purchase/charges/:id/cancel | purchasing/purchasing.controller.ts:181 | cancelCharge |  | @RequirePermission('purchase.charges') |  |
| 385 | GET | /purchase/reorder-suggestions | purchasing/purchasing.controller.ts:186 | suggestions |  | @RequirePermission('purchase.view') |  |
| 386 | POST | /purchase/reorder-suggestions/run | purchasing/purchasing.controller.ts:189 | runSuggestions |  | @RequirePermission('purchase.order') |  |
| 387 | POST | /purchase/reorder-suggestions/create-orders | purchasing/purchasing.controller.ts:192 | ordersFromSuggestions |  | @RequireModule('purchase_orders') @RequirePermission('purchase.order') |  |
| 388 | GET | /purchase/reports/order-follow-up | purchasing/purchasing.controller.ts:197 | followUp |  | @RequireModule('purchase_orders') @RequirePermission('purchase.view') |  |
| 389 | GET | /purchase/reports/received-not-billed | purchasing/purchasing.controller.ts:200 | notBilled |  | @RequirePermission('purchase.view') |  |
| 390 | GET | /purchase/reports/register | purchasing/purchasing.controller.ts:203 | register |  | @RequirePermission('purchase.view') |  |
| 391 | GET | /purchase/reports/by-supplier | purchasing/purchasing.controller.ts:206 | bySupplier |  | @RequirePermission('purchase.view') |  |
| 392 | GET | /purchase/reports/by-item | purchasing/purchasing.controller.ts:209 | byItem |  | @RequirePermission('purchase.view') |  |
| 393 | GET | /purchase/settings | purchasing/purchasing.controller.ts:212 | getSettings |  | @RequirePermission('purchase.view') |  |
| 394 | PATCH | /purchase/settings | purchasing/purchasing.controller.ts:215 | updateSettings |  | @RequirePermission('purchase.settings') |  |
| 395 | GET | /reports/gst/registrations | reports/gst-returns.controller.ts:26 | registrations |  | @RequireAnyPermission('gst.returns', 'gst.input_credit') |  |
| 396 | GET | /reports/gst/sales-register | reports/gst-returns.controller.ts:30 | salesRegister |  | @RequirePermission('gst.returns') |  |
| 397 | GET | /reports/gst/gstr1 | reports/gst-returns.controller.ts:34 | gstr1 |  | @RequirePermission('gst.returns') |  |
| 398 | GET | /reports/gst/gstr1/excel | reports/gst-returns.controller.ts:39 | gstr1Excel |  | @RequirePermission('gst.returns') |  |
| 399 | GET | /reports/gst/gstr1/json | reports/gst-returns.controller.ts:49 | gstr1Json |  | @RequirePermission('gst.returns') |  |
| 400 | GET | /reports/gst/gstr3b | reports/gst-returns.controller.ts:58 | gstr3b |  | @RequirePermission('gst.returns') |  |
| 401 | GET | /reports/gst/notes | reports/gst-returns.controller.ts:62 | notes |  | @RequirePermission('gst.returns') |  |
| 402 | GET | /reports/gst/payable | reports/gst-returns.controller.ts:66 | payable |  | @RequirePermission('gst.returns') |  |
| 403 | GET | /attention | reports/reports.controller.ts:40 | attentionList |  |  |  |
| 404 | GET | /dashboards | reports/reports.controller.ts:43 | available |  | @RequireAnyPermission('pos.reports', 'purchase.view', 'accounts.view') |  |
| 405 | GET | /dashboards/store | reports/reports.controller.ts:46 | storeDashboard |  | @RequirePermission('pos.reports') |  |
| 406 | GET | /dashboards/owner | reports/reports.controller.ts:49 | ownerDashboard |  | @RequirePermission('pos.reports') |  |
| 407 | GET | /dashboards/purchasing | reports/reports.controller.ts:52 | purchasingDashboard |  | @RequirePermission('purchase.view') |  |
| 408 | GET | /dashboards/accounts | reports/reports.controller.ts:55 | accountsDashboard |  | @RequirePermission('accounts.view') |  |
| 409 | GET | /reports/daily-sales | reports/reports.controller.ts:60 | dailySales |  | @RequirePermission('pos.reports') |  |
| 410 | GET | /reports/item-sales | reports/reports.controller.ts:63 | itemSales |  | @RequirePermission('pos.reports') |  |
| 411 | GET | /reports/best-sellers | reports/reports.controller.ts:66 | bestSellers |  | @RequirePermission('pos.reports') |  |
| 412 | GET | /reports/sales-by-group | reports/reports.controller.ts:69 | salesByGroup |  | @RequirePermission('pos.reports') |  |
| 413 | GET | /reports/returns | reports/reports.controller.ts:72 | returns |  | @RequirePermission('pos.reports') |  |
| 414 | GET | /reports/discounts | reports/reports.controller.ts:75 | discounts |  | @RequirePermission('pos.reports') |  |
| 415 | GET | /reports/gross-profit | reports/reports.controller.ts:78 | grossProfit |  | @RequireAnyPermission('cost_price.view', 'stock.cost.view') |  |
| 416 | GET | /reports/season-sell-through | reports/reports.controller.ts:83 | seasonSellThrough |  | @RequireModule('seasons') @RequirePermission('pos.reports') |  |
| 417 | GET | /reports/stock-movement | reports/reports.controller.ts:88 | stockMovement |  | @RequirePermission('stock.view') |  |
| 418 | GET | /reports/stock-cover | reports/reports.controller.ts:91 | stockCover |  | @RequirePermission('stock.view') |  |
| 419 | GET | /reports/stock-age | reports/reports.controller.ts:94 | stockAge |  | @RequirePermission('stock.view') |  |
| 420 | GET | /reports/shrinkage | reports/reports.controller.ts:97 | shrinkage |  | @RequireAnyPermission('stock.cost.view', 'cost_price.view') |  |
| 421 | GET | /reports/cash-position | reports/reports.controller.ts:102 | cashPosition |  | @RequirePermission('accounts.view') |  |
| 422 | GET | /reports/cash-flow | reports/reports.controller.ts:105 | cashFlow |  | @RequirePermission('accounts.view') |  |
| 423 | POST | /reports/export-log | reports/reports.controller.ts:110 | exportLog |  | @RequireAnyPermission('pos.reports', 'stock.view', 'stock.cost.view', 'cost_price.view', 'purchase.view', 'accounts.view', 'gst.returns') |  |
| 424 | GET | /summary-email/settings | reports/reports.controller.ts:115 | summarySettings |  | @RequirePermission('reports.summary_email') |  |
| 425 | PUT | /summary-email/settings | reports/reports.controller.ts:118 | saveSummarySettings |  | @RequirePermission('reports.summary_email') |  |
| 426 | POST | /summary-email/test | reports/reports.controller.ts:121 | sendTest |  | @RequirePermission('reports.summary_email') |  |
| 427 | GET | /summary-email/runs | reports/reports.controller.ts:124 | summaryRuns |  | @RequirePermission('reports.summary_email') |  |
| 428 | GET | /summary-email/preview/:figures | reports/reports.controller.ts:127 | preview |  | @RequirePermission('reports.summary_email') |  |
| 429 | GET | /permissions | roles/roles.controller.ts:14 | permissions |  | @RequirePermission('roles.manage') |  |
| 430 | GET | /roles | roles/roles.controller.ts:21 | list |  | @RequirePermission('users.view') |  |
| 431 | GET | /roles/:id | roles/roles.controller.ts:27 | get |  | @RequirePermission('users.view') |  |
| 432 | POST | /roles | roles/roles.controller.ts:33 | create |  | @RequirePermission('roles.manage') |  |
| 433 | PATCH | /roles/:id | roles/roles.controller.ts:39 | update |  | @RequirePermission('roles.manage') |  |
| 434 | GET | /getting-started | setup/getting-started.controller.ts:14 | checklist |  | @OwnerAdminOnly() |  |
| 435 | PUT | /getting-started | setup/getting-started.controller.ts:20 | setHidden |  | @OwnerAdminOnly() |  |
| 436 | GET | /settings/security | setup/getting-started.controller.ts:27 | security |  | @OwnerAdminOnly() |  |
| 437 | GET | /setup/status | setup/setup.controller.ts:19 | status |  | @AllowPasswordChangePending() |  |
| 438 | POST | /setup | setup/setup.controller.ts:28 | run |  | @Public() @RateLimit('signup') |  |
| 439 | GET | /setup/progress | setup/setup.controller.ts:34 | progress |  |  |  |
| 440 | PUT | /setup/progress | setup/setup.controller.ts:39 | saveProgress |  |  |  |
| 441 | POST | /setup/finish | setup/setup.controller.ts:45 | finish |  |  |  |
| 442 | POST | /auth/signup | setup/setup.controller.ts:58 | signup |  | @Public() @RateLimit('signup') |  |
| 443 | GET | /stores | stores/stores.controller.ts:13 | list |  | @RequirePermission('stores.view') |  |
| 444 | GET | /stores/:id | stores/stores.controller.ts:19 | get |  | @RequirePermission('stores.view') |  |
| 445 | POST | /stores | stores/stores.controller.ts:25 | create |  | @RequirePermission('stores.manage') |  |
| 446 | PATCH | /stores/:id | stores/stores.controller.ts:31 | update |  | @RequirePermission('stores.manage') |  |
| 447 | GET | /users | users/users.controller.ts:20 | list |  | @RequirePermission('users.view') |  |
| 448 | GET | /users/:id | users/users.controller.ts:26 | get |  | @RequirePermission('users.view') |  |
| 449 | POST | /users | users/users.controller.ts:32 | create |  | @RequirePermission('users.manage') |  |
| 450 | PATCH | /users/:id | users/users.controller.ts:38 | update |  | @RequirePermission('users.manage') |  |
| 451 | POST | /users/:id/reset-password | users/users.controller.ts:48 | resetPassword |  | @RequirePermission('users.manage') |  |
| 452 | DELETE | /users/:id/sessions | users/users.controller.ts:59 | endSessions |  | @RequirePermission('sessions.manage_others') |  |
