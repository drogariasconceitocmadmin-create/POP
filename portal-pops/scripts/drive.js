/**
 * Drive helpers: cria/acha pastas e move arquivos.
 */
export async function findFolderByName(drive, { name, parentId = null }) {
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${name.replaceAll("'", "\\'")}'`,
    `trashed=false`,
  ];
  if (parentId) q.push(`'${parentId}' in parents`);

  const res = await drive.files.list({
    q: q.join(' and '),
    fields: 'files(id,name,parents,webViewLink)',
    spaces: 'drive',
    pageSize: 10,
  });
  return res.data.files?.[0] || null;
}

export async function createFolder(drive, { name, parentId = null }) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id,name,webViewLink',
  });
  return res.data;
}

export async function ensureFolder(drive, { name, parentId = null }) {
  const existing = await findFolderByName(drive, { name, parentId });
  if (existing) return existing;
  return await createFolder(drive, { name, parentId });
}

export async function moveFileToFolder(drive, { fileId, folderId }) {
  const file = await drive.files.get({ fileId, fields: 'parents' });
  const previousParents = file.data.parents?.join(',') || '';
  await drive.files.update({
    fileId,
    addParents: folderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });
}

