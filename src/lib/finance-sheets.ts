import { google, sheets_v4 } from "googleapis";
import { InputFile } from "grammy";
import { prisma } from "@/lib/db";
import { bot } from "@/lib/bot";

const SHEET_NAMES = [
  "Dashboard",
  "Transactions",
  "Monthly Summary",
  "Expense Breakdown",
  "Donor Summary",
  "Services",
  "Change Log",
  "Checks",
] as const;

type SheetName = (typeof SHEET_NAMES)[number];

export interface FinanceAutomationEvent {
  action: "CREATED" | "UPDATED" | "APPROVED" | "REJECTED" | "DELETED" | "MANUAL_SYNC" | "RAZORPAY_CAPTURED" | "RAZORPAY_TEST_CAPTURED";
  actorName: string;
  transactionId?: string;
  sendBackup?: boolean;
}

let automationQueue: Promise<void> = Promise.resolve();

function configured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY,
  );
}

function safeText(value: unknown): string {
  const text = value == null ? "" : String(value);
  // Prevent user-entered descriptions from becoming spreadsheet formulas.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function privateKey() {
  return process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
}

function clients() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

async function fetchUsdToInr(): Promise<number> {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 3600 },
    });
    if (!response.ok) return 1;
    const data = await response.json();
    return Number(data.rates?.INR) || 1;
  } catch {
    return 1;
  }
}

function toInr(amount: number, currency: string, rate: number) {
  return currency === "USD" ? amount * rate : amount;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function color(hex: string) {
  const clean = hex.replace("#", "");
  return {
    red: parseInt(clean.slice(0, 2), 16) / 255,
    green: parseInt(clean.slice(2, 4), 16) / 255,
    blue: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function grid(sheetId: number, startRow: number, endRow: number, startColumn: number, endColumn: number) {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startColumn, endColumnIndex: endColumn };
}

async function ensureSheets(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  let metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title),charts(chartId))",
  });
  const existing = new Set((metadata.data.sheets || []).map((sheet) => sheet.properties?.title));
  const missing = SHEET_NAMES.filter((name) => !existing.has(name));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    metadata = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title),charts(chartId))",
    });
  }

  const ids = {} as Record<SheetName, number>;
  for (const sheet of metadata.data.sheets || []) {
    const title = sheet.properties?.title as SheetName | undefined;
    if (title && SHEET_NAMES.includes(title)) ids[title] = sheet.properties!.sheetId!;
  }
  return { ids, metadata: metadata.data };
}

function pieChart(title: string, sourceSheetId: number, startRow: number, endRow: number, anchorRow: number, anchorColumn: number): sheets_v4.Schema$Request {
  return {
    addChart: {
      chart: {
        spec: {
          title,
          backgroundColor: color("#fffdf9"),
          fontName: "Montserrat",
          titleTextFormat: { foregroundColor: color("#403b3b"), fontSize: 12, bold: true },
          pieChart: {
            legendPosition: "RIGHT_LEGEND",
            pieHole: 0.38,
            domain: { sourceRange: { sources: [grid(sourceSheetId, startRow, endRow, 9, 10)] } },
            series: { sourceRange: { sources: [grid(sourceSheetId, startRow, endRow, 10, 11)] } },
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: sourceSheetId, rowIndex: anchorRow, columnIndex: anchorColumn },
            widthPixels: 500,
            heightPixels: 300,
          },
        },
      },
    },
  };
}

function basicChart(
  title: string,
  chartType: "COLUMN" | "LINE" | "BAR",
  sourceSheetId: number,
  rowCount: number,
  seriesColumns: number[],
  dashboardId: number,
  anchorRow: number,
  anchorColumn: number,
): sheets_v4.Schema$Request {
  return {
    addChart: {
      chart: {
        spec: {
          title,
          backgroundColor: color("#fffdf9"),
          fontName: "Montserrat",
          titleTextFormat: { foregroundColor: color("#403b3b"), fontSize: 12, bold: true },
          basicChart: {
            chartType,
            legendPosition: "BOTTOM_LEGEND",
            headerCount: 1,
            axis: [
              { position: "BOTTOM_AXIS", title: chartType === "BAR" ? "Amount (INR)" : "Period" },
              { position: "LEFT_AXIS", title: chartType === "BAR" ? "Category" : "Amount (INR)" },
            ],
            domains: [{ domain: { sourceRange: { sources: [grid(sourceSheetId, 1, rowCount, 0, 1)] } } }],
            series: seriesColumns.map((column, index) => ({
              series: { sourceRange: { sources: [grid(sourceSheetId, 1, rowCount, column, column + 1)] } },
              targetAxis: "LEFT_AXIS",
              color: color(["#b9dfe5", "#efc7d5", "#cfc8e8", "#f6d1b8"][index % 4]),
            })),
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: dashboardId, rowIndex: anchorRow, columnIndex: anchorColumn },
            widthPixels: 560,
            heightPixels: 320,
          },
        },
      },
    },
  };
}

