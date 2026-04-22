/**
 * Docs helpers: cria Google Docs e insere texto simples.
 */
export async function createDocWithText(drive, docs, { title, text, parentFolderId }) {
  // Cria o arquivo do Doc via Drive (mais fácil setar parent).
  const file = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id,name,webViewLink',
  });

  // Insere texto no documento.
  await docs.documents.batchUpdate({
    documentId: file.data.id,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text,
          },
        },
      ],
    },
  });

  return file.data;
}

