/**
 * Sheets helpers: cria planilha e preenche abas com arrays.
 */
export async function createSpreadsheet(drive, sheets, { title, parentFolderId }) {
  const file = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id,name,webViewLink',
  });

  return file.data;
}

export async function setSheetTitleAndValues(sheets, { spreadsheetId, sheetTitle, values }) {
  // Garante que existe a aba com o nome pedido:
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });

  const existing = meta.data.sheets?.find((s) => s.properties?.title === sheetTitle);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      },
    });
  }

  // Limpa e escreve
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  // Auto resize colunas (A..K ou mais conforme values[0].length)
  const meta2 = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const sheet = meta2.data.sheets?.find((s) => s.properties?.title === sheetTitle);
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId === 'number') {
    const colCount = Math.max(1, values?.[0]?.length || 1);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: colCount,
              },
            },
          },
        ],
      },
    });
  }
}

