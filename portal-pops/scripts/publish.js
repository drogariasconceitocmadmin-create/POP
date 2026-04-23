import fs from 'node:fs';
import path from 'node:path';
import { getAuthedGoogle } from './googleClient.js';
import { ensureFolder } from './drive.js';
import { createDocWithText } from './docs.js';
import { createSpreadsheet, setSheetTitleAndValues } from './sheets.js';

const DRIVE_CONFIG_PATH = path.resolve('config/drive.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function argHas(flag) {
  return process.argv.includes(flag);
}

function buildDocsContent() {
  const readme =
    'Portal de POPs Drogarias Conceito\n\n' +
    'Objetivo do sistema\n' +
    '- Centralizar a gestão de POPs (criação, revisão, aprovação, publicação e arquivamento).\n' +
    '- Garantir conformidade operacional por meio de leituras obrigatórias e auditoria por usuário.\n' +
    '- Integrar com Google Drive para armazenar PDFs, anexos, documentos relacionados e formulários.\n\n' +
    'Stack atual\n' +
    '- sistema interno em Google Apps Script + HTML\n' +
    '- banco em Google Sheets\n' +
    '- uso de Google Drive para PDFs, anexos, documentos e formulários\n\n' +
    'Estrutura geral\n' +
    '- Backend (Apps Script): permissões, login/token, aprovação, versionamento, leitura, Drive.\n' +
    '- Frontend (HTML): portal, dashboard, viewer do POP, gestão de usuários e gestão de POPs.\n' +
    '- Dados (Sheets): Usuários, POPs, Leituras, Sessões.\n' +
    '- Arquivos (Drive): PDFs Oficiais, Anexos, Documentos Relacionados, Formularios.\n\n' +
    'Perfis do sistema\n' +
    '- diretor\n' +
    '- gerente\n' +
    '- farmaceutico\n' +
    '- atendente\n' +
    '- entregador\n\n' +
    'Principais regras\n' +
    '- diretor aprova e publica\n' +
    '- gerente, farmaceutico, atendente e entregador podem criar e editar rascunho\n' +
    '- edição em POP vigente gera nova versão\n' +
    '- leitura crítica obrigatória pode bloquear o sistema\n' +
    '- autor deve ser o usuário logado\n' +
    '- vigenciaInicio deve ser automática\n' +
    '- revisaoPrevista automática\n\n' +
    'Próximos módulos\n' +
    '- aprovação e versionamento completos\n' +
    '- conformidade por leitura crítica\n' +
    '- integração com Drive por pasta\n';

  const regras =
    'Regras de Negócio - Portal de POPs\n\n' +
    'Workflow do POP\n' +
    '- rascunho\n' +
    '- em_aprovacao\n' +
    '- aprovado\n' +
    '- reprovado\n' +
    '- vigente\n' +
    '- arquivado\n\n' +
    'Regras de versão\n' +
    '- POP vigente não deve ser sobrescrito\n' +
    '- qualquer alteração em vigente gera nova versão em rascunho\n' +
    '- leituras devem ser vinculadas à versão\n\n' +
    'Regras de leitura\n' +
    '- leitura obrigatória crítica vencida bloqueia praticamente o sistema\n' +
    '- leitura vale por usuário + versão\n' +
    '- POP exclusivo de farmaceutico só deve aparecer para farmaceutico e diretor\n\n' +
    'Regras de Drive\n' +
    '- PDF oficiais devem ir para “PDF Oficiais”\n' +
    '- anexos para “Anexos”\n' +
    '- documentos auxiliares para “Documentos Relacionados”\n' +
    '- formulários para “Formularios”\n';

  const mapa =
    'Mapa da Arquitetura\n\n' +
    'Backend\n' +
    '- Código.gs\n' +
    '- permissões\n' +
    '- login e token\n' +
    '- aprovação\n' +
    '- versionamento\n' +
    '- leitura\n' +
    '- Drive\n\n' +
    'Frontend\n' +
    '- Index.html\n' +
    '- portal\n' +
    '- dashboard\n' +
    '- viewer do POP\n' +
    '- gestão de usuários\n' +
    '- gestão de POPs\n\n' +
    'Dados\n' +
    '- Usuários\n' +
    '- POPs\n' +
    '- Leituras\n' +
    '- Sessões\n\n' +
    'Arquivos\n' +
    '- PDFs\n' +
    '- Anexos\n' +
    '- Documentos Relacionados\n' +
    '- Formulários\n';

  return { readme, regras, mapa };
}