async function sendWorkbookBackup(
  drive: ReturnType<typeof google.drive>,
  spreadsheetId: string,
  event: FinanceAutomationEvent,
) {
  const groupId = process.env.TG_GROUP_ID;
  const topicId = process.env.TG_TOPIC_BACKUPS;
  if (!groupId || !topicId) return;

  const exported = await drive.files.export(
    {
      fileId: spreadsheetId,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { responseType: "arraybuffer" },
  );
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `sentinel-finance-backup-${timestamp}.xlsx`;
  const caption = [
    "📊 <b>Sentinel Finance Backup</b>",
    `Trigger: <b>${event.action}</b>`,
    `By: ${escapeHtml(event.actorName)}`,
    event.transactionId ? `<code>${event.transactionId}</code>` : null,
  ].filter(Boolean).join("\n");

  await bot.api.sendDocument(
    groupId,
    new InputFile(Buffer.from(exported.data as ArrayBuffer), filename),
    {
      message_thread_id: Number(topicId),
      caption,
      parse_mode: "HTML",
    },
  );
}

export async function syncFinanceWorkbook(event: FinanceAutomationEvent) {
  if (!configured()) throw new Error("Google Sheets integration is not configured");

  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
  const { sheets, drive } = clients();
  const [transactions, services, audits, users, usdToInr] = await Promise.all([
    prisma.transaction.findMany({
      include: {
        fromUser: { select: { name: true } },
        createdBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.service.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ where: { entityType: "Transaction" }, orderBy: { timestamp: "asc" }, take: 5000 }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    fetchUsdToInr(),
  ]);

  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const approved = transactions.filter((tx) => tx.status === "APPROVED" && !tx.isTest);
  const incoming = approved.filter((tx) => tx.direction === "IN").reduce((sum, tx) => sum + toInr(Number(tx.amount), tx.currency, usdToInr), 0);
  const outgoing = approved.filter((tx) => tx.direction === "OUT").reduce((sum, tx) => sum + toInr(Number(tx.amount), tx.currency, usdToInr), 0);

  const transactionRows: unknown[][] = [[
    "ID", "Date", "Created At", "Description", "Amount", "Currency", "Direction", "Type", "Method", "Status",
    "From", "Created By", "Reviewed By", "Review Note", "Proof File", "Attachment Count", "USD→INR", "Amount (INR)", "Test Mode",
  ]];
  for (const [index, tx] of transactions.entries()) {
    const row = index + 2;
    transactionRows.push([
      tx.id,
      tx.date.toISOString(),
      tx.createdAt.toISOString(),
      safeText(tx.description),
      Number(tx.amount),
      tx.currency,
      tx.direction,
      tx.type,
      tx.method,
      tx.status,
      safeText(tx.fromUser?.name),
      safeText(tx.createdBy?.name),
      safeText(tx.reviewedBy?.name),
      safeText(tx.reviewNote),
      tx.proofFileId || "",
      tx.attachments.length,
      usdToInr,
      `=IF(F${row}="INR",E${row},IF(F${row}="USD",E${row}*Q${row},E${row}))`,
      tx.isTest,
    ]);
  }

  const monthly = new Map<string, { incoming: number; outgoing: number }>();
  for (const tx of approved) {
    const key = monthKey(tx.date);
    const item = monthly.get(key) || { incoming: 0, outgoing: 0 };
    item[tx.direction === "IN" ? "incoming" : "outgoing"] += toInr(Number(tx.amount), tx.currency, usdToInr);
    monthly.set(key, item);
  }
  let runningBalance = 0;
  const monthlyRows: unknown[][] = [["Month", "Incoming (INR)", "Outgoing (INR)", "Net (INR)", "Running Balance (INR)"]];
  for (const [month, values] of [...monthly.entries()].sort()) {
    runningBalance += values.incoming - values.outgoing;
    monthlyRows.push([month, values.incoming, values.outgoing, values.incoming - values.outgoing, runningBalance]);
  }

  const expenseMap = new Map<string, number>();
  for (const tx of approved.filter((item) => item.direction === "OUT")) {
    expenseMap.set(tx.type, (expenseMap.get(tx.type) || 0) + toInr(Number(tx.amount), tx.currency, usdToInr));
  }
  const expenseRows: unknown[][] = [["Expense Type", "Amount (INR)"]];
  for (const [type, amount] of [...expenseMap.entries()].sort((a, b) => b[1] - a[1])) expenseRows.push([type, amount]);

  const donorMap = new Map<string, number>();
  for (const tx of approved.filter((item) => item.direction === "IN")) {
    const name = tx.fromUser?.name || "External / Unassigned";
    donorMap.set(name, (donorMap.get(name) || 0) + toInr(Number(tx.amount), tx.currency, usdToInr));
  }
  const donorRows: unknown[][] = [["Donor", "Approved Contributions (INR)"]];
  for (const [name, amount] of [...donorMap.entries()].sort((a, b) => b[1] - a[1])) donorRows.push([safeText(name), amount]);

  const serviceRows: unknown[][] = [["Service", "Category", "Status", "Price", "Currency", "Frequency", "Monthly Cost (INR)", "Expiry"]];
  for (const service of services) {
    const amount = Number(service.price || 0);
    const inr = toInr(amount, service.currency || "INR", usdToInr);
    const monthlyCost = service.frequency === "YEARLY" ? inr / 12 : service.frequency === "WEEKLY" ? inr * 52 / 12 : service.frequency === "ONE_TIME" || service.frequency === "LIFETIME" ? 0 : inr;
    serviceRows.push([safeText(service.name), safeText(service.category), service.status || "", amount, service.currency || "", service.frequency || "", monthlyCost, service.expiryDate?.toISOString() || ""]);
  }

  const auditRows: unknown[][] = [["Timestamp", "Action", "Transaction ID", "Actor", "Before", "After"]];
  for (const audit of audits) {
    auditRows.push([
      audit.timestamp.toISOString(),
      audit.action,
      audit.entityId,
      safeText(userNames.get(audit.userId) || audit.userId),
      safeText(audit.before ? JSON.stringify(audit.before) : ""),
      safeText(audit.after ? JSON.stringify(audit.after) : ""),
    ]);
  }

  const methodCounts = new Map<string, number>();
  for (const tx of transactions.filter((item) => !item.isTest)) methodCounts.set(tx.method, (methodCounts.get(tx.method) || 0) + 1);
  const dashboardRows: unknown[][] = [
    ["SENTINEL · INCOME & EXPENSE"],
    [],
    ["A READ-ONLY FINANCIAL OVERVIEW · MANAGED BY SENTINEL"],
    [],
    ["Last synchronized", new Date().toISOString()],
    [],
    ["Approved incoming (INR)", `=SUMIFS(Transactions!R:R,Transactions!J:J,"APPROVED",Transactions!G:G,"IN",Transactions!S:S,FALSE)`],
    ["Approved outgoing (INR)", `=SUMIFS(Transactions!R:R,Transactions!J:J,"APPROVED",Transactions!G:G,"OUT",Transactions!S:S,FALSE)`],
    ["Current balance (INR)", "=B7-B8"],
    ["Pending transactions", `=COUNTIFS(Transactions!J:J,"PENDING",Transactions!S:S,FALSE)`],
    ["Approved transactions", `=COUNTIFS(Transactions!J:J,"APPROVED",Transactions!S:S,FALSE)`],
    ["Rejected transactions", `=COUNTIFS(Transactions!J:J,"REJECTED",Transactions!S:S,FALSE)`],
    ["USD to INR rate", usdToInr],
    ["Active services", services.filter((service) => service.status === "ACTIVE").length],
  ];
  while (dashboardRows.length < 20) dashboardRows.push([]);
  dashboardRows[1][9] = "Cash Flow"; dashboardRows[1][10] = "Amount (INR)";
  dashboardRows[2][9] = "Incoming"; dashboardRows[2][10] = incoming;
  dashboardRows[3][9] = "Outgoing"; dashboardRows[3][10] = outgoing;
  dashboardRows[6][9] = "Status"; dashboardRows[6][10] = "Count";
  dashboardRows[7][9] = "Approved"; dashboardRows[7][10] = approved.length;
  dashboardRows[8][9] = "Pending"; dashboardRows[8][10] = transactions.filter((tx) => tx.status === "PENDING" && !tx.isTest).length;
  dashboardRows[9][9] = "Rejected"; dashboardRows[9][10] = transactions.filter((tx) => tx.status === "REJECTED" && !tx.isTest).length;
  dashboardRows[12][9] = "Payment Method"; dashboardRows[12][10] = "Count";
  [...methodCounts.entries()].forEach(([method, count], index) => {
    dashboardRows[13 + index] ||= [];
    dashboardRows[13 + index][9] = method;
    dashboardRows[13 + index][10] = count;
  });

  const checksRows: unknown[][] = [
    ["Check", "Actual", "Expected", "Difference", "Status", "Notes"],
    ["Transaction row count", transactions.length, `=COUNTA(Transactions!A2:A)`, "=B2-C2", `=IF(D2=0,"OK","FAIL")`, "Database export matches sheet rows"],
    ["Balance tie-out", incoming - outgoing, "=Dashboard!B9", "=B3-C3", `=IF(ABS(D3)<0.01,"OK","FAIL")`, "Approved incoming less outgoing"],
    ["Model status", "", "", "", `=IF(COUNTIF(E2:E3,"FAIL")=0,"PASS","FAIL")`, "All checks must pass"],
  ];

  const { ids, metadata } = await ensureSheets(sheets, spreadsheetId);
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: SHEET_NAMES.map((name) => `'${name}'!A:Z`) },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: "Dashboard!A1:Z60", values: dashboardRows },
        { range: "Transactions!A1", values: transactionRows },
        { range: "'Monthly Summary'!A1", values: monthlyRows },
        { range: "'Expense Breakdown'!A1", values: expenseRows },
        { range: "'Donor Summary'!A1", values: donorRows },
        { range: "Services!A1", values: serviceRows },
        { range: "'Change Log'!A1", values: auditRows },
        { range: "Checks!A1", values: checksRows },
      ],
    },
  });

  const requests: sheets_v4.Schema$Request[] = [];
  for (const sheet of metadata.sheets || []) {
    for (const chart of sheet.charts || []) if (chart.chartId != null) requests.push({ deleteEmbeddedObject: { objectId: chart.chartId } });
  }
  const ink = color("#403b3b");
  const ivory = color("#fbf8f3");
  const sheetHeaderColors: Record<SheetName, string> = {
    Dashboard: "#f4d5c3",
    Transactions: "#cce7ea",
    "Monthly Summary": "#efcbd7",
    "Expense Breakdown": "#d8d2ec",
    "Donor Summary": "#d8ead7",
    Services: "#f8dfbd",
    "Change Log": "#ddd9d2",
    Checks: "#cfe5d5",
  };
  for (const name of SHEET_NAMES) {
    requests.push(
      { updateSheetProperties: { properties: { sheetId: ids[name], tabColor: color(sheetHeaderColors[name]), gridProperties: { frozenRowCount: name === "Dashboard" ? 3 : 1, hideGridlines: name === "Dashboard" } }, fields: "tabColor,gridProperties.frozenRowCount,gridProperties.hideGridlines" } },
      { repeatCell: { range: grid(ids[name], 0, 1, 0, name === "Dashboard" ? 11 : name === "Transactions" ? 19 : 18), cell: { userEnteredFormat: { backgroundColor: color(sheetHeaderColors[name]), textFormat: { foregroundColor: ink, bold: true, fontFamily: "Montserrat" }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat" } },
      { autoResizeDimensions: { dimensions: { sheetId: ids[name], dimension: "COLUMNS", startIndex: 0, endIndex: name === "Dashboard" ? 11 : name === "Transactions" ? 19 : 18 } } },
    );
  }
  requests.push(
    { unmergeCells: { range: grid(ids.Dashboard, 0, 3, 0, 8) } },
    { mergeCells: { range: grid(ids.Dashboard, 0, 2, 0, 8), mergeType: "MERGE_ALL" } },
    { mergeCells: { range: grid(ids.Dashboard, 2, 3, 0, 8), mergeType: "MERGE_ALL" } },
    { repeatCell: { range: grid(ids.Dashboard, 0, 60, 0, 26), cell: { userEnteredFormat: { backgroundColor: ivory, textFormat: { foregroundColor: ink, fontFamily: "Montserrat" } } }, fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat" } },
    { repeatCell: { range: grid(ids.Dashboard, 0, 2, 0, 8), cell: { userEnteredFormat: { backgroundColor: color("#f8efe7"), horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { foregroundColor: ink, fontFamily: "Playfair Display", fontSize: 25, bold: false } } }, fields: "userEnteredFormat" } },
    { repeatCell: { range: grid(ids.Dashboard, 2, 3, 0, 8), cell: { userEnteredFormat: { backgroundColor: color("#f8efe7"), horizontalAlignment: "CENTER", textFormat: { foregroundColor: color("#756e69"), fontFamily: "Montserrat", fontSize: 9, bold: true } } }, fields: "userEnteredFormat" } },
    { repeatCell: { range: grid(ids.Dashboard, 6, 14, 0, 2), cell: { userEnteredFormat: { backgroundColor: color("#fffdf9"), textFormat: { foregroundColor: ink, fontFamily: "Montserrat" }, borders: { bottom: { style: "SOLID", color: color("#e8e1db") } } } }, fields: "userEnteredFormat" } },
    { repeatCell: { range: grid(ids.Dashboard, 6, 9, 0, 2), cell: { userEnteredFormat: { backgroundColor: color("#f7d9c7") } }, fields: "userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: grid(ids.Dashboard, 9, 12, 0, 2), cell: { userEnteredFormat: { backgroundColor: color("#f2d3de") } }, fields: "userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: grid(ids.Dashboard, 12, 14, 0, 2), cell: { userEnteredFormat: { backgroundColor: color("#d7e9e8") } }, fields: "userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: grid(ids.Dashboard, 6, 14, 1, 2), cell: { userEnteredFormat: { textFormat: { foregroundColor: ink, bold: true, fontSize: 13 }, numberFormat: { type: "NUMBER", pattern: "#,##0.00;[Red](#,##0.00);-" } } }, fields: "userEnteredFormat" } },
    { updateDimensionProperties: { range: { sheetId: ids.Dashboard, dimension: "ROWS", startIndex: 0, endIndex: 2 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: ids.Dashboard, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 205 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: ids.Dashboard, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 145 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: ids.Dashboard, dimension: "COLUMNS", startIndex: 9, endIndex: 11 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
    { repeatCell: { range: grid(ids.Transactions, 1, Math.max(transactionRows.length, 2), 4, 5), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00;[Red](#,##0.00);-" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: grid(ids.Transactions, 1, Math.max(transactionRows.length, 2), 16, 18), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00;[Red](#,##0.00);-" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: grid(ids["Monthly Summary"], 1, Math.max(monthlyRows.length, 2), 1, 5), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "₹#,##0.00;[Red](₹#,##0.00);-" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: grid(ids["Expense Breakdown"], 1, Math.max(expenseRows.length, 2), 1, 2), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "₹#,##0.00;[Red](₹#,##0.00);-" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: grid(ids["Donor Summary"], 1, Math.max(donorRows.length, 2), 1, 2), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "₹#,##0.00;[Red](₹#,##0.00);-" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: grid(ids.Services, 1, Math.max(serviceRows.length, 2), 6, 7), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "₹#,##0.00;[Red](₹#,##0.00);-" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: grid(ids["Change Log"], 1, Math.max(auditRows.length, 2), 4, 6), cell: { userEnteredFormat: { wrapStrategy: "WRAP" } }, fields: "userEnteredFormat.wrapStrategy" } },
    pieChart("Income vs Expenses", ids.Dashboard, 2, 4, 1, 12),
    pieChart("Transaction Status", ids.Dashboard, 7, 10, 17, 12),
    pieChart("Payment Methods", ids.Dashboard, 13, 13 + Math.max(methodCounts.size, 1), 33, 12),
    basicChart("Monthly Cash Flow (INR)", "COLUMN", ids["Monthly Summary"], monthlyRows.length, [1, 2], ids.Dashboard, 1, 20),
    basicChart("Balance Trend (INR)", "LINE", ids["Monthly Summary"], monthlyRows.length, [4], ids.Dashboard, 17, 20),
    basicChart("Top Donor Contributions (INR)", "BAR", ids["Donor Summary"], donorRows.length, [1], ids.Dashboard, 33, 20),
  );
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  if (event.sendBackup) await sendWorkbookBackup(drive, spreadsheetId, event);
  return { spreadsheetId, transactionCount: transactions.length };
}

export function scheduleFinanceAutomation(event: FinanceAutomationEvent) {
  if (!configured()) return;
  automationQueue = automationQueue
    .then(() => syncFinanceWorkbook(event))
    .then(() => undefined)
    .catch((error) => console.error("[finance-sheets] automation failed:", error));
}
