import { prisma, getSettings } from "@/lib/db";
import { getDriveApi, getSheetsApi } from "./client";
import { ensureClientsFolder } from "./drive";

/**
 * The marketing spreadsheet lives at Drive › CSTL › Clients › Docs.
 * One row per client: name, email, marketing consent. Created on first use.
 */
async function ensureMarketingSheet(): Promise<string> {
  const settings = await getSettings();
  if (settings.marketingSheetId) return settings.marketingSheetId;

  const clientsFolder = await ensureClientsFolder();
  const drive = await getDriveApi();
  const existing = await drive.files.list({
    q: `name = 'Docs' and '${clientsFolder}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });
  let sheetId = existing.data.files?.[0]?.id ?? "";
  if (!sheetId) {
    const created = await drive.files.create({
      requestBody: {
        name: "Docs",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [clientsFolder],
      },
      fields: "id",
    });
    sheetId = created.data.id!;
    const sheets = await getSheetsApi();
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "A1:C1",
      valueInputOption: "RAW",
      requestBody: { values: [["Name", "Email", "Email marketing"]] },
    });
  }
  await prisma.appSettings.update({ where: { id: 1 }, data: { marketingSheetId: sheetId } });
  return sheetId;
}

/** Add or update the client's row (matched by email, falling back to name). */
export async function upsertMarketingRow(name: string, email: string, marketing: boolean) {
  const sheetId = await ensureMarketingSheet();
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "A:C" });
  const rows = res.data.values ?? [];
  const matchIdx = rows.findIndex(
    (r, i) =>
      i > 0 &&
      ((email && (r[1] ?? "").toLowerCase() === email.toLowerCase()) ||
        (!email && (r[0] ?? "").toLowerCase() === name.toLowerCase())),
  );
  const row = [name, email, marketing ? "Yes" : "No"];
  if (matchIdx > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `A${matchIdx + 1}:C${matchIdx + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A:C",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }
}