async function main() {
  const dryRun = argHas('--dry-run');
  if (!fs.existsSync(DRIVE_CONFIG_PATH)) {
    throw new Error(`Config não encontrada: ${DRIVE_CONFIG_PATH}`);
  }
  const driveCfg = readJson(DRIVE_CONFIG_PATH);

  if (dryRun) {
    console.log('[dry-run] Publicação simulada (nada será criado).');
  }

  const { drive, docs, sheets } = dryRun ? { drive: null, docs: null, sheets: null } : await getAuthedGoogle();

  // Cria raiz e subpastas
  const root = dryRun
    ? { id: '(dry-run)', name: driveCfg.rootFolderName, webViewLink: '(dry-run)' }
    : await ensureFolder(drive, { name: driveCfg.rootFolderName });

  const folders = {};
  for (const name of driveCfg.subfolders) {
    folders[name] = dryRun
      ? { id: `(dry-run:${name})`, name, webViewLink: '(dry-run)' }
      : await ensureFolder(drive, { name, parentId: root.id });
  }

  const baseFolder = folders[driveCfg.baseFolderName];
  if (!baseFolder) throw new Error(`Base folder não encontrada na config: ${driveCfg.baseFolderName}`);

  // Docs
  const { readme, regras, mapa } = buildDocsContent();

  const out = {
    rootFolder: { name: root.name, url: root.webViewLink || null },
    subfolders: Object.fromEntries(Object.entries(folders).map(([k, v]) => [k, v.webViewLink || null])),
    files: {},
  };

  if (!dryRun) {
    const readmeDoc = await createDocWithText(drive, docs, {
      title: 'README - Portal de POPs',
      text: readme,
      parentFolderId: baseFolder.id,
    });
    const regrasDoc = await createDocWithText(drive, docs, {
      title: 'Regras de Negócio - Portal de POPs',
      text: regras,
      parentFolderId: baseFolder.id,
    });
    const mapaDoc = await createDocWithText(drive, docs, {
      title: 'Mapa da Arquitetura',
      text: mapa,
      parentFolderId: baseFolder.id,
    });

    out.files['README - Portal de POPs'] = readmeDoc.webViewLink || null;
    out.files['Regras de Negócio - Portal de POPs'] = regrasDoc.webViewLink || null;
    out.files['Mapa da Arquitetura'] = mapaDoc.webViewLink || null;

    // Sheets: Matriz
    const matriz = await createSpreadsheet(drive, sheets, {
      title: 'Matriz de Perfis e Permissões',
      parentFolderId: baseFolder.id,
    });
    await setSheetTitleAndValues(sheets, {
      spreadsheetId: matriz.id,
      sheetTitle: 'Permissões',
      values: [
        [
          'Perfil',
          'Criar rascunho',
          'Editar rascunho',
          'Enviar para aprovação',
          'Aprovar',
          'Publicar',
          'Criar nova versão',
          'Ver POP farmacêutico',
          'Ver dashboard admin',
          'Ver usuários',
          'Ver leituras',
        ],
        ['diretor', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim'],
        ['gerente', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Não', 'Não', 'Não', 'Sim'],
        ['farmaceutico', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Sim', 'Não', 'Não', 'Sim'],
        ['atendente', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Não', 'Não', 'Não', 'Sim'],
        ['entregador', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Não', 'Não', 'Não', 'Sim'],
      ],
    });
    out.files['Matriz de Perfis e Permissões'] = matriz.webViewLink || null;

    // Sheets: Fluxo
    const fluxo = await createSpreadsheet(drive, sheets, {
      title: 'Fluxo de Aprovação e Versionamento',
      parentFolderId: baseFolder.id,
    });
    await setSheetTitleAndValues(sheets, {
      spreadsheetId: fluxo.id,
      sheetTitle: 'Aprovação',
      values: [
        ['Etapa', 'Quem executa', 'Ação', 'Próximo status'],
        ['criação', 'autor', 'salvar rascunho', 'rascunho'],
        ['envio', 'autor', 'enviar para aprovação', 'em_aprovacao'],
        ['aprovação', 'diretor', 'aprovar', 'aprovado'],
        ['publicação', 'diretor', 'publicar', 'vigente'],
        ['reprovação', 'diretor', 'reprovar', 'reprovado'],
      ],
    });
    await setSheetTitleAndValues(sheets, {
      spreadsheetId: fluxo.id,
      sheetTitle: 'Versionamento',
      values: [
        ['Situação', 'Regra'],
        ['edição de rascunho', 'atualiza o mesmo rascunho'],
        ['edição de vigente', 'cria nova versão rascunho'],
        ['leitura', 'vinculada à versão vigente'],
        ['histórico', 'não apagar versões antigas'],
      ],
    });
    out.files['Fluxo de Aprovação e Versionamento'] = fluxo.webViewLink || null;

    // Sheets: Backlog
    const backlog = await createSpreadsheet(drive, sheets, {
      title: 'Backlog de Evolução do Sistema',
      parentFolderId: baseFolder.id,
    });
    await setSheetTitleAndValues(sheets, {
      spreadsheetId: backlog.id,
      sheetTitle: 'Backlog',
      values: [
        ['Prioridade', 'Módulo', 'Tarefa', 'Status'],
        ['Alta', 'Aprovação', 'Implementar workflow completo', 'Pendente'],
        ['Alta', 'Versionamento', 'Criar nova versão real sem sobrescrever vigente', 'Pendente'],
        ['Alta', 'Leitura', 'Bloqueio por leitura crítica obrigatória', 'Pendente'],
        ['Alta', 'Drive', 'Preparar upload automático por pasta', 'Pendente'],
        ['Média', 'UX', 'Reformular home estilo catálogo', 'Pendente'],
        ['Média', 'Dashboard', 'Ranking real de conformidade', 'Pendente'],
      ],
    });
    out.files['Backlog de Evolução do Sistema'] = backlog.webViewLink || null;
  }

  console.log('Pasta raiz:', out.rootFolder);
  console.log('Subpastas:', out.subfolders);
  console.log('Arquivos:', out.files);

  // grava log
  fs.mkdirSync('logs', { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const logPath = path.join('logs', `publish-${stamp}.json`);
  fs.writeFileSync(logPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Log:', logPath);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

