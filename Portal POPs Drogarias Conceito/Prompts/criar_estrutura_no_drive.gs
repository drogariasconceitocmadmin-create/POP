/**
 * Execute criarEstruturaPortalPOPs() para criar:
 * - Pasta raiz "Portal POPs Drogarias Conceito"
 * - Subpastas (nomes exatos)
 * - Arquivos nativos (Google Docs/Sheets) dentro de "Base do Sistema" já preenchidos
 *
 * Onde executar:
 * - script.google.com → Novo projeto
 * - Cole este arquivo em "Código.gs" (ou crie um arquivo .gs) e execute a função
 *
 * Observação:
 * - Na primeira execução, o Apps Script pedirá autorização para Drive/Docs/Sheets.
 */
function criarEstruturaPortalPOPs() {
  var ROOT_NAME = 'Portal POPs Drogarias Conceito';
  var SUBFOLDERS = [
    'PDF Oficiais',
    'Anexos',
    'Documentos Relacionados',
    'Formularios',
    'Arquitetura do Projeto',
    'Prompts',
    'Base do Sistema',
  ];

  var root = DriveApp.createFolder(ROOT_NAME);
  var folders = {};
  SUBFOLDERS.forEach(function (name) {
    folders[name] = root.createFolder(name);
  });

  var baseFolder = folders['Base do Sistema'];

  // 1) README - Portal de POPs (Google Docs)
  var readmeBody =
    'Portal de POPs Drogarias Conceito\n\n' +
    'Objetivo do sistema\n' +
    '- Centralizar a gestão de POPs (criação, revisão, aprovação, publicação e arquivamento).\n' +
    '- Garantir conformidade operacional por meio de leituras obrigatórias e auditoria por usuário.\n' +
    '- Integrar com Google Drive para armazenar PDFs oficiais, anexos, documentos relacionados e formulários.\n\n' +
    'Stack atual\n' +
    '- Sistema interno em Google Apps Script + HTML.\n' +
    '- Banco de dados em Google Sheets.\n' +
    '- Google Drive para PDFs, anexos, documentos auxiliares e formulários.\n\n' +
    'Estrutura geral\n' +
    '- Backend (Apps Script): regras, permissões, workflow, versionamento, leitura e integração com Drive.\n' +
    '- Frontend (HTML): portal, dashboard, viewer de POP, gestão de usuários e gestão de POPs.\n' +
    '- Dados (Sheets): Usuários, POPs, Leituras e Sessões.\n' +
    '- Arquivos (Drive): PDFs Oficiais, Anexos, Documentos Relacionados e Formulários.\n\n' +
    'Perfis do sistema\n' +
    '- diretor\n' +
    '- gerente\n' +
    '- farmaceutico\n' +
    '- atendente\n' +
    '- entregador\n\n' +
    'Principais regras\n' +
    '- Diretor aprova e publica.\n' +
    '- Gerente, farmacêutico, atendente e entregador podem criar e editar rascunho.\n' +
    '- Edição em POP vigente gera nova versão (sem sobrescrever o vigente).\n' +
    '- Leitura crítica obrigatória pode bloquear o sistema até regularização.\n' +
    '- Autor deve ser o usuário logado.\n' +
    '- vigenciaInicio deve ser automática.\n' +
    '- revisaoPrevista automática.\n\n' +
    'Próximos módulos\n' +
    '- Workflow completo de aprovação.\n' +
    '- Versionamento robusto com histórico imutável.\n' +
    '- Bloqueio por leitura crítica vencida.\n' +
    '- Upload automático para pastas padronizadas no Drive.\n' +
    '- Dashboard de conformidade (ranking e indicadores).\n';
  var readmeDoc = createGoogleDoc_('README - Portal de POPs', readmeBody, baseFolder);

  // 2) Regras de Negócio - Portal de POPs (Google Docs)
  var regrasBody =
    'Regras de Negócio - Portal de POPs\n\n' +
    'Workflow do POP\n' +
    '- rascunho\n' +
    '- em_aprovacao\n' +
    '- aprovado\n' +
    '- reprovado\n' +
    '- vigente\n' +
    '- arquivado\n\n' +
    'Regras de versão\n' +
    '- POP vigente não deve ser sobrescrito.\n' +
    '- Qualquer alteração em vigente gera nova versão em rascunho.\n' +
    '- Leituras devem ser vinculadas à versão (usuário + versão).\n\n' +
    'Regras de leitura\n' +
    '- Leitura obrigatória crítica vencida bloqueia praticamente o sistema.\n' +
    '- Leitura vale por usuário + versão.\n' +
    '- POP exclusivo de farmaceutico só deve aparecer para farmaceutico e diretor.\n\n' +
    'Regras de Drive\n' +
    '- PDFs oficiais devem ir para “PDF Oficiais”.\n' +
    '- Anexos para “Anexos”.\n' +
    '- Documentos auxiliares para “Documentos Relacionados”.\n' +
    '- Formulários para “Formularios”.\n';
  var regrasDoc = createGoogleDoc_('Regras de Negócio - Portal de POPs', regrasBody, baseFolder);

  // 3) Mapa da Arquitetura (Google Docs)
  var mapaBody =
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
  var mapaDoc = createGoogleDoc_('Mapa da Arquitetura', mapaBody, baseFolder);

  // 4) Matriz de Perfis e Permissões (Google Sheets)
  var matrizSs = SpreadsheetApp.create('Matriz de Perfis e Permissões');
  moveFileToFolder_(matrizSs.getId(), baseFolder);
  var permSheet = matrizSs.getSheets()[0];
  permSheet.setName('Permissões');
  var permHeaders = [
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
  ];
  permSheet.getRange(1, 1, 1, permHeaders.length).setValues([permHeaders]);
  permSheet.getRange(2, 1, 5, permHeaders.length).setValues([
    ['diretor', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim'],
    ['gerente', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Não', 'Não', 'Não', 'Sim'],
    ['farmaceutico', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Sim', 'Não', 'Não', 'Sim'],
    ['atendente', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Não', 'Não', 'Não', 'Sim'],
    ['entregador', 'Sim', 'Sim', 'Sim', 'Não', 'Não', 'Sim', 'Não', 'Não', 'Não', 'Sim'],
  ]);
  permSheet.autoResizeColumns(1, permHeaders.length);

  // 5) Fluxo de Aprovação e Versionamento (Google Sheets)
  var fluxoSs = SpreadsheetApp.create('Fluxo de Aprovação e Versionamento');
  moveFileToFolder_(fluxoSs.getId(), baseFolder);

  var aprovSheet = fluxoSs.getSheets()[0];
  aprovSheet.setName('Aprovação');
  var aprovHeaders = ['Etapa', 'Quem executa', 'Ação', 'Próximo status'];
  aprovSheet.getRange(1, 1, 1, aprovHeaders.length).setValues([aprovHeaders]);
  aprovSheet.getRange(2, 1, 5, aprovHeaders.length).setValues([
    ['criação', 'autor', 'salvar rascunho', 'rascunho'],
    ['envio', 'autor', 'enviar para aprovação', 'em_aprovacao'],
    ['aprovação', 'diretor', 'aprovar', 'aprovado'],
    ['publicação', 'diretor', 'publicar', 'vigente'],
    ['reprovação', 'diretor', 'reprovar', 'reprovado'],
  ]);
  aprovSheet.autoResizeColumns(1, aprovHeaders.length);

  var versSheet = fluxoSs.insertSheet('Versionamento');
  var versHeaders = ['Situação', 'Regra'];
  versSheet.getRange(1, 1, 1, versHeaders.length).setValues([versHeaders]);
  versSheet.getRange(2, 1, 4, versHeaders.length).setValues([
    ['edição de rascunho', 'atualiza o mesmo rascunho'],
    ['edição de vigente', 'cria nova versão rascunho'],
    ['leitura', 'vinculada à versão vigente'],
    ['histórico', 'não apagar versões antigas'],
  ]);
  versSheet.autoResizeColumns(1, versHeaders.length);

  // 6) Backlog de Evolução do Sistema (Google Sheets)
  var backlogSs = SpreadsheetApp.create('Backlog de Evolução do Sistema');
  moveFileToFolder_(backlogSs.getId(), baseFolder);
  var backlogSheet = backlogSs.getSheets()[0];
  backlogSheet.setName('Backlog');
  var backlogHeaders = ['Prioridade', 'Módulo', 'Tarefa', 'Status'];
  backlogSheet.getRange(1, 1, 1, backlogHeaders.length).setValues([backlogHeaders]);
  backlogSheet.getRange(2, 1, 6, backlogHeaders.length).setValues([
    ['Alta', 'Aprovação', 'Implementar workflow completo', 'Pendente'],
    ['Alta', 'Versionamento', 'Criar nova versão real sem sobrescrever vigente', 'Pendente'],
    ['Alta', 'Leitura', 'Bloqueio por leitura crítica obrigatória', 'Pendente'],
    ['Alta', 'Drive', 'Preparar upload automático por pasta', 'Pendente'],
    ['Média', 'UX', 'Reformular home estilo catálogo', 'Pendente'],
    ['Média', 'Dashboard', 'Ranking real de conformidade', 'Pendente'],
  ]);
  backlogSheet.autoResizeColumns(1, backlogHeaders.length);

  Logger.log('Pasta raiz: ' + root.getUrl());
  Logger.log('Subpastas criadas: ' + SUBFOLDERS.join(' | '));
  Logger.log('Arquivos (Base do Sistema):');
  Logger.log('- README - Portal de POPs: ' + readmeDoc.getUrl());
  Logger.log('- Regras de Negócio - Portal de POPs: ' + regrasDoc.getUrl());
  Logger.log('- Mapa da Arquitetura: ' + mapaDoc.getUrl());
  Logger.log('- Matriz de Perfis e Permissões: ' + matrizSs.getUrl());
  Logger.log('- Fluxo de Aprovação e Versionamento: ' + fluxoSs.getUrl());
  Logger.log('- Backlog de Evolução do Sistema: ' + backlogSs.getUrl());
}

function createGoogleDoc_(title, bodyText, folder) {
  var doc = DocumentApp.create(title);
  doc.getBody().setText(bodyText);
  doc.saveAndClose();
  moveFileToFolder_(doc.getId(), folder);
  return doc;
}

function moveFileToFolder_(fileId, folder) {
  var file = DriveApp.getFileById(fileId);
  folder.addFile(file);
  // Remove do "Meu Drive" raiz para evitar duplicação visual.
  DriveApp.getRootFolder().removeFile(file);
}

