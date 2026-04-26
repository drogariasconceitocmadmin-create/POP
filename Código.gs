/**
 * Portal de POPs — Drogarias Conceito
 * Sprint 1 (base executável)
 *
 * Regras desta base:
 * - Backend (Apps Script) controla sessão, permissões, regras e parsing.
 * - Frontend (Index.html) apenas exibe/navega e aciona funções.
 * - Versionamento/workflow completos virão nas próximas sprints.
 *
 * Observação importante:
 * - A função publicar como vigente nesta Sprint é TEMPORÁRIA.
 *   Ela existe somente como "api_setPopVigenteBasic" / "publicarPop" (Sprint 1).
 *   Na Sprint 2 ela será substituída pelo workflow formal de aprovação.
 */

// =============================================================================
// Config
// =============================================================================

var SPREADSHEET_ID = '1K_EsFW2aSUnAbGAUwkTRd43v7Q2v56yQ9oqPR3y4U3I';
var LOGO_URL = 'https://drive.google.com/thumbnail?id=1RzVGSHiwmN9e0d9N7O1fjgP1OkOpTlov&sz=w512';

var SHEET_USUARIOS = 'Usuarios';
var SHEET_SESSOES = 'Sessoes';
var SHEET_POPS = 'POPs';
var SHEET_LEITURAS = 'Leituras';
var SHEET_PARAMETROS = 'Parametros';
var SHEET_AUDITORIA = 'Auditoria';
/** Logs mínimos da trilha colaborativa de POP (sem dashboard). */
var SHEET_LOGS_FLUXO = 'LogsFluxo';
/** Opcional: execuções operacionais para o dashboard C2 (MVP). Se a aba não existir, retorna []. */
var SHEET_EXECUCOES = 'execucoes';

var SESSION_TTL_HOURS = 12;

/** Logs temporários de POP (Execuções do Apps Script). Desative após estabilizar. */
var POP_DIAG_LOG = true;

/** Última leitura da biblioteca (para comparar start vs end vs getPortalData em um único bloco). */
var POP_LAST_LIST_TRIAGE_ = null;

function popDiagLog_(tag, payload) {
  if (!POP_DIAG_LOG) return;
  try {
    Logger.log('[POP_DIAG:' + tag + '] ' + JSON.stringify(payload));
  } catch (e) {
    Logger.log('[POP_DIAG:' + tag + '] (payload não serializável)');
  }
}

/** Um bloco só: 1) rawRows 2) pops após canView 3) pops no portal — evidência para os 3 cenários. */
function popTriageCompareLog_(endpointTag, portalPopsReturned) {
  if (!POP_DIAG_LOG) return;
  var t = POP_LAST_LIST_TRIAGE_;
  if (!t) {
    popDiagLog_('POP_TRIAGE_COMPARE', { endpoint: endpointTag, error: 'POP_LAST_LIST_TRIAGE_ vazio (listPopsForUser_ não rodou?)' });
    return;
  }
  var r0 = t.rawRows === 0;
  var lib0 = t.popsReturned === 0;
  var scenario = 'C0_INDEFINIDO';
  if (r0) scenario = 'C1_RAWROWS_ZERO_BASE_SPREADSHEET_ABA_DEPLOY';
  else if (lib0) scenario = 'C2_RAW_OK_LIBRARY_ZERO_CANVIEW_NORMALIZE_STATUS';
  else if (portalPopsReturned !== t.popsReturned) scenario = 'ANOMALIA_LIST_END_VS_PORTAL_LEN';
  else scenario = 'C2B_SERVER_LIBRARY_OK_SE_UI_VAZIA_ENTAO_C3_FRONTEND_FILTROS';

  popDiagLog_('POP_TRIAGE_COMPARE', {
    endpoint: endpointTag,
    scenario: scenario,
    bloco1_listPopsForUser_start_rawRows: t.rawRows,
    bloco2_listPopsForUser_end_popsReturned: t.popsReturned,
    bloco3_endpoint_popsReturned: portalPopsReturned,
    listEnd_equals_portal: t.popsReturned === portalPopsReturned,
    afterNormalize: t.afterNormalize,
    droppedByCanView: t.dropped,
    normalizeErrors: t.normalizeErrors,
    rowsLostBeforeCanView: t.rowsLostBeforeCanView,
    dropReasonHistogram: t.dropReasonHistogram,
    dominantDropReason: t.dominantDropReason,
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    userPerfil: t.userPerfil,
    userId: t.userId,
  });
}

function dominantKeyInHistogram_(hist) {
  if (!hist) return null;
  var best = null;
  var bestN = 0;
  Object.keys(hist).forEach(function (k) {
    if (hist[k] > bestN) {
      bestN = hist[k];
      best = k;
    }
  });
  return best;
}

// =============================================================================
// Web app
// =============================================================================

function doGet() {
  ensureSchema_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Portal de POPs — Drogarias Conceito')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getConfig() {
  return { logoUrl: LOGO_URL };
}

function debugAuthorizeUrlFetch() {
  var key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  Logger.log(key ? 'KEY OK' : 'KEY MISSING');

  var resp = UrlFetchApp.fetch('https://www.google.com/generate_204', {
    muteHttpExceptions: true
  });

  Logger.log('URLFETCH OK status=' + resp.getResponseCode());
  return {
    key: key ? 'KEY OK' : 'KEY MISSING',
    urlFetchStatus: resp.getResponseCode()
  };
}

// =============================================================================
// Dashboard Performance Operacional (C2) — piloto operacional (MVP)
// Não é o C2 gerencial completo (gravidade, repetição, tendência ainda limitados).
// =============================================================================

/** Última leitura da aba execucoes — só para log do endpoint C2. */
var __c2LastBuscaExecucoes_ = { sheetPresent: false, rowCount: 0, listError: null };

/**
 * Contrato da aba `execucoes` (SHEET_EXECUCOES) — documentação; o piloto não exige colunas extra.
 *
 * Obrigatório (mínimo esperado para o fluxo operacional):
 *   - popId
 *   - avaliadoId
 *   - score
 *   - dataHora
 *   - itensJson
 *   - modoPop
 *
 * Opcional aceito:
 *   - execucaoId, popTitulo, avaliadoNome, perfil, cargo, avaliadorId, tipo, flagCritica,
 *     statusExecucao, lojaId, lojaNome
 *
 * Observação: `tipo` é opcional no piloto atual; é recomendado para compatibilidade futura.
 *
 * Leitura: SpreadsheetApp.openById(SPREADSHEET_ID) — mesmo padrão do restante do sistema (Web App: nunca getActive).
 * Não lança: aba ausente, vazia ou cabeçalho incompleto → [].
 */
function buscarExecucoes_() {
  __c2LastBuscaExecucoes_ = { sheetPresent: false, rowCount: 0, listError: null };
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(SHEET_EXECUCOES);
    if (!sh) return [];
    __c2LastBuscaExecucoes_.sheetPresent = true;
    if (sh.getLastRow() < 1) return [];
    try {
      var rows = listRows_(sh);
      __c2LastBuscaExecucoes_.rowCount = rows.length;
      return rows;
    } catch (eList) {
      __c2LastBuscaExecucoes_.listError = String(eList && eList.message ? eList.message : eList);
      try {
        Logger.log('[C2][buscarExecucoes_] listRows falhou: ' + __c2LastBuscaExecucoes_.listError);
      } catch (e3) {}
      return [];
    }
  } catch (e) {
    try {
      Logger.log('[C2][buscarExecucoes_] ' + String(e && e.message ? e.message : e));
    } catch (e2) {}
    return [];
  }
}

/** @param execucoes {Array|undefined} linhas já filtradas no período (ou []). */
function gerarResumoFallback_(periodoDias, execucoes) {
  var pd = Number(periodoDias);
  if (pd !== 7 && pd !== 30) pd = 15;
  var total = (execucoes || []).length;
  return {
    periodoDias: pd,
    totalExecucoes: total,
    total_execucoes: total,
    motorVersao: 'piloto_mvp',
    statusGlobal: total === 0 ? 'amostragem_insuficiente' : 'normal',
    motivoStatusGlobal:
      total === 0
        ? 'Sem execuções no período'
        : 'Piloto operacional (MVP): métricas mínimas — não substitui o C2 gerencial completo.',
    adocao: {
      totalExecucoes: total,
    },
    risco: {
      scoreMedioGeral: 0,
      taxaFalhaCriticaGeral: 0,
      percentualPopsCriticos: 0,
      totalFalhasCriticas: 0,
    },
  };
}

function c2MergeResumoSeguro_(resumo, execucoesValidas, periodoDias) {
  var fb = gerarResumoFallback_(periodoDias, execucoesValidas || []);
  if (!resumo || typeof resumo !== 'object') return fb;
  if (resumo.totalExecucoes == null && resumo.total_execucoes == null) {
    resumo.totalExecucoes = fb.totalExecucoes;
    resumo.total_execucoes = fb.total_execucoes;
  }
  if (!resumo.motorVersao) resumo.motorVersao = fb.motorVersao;
  resumo.periodoDias = fb.periodoDias;
  return resumo;
}

function c2NormalizeDashboardData_(d, periodoDias) {
  d = d || {};
  var fb = gerarResumoFallback_(periodoDias, []);
  var v1 = d.c2v1 && typeof d.c2v1 === 'object' ? d.c2v1 : {};
  return {
    resumo: d.resumo && typeof d.resumo === 'object' ? d.resumo : fb,
    alertas: Array.isArray(d.alertas) ? d.alertas : [],
    colaboradores: Array.isArray(d.colaboradores) ? d.colaboradores : [],
    pops: Array.isArray(d.pops) ? d.pops : [],
    itens: Array.isArray(d.itens) ? d.itens : [],
    atualizadoEm: d.atualizadoEm || new Date().toISOString(),
    c2v1: {
      popsSemExecucao7d: Array.isArray(v1.popsSemExecucao7d) ? v1.popsSemExecucao7d : [],
      colaboradoresCriticos7d: Array.isArray(v1.colaboradoresCriticos7d) ? v1.colaboradoresCriticos7d : [],
      gerentesSemAtividade7d: Array.isArray(v1.gerentesSemAtividade7d) ? v1.gerentesSemAtividade7d : [],
    },
  };
}

function c2LogDashboardLine_(parts) {
  try {
    Logger.log('[C2] ' + parts.join(' '));
  } catch (e) {}
}

/**
 * Primeiro valor não vazio entre colunas de data/hora da execução (piloto C2).
 * dataHora primeiro — contrato da aba execucoes.
 */
function c2DashboardRawDataExecucao_(ex) {
  var keys = [
    ex.dataHora,
    ex.DataHora,
    ex.datahora,
    ex.dataExecucao,
    ex.data,
    ex.quando,
    ex.timestamp,
    ex.createdAt,
    ex.criadoEm,
  ];
  for (var i = 0; i < keys.length; i++) {
    var v = keys[i];
    if (v !== '' && v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Converte valor de data/hora da execução (Sheets Date, serial, ISO, YYYY-MM-DD, YYYY-MM-DD HH:mm:ss).
 * Não altera parseDateSafe_ global — uso restrito ao dashboard de execuções.
 */
function parseDateExecucao_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && !isNaN(value)) {
    if (value > 1e12) {
      var dm = new Date(value);
      return isNaN(dm.getTime()) ? null : dm;
    }
    if (value > 1e9 && value < 1e12) {
      var ds = new Date(value * 1000);
      return isNaN(ds.getTime()) ? null : ds;
    }
    if (value > 0 && value <= 600000) {
      var dser = new Date((value - 25569) * 86400 * 1000);
      return isNaN(dser.getTime()) ? null : dser;
    }
    var dflt = new Date(value);
    return isNaN(dflt.getTime()) ? null : dflt;
  }
  var s = String(value).trim();
  if (!s) return null;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    var sec = m[6] != null ? Number(m[6]) : 0;
    var dLocal = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), sec);
    return isNaN(dLocal.getTime()) ? null : dLocal;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    var dDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(dDay.getTime()) ? null : dDay;
  }
  return null;
}

function c2DashboardDataCamposFiltro_(ex) {
  return parseDateExecucao_(c2DashboardRawDataExecucao_(ex));
}

/** Corte do período — alinhado a dashboard_filtrarExecucoesValidas. */
function c2DashboardCutPeriodo_(filtros, refNow) {
  var dias = Number(filtros && filtros.periodoDias) || 15;
  if (dias !== 7 && dias !== 30) dias = 15;
  var now = refNow || new Date();
  return { cut: new Date(now.getTime() - dias * 24 * 60 * 60 * 1000) };
}

/** Retorna true sse a linha entra no período (regra atual do dashboard). */
function c2DashboardExecucaoPassaPeriodo_(ex, filtros, refNow) {
  var cut = c2DashboardCutPeriodo_(filtros, refNow).cut;
  var dt = c2DashboardDataCamposFiltro_(ex);
  if (!dt) return false;
  return dt >= cut;
}

/**
 * Só para log: quando c2DashboardDataCamposFiltro_ falha, primeiro motivo do contrato piloto
 * (ordem fixa) ou data_hora_invalida — não altera o filtro.
 */
function c2PilotoMotivoQuandoDataFiltroAusente_(ex) {
  if (!String(ex.execucaoId || ex.execucao_id || ex.id || '').trim()) return 'execucao_ausente';
  if (!String(ex.modoPop || ex.modo_pop || '').trim()) return 'modo_pop_invalido';
  if (!String(ex.popId || ex.codigoPop || ex.popCodigo || ex.numero || ex.codigo || '').trim()) return 'pop_id_ausente';
  if (!String(ex.avaliadoId || ex.avaliado_id || ex.colaboradorId || '').trim()) return 'avaliado_id_ausente';
  var dtAmplo = parseDateExecucao_(c2DashboardRawDataExecucao_(ex));
  if (dtAmplo) return 'data_hora_invalida';
  var sc = ex.score;
  if (sc === '' || sc === null || sc === undefined) return 'score_invalido';
  if (isNaN(Number(sc))) return 'score_invalido';
  var ij = ex.itensJson;
  if (ij === '' || ij === null || ij === undefined) return 'itens_invalidos';
  var parsed = safeJsonParse_(ij);
  if (parsed == null || Object.prototype.toString.call(parsed) !== '[object Array]') return 'itens_invalidos';
  return 'data_hora_invalida';
}

/** Só para log: aceita = mesma decisão de c2DashboardExecucaoPassaPeriodo_. */
function c2DashboardMotivoLinhaParaLog_(ex, filtros, refNow) {
  var raw = c2DashboardRawDataExecucao_(ex);
  var cut = c2DashboardCutPeriodo_(filtros, refNow).cut;
  var dt = parseDateExecucao_(raw);
  if (!dt) {
    if (raw !== null && raw !== undefined && raw !== '') {
      return { aceita: false, motivo: 'data_hora_invalida', valorBruto: raw };
    }
    return { aceita: false, motivo: c2PilotoMotivoQuandoDataFiltroAusente_(ex), valorBruto: null };
  }
  if (dt < cut) return { aceita: false, motivo: 'fora_do_periodo', valorBruto: null };
  return { aceita: true, motivo: 'valida', valorBruto: null };
}

function c2ExecDiagId_(idx) {
  var n = idx + 1;
  var s = String(n);
  if (s.length < 3) s = ('000' + s).slice(-3);
  return 'exec_' + s;
}

/** Log de invalidação por linha (piloto C2); não muda regra de negócio. */
function c2LogInvalidacaoExecucoes_(execucoesBrutas, filtros, refNow) {
  try {
    var arr = execucoesBrutas || [];
    var ref = refNow || new Date();
    var acc = 0;
    var desc = 0;
    Logger.log('[C2][raw] linhas=' + arr.length);
    for (var i = 0; i < arr.length; i++) {
      var row = c2DashboardMotivoLinhaParaLog_(arr[i], filtros, ref);
      var id = c2ExecDiagId_(i);
      if (row.aceita) {
        acc++;
        Logger.log('[C2][' + id + '] valida');
      } else {
        desc++;
        var invLine = '[C2][' + id + '] invalida motivo=' + row.motivo;
        if (row.motivo === 'data_hora_invalida' && row.valorBruto != null && row.valorBruto !== '') {
          var vb = row.valorBruto;
          if (Object.prototype.toString.call(vb) === '[object Date]' && !isNaN(vb.getTime())) {
            invLine += ' valorBruto=' + vb.toISOString();
          } else {
            var vs = String(vb).replace(/\s+/g, ' ').trim();
            if (vs.length > 120) vs = vs.substring(0, 117) + '...';
            invLine += ' valorBruto=' + vs;
          }
        }
        Logger.log(invLine);
      }
    }
    Logger.log('[C2][summary] validas=' + acc + ' descartadas=' + desc);
  } catch (eLog) {}
}

function dashboard_filtrarExecucoesValidas(execucoesBrutas, filtros, refNow) {
  var ref = refNow || new Date();
  return (execucoesBrutas || []).filter(function (ex) {
    return c2DashboardExecucaoPassaPeriodo_(ex, filtros, ref);
  });
}

function dashboard_filtrarExecucoesPeriodoAnterior(execucoesBrutas, filtros) {
  var dias = Number(filtros && filtros.periodoDias) || 15;
  if (dias !== 7 && dias !== 30) dias = 15;
  var now = new Date();
  var endA = new Date(now.getTime() - dias * 24 * 60 * 60 * 1000);
  var startB = new Date(now.getTime() - 2 * dias * 24 * 60 * 60 * 1000);
  return (execucoesBrutas || []).filter(function (ex) {
    var dt = parseDateExecucao_(c2DashboardRawDataExecucao_(ex));
    if (!dt) return false;
    return dt >= startB && dt < endA;
  });
}

/** Normaliza nome de coluna da planilha para casar cabeçalhos variantes (piloto C2). */
function c2NormalizeHeaderKey_(s) {
  var t = String(s || '').toLowerCase().replace(/[\s_\-]/g, '');
  try {
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (eNorm) {}
  return t;
}

/** Primeiro valor não vazio em `obj` cuja chave case-insensitive bate com um dos aliases. */
function c2AliasedField_(obj, aliases) {
  if (!obj || typeof obj !== 'object') return null;
  var map = {};
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    map[c2NormalizeHeaderKey_(k)] = k;
  }
  for (var i = 0; i < aliases.length; i++) {
    var nk = c2NormalizeHeaderKey_(aliases[i]);
    var rk = map[nk];
    if (rk == null) continue;
    var v = obj[rk];
    if (v !== '' && v !== null && v !== undefined) return v;
  }
  return null;
}

function c2ParseScoreNumber_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number' && !isNaN(v)) return v;
  var s = String(v).trim().replace(/\s/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) s = s.replace(',', '.');
  else if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function c2PopIdExec_(ex) {
  var v = c2AliasedField_(ex, [
    'popId',
    'PopId',
    'codigoPop',
    'popCodigo',
    'numero',
    'codigo',
    'POP',
    'idPop',
  ]);
  if (v != null && String(v).trim() !== '') return String(v).trim();
  return String(ex.popId || ex.codigoPop || ex.popCodigo || ex.numero || ex.codigo || '—').trim();
}

function c2ChaveColaboradorEx_(ex) {
  var id = c2AliasedField_(ex, ['avaliadoId', 'AvaliadoId', 'avaliado_id', 'colaboradorId', 'ColaboradorId']);
  id = id != null ? String(id).trim() : '';
  if (id) return id;
  var nome = c2AliasedField_(ex, ['avaliadoNome', 'Avaliado Nome', 'nomeAvaliado', 'nome_avaliado']);
  nome = nome != null ? String(nome).trim() : '';
  if (nome) return 'nome:' + nome;
  id = String(ex.userId || ex.userid || ex.email || ex.usuario || '').trim();
  if (id) return id;
  return '—';
}

function c2NomeExibicaoColaboradorEx_(ex) {
  var nome = c2AliasedField_(ex, [
    'avaliadoNome',
    'Avaliado Nome',
    'nomeAvaliado',
    'nome_avaliado',
    'colaboradorNome',
    'Colaborador Nome',
    'nomeColaborador',
  ]);
  nome = nome != null ? String(nome).trim() : '';
  if (nome) return nome;
  nome = String(ex.colaboradorNome || ex.nome || ex.name || '').trim();
  if (nome) return nome;
  var id = c2AliasedField_(ex, ['avaliadoId', 'AvaliadoId', 'colaboradorId']);
  id = id != null ? String(id).trim() : '';
  if (id) return id;
  id = String(ex.avaliadoId || ex.userId || ex.email || ex.usuario || '').trim();
  if (id) return id;
  return '—';
}

function dashboard_agruparColaboradores(execucoesValidas, execucoesAnterior) {
  var m = {};
  function bump(arr, field) {
    (arr || []).forEach(function (ex) {
      var chave = c2ChaveColaboradorEx_(ex);
      var nome = c2NomeExibicaoColaboradorEx_(ex);
      if (!m[chave]) m[chave] = { colaborador: nome, noPeriodo: 0, periodoAnterior: 0 };
      else if (m[chave].colaborador === '—' && nome !== '—') m[chave].colaborador = nome;
      m[chave][field]++;
    });
  }
  bump(execucoesValidas, 'noPeriodo');
  bump(execucoesAnterior, 'periodoAnterior');
  return Object.keys(m).map(function (k) {
    return m[k];
  });
}

function dashboard_agruparPops(execucoesValidas, execucoesAnterior) {
  var m = {};
  function bump(arr, field) {
    (arr || []).forEach(function (ex) {
      var pid = c2PopIdExec_(ex);
      if (!m[pid]) m[pid] = { pop: pid, noPeriodo: 0, periodoAnterior: 0 };
      m[pid][field]++;
    });
  }
  bump(execucoesValidas, 'noPeriodo');
  bump(execucoesAnterior, 'periodoAnterior');
  return Object.keys(m).map(function (k) {
    return m[k];
  });
}

function c2DescricoesItensDeExecucao_(ex) {
  var raw =
    ex.itensJson != null && ex.itensJson !== ''
      ? ex.itensJson
      : ex.itens_json != null && ex.itens_json !== ''
        ? ex.itens_json
        : c2AliasedField_(ex, ['itensJson', 'ItensJson', 'itens_json', 'itemsJson', 'checklistJson', 'Itens']);
  var arr = Array.isArray(raw) ? raw : safeJsonParse_(raw);
  if (!Array.isArray(arr)) return [];
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    var d = '';
    if (it == null) continue;
    if (typeof it === 'string' || typeof it === 'number' || typeof it === 'boolean') d = String(it).trim();
    else if (typeof it === 'object') {
      var pick = c2AliasedField_(it, [
        'descricao',
        'Descricao',
        'descrição',
        'texto',
        'titulo',
        'item',
        'passo',
        'conteudo',
        'nome',
        'label',
      ]);
      d = pick != null ? String(pick).trim() : '';
    }
    if (d) out.push(d);
  }
  return out;
}

function dashboard_agruparItens(execucoesValidas, execucoesAnterior) {
  var m = {};
  function bump(arr, field) {
    (arr || []).forEach(function (ex) {
      var descs = c2DescricoesItensDeExecucao_(ex);
      if (descs.length) {
        descs.forEach(function (d) {
          if (!m[d]) m[d] = { item: d, noPeriodo: 0, periodoAnterior: 0 };
          m[d][field]++;
        });
      } else {
        var fb = String(ex.itemId || ex.item || ex.etapa || ex.descricaoItem || ex.checklistItem || '').trim();
        if (!fb) fb = '(sem item no JSON)';
        if (!m[fb]) m[fb] = { item: fb, noPeriodo: 0, periodoAnterior: 0 };
        m[fb][field]++;
      }
    });
  }
  bump(execucoesValidas, 'noPeriodo');
  bump(execucoesAnterior, 'periodoAnterior');
  return Object.keys(m).map(function (k) {
    return m[k];
  });
}

function c2FlagCriticaExecucao_(ex) {
  var v = ex.flagCritica;
  if (v === undefined || v === null || v === '') v = ex.flag_critica;
  if (v === undefined || v === null || v === '')
    v = c2AliasedField_(ex, [
      'flagCritica',
      'FlagCritica',
      'flag_critica',
      'FalhaCritica',
      'falha_critica',
      'Critica',
      'critico',
      'Criticidade',
    ]);
  if (v === undefined || v === null || v === '') return false;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  var s = String(v).trim().toLowerCase();
  return (
    s === 'true' ||
    s === '1' ||
    s === 'sim' ||
    s === 'yes' ||
    s === 'verdadeiro' ||
    s === 'v' ||
    s === 'x' ||
    s === 'critica' ||
    s === 'crítica' ||
    s === 'critico' ||
    s === 'crítico'
  );
}

/** Piloto C2: status coerente com risco (0–1 nas taxas). */
function c2PilotoStatusEMotivo_(risco, nExec) {
  if (!nExec) {
    return {
      statusGlobal: 'amostragem_insuficiente',
      motivoStatusGlobal: 'Sem execuções no período',
    };
  }
  var tc = Number(risco && risco.taxaFalhaCriticaGeral);
  if (isNaN(tc)) tc = 0;
  if (tc > 1) tc = tc / 100;
  var pp = Number(risco && risco.percentualPopsCriticos);
  if (isNaN(pp)) pp = 0;
  if (pp > 1) pp = pp / 100;
  var sm = Number(risco && risco.scoreMedioGeral);
  if (isNaN(sm)) sm = 0;

  if (tc >= 0.5 || pp >= 0.5 || sm < 40) {
    return {
      statusGlobal: 'critico',
      motivoStatusGlobal:
        'Taxa elevada de falha crítica e/ou POPs críticos no período, ou score médio muito baixo — priorizar revisão operacional.',
    };
  }
  if (tc >= 0.2 || pp >= 0.2 || sm < 55) {
    return {
      statusGlobal: 'atencao',
      motivoStatusGlobal:
        'Indicadores de risco no período (falhas críticas, POPs críticos ou score) — recomenda-se monitoramento.',
    };
  }
  return {
    statusGlobal: 'normal',
    motivoStatusGlobal:
      'Piloto operacional (MVP): métricas dentro de faixa moderada no período — manter acompanhamento.',
  };
}

function dashboard_calcularResumo(ctx) {
  var pd = Number(ctx && ctx.periodoDias);
  if (pd !== 7 && pd !== 30) pd = 15;
  var ev = ctx.execucoes || [];
  var n = ev.length;
  var base = gerarResumoFallback_(pd, ev);
  base.totalExecucoes = n;
  base.total_execucoes = n;
  if (base.adocao) base.adocao.totalExecucoes = n;
  base.popsAvaliados = (ctx.pops || []).length;
  base.itensDistintos = (ctx.itens || []).length;
  base.colaboradoresComExecucao = (ctx.colaboradores || []).filter(function (c) {
    return c.noPeriodo > 0;
  }).length;

  var somaScore = 0;
  var qScore = 0;
  var crit = 0;
  var popsCriticos = {};
  for (var i = 0; i < n; i++) {
    var ex = ev[i];
    var scRaw = c2AliasedField_(ex, ['score', 'Score', 'pontuacao', 'Pontuacao', 'nota', 'Nota', 'pontuacaoFinal']);
    var num = c2ParseScoreNumber_(scRaw);
    if (!isNaN(num)) {
      somaScore += num;
      qScore++;
    }
    if (c2FlagCriticaExecucao_(ex)) {
      crit++;
      var pid = c2PopIdExec_(ex);
      if (pid && pid !== '—') popsCriticos[pid] = true;
    }
  }
  if (!base.risco) base.risco = {};
  base.risco.scoreMedioGeral = qScore ? somaScore / qScore : 0;
  base.risco.taxaFalhaCriticaGeral = n ? crit / n : 0;
  base.risco.totalFalhasCriticas = crit;

  var popsAg = ctx.pops || [];
  var popsComExec = popsAg.filter(function (p) {
    return (p.noPeriodo || 0) > 0;
  });
  var nPops = popsComExec.length;
  var nPopsCrit = 0;
  for (var pi = 0; pi < nPops; pi++) {
    var pk = String(popsComExec[pi].pop != null ? popsComExec[pi].pop : '').trim();
    if (pk && popsCriticos[pk]) nPopsCrit++;
  }
  base.risco.percentualPopsCriticos = nPops ? nPopsCrit / nPops : 0;

  var st = c2PilotoStatusEMotivo_(base.risco, n);
  base.statusGlobal = st.statusGlobal;
  base.motivoStatusGlobal = st.motivoStatusGlobal;

  return base;
}

function dashboard_gerarAlertas(ctx) {
  var alertas = [];
  var r = ctx.resumo || {};
  var total = Number(r.totalExecucoes != null ? r.totalExecucoes : r.total_execucoes);
  if (isNaN(total)) total = 0;
  if (total === 0) {
    alertas.push({
      tipo: 'amostragem',
      mensagem: 'Sem execuções no período selecionado.',
      severity: 'info',
    });
    return alertas;
  }
  (ctx.colaboradores || []).forEach(function (c) {
    if (c.noPeriodo === 0 && c.periodoAnterior > 0) {
      alertas.push({
        tipo: 'queda',
        mensagem: 'Colaborador ' + c.colaborador + ': execuções caíram em relação ao período anterior.',
        severity: 'warning',
      });
    }
  });
  if ((ctx.pops || []).length === 0) {
    alertas.push({
      tipo: 'vinculo',
      mensagem: 'Há execuções, mas nenhum POP foi agregado (confira colunas popId/codigo na aba execucoes).',
      severity: 'warning',
    });
  }

  var risk = r.risco && typeof r.risco === 'object' ? r.risco : {};
  var tf = Number(risk.totalFalhasCriticas);
  if (isNaN(tf)) tf = 0;
  var pctPop = Number(risk.percentualPopsCriticos);
  if (isNaN(pctPop)) pctPop = 0;
  if (pctPop > 1) pctPop = pctPop / 100;
  if (tf > 0) {
    alertas.push({
      tipo: 'critica',
      mensagem:
        'Falha crítica detectada no período (' +
        tf +
        ' execução(ões)) — revisar causas e ações corretivas.',
      severity: 'warning',
    });
  }
  if (pctPop > 0) {
    alertas.push({
      tipo: 'pop_critico',
      mensagem:
        'POP crítico no período: ' +
        (pctPop * 100).toFixed(0) +
        '% dos POPs com atividade tiveram execução marcada como crítica.',
      severity: 'warning',
    });
  }

  return alertas;
}

function c2AvaliadorChaveEx_(ex) {
  var id = c2AliasedField_(ex, ['avaliadorId', 'AvaliadorId', 'avaliador_id', 'gestorId', 'GerenteId', 'gerenteId']);
  id = id != null ? String(id).trim() : '';
  if (id) return id;
  return String(ex.avaliadorId || ex.gestorId || ex.gerenteId || '').trim();
}

/** Índice leve de usuários (id/código) para resolver perfil em linhas de execução. */
function c2BuildUsuarioIndexPorSessao_() {
  var users = listRows_(getSheet_(SHEET_USUARIOS)) || [];
  var out = { users: users, cache: {} };
  out.get = function (chave) {
    var k = String(chave || '').trim();
    if (!k) return null;
    if (this.cache[k]) return this.cache[k];
    var found = null;
    for (var i = 0; i < this.users.length; i++) {
      var row = this.users[i];
      var id = String(row.id || row.userId || '').trim();
      var cod = String(row.codigo != null && row.codigo !== '' ? row.codigo : '').trim();
      if (sameUsuarioId_(id, k) || (cod && sameUsuarioId_(cod, k))) {
        found = row;
        break;
      }
    }
    if (found) this.cache[k] = found;
    return found || null;
  };
  return out;
}

function c2PerfilChaveUsuario_(idx, chave) {
  var u = idx.get(chave);
  if (!u) return null;
  return normalizePerfil_(u.perfil);
}

function c2AvaliadoIdPrincipalEx_(ex) {
  var v = c2AliasedField_(ex, ['avaliadoId', 'AvaliadoId', 'avaliado_id', 'colaboradorId', 'ColaboradorId']);
  if (v != null && String(v).trim()) return String(v).trim();
  return String(ex.avaliadoId || ex.colaboradorId || '').trim();
}

/**
 * Chaves não vazias em execuções têm de existir na folha Usuarios (id ou codigo alinhados ao que grava em execucoes).
 * Isto é regra de dado: sem correspondência não inferimos perfil nem expandimos acesso — a linha fica de fora do
 * dashboard para não-diretor (comportamento conservador). Corrigir IDs na base restaura a leitura operacional.
 * Diretor não passa por esta verificação.
 */
function dashboard_execucaoChavesResolvemUsuarios_(ex, idx) {
  var a = c2AvaliadoIdPrincipalEx_(ex);
  var g = c2AvaliadorChaveEx_(ex);
  if (a && !idx.get(a)) return false;
  if (g && !idx.get(g)) return false;
  return true;
}

/**
 * Colaborador: só execuções ligadas ao próprio utilizador (avaliado ou avaliador).
 * Gerente: piso (perfis operacionais) + próprias avaliações; exclui avaliações atribuíveis à diretoria.
 * Diretor: tudo.
 */
function dashboard_execucaoVisivelParaUsuario_(ex, viewer, idx) {
  var p = normalizePerfil_(viewer && viewer.perfil);
  var myId = String(viewer && (viewer.id || viewer.userId) || '').trim();
  if (!myId) return false;
  if (p === 'diretor' || p === 'diretoria') return true;
  if (!dashboard_execucaoChavesResolvemUsuarios_(ex, idx)) return false;

  var aidChave = c2AvaliadorChaveEx_(ex);
  var avaliadoChave = c2AvaliadoIdPrincipalEx_(ex);

  if (p === 'atendente' || p === 'farmaceutico' || p === 'entregador') {
    if (avaliadoChave && sameUsuarioId_(avaliadoChave, myId)) return true;
    if (aidChave && sameUsuarioId_(aidChave, myId)) return true;
    return false;
  }

  if (p === 'gerente') {
    var perfAvaliador = aidChave ? c2PerfilChaveUsuario_(idx, aidChave) : null;
    if (perfAvaliador === 'diretor' || perfAvaliador === 'diretoria') return false;
    if (aidChave && sameUsuarioId_(aidChave, myId)) return true;
    var perfAvaliado = avaliadoChave ? c2PerfilChaveUsuario_(idx, avaliadoChave) : null;
    if (perfAvaliado === 'atendente' || perfAvaliado === 'farmaceutico' || perfAvaliado === 'entregador') return true;
    if (perfAvaliador === 'atendente' || perfAvaliador === 'farmaceutico' || perfAvaliador === 'entregador') return true;
    return false;
  }

  return false;
}

function dashboard_filtrarExecucoesGovernanca_(execs, viewer) {
  if (!Array.isArray(execs)) return [];
  var idx = c2BuildUsuarioIndexPorSessao_();
  return execs.filter(function (ex) {
    return dashboard_execucaoVisivelParaUsuario_(ex, viewer, idx);
  });
}

function c2v1CatalogoPopsCriticosVigentes_() {
  try {
    ensureSchema_();
    var rows = listRows_(getSheet_(SHEET_POPS));
    var out = [];
    (rows || []).forEach(function (r) {
      var p = normalizePopRow_(r);
      if (p.tipo !== 'critico') return;
      if (String(p.status) !== 'vigente') return;
      if (!String(p.popId || '').trim()) return;
      out.push({ popId: String(p.popId).trim(), numero: String(p.numero || '').trim(), titulo: String(p.titulo || 'POP sem título') });
    });
    return out;
  } catch (eCat) {
    return [];
  }
}

function c2v1ExecAssociaPopCritico_(ex, pop) {
  var pid = c2PopIdExec_(ex);
  if (!pid || pid === '—') return false;
  if (String(pid) === String(pop.popId || '').trim()) return true;
  if (pop.numero && String(pid) === String(pop.numero).trim()) return true;
  return false;
}

/**
 * C2 v1 — listas adicionais (sempre janela 7 dias, só POPs tipo crítico vigentes). Não altera o motor piloto existente.
 * @param {Array|undefined} optPopCatalog — se definido, restringe o catálogo (governança de saída sem refatorar agregadores).
 */
function c2v1ComputeAll_(execucoesBrutas, refNow, optPopCatalog) {
  var empty = { popsSemExecucao7d: [], colaboradoresCriticos7d: [], gerentesSemAtividade7d: [] };
  try {
    var ref = refNow || new Date();
    var popCatalog =
      optPopCatalog != null && Array.isArray(optPopCatalog) ? optPopCatalog : c2v1CatalogoPopsCriticosVigentes_();
    if (!popCatalog.length) return empty;

    var filtros7 = { periodoDias: 7 };
    var cut7 = c2DashboardCutPeriodo_(filtros7, ref).cut;

    var execsCrit7 = (execucoesBrutas || []).filter(function (ex) {
      if (!c2DashboardExecucaoPassaPeriodo_(ex, filtros7, ref)) return false;
      for (var i = 0; i < popCatalog.length; i++) {
        if (c2v1ExecAssociaPopCritico_(ex, popCatalog[i])) return true;
      }
      return false;
    });

    var lastMsByPopId = {};
    popCatalog.forEach(function (p) {
      lastMsByPopId[p.popId] = null;
    });
    (execucoesBrutas || []).forEach(function (ex) {
      var dt = c2DashboardDataCamposFiltro_(ex);
      if (!dt) return;
      var t = dt.getTime();
      for (var j = 0; j < popCatalog.length; j++) {
        var p = popCatalog[j];
        if (!c2v1ExecAssociaPopCritico_(ex, p)) continue;
        var cur = lastMsByPopId[p.popId];
        if (cur == null || t > cur) lastMsByPopId[p.popId] = t;
        break;
      }
    });

    var popsSem = [];
    popCatalog.forEach(function (p) {
      var lm = lastMsByPopId[p.popId];
      if (lm != null && lm >= cut7.getTime()) return;
      var diasSem;
      var ultimaIso = '';
      if (lm == null) {
        diasSem = 99999;
      } else {
        diasSem = Math.max(0, Math.floor((ref.getTime() - lm) / 86400000));
        ultimaIso = new Date(lm).toISOString();
      }
      popsSem.push({
        nome: p.titulo,
        diasSemExecucao: diasSem,
        ultimaExecucao: ultimaIso || '—',
        popId: p.popId,
      });
    });
    popsSem.sort(function (a, b) {
      return (b.diasSemExecucao || 0) - (a.diasSemExecucao || 0);
    });

    var aggCol = {};
    execsCrit7.forEach(function (ex) {
      var key = c2ChaveColaboradorEx_(ex);
      var nome = c2NomeExibicaoColaboradorEx_(ex);
      if (!aggCol[key]) aggCol[key] = { nome: nome, soma: 0, qVal: 0, qAll: 0 };
      if (aggCol[key].nome === '—' && nome !== '—') aggCol[key].nome = nome;
      aggCol[key].qAll++;
      var scRaw = c2AliasedField_(ex, ['score', 'Score', 'pontuacao', 'Pontuacao', 'nota', 'Nota', 'pontuacaoFinal']);
      var num = c2ParseScoreNumber_(scRaw);
      if (!isNaN(num)) {
        aggCol[key].soma += num;
        aggCol[key].qVal++;
      }
    });
    var colabCrit = [];
    Object.keys(aggCol).forEach(function (k) {
      var o = aggCol[k];
      if (o.qAll < 2) return;
      if (o.qVal < 1) return;
      var avg = o.soma / o.qVal;
      if (avg >= 70) return;
      colabCrit.push({
        nome: o.nome,
        scoreMedio: Math.round(avg * 10) / 10,
        numExecucoes: o.qAll,
      });
    });
    colabCrit.sort(function (a, b) {
      return (a.scoreMedio - b.scoreMedio) || (b.numExecucoes - a.numExecucoes);
    });

    var countAval = {};
    execsCrit7.forEach(function (ex) {
      var aid = c2AvaliadorChaveEx_(ex);
      if (!aid) return;
      countAval[aid] = (countAval[aid] || 0) + 1;
    });
    var gerentesOut = [];
    try {
      var users = listRows_(getSheet_(SHEET_USUARIOS));
      (users || []).forEach(function (u) {
        if (normalizePerfil_(u.perfil) !== 'gerente') return;
        var uid = String(u.id || u.userId || '').trim();
        if (!uid) return;
        var n = Number(countAval[uid] || 0);
        if (n !== 0) return;
        gerentesOut.push({
          nome: String(u.nome || u.usuario || uid).trim(),
          numExecucoes: 0,
          userId: uid,
        });
      });
    } catch (eU) {}
    gerentesOut.sort(function (a, b) {
      return String(a.nome).localeCompare(String(b.nome));
    });

    return {
      popsSemExecucao7d: popsSem,
      colaboradoresCriticos7d: colabCrit,
      gerentesSemAtividade7d: gerentesOut,
    };
  } catch (eAll) {
    try {
      Logger.log('[C2v1] ' + String(eAll && eAll.message ? eAll.message : eAll));
    } catch (eL) {}
    return empty;
  }
}

/** Catálogo crítico-vigente reduzido aos POPs que aparecem nas execuções já governadas (evita listas globais no payload). */
function c2v1FilterCatalogPopsPorExecucoes_(popCatalog, execsGov) {
  if (!Array.isArray(popCatalog) || !popCatalog.length) return [];
  if (!Array.isArray(execsGov) || !execsGov.length) return [];
  var set = {};
  for (var i = 0; i < execsGov.length; i++) {
    var ex = execsGov[i];
    for (var j = 0; j < popCatalog.length; j++) {
      var p = popCatalog[j];
      if (c2v1ExecAssociaPopCritico_(ex, p)) {
        set[String(p.popId || '').trim()] = true;
        break;
      }
    }
  }
  return popCatalog.filter(function (p) {
    return !!set[String(p.popId || '').trim()];
  });
}

/**
 * c2v1: diretor usa todas as execuções (visão global). Demais perfis só agregados sobre execuções governadas
 * e catálogo crítico intersecionado com essas linhas; nunca lista gerentesSemAtividade7d global.
 */
function c2v1ComputeAllParaUsuario_(execucoesBrutasFull, execucoesGovernadas, refNow, viewer) {
  var p = normalizePerfil_(viewer && viewer.perfil);
  if (p === 'diretor' || p === 'diretoria') {
    return c2v1ComputeAll_(execucoesBrutasFull, refNow);
  }
  var popFull = c2v1CatalogoPopsCriticosVigentes_();
  var popScoped = c2v1FilterCatalogPopsPorExecucoes_(popFull, execucoesGovernadas);
  var out = c2v1ComputeAll_(execucoesGovernadas, refNow, popScoped);
  out.gerentesSemAtividade7d = [];
  return out;
}

/**
 * Dashboard C2 (MVP): usa funções dashboard_* acima; nunca quebra o envelope esperado pelo Index.html.
 * Requer sessão válida; dados filtrados por perfil (colaborador / gerente / diretor).
 */
function api_obterDashboardPerformance(sessionId, payload) {
  var t0 = Date.now();
  var periodoDias = 15;
  var bruto = 0;
  var validas = 0;
  var sheetPresent = false;
  var listErr = '';
  var fallbackResumo = false;

  try {
    if (sessionId != null && typeof sessionId === 'object' && (payload === undefined || payload === null)) {
      return fail_(
        'AUTH_REQUIRED',
        'Atualize o portal e faça login de novo para ver Performance Operacional (sessão obrigatória).'
      );
    }
    ensureSchema_();
    var ctxDash = requireSession_(sessionId);
    if (!userHasPortalPermission_(ctxDash.user, 'performance_operacional')) {
      return fail_('FORBIDDEN', 'Sem permissão para Performance Operacional.');
    }

    if (payload != null && typeof payload !== 'object') {
      c2LogDashboardLine_(['aviso=payload_nao_objeto']);
      payload = {};
    } else {
      payload = payload || {};
    }
    var periodoBruto = payload.periodoDias;
    periodoDias = Number(periodoBruto);
    if (periodoBruto != null && periodoBruto !== '' && isNaN(periodoDias)) {
      c2LogDashboardLine_(['aviso=periodoDias_invalido_usando_15']);
      periodoDias = 15;
    } else if (periodoDias !== 7 && periodoDias !== 30) {
      periodoDias = 15;
    }

    var execucoesBrutasFull = buscarExecucoes_();
    var execucoesBrutas = dashboard_filtrarExecucoesGovernanca_(execucoesBrutasFull, ctxDash.user);
    bruto = execucoesBrutas.length;
    sheetPresent = !!__c2LastBuscaExecucoes_.sheetPresent;
    listErr = __c2LastBuscaExecucoes_.listError || '';

    var filtros = { periodoDias: periodoDias };

    var refNowDash = new Date();
    c2LogInvalidacaoExecucoes_(execucoesBrutas, filtros, refNowDash);

    var execucoesValidas =
      typeof dashboard_filtrarExecucoesValidas === 'function'
        ? dashboard_filtrarExecucoesValidas(execucoesBrutas, filtros, refNowDash)
        : [];
    validas = execucoesValidas.length;

    var execucoesAnterior =
      typeof dashboard_filtrarExecucoesPeriodoAnterior === 'function'
        ? dashboard_filtrarExecucoesPeriodoAnterior(execucoesBrutas, filtros)
        : [];

    var itens =
      typeof dashboard_agruparItens === 'function' ? dashboard_agruparItens(execucoesValidas, execucoesAnterior) : [];

    var colaboradores =
      typeof dashboard_agruparColaboradores === 'function'
        ? dashboard_agruparColaboradores(execucoesValidas, execucoesAnterior)
        : [];

    var pops =
      typeof dashboard_agruparPops === 'function' ? dashboard_agruparPops(execucoesValidas, execucoesAnterior) : [];

    var resumo;
    if (typeof dashboard_calcularResumo === 'function') {
      try {
        resumo = dashboard_calcularResumo({
          periodoDias: periodoDias,
          execucoes: execucoesValidas,
          itens: itens,
          colaboradores: colaboradores,
          pops: pops,
        });
      } catch (eCalc) {
        fallbackResumo = true;
        resumo = gerarResumoFallback_(periodoDias, execucoesValidas);
        try {
          Logger.log('[C2] resumo_fallback=motivo_calc erro=' + String(eCalc && eCalc.message ? eCalc.message : eCalc));
        } catch (eL) {}
      }
    } else {
      fallbackResumo = true;
      resumo = gerarResumoFallback_(periodoDias, execucoesValidas);
    }
    resumo = c2MergeResumoSeguro_(resumo, execucoesValidas, periodoDias);

    var alertas;
    try {
      alertas =
        typeof dashboard_gerarAlertas === 'function'
          ? dashboard_gerarAlertas({
              resumo: resumo,
              itens: itens,
              colaboradores: colaboradores,
              pops: pops,
            })
          : [];
    } catch (eAlert) {
      alertas = [];
      try {
        Logger.log('[C2] alertas_fallback erro=' + String(eAlert && eAlert.message ? eAlert.message : eAlert));
      } catch (eL2) {}
    }

    if (!Array.isArray(alertas)) alertas = [];

    var c2v1 = { popsSemExecucao7d: [], colaboradoresCriticos7d: [], gerentesSemAtividade7d: [] };
    try {
      c2v1 = c2v1ComputeAllParaUsuario_(execucoesBrutasFull, execucoesBrutas, refNowDash, ctxDash.user);
    } catch (eV1) {
      try {
        Logger.log('[C2v1] compute ' + String(eV1 && eV1.message ? eV1.message : eV1));
      } catch (eL3) {}
    }

    var dataRaw = {
      resumo: resumo,
      alertas: alertas,
      colaboradores: colaboradores,
      pops: pops,
      itens: itens,
      atualizadoEm: new Date().toISOString(),
      c2v1: c2v1,
    };
    var data = c2NormalizeDashboardData_(dataRaw, periodoDias);

    var tempoMs = Date.now() - t0;
    c2LogDashboardLine_([
      'periodo=' + periodoDias,
      'bruto=' + bruto,
      'validas=' + validas,
      'colaboradores=' + data.colaboradores.length,
      'pops=' + data.pops.length,
      'itens=' + data.itens.length,
      'fallbackResumo=' + (fallbackResumo ? 'true' : 'false'),
      'sheetExecucoes=' + (sheetPresent ? 'sim' : 'nao'),
      bruto > 0 && validas === 0 ? 'filtro_data_perdeu_todas=sim' : 'filtro_data_perdeu_todas=nao',
      listErr ? 'listErr=sim' : 'listErr=nao',
      'tempoMs=' + tempoMs,
    ]);

    if (!sheetPresent) {
      c2LogDashboardLine_(['aviso=aba_execucoes_ausente']);
    }
    if (bruto === 0 && sheetPresent) {
      c2LogDashboardLine_(['aviso=aba_execucoes_vazia_ou_so_cabecalho']);
    }
    if (listErr) {
      try {
        Logger.log('[C2] listErrDetalhe=' + String(listErr).substring(0, 200));
      } catch (eD) {}
    }

    return { ok: true, data: data };
  } catch (e) {
    var tempoMsErr = Date.now() - t0;
    try {
      Logger.log(
        '[C2] ERRO periodo=' +
          periodoDias +
          ' bruto=' +
          bruto +
          ' validas=' +
          validas +
          ' tempoMs=' +
          tempoMsErr +
          ' msg=' +
          String(e && e.message ? e.message : e)
      );
    } catch (e2) {}
    return {
      ok: false,
      message: 'Erro ao gerar dashboard',
      erro: String(e && e.message ? e.message : e),
    };
  }
}

// =============================================================================
// API (nova)
// =============================================================================

function api_login(emailOrUserOrId, senha) {
  ensureSchema_();
  var user = findActiveUserForLogin_(emailOrUserOrId, senha);
  if (!user) return fail_('AUTH_INVALID', 'Usuário/ID/email ou senha inválidos.');

  var session = createSession_(user);
  logAudit_(user, 'LOGIN', 'SESSAO', session.sessionId, {});

  return ok_({
    sessionId: session.sessionId,
    expiresAt: session.expiraEm,
    user: publicUser_(user),
  });
}

function api_logout(sessionId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  revokeSession_(ctx.session.sessionId);
  logAudit_(ctx.user, 'LOGOUT', 'SESSAO', ctx.session.sessionId, {});
  return ok_({ ok: true });
}

function api_getMe(sessionId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  return ok_({ user: publicUser_(ctx.user) });
}

/**
 * Estado global do sistema (Sprint 1: já existe, mas bloqueio forte vem Sprint 4).
 */
function api_getSystemState(sessionId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);

  var pendingCriticalReads = listPendingCriticalReads_(ctx.user);
  return ok_({
    blocked: false,
    reason: pendingCriticalReads.length ? 'PENDING_CRITICAL_READS' : null,
    pendingCriticalReads: pendingCriticalReads,
  });
}

function api_listPops(sessionId, filtros) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);

  var pops = getPopsLibraryForUser_(ctx.user);
  // Sprint 1: filtros opcionais, aplicados no backend apenas se vierem.
  var f = filtros || {};
  var beforeFilt = pops.length;
  if (f.status) pops = pops.filter(function (p) { return String(p.status || '') === String(f.status); });
  if (f.criticidade) pops = pops.filter(function (p) { return String(p.criticidade || '') === String(f.criticidade); });
  popDiagLog_('api_listPops', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    source: 'getPopsLibraryForUser_',
    beforeFilters: beforeFilt,
    popsReturned: pops.length,
    filtros: f,
    sample: pops.slice(0, 15).map(function (p) {
      return { popId: p.popId, titulo: p.titulo, status: p.status };
    }),
  });
  return ok_({ pops: pops });
}

function api_getPop(sessionId, popId, versaoId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  var pop = getPopForUser_(ctx.user, popId, versaoId);
  return ok_({ pop: pop });
}

function api_createPopDraft(sessionId, payload) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  assertCan_(ctx.user, 'POP_CREATE_DRAFT');

  var created = createPopDraft_(ctx.user, payload || {});
  logAudit_(ctx.user, 'POP_CREATE_DRAFT', 'POP', created.versaoId, auditPopDetails_(ctx.user, created, created.status));
  return ok_({ pop: created });
}

function api_updatePopDraft(sessionId, popId, versaoId, payload) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  assertCan_(ctx.user, 'POP_EDIT_DRAFT');

  var before = getPopForUser_(ctx.user, popId, versaoId);
  var updated = updatePopDraft_(ctx.user, popId, versaoId, payload || {});
  logAudit_(ctx.user, 'POP_UPDATE_DRAFT', 'POP', updated.versaoId, auditPopDetails_(ctx.user, before, updated.status, {
    statusNovo: updated.status,
    tipoNovo: normalizeTipoPop_(updated.tipo),
    origemNova: normalizeOrigemPop_(updated.origem),
  }));
  return ok_({ pop: updated });
}

/**
 * TEMPORÁRIO SPRINT 1:
 * Marca um POP como vigente sem workflow formal. Apenas diretor.
 * Substituir na Sprint 2 por workflow (em_aprovacao -> aprovado -> vigente).
 */
function api_setPopVigenteBasic(sessionId, popId, versaoId) {
  try {
    ensureSchema_();
    var ctx = requireSession_(sessionId);
    assertCan_(ctx.user, 'POP_MARK_VIGENTE_BASIC');

    var before = getPopForUser_(ctx.user, popId, versaoId);
    var pop = setPopVigenteBasic_(ctx.user, popId, versaoId);
    logAudit_(ctx.user, 'POP_MARK_VIGENTE_BASIC', 'POP', pop.versaoId, auditPopDetails_(ctx.user, before, pop.status));
    return ok_({ pop: pop });
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    if (e && e.popValidacaoErros) {
      return fail_('POP_PUBLICACAO_BLOQUEADA', msg, { erros: e.popValidacaoErros });
    }
    return fail_('POP_MARK_VIGENTE_ERR', msg, null);
  }
}

function api_listMyPendingReads(sessionId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  var pending = listMyPendingReads_(ctx.user);
  return ok_({ pending: pending });
}

function api_confirmRead(sessionId, popId, versaoId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  var pop = getPopForUser_(ctx.user, popId, versaoId);
  if (String(pop.status) !== 'vigente') return fail_('READ_NOT_ALLOWED', 'Leitura só pode ser confirmada para POP vigente.');

  var leitura = confirmRead_(ctx.user, pop);
  logAudit_(ctx.user, 'READ_CONFIRM', 'LEITURA', leitura.leituraId, { popId: pop.popId, versaoId: pop.versaoId, numero: pop.numero });
  return ok_({ leitura: leitura });
}

function api_getReadStatus(sessionId, popId, versaoId) {
  ensureSchema_();
  var ctx = requireSession_(sessionId);
  var pop = getPopForUser_(ctx.user, popId, versaoId);
  var leitura = getReadForUserAndVersion_(ctx.user.userId, pop.popId, pop.versaoId);
  return ok_({ lido: !!leitura, leitura: leitura || null });
}

// =============================================================================
// Compat layer (para o HTML que você já tem hoje)
// =============================================================================

/**
 * HTML atual chama login(usuario, senha) e espera:
 * { ok, token, user, expiresAt }
 *
 * Retorno sempre JSON-serializável (evita res === null no google.script.run do Web App).
 */
function login(usuarioOuIdOuEmail, senha) {
  try {
    var res = api_login(usuarioOuIdOuEmail, senha);
    if (!res || res.ok !== true) {
      var msg = (res && res.error && res.error.message) ? String(res.error.message) : 'Usuário/ID/email ou senha inválidos.';
      return { ok: false, message: msg };
    }
    var d = res.data || {};
    var u = d.user || {};
    var expMs = d.expiresAt instanceof Date ? d.expiresAt.getTime() : new Date(d.expiresAt).getTime();
    var out = {
      ok: true,
      token: String(d.sessionId || ''),
      expiresAt: isNaN(expMs) ? null : expMs,
      user: {
        id: String(u.id || u.userId || ''),
        userId: String(u.userId || u.id || ''),
        codigo: String(u.codigo != null && u.codigo !== '' ? u.codigo : ''),
        email: String(u.email || ''),
        nome: String(u.nome || ''),
        usuario: String(u.usuario || ''),
        perfil: String(u.perfil || ''),
        permissions: Array.isArray(u.permissions) ? u.permissions.map(function (x) { return String(x); }) : [],
      },
    };
    return JSON.parse(JSON.stringify(out));
  } catch (e) {
    return { ok: false, message: String((e && e.message) ? e.message : e) };
  }
}

function logoutSession(token) {
  // manter assinatura antiga
  try {
    api_logout(token);
    return { ok: true };
  } catch (e) {
    return { ok: true };
  }
}

/** Uma única leitura da biblioteca + áreas + stats (fonte de verdade partilhada). */
function buildPortalPayloadForUser_(user) {
  var pops = getPopsLibraryForUser_(user);
  var areasMap = {};
  pops.forEach(function (p) {
    if (p.area) areasMap[p.area] = true;
  });
  var areas = Object.keys(areasMap).sort().map(function (nome) { return { nome: nome }; });
  var stats = computePortalStats_(user, pops);
  return {
    pops: pops,
    areas: areas,
    stats: stats,
    popsPortal: pops.map(toPortalPopCompat_),
  };
}

/**
 * Portal atual espera:
 * { ok, areas, pops, stats }
 */
function getPortalData(token) {
  var ctx = requireSession_(token);
  if (POP_DIAG_LOG) {
    var rawPortal = listRows_(getSheet_(SHEET_POPS));
    popDiagLog_('getPortalData.beforeLibrary', {
      spreadsheetId: SPREADSHEET_ID,
      sheet: SHEET_POPS,
      rawRows: rawPortal.length,
      rawSample: rawPortal.slice(0, 5).map(function (row) {
        return {
          popId: row.popId || row.id || '',
          titulo: row.titulo || '',
          status: row.status == null ? '(null)' : String(row.status),
        };
      }),
    });
  }
  var b = buildPortalPayloadForUser_(ctx.user);
  var pops = b.pops;
  popTriageCompareLog_('getPortalData', pops.length);
  popDiagLog_('getPortalData', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    popsReturned: pops.length,
    source: 'getPopsLibraryForUser_',
    sample: pops.slice(0, 15).map(function (p) {
      return { popId: p.popId, titulo: p.titulo, status: p.status, area: p.area };
    }),
  });
  return okCompat_({
    areas: b.areas,
    pops: b.popsPortal,
    stats: b.stats,
  });
}

/**
 * Uma chamada: biblioteca + dashboard com a mesma lista em memória (evita divergência UI / epoch).
 * Instrumentado por fases: qualquer falha devolve { ok:false, message: 'getPortalBundle@<fase>: …' }.
 */
function getPortalBundle(token) {
  var phase = 'entrada';
  try {
    phase = 'requireSession_';
    var ctx = requireSession_(token);
    popDiagLog_('getPortalBundle.phase', { phase: phase, userId: String(ctx.user.id || ctx.user.userId || '') });

    if (POP_DIAG_LOG) {
      phase = 'diag_rawPopsSheet';
      var rawPortal = listRows_(getSheet_(SHEET_POPS));
      popDiagLog_('getPortalBundle.beforeLibrary', {
        spreadsheetId: SPREADSHEET_ID,
        sheet: SHEET_POPS,
        rawRows: rawPortal.length,
      });
    }

    phase = 'buildPortalPayloadForUser_';
    var b = buildPortalPayloadForUser_(ctx.user);
    popDiagLog_('getPortalBundle.phase', { phase: phase, popsRaw: (b.pops || []).length, areas: (b.areas || []).length });

    phase = 'areas_stats_popsPortal';
    var areas = b.areas;
    var stats = b.stats;
    var popsPortal = b.popsPortal;
    popDiagLog_('getPortalBundle.phase', { phase: phase, popsPortalLen: (popsPortal || []).length });

    phase = 'normalizePerfil_+fila';
    var perfil = normalizePerfil_(ctx.user.perfil);
    var fila = buildFilaDashboard_(ctx.user, b.pops);
    popDiagLog_('getPortalBundle.phase', { phase: phase, perfil: perfil, filaLen: (fila || []).length });

    phase = 'countActiveUsers_';
    var nUsers = countActiveUsers_();

    phase = 'safeBuildRankingConformidade_';
    var isAdminView = perfil === 'diretor' || perfil === 'gerente';
    var ranking = isAdminView ? safeBuildRankingConformidade_(ctx.user) : [];
    popDiagLog_('getPortalBundle.phase', { phase: phase, rankingLen: (ranking || []).length });

    phase = 'buildMeusPendentes_';
    var meus = !isAdminView ? buildMeusPendentes_(ctx.user) : [];
    popDiagLog_('getPortalBundle.phase', { phase: phase, meusLen: (meus || []).length });

    phase = 'montarObjetoDashboard';
    var dashboard = {
      isAdminView: isAdminView,
      isGerenteView: perfil === 'gerente',
      popsNaBiblioteca: (b.pops || []).length,
      filaAprovacao: fila,
      metrics: {
        popsVigentes: stats.totalVigentes,
        popsCriticos: stats.criticosVigentes,
        usuariosAtivos: nUsers,
        popsEmRevisao: fila.length,
      },
      rankingConformidade: ranking,
      meusPendentes: meus,
    };

    phase = 'jsonSerializeTest_payload';
    var payload = {
      areas: areas,
      pops: popsPortal,
      stats: stats,
      dashboard: dashboard,
    };
    try {
      JSON.stringify(payload);
    } catch (se) {
      var seMsg = String(se && se.message ? se.message : se);
      popDiagLog_('getPortalBundle.serializeFail', { err: seMsg });
      var pops2 = (popsPortal || []).map(function (one) {
        try {
          return JSON.parse(JSON.stringify(one));
        } catch (e2) {
          return {
            id: one.id,
            titulo: String(one.titulo || ''),
            status: String(one.status || ''),
            conteudoObj: {},
            payload: {},
          };
        }
      });
      payload.pops = pops2;
      phase = 'jsonSerializeTest_payload_retry';
      try {
        JSON.stringify(payload);
      } catch (se2) {
        throw new Error('serializePayload: ' + String(se2 && se2.message ? se2.message : se2) + ' (original: ' + seMsg + ')');
      }
    }

    phase = 'popTriageCompareLog_';
    popTriageCompareLog_('getPortalBundle', (b.pops || []).length);

    phase = 'okCompat_';
    popDiagLog_('getPortalBundle.success', { pops: (b.pops || []).length, fila: (fila || []).length });
    return okCompat_(payload);
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    popDiagLog_('getPortalBundle.ERROR', { phase: phase, err: msg });
    try {
      Logger.log('[getPortalBundle] FASE=' + phase + ' ERRO=' + msg);
    } catch (eLog) {}
    return { ok: false, message: 'getPortalBundle@' + phase + ': ' + msg };
  }
}

function getPopById(popId, token) {
  var ctx = requireSession_(token);
  var pop = getPopForUser_(ctx.user, popId, null);
  return okCompat_({ pop: toPortalPopDetailCompat_(pop) });
}

function marcarComoLido(token, popId) {
  var ctx = requireSession_(token);
  var pop = getPopForUser_(ctx.user, popId, null);
  if (String(pop.status) !== 'vigente') return { ok: false, message: 'Leitura só pode ser confirmada para POP vigente.' };
  confirmRead_(ctx.user, pop);
  return { ok: true, message: 'Leitura registrada com sucesso.' };
}

function publicarPop(token, popId) {
  // Diretor publica a partir de rascunho, fila do gerente ou aprovação pendente.
  var res = api_setPopVigenteBasic(token, popId, null);
  if (!res.ok) {
    var det = res.error && res.error.details;
    return {
      ok: false,
      message: res.error.message,
      code: res.error.code,
      erros: det && det.erros ? det.erros : [],
    };
  }
  return { ok: true, message: 'POP publicado como vigente.' };
}

function submeterPopAprovacao(token, popId) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_EDIT_DRAFT');
  var pop = getPopForUser_(ctx.user, popId, null);
  if (String(pop.status) !== 'rascunho') throw new Error('Somente rascunho pode ser enviado para aprovação.');
  assertPopCamposMinimosFluxo_(pop);
  if (normalizeTipoPop_(pop.tipo) === 'critico' && !userMayPersistPopCritico_(ctx.user)) {
    throw new Error('Seu perfil não pode enviar POP crítico para aprovação.');
  }
  assertPopChangedSinceLastSubmit_(pop);
  assertAutorDiferenteDeAprovadorCriticoFromPop_(pop);
  var p = normalizePerfil_(ctx.user.perfil);
  var next = (p === 'gerente' || p === 'diretor') ? 'aguardando_diretor' : 'em_aprovacao';
  patchPopStatus_(pop.popId, pop.versaoId, next);
  logAudit_(ctx.user, 'POP_SUBMIT', 'POP', pop.versaoId, auditPopDetails_(ctx.user, pop, next, {
    snapshot: popRelevantSnapshot_(pop),
  }));
  if (normalizeTipoPop_(pop.tipo) === 'colaborativo') {
    logFluxo_(ctx.user, {
      acao: 'enviar_aprovacao',
      etapa: 'aprovacao',
      status: 'ok',
      mensagem: String(next || ''),
      tipo: 'colaborativo',
      origem: String(pop.origem || 'colaborativo_gpt'),
      popId: String(pop.popId || popId || ''),
      payloadResumo: fluxoResumoPayloadMax500_({
        titulo: pop.titulo,
        area: pop.area,
        processo: pop.processo,
      }),
    });
  }
  return {
    ok: true,
    message: next === 'aguardando_diretor' ? 'Enviado ao diretor para publicação.' : 'Enviado ao gerente para aprovação.',
  };
}

function aprovarGerentePop(token, popId) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_APPROVE_MANAGER');
  var pop = getPopForUser_(ctx.user, popId, null);
  // POP crítico não passa pela fila do gerente: mensagem explícita antes do check de status (evita "não aguarda gerente" genérico).
  if (isPopCriticoFluxo_(pop)) throw new Error('POP crítico exige aprovação da diretoria.');
  if (String(pop.status) !== 'em_aprovacao') throw new Error('Este POP não está aguardando o gerente.');
  assertPopCamposMinimosFluxo_(pop);
  patchPopStatus_(pop.popId, pop.versaoId, 'aguardando_diretor');
  logAudit_(ctx.user, 'POP_APPROVE_MGR', 'POP', pop.versaoId, auditPopDetails_(ctx.user, pop, 'aguardando_diretor'));
  return { ok: true, message: 'Aprovado pelo gerente. Aguardando o diretor publicar.' };
}

/** Volta para rascunho antes da publicação: quem criou (ou diretor) retira da fila de aprovação para editar de novo. */
function retomarEdicaoPop(token, popId) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_EDIT_DRAFT');
  var pop = getPopForUser_(ctx.user, popId, null);
  var st = String(pop.status || '');
  if (['em_aprovacao', 'aguardando_diretor'].indexOf(st) < 0) {
    return { ok: false, message: 'Só é possível retomar edição enquanto o POP aguarda aprovação do gestor ou do diretor (não vigente).' };
  }
  var uid = String(ctx.user.id || ctx.user.userId || '');
  var autor = String(pop.autorUserId || '');
  var perfil = normalizePerfil_(ctx.user.perfil);
  if (uid !== autor && perfil !== 'diretor') {
    return { ok: false, message: 'Apenas quem criou o POP (ou o diretor) pode retomar a edição nesta etapa.' };
  }
  patchPopStatus_(pop.popId, pop.versaoId, 'rascunho');
  logAudit_(ctx.user, 'POP_RETRACT_TO_DRAFT', 'POP', pop.versaoId, auditPopDetails_(ctx.user, pop, 'rascunho'));
  return { ok: true, message: 'POP retornado para rascunho. Ajuste e reenvie para aprovação quando estiver pronto.' };
}

function patchPopStatus_(popId, versaoId, status) {
  var sheet = getSheet_(SHEET_POPS);
  var rows = listRowsWithRowIndex_(sheet).map(function (x) {
    return { rowIndex: x.rowIndex, obj: normalizePopRow_(x.obj) };
  });
  var match = rows.find(function (p) {
    if (versaoId) return String(p.obj.versaoId) === String(versaoId);
    return String(p.obj.popId) === String(popId) || String(p.obj.versaoId) === String(popId);
  });
  if (!match) throw new Error('POP não encontrado.');
  applyRowPatch_(sheet, match.rowIndex, { status: normalizeStatus_(status), atualizadoEm: new Date() });
}

function normalizeTipoPop_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (s === 'critico' || s === 'crítico') return 'critico';
  return 'colaborativo';
}

function normalizeOrigemPop_(v) {
  return String(v || '').trim();
}

/** Gerência e diretoria podem persistir POP com tipo crítico. */
function userMayPersistPopCritico_(user) {
  var p = normalizePerfil_(user && user.perfil);
  return p === 'gerente' || p === 'diretor' || p === 'diretoria';
}

function assertTipoPopPermitido_(user, tipoNormalizado) {
  var t = normalizeTipoPop_(tipoNormalizado);
  if (t !== 'critico') return;
  if (!userMayPersistPopCritico_(user)) {
    throw new Error('Seu perfil não pode criar ou alterar POP do tipo crítico.');
  }
}

function isCriticoProcedimentoItems_(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  var x = arr[0];
  return x != null && typeof x === 'object' && String(x.itemId || '').trim() !== '';
}

function normalizeFrequenciaCritico_(raw) {
  var s = normalizeText_(raw)
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
  if (s === 'por_demanda' || s === 'pordemanda') return 'por_demanda';
  if (s === 'diario' || s === 'diário') return 'diario';
  if (s === 'semanal') return 'semanal';
  return '';
}

function sanitizeOneItemCritico_(o) {
  if (!o || typeof o !== 'object') return null;
  var itemId = normalizeText_(o.itemId || o.id || '');
  if (!itemId) return null;
  var out = {
    itemId: itemId,
    etapa: normalizeText_(o.etapa || ''),
    descricao: normalizeText_(o.descricao || ''),
    acao: normalizeText_(o.acao || ''),
    criterioAvaliacao: normalizeText_(o.criterioAvaliacao || ''),
    tipoAvaliacao: 'binario',
    peso: normalizeText_(o.peso != null ? String(o.peso) : ''),
  };
  if (Object.prototype.hasOwnProperty.call(o, 'obrigatorio')) out.obrigatorio = normalizeBoolean_(o.obrigatorio);
  if (Object.prototype.hasOwnProperty.call(o, 'critico')) out.critico = normalizeBoolean_(o.critico);
  return out;
}

function normalizeProcedimentoCriticoLista_(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var s = sanitizeOneItemCritico_(raw[i]);
    if (s) out.push(s);
  }
  return out;
}

function mergeCriticoProcedimentoImutavelItemId_(prevList, nextList) {
  var prev = Array.isArray(prevList) ? prevList : [];
  var nxt = Array.isArray(nextList) ? nextList : [];
  var prevMap = {};
  for (var i = 0; i < prev.length; i++) {
    var it = prev[i];
    if (it && typeof it === 'object' && it.itemId) prevMap[String(it.itemId)] = it;
  }
  var out = [];
  for (var j = 0; j < nxt.length; j++) {
    var o = nxt[j];
    if (!o || typeof o !== 'object') continue;
    var nid = String(o.itemId || '').trim();
    if (nid && prevMap[nid]) {
      out.push(Object.assign({}, o, { itemId: prevMap[nid].itemId }));
    } else {
      out.push(o);
    }
  }
  return out;
}

function validatePopCritico_(normalized) {
  if (normalizeTipoPop_(normalized.tipo) !== 'critico') return;
  var cj = normalized.conteudoJson || {};
  var fq = normalizeFrequenciaCritico_(cj.frequencia || '');
  if (!fq) throw new Error('POP crítico: selecione a frequência (diário, semanal ou por demanda).');
  normalized.conteudoJson.frequencia = fq;
  var proc = normalized.conteudoJson.procedimento;
  if (!Array.isArray(proc) || proc.length < 1) {
    throw new Error('POP crítico: inclua pelo menos um item avaliável em procedimento.');
  }
  var seen = {};
  for (var i = 0; i < proc.length; i++) {
    var it = proc[i];
    if (!it || typeof it !== 'object') throw new Error('POP crítico: procedimento deve ser uma lista de itens estruturados.');
    var id = String(it.itemId || '').trim();
    if (!id) throw new Error('POP crítico: cada item deve ter itemId.');
    if (seen[id]) throw new Error('POP crítico: itemId duplicado: ' + id + '.');
    seen[id] = true;
    if (!String(it.etapa || '').trim()) throw new Error('POP crítico: etapa obrigatória no item ' + id + '.');
    if (!String(it.acao || '').trim()) throw new Error('POP crítico: ação obrigatória no item ' + id + '.');
    if (!String(it.criterioAvaliacao || '').trim()) throw new Error('POP crítico: critério de avaliação obrigatório no item ' + id + '.');
    if (String(it.tipoAvaliacao || 'binario') !== 'binario') throw new Error('POP crítico: tipoAvaliacao deve ser binario.');
    var pe = String(it.peso != null ? it.peso : '').trim();
    if (!pe) throw new Error('POP crítico: peso obrigatório no item ' + id + '.');
    if (isNaN(parseFloat(pe))) throw new Error('POP crítico: peso numérico inválido no item ' + id + '.');
    if (it.obrigatorio === undefined) throw new Error('POP crítico: campo obrigatorio obrigatório no item ' + id + '.');
    if (it.critico === undefined) throw new Error('POP crítico: campo critico obrigatório no item ' + id + '.');
  }
}

function assertAutorDiferenteDeAprovadorCritico_(normalized) {
  if (normalizeTipoPop_(normalized.tipo) !== 'critico') return;
  var cj = normalized.conteudoJson || {};
  var a = normalizeText_(normalized.autorNome || cj.autorNome || '');
  var ap = normalizeText_(normalized.aprovador || cj.aprovadorEsperado || '');
  // Quando não há outro diretor disponível no cadastro, usamos um aprovador institucional explícito
  // para não bloquear o fluxo de teste/publicação com o mesmo nome do autor.
  if (ap && iaBagNorm_(ap).indexOf('diretoria') >= 0 && iaBagNorm_(ap).indexOf('revisao') >= 0) return;
  if (a && ap && a.toLowerCase() === ap.toLowerCase()) {
    throw new Error('POP crítico: criador e aprovador esperado não podem ser a mesma pessoa.');
  }
}

function resolveAutorDisplayNameForPopCriticoGuard_(pop) {
  var cj = pop && pop.conteudoObj ? pop.conteudoObj : {};
  var a = normalizeText_(cj.autorNome || '');
  if (a) return a;
  var uid = String(pop && pop.autorUserId ? pop.autorUserId : '');
  if (!uid) return '';
  var users = listRows_(getSheet_(SHEET_USUARIOS));
  var u = users.find(function (x) {
    return String(x.id || x.userId || '') === uid;
  });
  return u ? normalizeText_(u.nome || u.usuario || '') : '';
}

function assertAutorDiferenteDeAprovadorCriticoFromPop_(pop) {
  if (normalizeTipoPop_(pop.tipo) !== 'critico') return;
  var cj = pop.conteudoObj || {};
  var tmp = {
    tipo: pop.tipo,
    autorNome: resolveAutorDisplayNameForPopCriticoGuard_(pop),
    aprovador: String(cj.aprovadorEsperado || ''),
    conteudoJson: cj,
  };
  assertAutorDiferenteDeAprovadorCritico_(tmp);
}

function isColaborativoGptJsonShape_(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (normalizeTipoPop_(obj.tipo) === 'critico') return false;
  if (Array.isArray(obj.procedimento) && isCriticoProcedimentoItems_(obj.procedimento)) return false;
  var t = String(obj.tipo || '')
    .trim()
    .toLowerCase();
  if (t === 'colaborativo') return true;
  if (Array.isArray(obj.procedimento)) return true;
  if (Object.prototype.hasOwnProperty.call(obj, 'errosComuns')) return true;
  if (Object.prototype.hasOwnProperty.call(obj, 'pontosDeAtencao')) return true;
  return false;
}

/** Conta etapas não vazias em procedimento (strings ou objetos com texto). */
function countProcedimentoEtapasValidas_(proc) {
  if (!Array.isArray(proc)) return 0;
  var n = 0;
  for (var i = 0; i < proc.length; i++) {
    var x = proc[i];
    var t = '';
    if (x == null) continue;
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') t = String(x);
    else if (typeof x === 'object') {
      t = String(x.texto || x.descricao || x.passo || x.item || x.titulo || x.conteudo || '').trim();
    }
    if (String(t).trim()) n++;
  }
  return n;
}

function validateColaborativoGptBlocking_(obj) {
  var errs = [];
  if (!obj || typeof obj !== 'object') {
    errs.push('JSON inválido ou vazio');
    return errs;
  }
  if (!String(obj.titulo || '').trim()) errs.push('Campo obrigatório ausente: titulo');
  if (!String(obj.area || '').trim()) errs.push('Campo obrigatório ausente: area');
  if (!String(obj.processo || '').trim()) errs.push('Campo obrigatório ausente: processo');
  if (!String(obj.objetivo || '').trim()) errs.push('Campo obrigatório ausente: objetivo');
  if (!Array.isArray(obj.procedimento)) errs.push('procedimento deve ser um array');
  else {
    var nEt = countProcedimentoEtapasValidas_(obj.procedimento);
    if (nEt < 1) errs.push('procedimento deve ter pelo menos 1 etapa com conteúdo');
  }
  return errs;
}

function validateColaborativoGptAdvisory_(obj) {
  var av = [];
  if (!obj || typeof obj !== 'object') return av;
  var ob = String(obj.objetivo || '').trim();
  if (ob.length > 0 && ob.length < 40) av.push('Objetivo muito curto');
  if (Array.isArray(obj.procedimento)) {
    var nEt = countProcedimentoEtapasValidas_(obj.procedimento);
    if (nEt > 0 && nEt < 3) av.push('Procedimento com menos de 3 itens');
  }
  if (!Array.isArray(obj.errosComuns) || obj.errosComuns.length === 0) av.push('Erros comuns ausentes');
  if (!Array.isArray(obj.pontosDeAtencao) || obj.pontosDeAtencao.length === 0) av.push('Pontos de atenção ausentes');
  return av;
}

function buildIncomingFromColaborativoGpt_(user, obj) {
  var gov = computeGovernancaDefaults_(user);
  return {
    tipo: normalizeTipoPop_(obj.tipo || 'colaborativo'),
    origem: 'colaborativo_gpt',
    titulo: normalizeText_(obj.titulo || ''),
    area: normalizeText_(obj.area || ''),
    processo: normalizeText_(obj.processo || ''),
    objetivo: normalizeText_(obj.objetivo || ''),
    procedimento: normalizeStringArray_(obj.procedimento || []),
    errosComuns: normalizeStringArray_(obj.errosComuns || []),
    pontosDeAtencao: normalizeStringArray_(obj.pontosDeAtencao || []),
    criticidade: 'media',
    status: 'rascunho',
    publicoAlvo: 'todos',
    leituraObrigatoria: true,
    treinamentoObrigatorio: true,
    autorNome: gov.autorNome,
    donoDocumento: gov.donoDocumento,
    aprovador: gov.aprovadorEsperado,
  };
}

function importarPopJson(token, jsonString) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_CREATE_DRAFT');

  try {
    var obj = JSON.parse(String(jsonString || ''));
    if (normalizeTipoPop_(obj.tipo) === 'critico') {
      logFluxo_(ctx.user, {
        acao: 'validacao_json',
        etapa: 'input',
        status: 'erro',
        mensagem: 'POP crítico não pode ser importado por JSON.',
        tipo: 'critico',
        origem: String(obj.origem || ''),
        popId: '',
        payloadResumo: fluxoResumoPayloadMax500_(obj),
      });
      return {
        ok: false,
        message: 'POP crítico não pode ser importado por JSON.',
        blocking: ['POP crítico não utiliza a importação colaborativa por JSON.'],
      };
    }
    var avisos = [];
    var mergedIn = obj;
    if (isColaborativoGptJsonShape_(obj)) {
      var block = validateColaborativoGptBlocking_(obj);
      if (block.length) {
        logFluxo_(ctx.user, {
          acao: 'validacao_json',
          etapa: 'input',
          status: 'erro',
          mensagem: block.join(' | '),
          tipo: 'colaborativo',
          origem: String(obj.origem || 'colaborativo_gpt'),
          popId: '',
          payloadResumo: fluxoResumoPayloadMax500_(obj),
        });
        return { ok: false, message: block.join(' '), blocking: block };
      }
      avisos = validateColaborativoGptAdvisory_(obj);
      mergedIn = buildIncomingFromColaborativoGpt_(ctx.user, obj);
    }
    var normalized = normalizePopJsonPayload_(ctx.user, mergedIn);
    logFluxo_(ctx.user, {
      acao: 'validacao_json',
      etapa: 'preview',
      status: 'ok',
      mensagem: (avisos || []).join(' | '),
      tipo: String(normalized.tipo || ''),
      origem: String(normalized.origem || ''),
      popId: '',
      payloadResumo: fluxoResumoPayloadMax500_(normalized),
    });
    return { ok: true, data: normalized, avisos: avisos };
  } catch (e) {
    var msg = (e && e.message) ? String(e.message) : 'JSON inválido ou não suportado.';
    logFluxo_(ctx.user, {
      acao: 'erro_fluxo_colaborativo',
      etapa: 'input',
      status: 'erro',
      mensagem: msg,
      tipo: '',
      origem: '',
      popId: '',
      payloadResumo: fluxoResumoPayloadMax500_(String(jsonString || '').substring(0, 800)),
    });
    return { ok: false, message: msg, blocking: [msg] };
  }
}

// =============================================================================
// Geração de POP com IA (Conceito) — prompt e contrato fixos; validação bloqueante no servidor.
// =============================================================================

var IA_POP_PROMPT_VERSAO_ = '1.1';

var IA_POP_PROMPT_SISTEMA_ =
  'Responda apenas um objeto JSON válido (sem markdown, sem texto fora do JSON). ' +
  'O JSON deve obedecer ao contrato pedido e ser compatível com validação automática posterior (ações observáveis nas etapas, critério verificável, sem frases genéricas proibidas).\n\n' +
  'ETAPAS (execucao.o_que_fazer):\n' +
  '- Cada item: começa com VERBO de ação + OBJETO concreto visível na loja (prateleira, produto, gôndola, etiqueta, cliente, balcão, estoque).\n' +
  '- Frases curtas são aceitáveis.\n' +
  '- Evite vazio operacional: "Garantir reposição adequada", "Executar o processo de reposição".\n' +
  '- Exemplos aceitáveis: "Verificar a prateleira e identificar falta de produto", "Repor o produto na gôndola", "Avisar o cliente sobre a reposição".\n\n' +
  'COMO FAZER BEM (via abordagem — o que vira comportamento observável):\n' +
  '- Simples é válido; não precisa ser sofisticado.\n' +
  '- Inclua pelo menos UM elemento físico ou ato visível (olhar, voz, posição, prateleira, gôndola, balcão, produto).\n' +
  '- Evite: "Fazer com atenção", "Agir com profissionalismo".\n\n' +
  'ERRO CRÍTICO (controle.erros_graves — falha visível):\n' +
  '- Frase simples basta.\n' +
  '- Exemplos aceitáveis: "Deixar a prateleira vazia", "Responder sem olhar para o cliente".\n' +
  '- Evite: "Não errar", "Evitar problemas", "Erro ruim".\n\n' +
  'CRITÉRIO DE SUCESSO (controle.criterio_sucesso):\n' +
  '- Deve ser VERIFICÁVEL (prazo, tempo máximo, contagem, sim/não, checklist binária, %).\n' +
  '- Pode ser simples, ex.: "Produto reposto em até 2 minutos após identificar falta".\n\n' +
  'CONTEXTO OPERACIONAL:\n' +
  '- Em atendimento ao cliente: fala, tom e postura observáveis.\n' +
  '- Em processos simples (reposição, organização, conferência): priorize CLAREZA e AÇÃO DIRETA em vez de linguagem decorativa.\n\n' +
  'VALIDAÇÃO INTERNA (no mesmo raciocínio; uma única mensagem JSON de saída):\n' +
  '- Verifique: (1) cada etapa com verbo+objeto observável; (2) nenhuma frase genérica proibida; (3) comportamento "certo" e primeiro erro grave são CENAS visíveis.\n' +
  '- Se falhar qualquer item: REESCREVA o objeto JSON inteiro NO MÁXIMO UMA VEZ e devolva só a versão final.\n\n' +
  'FORMATO LÓGICO: título, quando aplicar, 3 a 6 etapas, tempo, frequência, critério de sucesso. Preencha o contrato JSON nessa ordem de conteúdo.';

/** Prompt utilizador — texto fixo da especificação; apenas processo/situacao/erro variam. */
function buildIaPopPromptUsuario_(pIn, sIn, eIn) {
  return [
    'GERAR NO PADRÃO CONCEITO',
    '',
    'Você está gerando um POP operacional para farmácia de varejo.',
    '',
    'Objetivo:',
    'Criar um procedimento executável, mensurável e aplicável no dia a dia.',
    '',
    'ENTRADA:',
    '- processo:',
    String(pIn || ''),
    '- situacao:',
    String(sIn || ''),
    '- erro:',
    String(eIn || ''),
    '',
    'REGRAS OBRIGATÓRIAS:',
    '',
    '1. PROIBIDO linguagem genérica:',
    'Nunca use (nem variações óbvias):',
    '- atender bem',
    '- ser cordial / profissionalismo vazio',
    '- fazer corretamente / fazer bem',
    '- com atenção',
    '- não errar / evitar problemas / agir mal / erro ruim',
    '',
    '2. PROCEDIMENTO (execucao.o_que_fazer):',
    '- Cada etapa DEVE começar com VERBO de ação e conter OBJETO concreto visível na loja.',
    '- Frases curtas são aceitáveis.',
    '- Evite: "Garantir reposição adequada", "Executar o processo de reposição".',
    '- Prefira estilo: "Verificar a prateleira e identificar falta de produto", "Repor o produto na gôndola", "Avisar o cliente sobre a reposição".',
    '',
    '3. COMO FAZER BEM (abordagem: o_que_dizer, tom, postura — tudo observável):',
    '- Pode ser simples; inclua pelo menos UM elemento físico ou ato visível (olhar, voz, prateleira, gôndola, balcão, produto).',
    '- Proibido: "Fazer com atenção", "Agir com profissionalismo".',
    '',
    '4. ERRO CRÍTICO (controle.erros_graves — 1º item = falha principal visível):',
    '- Frase simples basta; descreva a cena errada.',
    '- Evite abstrações: "Não errar", "Evitar problemas".',
    '',
    '5. CRITÉRIO DE SUCESSO e MÉTRICA (controle):',
    '- critério de sucesso: VERIFICÁVEL (prazo, tempo máximo, contagem, sim/não, %).',
    '- Ex.: "Produto reposto em até 2 minutos após identificar falta".',
    '- metrica: alinhada a algo contável ou observável no período.',
    '',
    '6. Sempre incluir:',
    '- tempo',
    '- frequência',
    '- critério de sucesso',
    '',
    '7. Se for atendimento ao cliente:',
    '- incluir fala (o_que_dizer), tom e postura observáveis.',
    '',
    '8. Se NÃO for atendimento (reposição, organização, conferência, piso):',
    '- priorize CLAREZA e AÇÃO DIRETA em vez de linguagem sofisticada;',
    '- evite tom/postura subjetivos vazios; se usar postura, que seja física/posicional (ex.: "de frente à prateleira").',
    '',
    '9. Limite:',
    '- mínimo 3 etapas',
    '- máximo 6 etapas',
    '',
    '10. Classifique automaticamente linhaPop:',
    '- critico → cliente, medicamento, venda, dinheiro',
    '- operacional → rotinas internas',
    '',
    '11. VALIDAÇÃO INTERNA (antes de devolver o JSON; sem segunda mensagem ao utilizador):',
    '- Confira: (a) cada etapa com verbo+objeto observável; (b) nenhuma frase genérica proibida; (c) como fazer bem e erro crítico são CENAS observáveis.',
    '- Se falhar: reescreva o JSON COMPLETO NO MÁXIMO UMA VEZ e devolva só a versão final.',
    '',
    'SAÍDA:',
    'Retornar apenas JSON válido.',
    'Sem explicações.',
    '',
    'CONTRATO DE SAÍDA',
    '',
    '{',
    '  "titulo": "",',
    '  "area": "",',
    '  "processo": "",',
    '  "linhaPop": "",',
    '  "execucao": {',
    '    "o_que_fazer": [],',
    '    "tempo": "",',
    '    "frequencia": ""',
    '  },',
    '  "abordagem": {',
    '    "o_que_dizer": [],',
    '    "tom": "",',
    '    "postura": ""',
    '  },',
    '  "controle": {',
    '    "erros_graves": [],',
    '    "metrica": "",',
    '    "criterio_sucesso": ""',
    '  },',
    '  "contexto": {',
    '    "quando_aplicar": "",',
    '    "exemplo": ""',
    '  },',
    '  "versao_prompt": "' + IA_POP_PROMPT_VERSAO_ + '"',
    '}',
  ].join('\n');
}

function iaPad2_(n) {
  var s = String(n);
  return s.length >= 2 ? s : '0' + s;
}

function iaStripJsonFence_(s) {
  s = String(s || '').trim();
  if (s.indexOf('```') === 0) {
    s = s.replace(/^```[a-zA-Z]*\s*/m, '').replace(/\s*```$/m, '');
  }
  return s.trim();
}

function iaOpenAiChatJson_(systemText, userText) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('OPENAI_API_KEY');
  if (!key || !String(key).trim()) {
    throw new Error('OPENAI_API_KEY não configurada (Propriedades do script).');
  }
  var model = String(props.getProperty('OPENAI_MODEL') || 'gpt-4o-mini').trim();
  var body = {
    model: model,
    temperature: 0.35,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: String(systemText || IA_POP_PROMPT_SISTEMA_) },
      { role: 'user', content: String(userText || '') },
    ],
  };
  var opt = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + String(key).trim() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  var resp = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', opt);
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code !== 200) {
    throw new Error('OpenAI HTTP ' + code + ': ' + String(text || '').substring(0, 600));
  }
  var parsed = JSON.parse(text);
  var msg = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  return String(msg || '').trim();
}

function iaBagNorm_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Rotinas de piso (reposição, arrumação, etc.): operacional mesmo se o erro citar cliente sem achar produto. */
function iaIsFluxoInternoPiso_(area, processo, situacao, erro) {
  var chunk = iaBagNorm_(String(area || '') + ' ' + String(processo || '') + ' ' + String(situacao || '') + ' ' + String(erro || ''));
  return (
    /\b(reposi|reabastec|prateleir|gondol|arrumac|organizac|organiza|estoque|facing|sku)\b/.test(chunk) ||
    /\b(bagunca|bagun|produto acabou|loja cheia)\b/.test(chunk)
  );
}

function iaClassificarLinhaPopServidor_(area, processo, situacao, erro) {
  var bag = iaBagNorm_(String(area || '') + ' ' + String(processo || '') + ' ' + String(situacao || '') + ' ' + String(erro || ''));
  var strong = [
    'medicamento',
    'venda',
    'caixa',
    'dinheiro',
    'pagamento',
    'receita',
    'seguranca',
    'atendimento',
    'balcao',
    'consumidor',
  ];
  var i;
  for (i = 0; i < strong.length; i++) {
    if (bag.indexOf(strong[i]) >= 0) return 'critico';
  }
  if (iaIsFluxoInternoPiso_(area, processo, situacao, erro)) return 'operacional';
  if (bag.indexOf('cliente') >= 0) return 'critico';
  return 'operacional';
}

function iaDetectAtendimentoCliente_(area, processo, situacao, erro) {
  var bag = iaBagNorm_(String(area || '') + ' ' + String(processo || '') + ' ' + String(situacao || '') + ' ' + String(erro || ''));
  if (bag.indexOf('atendimento') >= 0 || bag.indexOf('balcao') >= 0 || bag.indexOf('consumidor') >= 0) return true;
  if (bag.indexOf('cliente') >= 0 && !iaIsFluxoInternoPiso_(area, processo, situacao, erro)) return true;
  return false;
}

function iaColetarStringsObj_(obj, out) {
  if (obj == null) return;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    out.push(String(obj));
    return;
  }
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) iaColetarStringsObj_(obj[i], out);
    return;
  }
  if (typeof obj === 'object') {
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      iaColetarStringsObj_(obj[k], out);
    }
  }
}

function iaTemLinguagemGenerica_(c) {
  var parts = [];
  iaColetarStringsObj_(c, parts);
  var blob = parts
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  var phrases = ['atender bem', 'ser cordial', 'fazer corretamente', 'com atencao'];
  for (var i = 0; i < phrases.length; i++) {
    if (blob.indexOf(phrases[i]) >= 0) return true;
  }
  if (/\bcorretamente\b/.test(blob)) return true;
  return false;
}

/** Frases genéricas fracas — casar por limite de palavra (evita falso positivo em texto operacional longo). */
function iaMotorFraseBanidasRegexesLeves_() {
  return [
    /\bcom\s+atencao\b/,
    /\bagir\s+com\s+atencao\b/,
    /\bagir\s+com\s+seguranca\b/,
    /\batender\s+bem\b/,
    /\bnao\s+errar\b/,
    /\bfazer\s+corretamente\b/,
    /\bdemonstrar\s+seguranca\b/,
    /\bevitar\s+problemas\b/,
    /\bnao\s+falhar\b/,
    /\bagir\s+mal\b/,
    /\bfazer\s+bem\b/,
    /\berro\s+ruim\b/,
    /\bser\s+profissional\b/,
    /\bter\s+atitude\b/,
    /\bboa\s+comunicacao\b/,
  ];
}

function iaMotorContemFraseBanidaLeve_(texto) {
  var s = iaBagNorm_(texto || '');
  if (!s) return false;
  var res = iaMotorFraseBanidasRegexesLeves_();
  for (var i = 0; i < res.length; i++) {
    if (res[i].test(s)) return true;
  }
  return false;
}

function iaMotorContagemTokens_(texto) {
  var s = iaBagNorm_(texto || '');
  if (!s) return 0;
  return s.split(/\s+/g).filter(Boolean).length;
}

function iaMotorTemVerboAcao_(texto) {
  var s = iaBagNorm_(texto || '');
  if (!s) return false;
  return /\b(falar|dizer|perguntar|pergunta|perguntou|responder|responde|explicar|explica|ouvir|ouve|ouviu|olhar|olha|encarar|manter|segurar|apoiar|virar|deixar|levantar|abaixar|apontar|girar|andar|parar|aproximar|afastar|bater|cumprimentar|acenar|esperar|chamar|confirmar|confirma|confirmou|validar|valida|verificar|verifica|verificou|conferir|conferi|checar|ler|mostrar|entregar|entrega|entregou|abrir|fechar|ligar|desligar|anotar|registar|registrar|registra|escrever|assinar|marcar|indicar|indica|apresentar|repetir|separar|pesar|medir|rotular|etiquetar|armazenar|guardar|limpar|higienizar|desinfetar|empacotar|orientar|oriente|avisar|informar|informa|fazer|faz|organizar|repor|recolocar|posicionar|alinhar|entender|entende|entendeu|esclarecer|esclarece|esclareceu|solicitar|solicita|solicitou|identificar|identifica|identificou|escutar|escuta|encaminhar|encaminha|encaminhou|avaliar|avalia|avaliou|retirar|retira|buscar|busca|localizar|localiza|acompanhar|acompanha|finalizar|finaliza|oferecer|oferece|recomendar|recomenda|observar|observa|interromper|interrompe|corrigir|corrige|atender|atende|pedir|pede|agir|saudar|sauda|saudou|sugerir|sugere|sugeriu|consultar|consulta|consultou)\b/.test(
    s
  );
}

function iaMotorCritCampoQaComVerboNaoVago_(txt) {
  var f = String(txt || '').trim();
  if (!f) return false;
  return iaMotorTemVerboAcao_(f) && !crivoTextoTemFraseVaga_(f);
}

function iaMotorCritItemQaAcaoObservavel_(it) {
  var o = it || {};
  return (
    iaMotorCritCampoQaComVerboNaoVago_(o.acao) ||
    iaMotorCritCampoQaComVerboNaoVago_(o.descricao) ||
    iaMotorCritCampoQaComVerboNaoVago_(o.padrao) ||
    iaMotorCritCampoQaComVerboNaoVago_(o.evidencia_minima) ||
    iaMotorCritCampoQaComVerboNaoVago_(o.criterioAvaliacao) ||
    iaMotorCritCampoQaComVerboNaoVago_(o.criterio_aprovacao) ||
    iaMotorCritCampoQaComVerboNaoVago_(o.criterioAprovacao)
  );
}

/** Verbo de ação (whitelist) em algum campo avaliável — diagnóstico, sem crivo de vago. */
function iaMotorCritItemTemVerboLexicoQaItensAval_(it) {
  var o = it || {};
  var fs = [o.acao, o.descricao, o.padrao, o.evidencia_minima, o.criterioAvaliacao, o.criterio_aprovacao, o.criterioAprovacao];
  for (var f = 0; f < fs.length; f++) {
    if (iaMotorTemVerboAcao_(fs[f])) return true;
  }
  return false;
}

/** Texto compacto p/ log quando `acao_observavel` (acao | desc | …). */
function iaMotorCritCadeiaTextoQaItensAvalLog_(it) {
  var o = it || {};
  return [
    o.acao,
    o.descricao,
    o.padrao,
    o.evidencia_minima,
    o.criterioAvaliacao,
    o.criterio_aprovacao,
    o.criterioAprovacao,
  ]
    .map(function (x) {
      return String(x == null ? '' : x).trim();
    })
    .filter(Boolean)
    .join(' | ');
}

function iaMotorTemSinalConcreto_(texto) {
  var s = iaBagNorm_(texto || '');
  if (!s) return false;
  return /\b(voz|volume|tom|ritmo|olhar|olhos|contato\s+visual|rosto|cliente|balcao|caixa|prateleira|estoque|dispensa|receita|receituario|medicamento|farmaceutico|farmaceutica|corpo|costas|perfil|ombro|maos|mao|dedos|postura|pe|pernas|passos|gesto|gestos|cabeca|direccao|direcao|frente|lado|ecra|tela|teclado|telefone|gondola|reposicao|atraso|vazio|vazia)\b/.test(
    s
  );
}

function iaMotorTemIndicioOperacionalSimples_(texto) {
  var s = iaBagNorm_(texto || '');
  if (!s) return false;
  if (/\d/.test(s)) return true;
  if (s.length >= 36) return true;
  var tokens = s.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 5) return true;
  return iaMotorTemSinalConcreto_(s);
}

function iaMotorErroTemAbstracaoObvia_(texto) {
  var s = iaBagNorm_(texto || '');
  if (!s) return false;
  return /\b(nao\s+(errar|falhar)|evitar\s+problemas|coisa\s+errada|algo\s+errado|qualquer\s+erro|de\s+forma\s+errada|mal\s+feito|erro\s+ruim)\b/.test(s);
}

function iaMotorValidarComoFazerErroCriticoLeve_(comoRaw, erroRaw) {
  var como = String(comoRaw || '').trim();
  var erro = String(erroRaw || '').trim();
  if (!como) return 'Como fazer bem precisa descrever comportamento visível';
  if (!erro) return 'Erro crítico precisa descrever falha visível e prática';
  if (iaMotorContemFraseBanidaLeve_(como)) return 'Como fazer bem precisa descrever comportamento visível';
  if (iaMotorContemFraseBanidaLeve_(erro)) return 'Erro crítico precisa descrever falha visível e prática';
  if (como.length < 8) return 'Como fazer bem precisa descrever comportamento visível';
  if (erro.length < 8) return 'Erro crítico precisa descrever falha visível e prática';
  if (iaMotorErroTemAbstracaoObvia_(erro)) return 'Erro crítico precisa descrever falha visível e prática';
  var comoOk =
    (iaMotorTemVerboAcao_(como) && iaMotorTemSinalConcreto_(como)) ||
    (iaMotorTemVerboAcao_(como) && iaMotorTemIndicioOperacionalSimples_(como)) ||
    (iaMotorTemSinalConcreto_(como) && iaMotorTemIndicioOperacionalSimples_(como)) ||
    (iaMotorTemVerboAcao_(como) && iaMotorContagemTokens_(como) >= 5);
  if (!comoOk) return 'Como fazer bem precisa descrever comportamento visível';
  var erroOk =
    (iaMotorTemVerboAcao_(erro) && iaMotorTemSinalConcreto_(erro)) ||
    (iaMotorTemVerboAcao_(erro) && iaMotorTemIndicioOperacionalSimples_(erro)) ||
    (iaMotorTemSinalConcreto_(erro) && iaMotorTemIndicioOperacionalSimples_(erro)) ||
    (iaMotorTemVerboAcao_(erro) && iaMotorContagemTokens_(erro) >= 4);
  if (!erroOk) return 'Erro crítico precisa descrever falha visível e prática';
  return '';
}

/** Validação mínima alinhada ao portal (manual) para persistência no servidor (anti-bypass). */
function assertPortalPopMinimoSemanticoPersistencia_(normalized) {
  var n = normalized || {};
  var tipo = normalizeTipoPop_(n.tipo);
  if (tipo === 'critico') return;
  if (!String(n.titulo || '').trim()) throw new Error('Título é obrigatório');
  var proc = n.conteudoJson && n.conteudoJson.procedimento ? n.conteudoJson.procedimento : [];
  if (!Array.isArray(proc) || countProcedimentoEtapasValidas_(proc) < 1) {
    throw new Error('Procedimento precisa ter ao menos 1 etapa');
  }
  var cj = n.conteudoJson || {};
  var q = iaMotorValidarComoFazerErroCriticoLeve_(cj.como_fazer_bem || cj.comoFazerBem || '', cj.erro_critico || cj.erroCritico || '');
  if (q) throw new Error(q);
}

function iaMotorPreencherComoFazerErroCriticoIncoming_(mergedIn, contract) {
  var out = mergedIn || {};
  var c = contract || {};
  var ab = c.abordagem || {};
  var ctl = c.controle || {};
  var eg = Array.isArray(ctl.erros_graves) ? ctl.erros_graves : [];
  var eg0 = String(eg[0] == null ? '' : eg[0]).trim();

  if (!String(out.como_fazer_bem || '').trim()) {
    var tom = String(ab.tom || '').trim();
    var post = String(ab.postura || '').trim();
    var bits = [];
    if (post) bits.push('Postura: ' + post);
    if (tom) bits.push('Tom: ' + tom);
    if (bits.length) out.como_fazer_bem = bits.join(' · ');
  }
  if (!String(out.erro_critico || '').trim()) {
    if (eg0) out.erro_critico = eg0;
  }
  return out;
}

/** QA motor: versão do heurístico de métrica (log / rastreio). */
var IA_MOTOR_QA_ENGINE_VERSION_ = 'qa_metric_fase4_v1';

/** Termos proibidos como foco principal da métrica (vago). */
function iaMotorMetricaTermosProibidos_() {
  return [
    'atendimento correto',
    'atendimentos corretos',
    'qualidade do atendimento',
    'atendimento bom',
    'cliente satisfeito',
    'processo adequado',
    'execução correta',
    'execucao correta',
  ];
}

/** Métrica vaga de “qualidade” (não enriquece automaticamente; QA continua a reprovar). */
function iaMotorMetricaVagaBloqueadaSempre_(metricaStr) {
  var bag = iaBagNorm_(String(metricaStr || ''));
  if (bag.indexOf('qualidade do atendimento') >= 0) return true;
  if (bag.indexOf('atendimento bom') >= 0) return true;
  if (bag.indexOf('cliente satisfeito') >= 0) return true;
  if (bag.indexOf('processo adequado') >= 0) return true;
  if (bag.indexOf('qualidade geral') >= 0) return true;
  return false;
}

function iaMotorMetricaBagTemProibicao_(bag) {
  var list = iaMotorMetricaTermosProibidos_();
  for (var i = 0; i < list.length; i++) {
    if (bag.indexOf(iaBagNorm_(list[i])) >= 0) return true;
  }
  return false;
}

/** Métrica operacional forte: mensurável + objeto de piso + período/frequência. */
function iaMotorQaMetricaOperacionalOk_(metricaStr) {
  var t = String(metricaStr || '').trim();
  if (t.length < 12) return false;
  var bag = iaBagNorm_(t);
  if (iaMotorMetricaVagaBloqueadaSempre_(t)) return false;
  if (iaMotorMetricaBagTemProibicao_(bag)) return false;
  var temMens =
    /%|percentual|percentagem|número|numero|quantidade|contagem|total(\s|$|de)/i.test(t) ||
    /meta[\s:]*\d/i.test(t) ||
    /\d+[\d.,]*\s*%/.test(t);
  var temOp =
    bag.indexOf('atend') >= 0 ||
    bag.indexOf('balc') >= 0 ||
    bag.indexOf('falh') >= 0 ||
    bag.indexOf('sugest') >= 0 ||
    bag.indexOf('pergun') >= 0 ||
    bag.indexOf('receit') >= 0 ||
    bag.indexOf('entreg') >= 0 ||
    bag.indexOf('checklist') >= 0 ||
    bag.indexOf('auditor') >= 0 ||
    bag.indexOf('erro') >= 0 ||
    bag.indexOf('caix') >= 0;
  var temPrazo =
    /semanal|quinzen|mensal|diari|por\s+semana|por\s+dia|por\s+turno|por\s+m[eê]s|em\s+\d+\s*dias|30\s*dias|no\s+m[eê]s|por\s+auditoria|auditoria/i.test(
      t,
    );
  return temMens && temOp && temPrazo;
}

/**
 * Enriquecimento determinístico da métrica após patch (antes do QA pós-patch).
 * Usa critério de sucesso só para meta/período; não copia “satisfatório” etc.
 */
function iaMotorMetricaReconstruirDeContexto_(metricaAtual, criterioSucesso, processo, situacao, erro) {
  void metricaAtual;
  var cs = String(criterioSucesso || '');
  var pct = '';
  var mPct = cs.match(/(\d{1,3})\s*%/);
  if (mPct) pct = mPct[1] + '%';
  var janela = 'semanal';
  if (cs) {
    if (/30\s*dias|trinta\s*dias|per[ií]odo\s+de\s+30|em\s+um\s+per[ií]odo\s+de\s+30/i.test(cs)) janela = 'em janela de 30 dias (referência mensal)';
    else if (/semanal|por\s+semana|a\s+cada\s+semana/i.test(cs)) janela = 'semanal';
    else if (/quinzenal|quinzena/i.test(cs)) janela = 'quinzenal';
    else if (/mensal|por\s+m[eê]s|no\s+m[eê]s/i.test(cs)) janela = 'mensal';
  }
  var errN = iaBagNorm_(String(erro || ''));
  var foco = 'atendimentos no balcão em que há pergunta explícita sobre a necessidade antes de sugestão de produto';
  if (errN.indexOf('sugere') >= 0 && errN.indexOf('necess') >= 0) {
    foco =
      'atendimentos no balcão em que o colaborador pergunta a necessidade do cliente antes de sugerir produto';
  }
  var meta = pct ? ' (referência de meta ' + pct + ' alinhada ao critério)' : '';
  return (
    'Percentual ' +
    janela +
    ' de ' +
    foco +
    meta +
    '.'
  );
}

/**
 * @param {Object} mergedIn
 * @param {{ processo: string, situacao: string, erro: string, linhaPop: string, contract: Object }} contexto
 */
function iaMotorNormalizarMetricaOperacional_(mergedIn, contexto) {
  var m = mergedIn || {};
  var cx = contexto || {};
  var c = cx.contract || {};
  if (!c.controle) c.controle = {};
  var ctl = c.controle;
  var criterio = String(m.criterio_sucesso || ctl.criterio_sucesso || '').trim();
  var metrica = String(m.metrica == null ? '' : m.metrica).trim();
  if (!metrica) return;
  if (iaMotorQaMetricaOperacionalOk_(metrica)) return;
  if (iaMotorMetricaVagaBloqueadaSempre_(metrica)) return;
  if (iaMotorMetricaBagTemProibicao_(iaBagNorm_(metrica)) && !criterio) {
    return;
  }
  var novo = iaMotorMetricaReconstruirDeContexto_(metrica, criterio, cx.processo, cx.situacao, cx.erro);
  if (novo && novo.length > 20) {
    m.metrica = novo;
    ctl.metrica = novo;
  }
}

function iaMotorQaChecklistIncoming_(mergedIn, contract) {
  var falhas = [];
  var m = mergedIn || {};
  var c = contract || {};
  var exec = c.execucao || {};
  var ctl = c.controle || {};

  // ação observável (heurística leve)
  if (normalizeTipoPop_(m.tipo) === 'colaborativo') {
    var steps = Array.isArray(m.procedimento) ? m.procedimento : [];
    var okSteps = 0;
    for (var i = 0; i < steps.length; i++) {
      var st = String(steps[i] == null ? '' : steps[i]).trim();
      if (!st) continue;
      if (iaMotorTemVerboAcao_(st)) okSteps++;
    }
    if (!steps.length || okSteps < Math.max(1, Math.ceil(steps.length * 0.5))) {
      falhas.push({ codigo: 'acao_observavel', mensagem: 'Procedimento precisa de ações observáveis (verbos) na maioria das etapas.' });
    }
  } else {
    var items = Array.isArray(m.procedimento) ? m.procedimento : [];
    var okItems = 0;
    for (var j = 0; j < items.length; j++) {
      if (iaMotorCritItemQaAcaoObservavel_(items[j])) okItems++;
    }
    if (!items.length || okItems < Math.max(1, Math.ceil(items.length * 0.5))) {
      var minOk = Math.max(1, Math.ceil(items.length * 0.5));
      var diags = [];
      for (var di = 0; di < items.length; di++) {
        var it0 = items[di] || {};
        var lex0 = iaMotorCritItemTemVerboLexicoQaItensAval_(it0);
        var tx0 = iaMotorCritCadeiaTextoQaItensAvalLog_(it0);
        diags.push({
          indice: di,
          itemId: String(it0.itemId == null || it0.itemId === '' ? di : it0.itemId),
          texto_analise: tx0 ? tx0 : '(vazio)',
          verbo_reconhecido: lex0 ? 'SIM' : 'NAO',
        });
      }
      falhas.push({
        codigo: 'acao_observavel',
        mensagem: 'Itens avaliáveis precisam descrever ação observável (verbo).',
        diagnostico_itens: diags,
        criterio_maioria: { minimo: minOk, obtido: okItems, total: items.length },
      });
    }
  }

  if (!String(exec.tempo || '').trim()) falhas.push({ codigo: 'tempo_definido', mensagem: 'Tempo da execução não definido no contrato.' });
  if (!String(exec.frequencia || '').trim()) falhas.push({ codigo: 'frequencia_definida', mensagem: 'Frequência da execução não definida no contrato.' });
  if (!String(m.metrica || '').trim()) falhas.push({ codigo: 'metrica', mensagem: 'Métrica ausente no payload.' });
  else if (!iaMotorQaMetricaOperacionalOk_(m.metrica)) {
    falhas.push({
      codigo: 'metrica_fraca',
      mensagem:
        'Métrica operacional fraca: combine sinal mensurável (número, quantidade, percentual, contagem…), objeto operacional de piso (atendimento, balcão, pergunta, sugestão…) e período ou frequência (semanal, mensal, em 30 dias, por turno…).',
    });
  }

  var criterioStr = String(ctl.criterio_sucesso || m.criterio_sucesso || '').trim();
  var critBlob = iaBagNorm_(criterioStr + ' ' + String(m.metrica || ''));
  var mensur =
    /\b(%|numero|número|quantidade|percentual|percentagem|contagem|total|zero|nenhum|checklist|binario|sim\/nao|sim\/não|confirmar|contar|registrar|medir|prazo|minutos|minuto|horas|hora|dias|dia|semana|semanal|diario|diário|quinzen|mensal)\b/.test(
      critBlob
    ) || /\b\d+\b/.test(critBlob);
  if (!criterioStr || !mensur) {
    falhas.push({
      codigo: 'criterio_sucesso_mensuravel',
      mensagem: 'Critério de sucesso precisa ser mensurável/verificável (número, %, checklist, prazo ou contagem).',
    });
  }

  var pre = iaMotorPreencherComoFazerErroCriticoIncoming_({ como_fazer_bem: m.como_fazer_bem, erro_critico: m.erro_critico }, c);
  var qCE = iaMotorValidarComoFazerErroCriticoLeve_(pre.como_fazer_bem, pre.erro_critico);
  if (qCE) falhas.push({ codigo: 'como_erro', mensagem: qCE });

  return falhas;
}

function iaMotorAplicarPatchIncoming_(base, patch) {
  var out = Object.assign({}, base || {});
  var p = patch || {};
  for (var k in p) {
    if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
    out[k] = p[k];
  }
  return out;
}

function iaMotorSincronizarContratoComIncoming_(contract, mergedIn) {
  var c = contract || {};
  var m = mergedIn || {};
  if (!c.execucao) c.execucao = {};
  if (!c.controle) c.controle = {};
  if (!c.abordagem) c.abordagem = {};

  // Sincroniza campos “fonte” usados no preview operacional e na validação bloqueante.
  if (normalizeTipoPop_(m.tipo) === 'colaborativo') {
    if (Array.isArray(m.procedimento)) c.execucao.o_que_fazer = m.procedimento.slice();
    if (m.frequencia != null && String(m.frequencia).trim()) c.execucao.frequencia = String(m.frequencia).trim();
  }
  if (m.metrica != null && String(m.metrica).trim()) c.controle.metrica = String(m.metrica).trim();
  if (m.criterio_sucesso != null && String(m.criterio_sucesso).trim()) {
    c.controle.criterio_sucesso = String(m.criterio_sucesso).trim();
  }

  // Heurística: se critério sumiu, reancora no objetivo/pontos (mantém contrato coerente com payload).
  if (!String(c.controle.criterio_sucesso || '').trim()) {
    var obj = String(m.objetivo || '').trim();
    if (obj) c.controle.criterio_sucesso = obj.split('\n')[0];
  }

  if (m.como_fazer_bem != null && String(m.como_fazer_bem).trim()) {
    var cf = String(m.como_fazer_bem).trim();
    // Mantém sinais no contrato (quando existir estrutura de abordagem).
    if (!String(c.abordagem.postura || '').trim()) c.abordagem.postura = cf;
  }
  if (m.erro_critico != null && String(m.erro_critico).trim()) {
    var eg = Array.isArray(c.controle.erros_graves) ? c.controle.erros_graves.slice() : [];
    if (!eg.length) eg = [''];
    eg[0] = String(m.erro_critico).trim();
    c.controle.erros_graves = eg;
  }
}

function iaMotorCorrigirIncomingUmaVez_(user, requestId, mergedIn, contract, falhas, pIn, sIn, eIn) {
  var sys = [
    'Você é um revisor interno de QA (invisível ao usuário final).',
    'Tarefa: corrigir SOMENTE os pontos falhos do POP já gerado.',
    'Regras:',
    '- Retorne APENAS JSON válido (sem markdown).',
    '- Não reescreva o POP inteiro: devolva apenas um objeto "patch" com chaves do payload que precisam mudar.',
    '- No máximo 12 chaves alteradas.',
    '- Textos em pt-BR, operacionais, observáveis.',
    '- "como_fazer_bem" e "erro_critico" devem passar validação leve: texto operacional observável (verbo e/ou sinal concreto no balcão/farmácia; pode ser simples), sem frases genéricas banidas.',
    '- "metrica" e campos relacionados a critério devem ser mensuráveis (número, %, checklist, prazo, contagem).',
    '',
    'FORMATO OBRIGATÓRIO:',
    '{ "patch": { /* somente chaves alteradas */ }, "notas": [] }',
  ].join('\n');

  var userObj = {
    entrada_usuario: { processo: pIn, situacao: sIn, erro: eIn },
    contrato_ia: contract,
    payload_atual: mergedIn,
    falhas: falhas,
  };
  var userText = JSON.stringify(userObj);

  var raw = iaOpenAiChatJson_(sys, userText);
  raw = iaStripJsonFence_(raw);
  var parsed = JSON.parse(raw);
  var patch = parsed && parsed.patch ? parsed.patch : null;
  if (!patch || typeof patch !== 'object') throw new Error('Resposta de correção inválida (sem patch).');

  logGptPopIaLinha_(user, requestId, 'gpt_qa_patch', '', patch);
  return iaMotorAplicarPatchIncoming_(mergedIn, patch);
}

function iaMapFrequenciaCritico_(freqRaw, tempoRaw) {
  var s = normalizeText_(String(freqRaw || '') + ' ' + String(tempoRaw || ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (s.indexOf('demanda') >= 0 || s.indexOf('quando necess') >= 0) return 'por_demanda';
  if (s.indexOf('seman') >= 0) return 'semanal';
  if (s.indexOf('diari') >= 0 || s.indexOf('diário') >= 0 || s.indexOf('todo dia') >= 0 || s.indexOf('tododia') >= 0) return 'diario';
  if (s.indexOf('dia') >= 0) return 'diario';
  return 'diario';
}

function validarContratoPopIaBloqueante_(c, linhaPopServidor, situacao, erro) {
  var erros = [];
  if (!c || typeof c !== 'object') {
    erros.push('JSON inválido.');
    return erros;
  }
  if (iaTemLinguagemGenerica_(c)) {
    erros.push('Texto com linguagem genérica proibida (atender bem, ser cordial, corretamente, com atenção, etc.).');
  }
  var exec = c.execucao || {};
  var ctl = c.controle || {};
  var ab = c.abordagem || {};
  var steps = Array.isArray(exec.o_que_fazer) ? exec.o_que_fazer : [];
  var nEt = steps.filter(function (x) {
    return String(x == null ? '' : x).trim() !== '';
  }).length;
  if (nEt < 3 || nEt > 6) erros.push('Etapas (execucao.o_que_fazer) devem ser entre 3 e 6.');
  if (!String(exec.tempo || '').trim()) erros.push('execucao.tempo obrigatório.');
  if (!String(exec.frequencia || '').trim()) erros.push('execucao.frequencia obrigatória.');
  if (!String(ctl.metrica || '').trim()) erros.push('controle.metrica obrigatória.');
  if (!String(ctl.criterio_sucesso || '').trim()) erros.push('controle.criterio_sucesso obrigatório.');
  var eg = Array.isArray(ctl.erros_graves) ? ctl.erros_graves : [];
  var egOk = eg
    .map(function (x) {
      return String(x == null ? '' : x).trim();
    })
    .filter(Boolean);
  if (egOk.length < 1) erros.push('controle.erros_graves: inclua pelo menos um erro grave concreto.');
  if (!String(c.titulo || '').trim()) erros.push('titulo obrigatório.');
  if (!String(c.area || '').trim()) erros.push('area obrigatória.');
  if (!String(c.processo || '').trim()) erros.push('processo obrigatório.');

  var atend = iaDetectAtendimentoCliente_(String(c.area || ''), String(c.processo || ''), String(situacao || ''), String(erro || ''));
  if (linhaPopServidor === 'critico' && atend) {
    var diz = Array.isArray(ab.o_que_dizer) ? ab.o_que_dizer : [];
    var nD = diz
      .map(function (x) {
        return String(x == null ? '' : x).trim();
      })
      .filter(Boolean).length;
    if (nD < 1) erros.push('POP crítico com atendimento: abordagem.o_que_dizer obrigatório.');
    if (!String(ab.tom || '').trim()) erros.push('POP crítico com atendimento: abordagem.tom obrigatório.');
    if (!String(ab.postura || '').trim()) erros.push('POP crítico com atendimento: abordagem.postura obrigatória.');
  }
  return erros;
}

function mapContratoIaConceitoToIncoming_(user, c, linhaPopServidor, situacao, erro) {
  var tipoPop = linhaPopServidor === 'critico' ? 'critico' : 'colaborativo';
  var exec = c.execucao || {};
  var ab = c.abordagem || {};
  var ctl = c.controle || {};
  var ctxo = c.contexto || {};
  var steps = Array.isArray(exec.o_que_fazer)
    ? exec.o_que_fazer
        .map(function (x) {
          return normalizeText_(x);
        })
        .filter(Boolean)
    : [];
  var gov = computeGovernancaDefaults_(user);
  var objetivo =
    normalizeText_(ctxo.quando_aplicar || '') +
    (ctxo.exemplo ? '\n\nExemplo ilustrativo:\n' + normalizeText_(ctxo.exemplo) : '');
  objetivo += '\n\n--- Contexto informado ---\nSituação: ' + normalizeText_(situacao) + '\nErro ou risco: ' + normalizeText_(erro);

  var errosComuns = normalizeStringArray_(ctl.erros_graves || []);
  var pontos = [];
  if (ctl.metrica) pontos.push('Métrica: ' + normalizeText_(ctl.metrica));
  if (ctl.criterio_sucesso) pontos.push('Critério de sucesso: ' + normalizeText_(ctl.criterio_sucesso));

  var out = {
    tipo: tipoPop,
    origem: 'geracao_ia_conceito',
    titulo: normalizeText_(c.titulo || ''),
    area: normalizeText_(c.area || ''),
    processo: normalizeText_(c.processo || ''),
    objetivo: objetivo,
    errosComuns: errosComuns,
    pontosDeAtencao: pontos.length ? pontos : ['Revisar execução no chão após implantação.'],
    metrica: normalizeText_(ctl.metrica || ''),
    criticidade: tipoPop === 'critico' ? 'alta' : 'media',
    status: 'rascunho',
    publicoAlvo: 'todos',
    leituraObrigatoria: true,
    treinamentoObrigatorio: true,
    autorNome: gov.autorNome,
    donoDocumento: gov.donoDocumento,
    aprovador: gov.aprovadorEsperado,
  };

  if (tipoPop === 'critico') {
    out.frequencia = iaMapFrequenciaCritico_(exec.frequencia, exec.tempo);
    var procCrit = [];
    var n = steps.length;
    var pesoEach = n > 0 ? (100 / n).toFixed(2) : '10';
    for (var i = 0; i < n; i++) {
      var id = 'IA-' + iaPad2_(i + 1);
      procCrit.push({
        itemId: id,
        etapa: 'Etapa ' + (i + 1),
        descricao: steps[i],
        acao: steps[i],
        criterioAvaliacao: 'Execução conforme descrição da etapa, observável no ponto de venda.',
        tipoAvaliacao: 'binario',
        peso: pesoEach,
        obrigatorio: true,
        critico: true,
      });
    }
    out.procedimento = procCrit;
  } else {
    out.procedimento = steps;
    out.frequencia = normalizeText_(exec.frequencia || exec.tempo || '');
    var dizer = normalizeStringArray_(ab.o_que_dizer || []);
    if (dizer.length) {
      out.pontosDeAtencao = (out.pontosDeAtencao || []).concat(
        dizer.map(function (d) {
          return 'Fala / script: ' + d;
        })
      );
    }
    if (String(ab.tom || '').trim()) out.pontosDeAtencao.push('Tom: ' + normalizeText_(ab.tom));
    if (String(ab.postura || '').trim()) out.pontosDeAtencao.push('Postura: ' + normalizeText_(ab.postura));
  }
  return out;
}

function logGptPopIaLinha_(user, requestId, acao, mensagem, payloadResumo) {
  var rid = String(requestId || '').trim();
  var resumo = payloadResumo;
  if (rid) {
    if (resumo != null && typeof resumo === 'object' && !Array.isArray(resumo)) {
      resumo = Object.assign({ requestId: rid }, resumo);
    } else {
      resumo = { requestId: rid, payload: resumo };
    }
  }
  var ac = String(acao || '');
  var statusFluxo = 'ok';
  var hasFalhas =
    resumo != null && typeof resumo === 'object' && !Array.isArray(resumo) && Array.isArray(resumo.falhas);
  var nFalhas = hasFalhas ? resumo.falhas.length : -1;
  if (ac === 'gpt_qa' || ac === 'gpt_qa_pos_patch') {
    if (nFalhas === 0) statusFluxo = 'ok';
    else if (nFalhas > 0) statusFluxo = 'erro';
    else statusFluxo = mensagem && String(mensagem).trim().toLowerCase() !== 'ok' ? 'erro' : 'ok';
  } else {
    statusFluxo = mensagem && String(mensagem).trim().toLowerCase() !== 'ok' ? 'erro' : 'ok';
  }
  logFluxo_(user, {
    acao: ac,
    etapa: 'input',
    status: statusFluxo,
    mensagem: String(mensagem || ''),
    tipo: 'ia_conceito',
    origem: 'geracao_ia_conceito',
    popId: '',
    payloadResumo: fluxoResumoPayloadMax500_(resumo != null ? resumo : ''),
  });
}

/**
 * Gera POP estruturado via OpenAI, valida no servidor e devolve payload pronto para preencherFormularioComJson.
 * Requer OPENAI_API_KEY nas propriedades do script. requestId correlaciona logs (gpt_input, gpt_output, gpt_validacao_erro).
 */
function gerarPopIaConceito(token, processo, situacao, erro) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_CREATE_DRAFT');
  if (!userHasPortalPermission_(ctx.user, 'geracao_ia')) {
    return {
      ok: false,
      message:
        'Seu perfil não tem acesso à geração por IA no portal. Use importação por JSON ou peça apoio à gerência.',
      blocking: ['Geração por IA disponível apenas para gerência e diretoria.'],
    };
  }

  var requestId = uuid_();
  var pIn = normalizeText_(processo || '');
  var sIn = normalizeText_(situacao || '');
  var eIn = normalizeText_(erro || '');

  logGptPopIaLinha_(ctx.user, requestId, 'gpt_input', '', { processo: pIn, situacao: sIn, erro: eIn });

  if (!pIn || !sIn || !eIn) {
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', 'Campos processo, situacao e erro são obrigatórios.', '');
    return { ok: false, requestId: requestId, message: 'Preencha processo, situação e erro.', blocking: ['Entrada incompleta.'] };
  }

  var userPrompt = buildIaPopPromptUsuario_(pIn, sIn, eIn);

  var rawOut = '';
  var contract = null;
  try {
    rawOut = iaOpenAiChatJson_(IA_POP_PROMPT_SISTEMA_, userPrompt);
    rawOut = iaStripJsonFence_(rawOut);
    contract = JSON.parse(rawOut);
  } catch (eParse) {
    var m1 = String(eParse && eParse.message ? eParse.message : eParse);
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', m1, rawOut);
    return {
      ok: false,
      requestId: requestId,
      message:
        'A resposta da IA não veio no formato JSON esperado. Tente de novo com processo, situação e erro mais concretos (ex.: nomes de tarefas e o que foi visto no piso). Se repetir, use importação por JSON.',
      blocking: [m1],
    };
  }

  logGptPopIaLinha_(ctx.user, requestId, 'gpt_output', '', rawOut);

  var linhaServ = iaClassificarLinhaPopServidor_(String(contract.area || ''), String(contract.processo || ''), sIn, eIn);
  if (String(contract.linhaPop || '').trim().toLowerCase() !== String(linhaServ)) {
    contract.linhaPop = linhaServ;
  }
  if (!String(contract.linhaPop || '').trim()) {
    contract.linhaPop = linhaServ;
  }

  var bloq = validarContratoPopIaBloqueante_(contract, linhaServ, sIn, eIn);
  if (bloq.length) {
    var m2 = bloq.join(' ');
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', m2, contract);
    return { ok: false, requestId: requestId, message: m2, blocking: bloq };
  }

  var mergedIn;
  try {
    mergedIn = mapContratoIaConceitoToIncoming_(ctx.user, contract, linhaServ, sIn, eIn);
    assertTipoPopPermitido_(ctx.user, mergedIn.tipo);
    // Pré-preenche campos de QA no payload (sem exigir mudança no contrato IA).
    iaMotorPreencherComoFazerErroCriticoIncoming_(mergedIn, contract);
  } catch (eMap) {
    var m3 = String(eMap && eMap.message ? eMap.message : eMap);
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', m3, contract);
    return { ok: false, requestId: requestId, message: m3, blocking: [m3] };
  }

  // QA interno (motor): checklist fechado + no máximo 1 correção automática invisível ao usuário.
  try {
    var falhasQa = iaMotorQaChecklistIncoming_(mergedIn, contract);
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_qa', falhasQa.length ? 'falhou' : 'ok', { falhas: falhasQa });
    if (falhasQa.length) {
      mergedIn = iaMotorCorrigirIncomingUmaVez_(ctx.user, requestId, mergedIn, contract, falhasQa, pIn, sIn, eIn);
      iaMotorSincronizarContratoComIncoming_(contract, mergedIn);
      logGptPopIaLinha_(ctx.user, requestId, 'gpt_qa_pre_pos_patch', 'ok', {
        qa_engine_version: IA_MOTOR_QA_ENGINE_VERSION_,
      });
      iaMotorNormalizarMetricaOperacional_(mergedIn, {
        contract: contract,
        processo: pIn,
        situacao: sIn,
        erro: eIn,
        linhaPop: String(contract.linhaPop || mergedIn.linhaPop || ''),
      });
      iaMotorSincronizarContratoComIncoming_(contract, mergedIn);
      var falhas2 = iaMotorQaChecklistIncoming_(mergedIn, contract);
      logGptPopIaLinha_(ctx.user, requestId, 'gpt_qa_pos_patch', falhas2.length ? 'falhou' : 'ok', { falhas: falhas2 });
      if (falhas2.length) {
        var msgQa = 'Falha no padrão mínimo de qualidade (IA).';
        logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', msgQa, { falhas: falhas2 });
        return { ok: false, requestId: requestId, message: msgQa, blocking: falhas2.map(function (x) { return x.mensagem; }) };
      }
    }
  } catch (eQa) {
    var mQa = String(eQa && eQa.message ? eQa.message : eQa);
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', mQa, '');
    return { ok: false, requestId: requestId, message: 'Falha no padrão mínimo de qualidade (IA).', blocking: [mQa] };
  }

  // Garante persistência dos campos no payload (mesmo se o QA não precisou de correção).
  iaMotorPreencherComoFazerErroCriticoIncoming_(mergedIn, contract);
  iaMotorSincronizarContratoComIncoming_(contract, mergedIn);

  var normalized;
  try {
    normalized = normalizePopJsonPayload_(ctx.user, mergedIn);
    if (normalizeTipoPop_(normalized.tipo) === 'critico') {
      validatePopCritico_(normalized);
    } else {
      var blk = validateColaborativoGptBlocking_(mergedIn);
      if (blk.length) {
        logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', blk.join(' | '), mergedIn);
        return { ok: false, requestId: requestId, message: blk.join(' '), blocking: blk };
      }
    }
  } catch (eNorm) {
    var m4 = String(eNorm && eNorm.message ? eNorm.message : eNorm);
    logGptPopIaLinha_(ctx.user, requestId, 'gpt_validacao_erro', m4, mergedIn);
    return { ok: false, requestId: requestId, message: m4, blocking: [m4] };
  }

  try {
    normalized.conteudoJson.versao_prompt_ia = String(contract.versao_prompt || '1.0');
    normalized.conteudoJson.linha_pop_ia = String(linhaServ || '');
  } catch (eMeta) {}

  var fase4 = geradorIntegrarFase4PosNormalizacao_(ctx.user, requestId, normalized, contract, pIn, sIn, eIn, linhaServ);
  if (!fase4.ok) {
    var blockF4 = [];
    if (fase4.crivo && fase4.crivo.bloqueadores && fase4.crivo.bloqueadores.length) {
      for (var bfi = 0; bfi < fase4.crivo.bloqueadores.length; bfi++) {
        var bb = fase4.crivo.bloqueadores[bfi];
        blockF4.push(String((bb && bb.codigo) || '') + ': ' + String((bb && bb.motivo) || ''));
      }
    } else if (fase4.message) {
      blockF4.push(fase4.message);
    } else {
      blockF4.push('Bloqueio Fase 4 (crivo/campos).');
    }
    logGptPopIaLinha_(ctx.user, requestId, 'fase4_gerador_bloqueio', fase4.message || '', { crivo: fase4.crivo, matriz: fase4.matriz });
    return {
      ok: false,
      requestId: requestId,
      message: fase4.message || 'POP não aprovado no crivo de execução.',
      blocking: blockF4,
      fase4: fase4,
    };
  }

  return { ok: true, requestId: requestId, data: normalized, contract: contract, fase4: fase4 };
}

function criarPop(token, data) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_CREATE_DRAFT');

  // HTML atual envia um objeto "flat" grande; aqui convertimos para conteudoJson.
  var created = createPopDraft_(ctx.user, data || {});
  logAudit_(ctx.user, 'POP_CREATE_DRAFT', 'POP', created.versaoId, auditPopDetails_(ctx.user, created, created.status));
  if (normalizeTipoPop_(data && data.tipo) === 'colaborativo') {
    logFluxo_(ctx.user, {
      acao: 'salvar_rascunho',
      etapa: 'preview',
      status: 'ok',
      mensagem: 'rascunho',
      tipo: 'colaborativo',
      origem: String((data && data.origem) || 'colaborativo_gpt'),
      popId: String(created.popId || ''),
      payloadResumo: fluxoResumoPayloadMax500_(data || {}),
    });
  }
  return {
    ok: true,
    message: 'POP salvo com sucesso.',
    codigo: created.numero,
    popId: created.popId,
  };
}

function editarPop(token, popId, data) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_EDIT_DRAFT');
  var before = getPopForUser_(ctx.user, popId, null);
  var updated = updatePopDraft_(ctx.user, popId, null, data || {});
  logAudit_(ctx.user, 'POP_UPDATE_DRAFT', 'POP', updated.versaoId, auditPopDetails_(ctx.user, before, updated.status, {
    tipoNovo: normalizeTipoPop_(updated.tipo),
    origemNova: normalizeOrigemPop_(updated.origem),
  }));
  if (normalizeTipoPop_(data && data.tipo) === 'colaborativo') {
    logFluxo_(ctx.user, {
      acao: 'salvar_rascunho',
      etapa: 'preview',
      status: 'ok',
      mensagem: 'rascunho',
      tipo: 'colaborativo',
      origem: String((data && data.origem) || 'colaborativo_gpt'),
      popId: String(popId || ''),
      payloadResumo: fluxoResumoPayloadMax500_(data || {}),
    });
  }
  return { ok: true, message: 'POP atualizado com sucesso.' };
}

/** Catálogo único área × processo (cadastro + importação JSON). */
function getProcessosCatalog_() {
  return [
    { area: 'Atendimento e vendas', processo: 'Atendimento' },
    { area: 'Atendimento e vendas', processo: 'Atendimento ao cliente' },
    { area: 'Atendimento e vendas', processo: 'Vendas consultivas' },
    { area: 'Caixa e financeiro operacional', processo: 'Abertura/fechamento de caixa' },
    { area: 'Recebimento e estoque', processo: 'Recebimento de mercadorias' },
    { area: 'Recebimento e estoque', processo: 'Armazenamento e inventário' },
    { area: 'Medicamentos e controle farmacêutico', processo: 'Dispensação' },
    { area: 'Medicamentos e controle farmacêutico', processo: 'Controle de psicotrópicos' },
    { area: 'Loja e operação diária', processo: 'Organização e limpeza' },
    { area: 'Loja e operação diária', processo: 'Rotina operacional da loja' },
    { area: 'Loja e operação diária', processo: 'Limpeza, lixo e insumos de higiene' },
    { area: 'Loja e operação diária', processo: 'Manejo de resíduos e descarte' },
    { area: 'Delivery e expedição', processo: 'Separação e expedição' },
    { area: 'Gestão de pessoas e treinamento', processo: 'Treinamento de equipe' },
    { area: 'Segurança e conformidade', processo: 'Conformidade e auditoria interna' },
  ];
}

function getSetupData(token) {
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'POP_CREATE_DRAFT');

  // Mantém o que o HTML espera: áreas, processos, público-alvo, status, criticidade
  var areas = [
    { nome: 'Atendimento e vendas' },
    { nome: 'Caixa e financeiro operacional' },
    { nome: 'Recebimento e estoque' },
    { nome: 'Medicamentos e controle farmacêutico' },
    { nome: 'Loja e operação diária' },
    { nome: 'Delivery e expedição' },
    { nome: 'Gestão de pessoas e treinamento' },
    { nome: 'Segurança e conformidade' },
  ];

  return {
    ok: true,
    areas: areas,
    processos: getProcessosCatalog_(),
    publicoAlvoOptions: [
      { value: 'todos', label: 'todos' },
      { value: 'farmaceutico', label: 'farmaceutico' },
    ],
    statusOptions: [
      { value: 'rascunho', label: 'Rascunho' },
      { value: 'em_aprovacao', label: 'Aguardando gerente' },
      { value: 'aguardando_diretor', label: 'Aguardando diretor' },
      { value: 'vigente', label: 'Vigente' },
      { value: 'em revisão', label: 'Em revisão' },
    ],
    criticidadeOptions: [
      { value: 'baixa', label: 'baixa' },
      { value: 'media', label: 'media' },
      { value: 'alta', label: 'alta' },
      { value: 'critica', label: 'critica' },
    ],
  };
}

function criarUsuario(token, nome, usuario, senha, perfil) {
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'USER_ADMIN');

  var sheet = getSheet_(SHEET_USUARIOS);
  var headers = getHeaders_(sheet);
  var existing = listRows_(sheet).find(function (u) {
    return String(u.usuario || '').toLowerCase() === String(usuario || '').toLowerCase();
  });
  if (existing) return { ok: false, message: 'Usuário já existe.' };

  var userId = uuid_();
  var codigo = String(nextUsuarioCodigoDisponivel_());
  var rowObj = {
    id: userId,
    userId: userId, // compat
    codigo: codigo,
    email: '',
    nome: String(nome || '').trim(),
    usuario: String(usuario || '').trim(),
    senha: String(senha || ''),
    perfil: normalizePerfil_(perfil),
    ativo: true,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  };
  appendRowObj_(sheet, headers, rowObj);
  logAudit_(ctx.user, 'USER_CREATE', 'USUARIO', userId, { usuario: rowObj.usuario, perfil: rowObj.perfil, codigo: codigo });
  return { ok: true, message: 'Usuário criado com sucesso.', codigo: codigo };
}

/**
 * Diretor: atualizar cadastro após edição manual na planilha (recomendado usar esta UI em vez de editar ids à mão).
 */
function atualizarUsuario(token, userId, nome, usuario, email, perfil, senha, ativoStr) {
  ensureSchema_();
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'USER_ADMIN');

  var sheet = getSheet_(SHEET_USUARIOS);
  var rows = listRowsWithRowIndex_(sheet);
  var m = rows.find(function (r) {
    return sameUsuarioId_(r.obj.id || r.obj.userId, userId);
  });
  if (!m) return { ok: false, message: 'Usuário não encontrado.' };

  var novoUsuario = String(usuario || '').trim();
  var novoNome = String(nome || '').trim();
  var novoEmail = String(email != null ? email : '').trim();
  var novoPerfil = normalizePerfil_(perfil);

  var clash = listRows_(sheet).find(function (u) {
    if (sameUsuarioId_(u.id || u.userId, userId)) return false;
    return String(u.usuario || '').trim().toLowerCase() === novoUsuario.toLowerCase();
  });
  if (clash) return { ok: false, message: 'Login (usuário) já em uso por outro cadastro.' };

  var patch = {
    nome: novoNome,
    usuario: novoUsuario,
    email: novoEmail,
    perfil: novoPerfil,
    atualizadoEm: new Date(),
  };
  if (senha != null && String(senha).trim() !== '') patch.senha = String(senha);
  if (ativoStr !== undefined && ativoStr !== null) {
    patch.ativo = !!(ativoStr === true || ativoStr === 'true' || String(ativoStr).toUpperCase() === 'TRUE');
  }

  applyRowPatch_(sheet, m.rowIndex, patch);
  logAudit_(ctx.user, 'USER_UPDATE', 'USUARIO', String(userId), { usuario: novoUsuario, perfil: novoPerfil });
  return { ok: true, message: 'Usuário atualizado.' };
}

function listarUsuarios(token) {
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'USER_ADMIN');

  var sheet = getSheet_(SHEET_USUARIOS);
  var users = listRows_(sheet)
    .filter(function (u) { return String(u.ativo).toLowerCase() !== 'false'; })
    .map(function (u) {
      return {
        id: String(u.id || u.userId || ''),
        codigo: String(u.codigo != null && u.codigo !== '' ? u.codigo : ''),
        nome: String(u.nome || ''),
        usuario: String(u.usuario || ''),
        email: String(u.email || ''),
        perfil: normalizePerfil_(u.perfil),
        ativo: String(u.ativo).toLowerCase() !== 'false',
      };
    });

  return { ok: true, usuarios: users };
}

function listarLeituras(token) {
  var ctx = requireSession_(token);
  assertCan_(ctx.user, 'READ_ADMIN');

  var reads = listRows_(getSheet_(SHEET_LEITURAS));
  var pops = indexBy_(listRows_(getSheet_(SHEET_POPS)), function (p) { return String(p.versaoId || p.popId || p.id); });
  var users = indexBy_(listRows_(getSheet_(SHEET_USUARIOS)), function (u) { return String(u.id || u.userId); });

  var out = reads.map(function (r) {
    var user = users[String(r.userId || r.usuario || '')] || {};
    var pop = pops[String(r.versaoId || '')] || {};
    return {
      userNome: String(user.nome || ''),
      popTitulo: String(pop.titulo || ''),
      versao: String(pop.versao || pop.versaoLabel || '1.0'),
      dataLeitura: valueForClientJson_(r.lidaEm || r.dataLeitura || r.quando || ''),
    };
  });
  return { ok: true, leituras: out };
}

/** POPs em fluxo que exigem ação do perfil atual (mesma base da biblioteca). */
function buildFilaDashboard_(user, pops) {
  var perfil = normalizePerfil_(user.perfil);
  var uid = String(user.id || user.userId || '');
  var em = String(user.email || '').trim().toLowerCase();
  var uRows = listRows_(getSheet_(SHEET_USUARIOS));
  function perfilAutorPop_(autorUserId) {
    var u = uRows.find(function (x) {
      return sameUsuarioId_(x.id || x.userId, autorUserId);
    });
    return u ? normalizePerfil_(u.perfil) : '';
  }
  function rascunhoParaGestao_(pop) {
    if (String(pop.status || '') !== 'rascunho') return false;
    var autor = pop.autorUserId;
    if (!autor || sameUsuarioId_(autor, uid)) return false;
    var pa = perfilAutorPop_(autor);
    if (perfil === 'gerente') {
      return pa === 'atendente' || pa === 'farmaceutico' || pa === 'entregador';
    }
    if (perfil === 'diretor') return pa !== 'diretor';
    return false;
  }
  return (pops || []).filter(function (pop) {
    if (rascunhoParaGestao_(pop)) return true;
    var st = String(pop.status || '');
    if (st !== 'em_aprovacao' && st !== 'aguardando_diretor') return false;
    if (perfil === 'diretor') return true;
    if (perfil === 'gerente') {
      if (st === 'em_aprovacao') return true;
      return st === 'aguardando_diretor' && sameUsuarioId_(pop.autorUserId, uid);
    }
    return sameUsuarioId_(pop.autorUserId, uid) ||
      (!!em && String(pop.autorEmail || '').trim().toLowerCase() === em);
  }).map(function (p) {
    return {
      popId: p.popId,
      titulo: String(p.titulo || ''),
      numero: String(p.numero || ''),
      status: String(p.status || ''),
    };
  });
}

function getDashboardData(token) {
  var ctx = requireSession_(token);
  var b = buildPortalPayloadForUser_(ctx.user);
  var pops = b.pops;
  var stats = b.stats;
  var perfil = normalizePerfil_(ctx.user.perfil);
  var fila = buildFilaDashboard_(ctx.user, pops);
  popTriageCompareLog_('getDashboardData', pops.length);
  popDiagLog_('getDashboardData', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    source: 'getPopsLibraryForUser_',
    popsReturned: pops.length,
    stats: stats,
    filaCount: fila.length,
    sample: pops.slice(0, 15).map(function (p) {
      return { popId: p.popId, titulo: p.titulo, status: p.status };
    }),
  });

  var isAdminView = perfil === 'diretor' || perfil === 'gerente';

  return {
    ok: true,
    isAdminView: isAdminView,
    isGerenteView: perfil === 'gerente',
    popsNaBiblioteca: pops.length,
    filaAprovacao: fila,
    metrics: {
      popsVigentes: stats.totalVigentes,
      popsCriticos: stats.criticosVigentes,
      usuariosAtivos: countActiveUsers_(),
      popsEmRevisao: fila.length,
    },
    rankingConformidade: isAdminView ? safeBuildRankingConformidade_(ctx.user) : [],
    meusPendentes: !isAdminView ? buildMeusPendentes_(ctx.user) : [],
  };
}

function countPopsEmFluxoAprovacao_() {
  var sheet = getSheet_(SHEET_POPS);
  var rows = listRows_(sheet);
  var statusHistogram = {};
  var inFluxo = 0;
  rows.forEach(function (r) {
    var p = normalizePopRow_(r);
    var s = String(p.status || '(vazio)');
    statusHistogram[s] = (statusHistogram[s] || 0) + 1;
    if (p.status === 'em_aprovacao' || p.status === 'aguardando_diretor') inFluxo++;
  });
  popDiagLog_('countPopsEmFluxo', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    rawRows: rows.length,
    inFluxo: inFluxo,
    statusHistogram: statusHistogram,
  });
  return inFluxo;
}

// =============================================================================
// Core: Sessão / Auth
// =============================================================================

/**
 * Login aceito (sem ambiguidade):
 * 1) coluna usuario (case insensitive)
 * 2) coluna email (case insensitive)
 * 3) id / userId OU codigo, conforme o formato do que foi digitado:
 *    - Se o login for só dígitos (ex.: "12"): primeiro codigo, depois id — espelha o uso real ("meu número" = codigo).
 *    - Caso contrário: primeiro id/userId (texto exato), depois codigo.
 */
/** Compara ids de usuário na planilha (número vs texto "3", "003"). */
function sameUsuarioId_(a, b) {
  var sa = String(a != null && a !== '' ? a : '').trim();
  var sb = String(b != null && b !== '' ? b : '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (/^\d+$/.test(sa) && /^\d+$/.test(sb)) {
    try {
      return parseInt(sa, 10) === parseInt(sb, 10);
    } catch (e) {
      return false;
    }
  }
  return false;
}

function findActiveUserForLogin_(emailOrUserOrId, senha) {
  var users = listRows_(getSheet_(SHEET_USUARIOS));
  var loginRaw = String(emailOrUserOrId || '').trim();
  var loginLower = loginRaw.toLowerCase();
  var loginSoDigitos = /^\d+$/.test(loginRaw);
  var pass = String(senha || '');

  function ativo(u) {
    return String(u.ativo).toLowerCase() !== 'false';
  }
  function senhaOk(u) {
    return String(u.senha != null ? u.senha : '') === String(pass);
  }
  function normUser(u) {
    if (!u) return null;
    if (!u.id && u.userId) u.id = u.userId;
    if (!u.userId && u.id) u.userId = u.id;
    u.perfil = normalizePerfil_(u.perfil);
    return u;
  }

  var cand = users.filter(function (u) {
    return ativo(u) && senhaOk(u);
  });
  if (!cand.length) return null;

  function pick(matchFn) {
    for (var i = 0; i < cand.length; i++) {
      if (matchFn(cand[i])) return cand[i];
    }
    return null;
  }

  var u1 = pick(function (u) {
    return String(u.usuario || '').trim().toLowerCase() === loginLower;
  });
  if (u1) return normUser(u1);

  var u2 = pick(function (u) {
    return String(u.email || '').trim().toLowerCase() === loginLower;
  });
  if (u2) return normUser(u2);

  function matchId_(u) {
    return sameUsuarioId_(loginRaw, u.id || u.userId) || String(u.id || u.userId || '').trim().toLowerCase() === loginLower;
  }
  function matchCodigo_(u) {
    return loginMatchesUsuarioCodigo_(loginRaw, u.codigo);
  }

  if (loginSoDigitos) {
    var uCodPrimeiro = pick(matchCodigo_);
    if (uCodPrimeiro) return normUser(uCodPrimeiro);
    var uIdDepois = pick(matchId_);
    if (uIdDepois) return normUser(uIdDepois);
  } else {
    var uId = pick(matchId_);
    if (uId) return normUser(uId);
    var uCod = pick(matchCodigo_);
    if (uCod) return normUser(uCod);
  }

  return null;
}

function createSession_(user) {
  var sheet = getSheet_(SHEET_SESSOES);
  var headers = getHeaders_(sheet);

  var sessionId = uuid_();
  var now = new Date();
  var expiraEm = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  var rowObj = {
    sessionId: sessionId,
    userId: String(user.id || user.userId || ''),
    email: String(user.email || ''),
    usuario: String(user.usuario || '').trim().toLowerCase(),
    criadoEm: now,
    expiraEm: expiraEm,
    revogadoEm: '',
  };
  appendRowObj_(sheet, headers, rowObj);
  return rowObj;
}

function revokeSession_(sessionId) {
  var sheet = getSheet_(SHEET_SESSOES);
  var rows = listRowsWithRowIndex_(sheet);
  var match = rows.find(function (r) { return String(r.obj.sessionId) === String(sessionId); });
  if (!match) return;
  if (match.obj.revogadoEm) return;
  setCell_(sheet, match.rowIndex, 'revogadoEm', new Date());
}

function requireSession_(sessionId) {
  if (!sessionId) throw new Error('Sessão inválida.');
  var sheet = getSheet_(SHEET_SESSOES);
  var rowsS = listRowsWithRowIndex_(sheet);
  var sm = rowsS.find(function (r) { return String(r.obj.sessionId) === String(sessionId); });
  if (!sm) throw new Error('Sessão inválida.');
  var sessao = sm.obj;

  if (sessao.revogadoEm) throw new Error('Sessão encerrada.');
  var exp = parseDateSafe_(sessao.expiraEm);
  if (!exp || exp.getTime() < Date.now()) throw new Error('Sessão expirada.');

  var userId = String(sessao.userId != null ? sessao.userId : '').trim();
  var loginSessao = String(sessao.usuario || '').trim().toLowerCase();
  var users = listRows_(getSheet_(SHEET_USUARIOS));

  // Prioridade: userId da sessão (fonte após edição na planilha) > login na coluna usuario.
  // Ordem antiga (usuario primeiro) fazia sessões corrompidas mostrarem outro nome/permissões.
  var user = null;
  if (userId) {
    user = users.find(function (u) {
      if (String(u.ativo).toLowerCase() === 'false') return false;
      return sameUsuarioId_(u.id || u.userId, userId);
    });
  }
  if (!user && loginSessao) {
    user = users.find(function (u) {
      if (String(u.ativo).toLowerCase() === 'false') return false;
      return String(u.usuario || '').trim().toLowerCase() === loginSessao;
    });
  }
  if (!user) throw new Error('Sessão inválida: usuário não encontrado (id ou login). Faça login novamente.');

  if (String(user.ativo).toLowerCase() === 'false') throw new Error('Usuário inativo.');

  user.id = String(user.id || user.userId || '');
  user.userId = user.id;
  user.perfil = normalizePerfil_(user.perfil);

  var patchSess = {};
  if (user.id && !sameUsuarioId_(sessao.userId, user.id)) patchSess.userId = user.id;
  var uLow = String(user.usuario || '').trim().toLowerCase();
  if (uLow && loginSessao !== uLow) patchSess.usuario = uLow;
  if (Object.keys(patchSess).length) {
    try {
      applyRowPatch_(sheet, sm.rowIndex, patchSess);
    } catch (ePatch) {
      popDiagLog_('session.align.patch.skip', { err: String(ePatch && ePatch.message ? ePatch.message : ePatch) });
    }
  }

  return { session: sessao, user: user };
}

function publicUser_(user) {
  var perfil = normalizePerfil_(user.perfil);
  return {
    id: String(user.id || user.userId || ''),
    userId: String(user.id || user.userId || ''),
    codigo: String(user.codigo != null && user.codigo !== '' ? user.codigo : ''),
    email: String(user.email || ''),
    nome: String(user.nome || ''),
    usuario: String(user.usuario || ''),
    perfil: perfil,
    permissions: permissionsForPerfil_(perfil),
  };
}

function permissionsForPerfil_(perfil) {
  var p = normalizePerfil_(perfil);
  if (p === 'diretor')
    return ['usuarios', 'novo_pop', 'leituras', 'publicar_pop', 'aprovar_pop', 'performance_operacional', 'geracao_ia'];
  if (p === 'gerente') return ['novo_pop', 'aprovar_pop', 'performance_operacional', 'geracao_ia'];
  if (p === 'farmaceutico') return ['novo_pop', 'performance_operacional'];
  if (p === 'atendente') return ['novo_pop', 'performance_operacional'];
  if (p === 'entregador') return ['novo_pop', 'performance_operacional'];
  return [];
}

function userHasPortalPermission_(user, permission) {
  var perfil = normalizePerfil_(user && user.perfil);
  var list = permissionsForPerfil_(perfil);
  return list.indexOf(String(permission || '')) >= 0;
}

function assertCan_(user, action) {
  if (can_(user, action)) return;
  throw new Error('Sem permissão para esta ação.');
}

function can_(user, action) {
  var perfil = normalizePerfil_(user.perfil);
  var actionsByPerfil = {
    diretor: ['POP_CREATE_DRAFT', 'POP_EDIT_DRAFT', 'POP_MARK_VIGENTE_BASIC', 'POP_APPROVE_MANAGER', 'USER_ADMIN', 'READ_ADMIN'],
    gerente: ['POP_CREATE_DRAFT', 'POP_EDIT_DRAFT', 'POP_APPROVE_MANAGER'],
    farmaceutico: ['POP_CREATE_DRAFT', 'POP_EDIT_DRAFT'],
    atendente: ['POP_CREATE_DRAFT', 'POP_EDIT_DRAFT'],
    entregador: ['POP_CREATE_DRAFT', 'POP_EDIT_DRAFT'],
  };
  var allowed = actionsByPerfil[perfil] || [];
  return allowed.indexOf(action) >= 0;
}

function auditPopDetails_(user, pop, statusNovo, extra) {
  var out = extra || {};
  out.usuario = String(user && (user.usuario || user.email || user.id || user.userId) || '');
  out.perfil = normalizePerfil_(user && user.perfil);
  out.popId = String(pop && pop.popId || '');
  out.numero = String(pop && pop.numero || '');
  out.tipo = normalizeTipoPop_(pop && pop.tipo);
  out.origem = normalizeOrigemPop_(pop && pop.origem);
  out.statusAnterior = String(pop && pop.status || '');
  out.statusNovo = String(statusNovo || pop && pop.status || '');
  return out;
}

function incomingLinhaPop_(incoming) {
  var obj = incoming || {};
  var content = obj.conteudoJson || obj.conteudoObj || obj.payload || {};
  if (typeof content === 'string') content = safeJsonParse_(content) || {};
  return normalizeText_(obj.linhaPop || content.linhaPop || obj.tipo || content.tipo || '');
}

function assertTipoLinhaPopPermitidos_(user, normalized, incoming) {
  var linha = incomingLinhaPop_(incoming).toLowerCase();
  var tipo = normalizeTipoPop_(normalized && normalized.tipo);
  if ((tipo === 'critico' || linha === 'critico') && !userMayPersistPopCritico_(user)) {
    throw new Error('Seu perfil não pode criar, alterar ou classificar POP como crítico.');
  }
}

function assertPopCamposMinimosFluxo_(pop) {
  var cj = pop && pop.conteudoObj || {};
  var procedimento = cj.procedimento;
  var objetivo = normalizeText_(cj.objetivo || pop.objetivo || '');
  var erros = [];
  if (!normalizeText_(pop && pop.titulo)) erros.push('titulo');
  if (!normalizeText_(pop && pop.area)) erros.push('area');
  if (!normalizeText_(pop && pop.processo)) erros.push('processo');
  if (!objetivo) erros.push('objetivo');
  if (!Array.isArray(procedimento) || !procedimento.length) erros.push('procedimento[]');
  if (erros.length) throw new Error('Campos mínimos obrigatórios para avançar fluxo: ' + erros.join(', ') + '.');
}

// =============================================================================
// Validação técnica bloqueante — publicação (vigente)
// Normalizável: trim, enums canônicos, sinónimos leves. Conteúdo: bloqueia com lista objetiva.
// =============================================================================

var POP_PUBLISH_MIN_CHECKLIST_ = 5;
var POP_PUBLISH_MIN_PROC_COLAB_ = 3;
var POP_PUBLISH_MIN_PROC_CRITICO_ = 3;
var POP_PUBLISH_MIN_OBJETIVO_LEN_ = 35;
var POP_PUBLISH_MIN_METRICA_LEN_ = 12;

/**
 * Normalização determinística para comparar placeholders (não usar iaBagNorm_ aqui).
 * Ordem: (a) string segura (b) BOM (c) NBSP (d) hífens (e) trim (f) espaços (g) lowercase (h) acentos (i) comparação fora.
 */
function popNormTextoPlaceholder_(s) {
  var t = s == null ? '' : String(s);
  t = t.replace(/\uFEFF/g, '');
  t = t.replace(/\u00A0/g, ' ');
  t = t.replace(/\s*[\u002D\u2013\u2014]\s*/g, ' ');
  t = t.trim();
  t = t.replace(/\s+/g, ' ');
  t = t.toLowerCase();
  t = popRemoverDiacriticosLatinos_(t);
  t = t.replace(/\./g, '');
  t = t.replace(/\s+/g, ' ').trim();
  t = popNormTextoPlaceholderCorrecaoMojibakeNao_(t);
  return t;
}

/** Remoção de diacríticos: NFD + strip; fallback explícito se normalize não existir. */
function popRemoverDiacriticosLatinos_(str) {
  if (str == null || str === '') return '';
  var t = String(str);
  try {
    if (typeof t.normalize === 'function') {
      return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
  } catch (e) {}
  return t
    .replace(/[àáâãäåāăą]/g, 'a')
    .replace(/[èéêëēĕėę]/g, 'e')
    .replace(/[ìíîïīĭįı]/g, 'i')
    .replace(/[òóôõöōŏő]/g, 'o')
    .replace(/[ùúûüūŭůűų]/g, 'u')
    .replace(/[ñǹńň]/g, 'n')
    .replace(/[çćĉċč]/g, 'c')
    .replace(/[ýÿŷ]/g, 'y');
}

/**
 * "Não" corrompido como "N?o" quando UTF-8 é lido como Latin-1 (ou canal perde o byte do ã).
 * Só substitui as sequências literais abaixo — nunca "?" genérico.
 */
function popNormTextoPlaceholderCorrecaoMojibakeNao_(t) {
  var s = String(t || '');
  s = s.split('n?o informado').join('nao informado');
  s = s.split('n?o se aplica').join('nao se aplica');
  return s;
}

/** Texto explícito "Não informado" / equivalentes (proibido em publicação). */
function popEsNaoInformadoLiteral_(s) {
  var key = popNormTextoPlaceholder_(s);
  if (!key) return false;
  return (
    key === 'nao informado' ||
    key === 'n/a' ||
    key === 'na' ||
    key === 's/o' ||
    key === 'sem informacao' ||
    key === 'a definir' ||
    key === 'indefinido' ||
    key === 'nao se aplica'
  );
}

// =============================================================================
// Fase 2 — Score operacional (conceito Matriz_Mae / execução)
// Motor puro: não persiste dados; calcula a partir de itens avaliados (Sim/Não/N/A).
// =============================================================================

/** Seções críticas (nomes canônicos; comparação via iaBagNorm_). */
function scoreConceitoListaSecoesCriticasNorm_() {
  return [
    iaBagNorm_('Atendimento no balcão de medicamentos'),
    iaBagNorm_('Atendimento farmacêutico'),
    iaBagNorm_('Caixa e fechamento'),
    iaBagNorm_('Retirada e entrega de pedidos'),
  ];
}

function scoreConceitoEhSecaoCritica_(secaoRaw) {
  var n = iaBagNorm_(secaoRaw || '');
  var list = scoreConceitoListaSecoesCriticasNorm_();
  for (var i = 0; i < list.length; i++) {
    if (list[i] === n) return true;
  }
  return false;
}

/** resultado: sim | nao | na | '' (desconhecido tratado como fora do cálculo). */
function scoreConceitoNormalizarResultado_(r) {
  var x = iaBagNorm_(String(r == null ? '' : r));
  if (!x) return '';
  if (x === 'sim' || x === 's' || x === 'ok' || x === 'conforme' || x === 'cumprido') return 'sim';
  if (x === 'nao' || x === 'n') return 'nao';
  if (x === 'na' || x === 'n/a' || x === 's.o.' || x === 'so' || x === 'nao se aplica' || x === 'nao aplicavel' || x === 'inexistente') return 'na';
  return '';
}

function scoreConceitoNormalizarGravidade_(g) {
  var x = iaBagNorm_(String(g == null ? '' : g));
  if (!x) return 'normal';
  if (x === 'critica' || x === 'critico' || x === 'critical') return 'critica';
  return 'normal';
}

function scoreConceitoAcaoCorretivaPadraoPorCodigo_(codigo) {
  var c = String(codigo || '').trim();
  var map = {
    TEST_CRIT_X: 'Acionamento imediato da gestão e bloqueio operacional até correção documentada.',
  };
  if (map[c]) return map[c];
  return 'Registrar não conformidade, corrigir causa raiz e agendar reauditoria no ciclo da loja.';
}

function scoreConceitoItemPreparado_(item) {
  var res = scoreConceitoNormalizarResultado_(item && item.resultado);
  var grav = scoreConceitoNormalizarGravidade_(item && item.gravidade);
  return {
    codigo: String(item && item.codigo != null ? item.codigo : ''),
    secao: String(item && item.secao != null ? item.secao : ''),
    dimensao: String(item && item.dimensao != null ? item.dimensao : ''),
    classificacao: String(item && item.classificacao != null ? item.classificacao : ''),
    classificacao_norm: iaBagNorm_(item && item.classificacao),
    padrao: String(item && item.padrao != null ? item.padrao : ''),
    gravidade: grav,
    resultado: res,
    aplicavel: res === 'sim' || res === 'nao',
    ponto: res === 'sim' ? 1 : res === 'nao' ? 0 : null,
  };
}

function scoreConceitoAcumularGrupo_(mapa, chave, prep) {
  if (!prep.aplicavel) return;
  var k = String(chave || '').trim() || '(sem chave)';
  if (!mapa[k]) mapa[k] = { aplicaveis: 0, sim: 0, nao: 0 };
  mapa[k].aplicaveis++;
  if (prep.resultado === 'sim') mapa[k].sim++;
  else mapa[k].nao++;
}

function scoreConceitoMapaParaScorePct_(mapa) {
  var out = {};
  var keys = Object.keys(mapa);
  for (var i = 0; i < keys.length; i++) {
    var g = mapa[keys[i]];
    var pct = g.aplicaveis > 0 ? Math.round((g.sim / g.aplicaveis) * 10000) / 100 : null;
    out[keys[i]] = { score: pct, aplicaveis: g.aplicaveis, sim: g.sim, nao: g.nao };
  }
  return out;
}

function scoreConceitoClassificarFaixa_(scoreGeral, falhaCritica) {
  var s = Number(scoreGeral);
  if (isNaN(s)) s = 0;
  var band = 'fraco';
  if (s >= 90) band = 'excelência operacional';
  else if (s >= 80) band = 'bom padrão';
  else if (s >= 70) band = 'instável';
  if (falhaCritica && band === 'excelência operacional') band = 'bom padrão';
  return band;
}

function scoreConceitoFalhaCorretivaDeItem_(prep) {
  return {
    codigo: prep.codigo,
    secao: prep.secao,
    dimensao: prep.dimensao,
    classificacao: prep.classificacao,
    padrao: prep.padrao || prep.codigo,
    gravidade: prep.gravidade,
    acao_corretiva_padrao: scoreConceitoAcaoCorretivaPadraoPorCodigo_(prep.codigo),
    responsavel_correcao: '',
    prazo_correcao: '',
    status_correcao: 'aberta',
    data_reauditoria_prevista: null,
  };
}

/**
 * Motor de score operacional (Matriz_Mae conceito).
 * Regra: Sim=1, Não=0, N/A fora do denominador; score = sim/aplicáveis*100.
 *
 * @param {Array<Object>} itens { codigo, secao, dimensao, classificacao, gravidade, resultado, padrao? }
 * @param {Object=} opcoes reservado (fase futura)
 * @returns {Object}
 */
function calcularScoreExecucaoConceito_(itens, opcoes) {
  void opcoes;
  var arr = Array.isArray(itens) ? itens : [];
  var preps = [];
  var total_itens = arr.length;
  var total_aplicaveis = 0;
  var total_sim = 0;
  var total_nao = 0;
  var total_na = 0;
  var falhasCriticasArr = [];
  var porDim = {};
  var porSec = {};
  var porCls = {};
  var gestaoCorretiva = [];

  for (var i = 0; i < arr.length; i++) {
    var prep = scoreConceitoItemPreparado_(arr[i]);
    preps.push(prep);
    if (!prep.aplicavel) {
      total_na++;
      continue;
    }
    total_aplicaveis++;
    if (prep.resultado === 'sim') total_sim++;
    else total_nao++;
    if (prep.resultado === 'nao' && prep.gravidade === 'critica') falhasCriticasArr.push(prep);
    scoreConceitoAcumularGrupo_(porDim, prep.dimensao, prep);
    scoreConceitoAcumularGrupo_(porSec, prep.secao, prep);
    scoreConceitoAcumularGrupo_(porCls, prep.classificacao, prep);
    if (prep.resultado === 'nao') gestaoCorretiva.push(scoreConceitoFalhaCorretivaDeItem_(prep));
  }

  var score_geral = total_aplicaveis > 0 ? Math.round((total_sim / total_aplicaveis) * 10000) / 100 : null;
  var falha_critica = falhasCriticasArr.length > 0;
  var alerta_vermelho = falhasCriticasArr.length >= 2;
  var score_por_dimensao = scoreConceitoMapaParaScorePct_(porDim);
  var score_por_secao = scoreConceitoMapaParaScorePct_(porSec);
  var score_por_classificacao = scoreConceitoMapaParaScorePct_(porCls);

  var prioridade_gerencial = false;
  var risco_operacional = false;
  var secKeys = Object.keys(porSec);
  for (var k = 0; k < secKeys.length; k++) {
    if (!scoreConceitoEhSecaoCritica_(secKeys[k])) continue;
    var b = porSec[secKeys[k]];
    if (!b || b.aplicaveis < 1) continue;
    var sc = (b.sim / b.aplicaveis) * 100;
    if (sc < 80) prioridade_gerencial = true;
    if (sc < 70) risco_operacional = true;
  }

  var padroes_resultado_nao = [];
  var padroes_criticos_reprovados = [];
  for (var p = 0; p < preps.length; p++) {
    var pr = preps[p];
    if (pr.resultado !== 'nao') continue;
    var row = {
      codigo: pr.codigo,
      secao: pr.secao,
      dimensao: pr.dimensao,
      classificacao: pr.classificacao,
      gravidade: pr.gravidade,
    };
    padroes_resultado_nao.push(row);
    if (pr.gravidade === 'critica') padroes_criticos_reprovados.push(row);
  }

  var ordPiores = preps
    .filter(function (x) {
      return x.aplicavel;
    })
    .slice()
    .sort(function (a, b) {
      var an = a.resultado === 'nao' ? 0 : 1;
      var bn = b.resultado === 'nao' ? 0 : 1;
      if (an !== bn) return an - bn;
      var ac = a.gravidade === 'critica' && a.resultado === 'nao' ? 0 : 1;
      var bc = b.gravidade === 'critica' && b.resultado === 'nao' ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return String(a.codigo).localeCompare(String(b.codigo));
    });
  var piores_padroes = ordPiores.slice(0, 15).map(function (x) {
    return {
      codigo: x.codigo,
      secao: x.secao,
      dimensao: x.dimensao,
      classificacao: x.classificacao,
      resultado: x.resultado,
      gravidade: x.gravidade,
    };
  });

  var basicos = preps.filter(function (x) {
    if (!x.aplicavel) return false;
    var cn = x.classificacao_norm;
    return cn.indexOf('basico') >= 0 || cn === 'basica' || cn.indexOf('padrao basico') >= 0;
  });
  var padroes_basicos_pior_desempenho = basicos
    .slice()
    .sort(function (a, b) {
      var an = a.resultado === 'nao' ? 0 : 1;
      var bn = b.resultado === 'nao' ? 0 : 1;
      if (an !== bn) return an - bn;
      return String(a.codigo).localeCompare(String(b.codigo));
    })
    .slice(0, 15)
    .map(function (x) {
      return { codigo: x.codigo, secao: x.secao, dimensao: x.dimensao, resultado: x.resultado, classificacao: x.classificacao };
    });

  var status_operacional = scoreConceitoClassificarFaixa_(score_geral == null ? 0 : score_geral, falha_critica);

  return {
    score_geral: score_geral,
    score_por_dimensao: score_por_dimensao,
    score_por_secao: score_por_secao,
    score_por_classificacao: score_por_classificacao,
    total_itens: total_itens,
    total_aplicaveis: total_aplicaveis,
    total_sim: total_sim,
    total_nao: total_nao,
    total_na: total_na,
    falhas_criticas: falhasCriticasArr,
    total_falhas_criticas: falhasCriticasArr.length,
    falha_critica: falha_critica,
    alerta_vermelho: alerta_vermelho,
    prioridade_gerencial: prioridade_gerencial,
    risco_operacional: risco_operacional,
    status_operacional: status_operacional,
    gestao_corretiva: gestaoCorretiva,
    piores_padroes: piores_padroes,
    padroes_resultado_nao: padroes_resultado_nao,
    padroes_criticos_reprovados: padroes_criticos_reprovados,
    padroes_basicos_pior_desempenho: padroes_basicos_pior_desempenho,
  };
}

/** Valida objeto de gestão corretiva (BLOCO 5 — estrutura mínima). */
function scoreSelfTestGestaoCorretivaItemValido_(o) {
  if (!o || typeof o !== 'object') return false;
  var keys = [
    'codigo',
    'secao',
    'dimensao',
    'classificacao',
    'padrao',
    'gravidade',
    'acao_corretiva_padrao',
    'responsavel_correcao',
    'prazo_correcao',
    'status_correcao',
    'data_reauditoria_prevista',
  ];
  for (var i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(o, keys[i])) return false;
  }
  return true;
}

/**
 * Self-test do motor de score (sem Sheets).
 * @returns {{ ok: boolean, casos: Array<{ id: number, nome: string, ok: boolean, detalhe?: Object }> }}
 */
function scoreSelfTestConceito_() {
  function item(cod, sec, dim, cls, grav, res, pad) {
    return {
      codigo: cod,
      secao: sec,
      dimensao: dim,
      classificacao: cls,
      gravidade: grav,
      resultado: res,
      padrao: pad || cod,
    };
  }
  var casos = [];

  // 1) perfeito
  var r1 = calcularScoreExecucaoConceito_([
    item('A1', 'Outra', 'D1', 'Básico', 'normal', 'Sim', ''),
    item('A2', 'Outra', 'D1', 'Básico', 'normal', 'Sim', ''),
  ]);
  var ok1Gestao =
    r1.gestao_corretiva != null &&
    Array.isArray(r1.gestao_corretiva) &&
    r1.gestao_corretiva.length === 0 &&
    r1.gestao_corretiva.length === r1.total_nao;
  var ok1 =
    r1.score_geral === 100 &&
    r1.status_operacional === 'excelência operacional' &&
    !r1.falha_critica &&
    !r1.alerta_vermelho &&
    ok1Gestao;
  casos.push({ id: 1, nome: 'score perfeito', ok: ok1, detalhe: { score: r1.score_geral, status: r1.status_operacional } });

  // 2) um Não normal
  var r2 = calcularScoreExecucaoConceito_([
    item('B1', 'Outra', 'D1', 'Básico', 'normal', 'Sim', ''),
    item('B2', 'Outra', 'D1', 'Básico', 'normal', 'Não', ''),
  ]);
  var ok2Gestao =
    r2.gestao_corretiva != null &&
    Array.isArray(r2.gestao_corretiva) &&
    r2.gestao_corretiva.length === r2.total_nao &&
    r2.total_nao === 1 &&
    scoreSelfTestGestaoCorretivaItemValido_(r2.gestao_corretiva[0]);
  var ok2 = r2.score_geral < 100 && !r2.falha_critica && !r2.alerta_vermelho && ok2Gestao;
  casos.push({ id: 2, nome: 'um Não normal + gestão corretiva', ok: ok2, detalhe: { score: r2.score_geral, falha: r2.falha_critica, gestaoLen: (r2.gestao_corretiva || []).length } });

  // 3) Não com gravidade crítica (reprovação crítica) com score alto — excelência bloqueada
  var r3 = calcularScoreExecucaoConceito_([
    item('C0', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C1', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C2', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C3', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C4', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C5', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C6', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C7', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C8', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
    item('C9', 'Outra', 'D1', 'Crítico', 'critica', 'Não', ''),
  ]);
  var ok3Gestao =
    r3.gestao_corretiva != null &&
    Array.isArray(r3.gestao_corretiva) &&
    r3.gestao_corretiva.length === r3.total_nao &&
    r3.total_nao === 1 &&
    scoreSelfTestGestaoCorretivaItemValido_(r3.gestao_corretiva[0]) &&
    r3.gestao_corretiva[0].gravidade === 'critica';
  var ok3 = r3.score_geral >= 90 && r3.falha_critica && r3.status_operacional !== 'excelência operacional' && ok3Gestao;
  casos.push({
    id: 3,
    nome: 'Falha crítica com score >= 90 bloqueia excelência',
    ok: ok3,
    detalhe: { score: r3.score_geral, status: r3.status_operacional },
  });

  // 4) duas falhas críticas
  var r4 = calcularScoreExecucaoConceito_([
    item('D1', 'Outra', 'D1', 'Crítico', 'critica', 'Não', ''),
    item('D2', 'Outra', 'D1', 'Crítico', 'critica', 'Não', ''),
    item('D3', 'Outra', 'D1', 'Crítico', 'critica', 'Sim', ''),
  ]);
  var ok4Gestao =
    r4.gestao_corretiva != null &&
    Array.isArray(r4.gestao_corretiva) &&
    r4.gestao_corretiva.length === r4.total_nao &&
    r4.total_nao === 2 &&
    scoreSelfTestGestaoCorretivaItemValido_(r4.gestao_corretiva[0]) &&
    scoreSelfTestGestaoCorretivaItemValido_(r4.gestao_corretiva[1]);
  var ok4 = r4.alerta_vermelho && r4.total_falhas_criticas >= 2 && ok4Gestao;
  casos.push({ id: 4, nome: 'duas falhas críticas', ok: ok4, detalhe: { alerta: r4.alerta_vermelho } });

  // 5) N/A fora
  var r5 = calcularScoreExecucaoConceito_([
    item('E1', 'Outra', 'D1', 'Básico', 'normal', 'Sim', ''),
    item('E2', 'Outra', 'D1', 'Básico', 'normal', 'N/A', ''),
    item('E3', 'Outra', 'D1', 'Básico', 'normal', 'Não', ''),
  ]);
  var ok5Gestao =
    r5.gestao_corretiva != null &&
    Array.isArray(r5.gestao_corretiva) &&
    r5.gestao_corretiva.length === r5.total_nao &&
    r5.total_nao === 1 &&
    scoreSelfTestGestaoCorretivaItemValido_(r5.gestao_corretiva[0]);
  var ok5 = r5.total_aplicaveis === 2 && r5.total_na === 1 && r5.score_geral === 50 && ok5Gestao;
  casos.push({ id: 5, nome: 'N/A fora do denominador', ok: ok5, detalhe: { aplicaveis: r5.total_aplicaveis, na: r5.total_na, score: r5.score_geral } });

  // 6) seção crítica < 80 e >= 70 (75%)
  var secCrit80 = 'Caixa e fechamento';
  var it6 = [];
  for (var i6 = 0; i6 < 15; i6++) it6.push(item('F' + i6, secCrit80, 'D1', 'Básico', 'normal', 'Sim', ''));
  for (var j6 = 0; j6 < 5; j6++) it6.push(item('G' + j6, secCrit80, 'D1', 'Básico', 'normal', 'Não', ''));
  var r6 = calcularScoreExecucaoConceito_(it6);
  var ok6 = r6.prioridade_gerencial === true && r6.risco_operacional === false;
  casos.push({ id: 6, nome: 'seção crítica <80', ok: ok6, detalhe: { secScore: r6.score_por_secao[secCrit80] } });

  // 7) seção crítica < 70
  var secCrit70 = 'Atendimento farmacêutico';
  var it7 = [];
  for (var i7 = 0; i7 < 3; i7++) it7.push(item('H' + i7, secCrit70, 'D1', 'Básico', 'normal', 'Sim', ''));
  for (var j7 = 0; j7 < 10; j7++) it7.push(item('I' + j7, secCrit70, 'D1', 'Básico', 'normal', 'Não', ''));
  var r7 = calcularScoreExecucaoConceito_(it7);
  var ok7 = r7.risco_operacional === true;
  casos.push({ id: 7, nome: 'seção crítica <70', ok: ok7, detalhe: { secScore: r7.score_por_secao[secCrit70] } });

  var allOk = casos.every(function (c) {
    return c.ok;
  });
  return { ok: allOk, casos: casos };
}

// =============================================================================
// Fase 3 — Crivo de execução (motor isolado; geração ≠ aprovação operacional)
// =============================================================================

var CRIVO_STATUS_CANONICOS_ = ['rascunho', 'em_revisao', 'reprovado_no_crivo', 'aprovado_com_ajuste', 'aprovado_para_operacao'];

/** Status oficiais do crivo (normalização + validação). */
function crivoNormalizarStatusExecucao_(status) {
  var x = iaBagNorm_(String(status == null ? '' : status));
  if (!x) return '';
  var map = {
    rascunho: 'rascunho',
    emrevisao: 'em_revisao',
    em_revisao: 'em_revisao',
    revisao: 'em_revisao',
    analise: 'em_revisao',
    reprovado_no_crivo: 'reprovado_no_crivo',
    reprovado: 'reprovado_no_crivo',
    reprovado_no_crivo_operacao: 'reprovado_no_crivo',
    aprovado_com_ajuste: 'aprovado_com_ajuste',
    aprovadocomajuste: 'aprovado_com_ajuste',
    ajuste: 'aprovado_com_ajuste',
    aprovado_para_operacao: 'aprovado_para_operacao',
    aprovadoparaoperacao: 'aprovado_para_operacao',
    aprovado: 'aprovado_para_operacao',
    operacao: 'aprovado_para_operacao',
  };
  var k = x.replace(/[\s_\-]/g, '');
  if (map[k] != null) return map[k];
  if (map[x] != null) return map[x];
  return '';
}

function crivoStatusExecucaoEhValido_(status) {
  return CRIVO_STATUS_CANONICOS_.indexOf(crivoNormalizarStatusExecucao_(status)) >= 0;
}

function crivoExtrairConteudoPop_(pop) {
  var p = pop || {};
  var cj = p.conteudoJson || p.conteudoObj || {};
  if (typeof cj === 'string') {
    try {
      cj = JSON.parse(cj);
    } catch (e1) {
      cj = {};
    }
  }
  if (!cj || typeof cj !== 'object') cj = {};
  return { pop: p, cj: cj };
}

function crivoCampoMortoEssencial_(valor, opts) {
  var o = opts || {};
  var t = popTextoCampoPublicacao_(valor);
  if (!String(t).trim()) return true;
  if (popEsNaoInformadoLiteral_(t)) return true;
  var k = iaBagNorm_(t);
  if (k === 'a definir' || k === 'indefinido' || k === 'adefinir') return true;
  if (k.indexOf('n?o informado') >= 0 || k.indexOf('nao informado') >= 0) return true;
  if (k.indexOf('nao se aplica') >= 0 || k === 'na' || k === 'n/a') {
    if (o.permiteNaoSeAplicaJustificado) {
      var low = String(t).toLowerCase();
      return low.length < 42 || (low.indexOf('justifica') < 0 && low.indexOf('porque') < 0 && low.indexOf('motivo') < 0);
    }
    return true;
  }
  return false;
}

function crivoListaFrasesVagasOperacao_() {
  return [
    'atender bem',
    'ser cordial',
    'demonstrar empatia',
    'orientar corretamente',
    'fazer corretamente',
    'agir com atencao',
    'atendimento adequado',
    'executar conforme padrao',
    'realizar da melhor forma',
    'melhorar postura',
    'reforcar atendimento',
    'executar corretamente',
    'com atencao',
  ];
}

function crivoTextoTemFraseVaga_(texto) {
  var bag = iaBagNorm_(texto || '');
  if (!bag) return false;
  var list = crivoListaFrasesVagasOperacao_();
  for (var i = 0; i < list.length; i++) {
    if (bag.indexOf(list[i]) >= 0) return true;
  }
  return false;
}

function crivoTextoTemHumanizacaoObservavel_(texto) {
  var bag = iaBagNorm_(texto || '');
  if (!bag) return false;
  var sinais = [
    'reconhecer',
    'perceber',
    'dor',
    'pressa',
    'inseguranca',
    'confusao',
    'adaptar a fala',
    'adaptar fala',
    'nao fazer o cliente repetir',
    'evitar que o cliente repita',
    'antecipar',
    'encerrar com clareza',
    'encerrar dizendo',
    'seguranca no encerramento',
    'olhar para o cliente',
    'perguntar a necessidade',
    'perguntar antes de sugerir',
    'confirmar entendimento',
    'confirmar informacao',
    'confirmar se entendeu',
    'informar o proximo passo',
    'informar proximo passo',
    'ouvir sem interromper',
    'nao interromper',
    'encaminhar ao farmaceutico quando necessario',
  ];
  var n = 0;
  for (var j = 0; j < sinais.length; j++) {
    if (bag.indexOf(iaBagNorm_(sinais[j])) >= 0) n++;
  }
  return n >= 2;
}

function crivoObjetivoContaminadoBriefing_(objetivo) {
  var t = String(objetivo || '');
  return /situacao\s*:|erro\s+ou\s+risco\s*:|exemplo\s*:|contexto\s+operacional\s*:/i.test(t);
}

function crivoContarPartesPraticas_(texto, minPartes) {
  var s = String(texto || '').trim();
  if (!s) return 0;
  var raw = s.split(/\n+|(?:\s*[·•]\s*)|(?:\s*;\s*)|(?:\d+[\.)]\s*)|(?:\.\s+)/g);
  var n = 0;
  for (var p = 0; p < raw.length; p++) {
    var t = String(raw[p] == null ? '' : raw[p]).trim();
    if (t.length < 12) continue;
    if (crivoTextoTemFraseVaga_(t)) continue;
    n++;
  }
  return n;
}

function crivoChecklistFraco_(arr, minItens) {
  var min = minItens == null || minItens === undefined ? 5 : minItens;
  if (!Array.isArray(arr) || arr.length < min) return true;
  var curtas = 0;
  for (var i = 0; i < arr.length; i++) {
    var u = String(arr[i] == null ? '' : arr[i]).trim();
    if (u.length < 18) curtas++;
  }
  return curtas >= Math.ceil(arr.length * 0.6);
}

function crivoAcaoCorretivaVaga_(desvios) {
  if (!Array.isArray(desvios)) return true;
  var ok = 0;
  for (var d = 0; d < desvios.length; d++) {
    var t = String(desvios[d] == null ? '' : desvios[d]).trim();
    if (t.length < 28) continue;
    if (crivoTextoTemFraseVaga_(t)) continue;
    ok++;
  }
  return ok < Math.min(2, desvios.length);
}

function crivoAvaliarItensAvaliaveis_(itens) {
  var out = { ok: true, motivo: '', evidencia: '' };
  if (!Array.isArray(itens) || itens.length < 1) return out;
  var criteriosAprov = [];
  for (var i = 0; i < itens.length; i++) {
    var it = itens[i] || {};
    var comp = String(it.comportamento || it.padrao || it.descricao || it.texto || '').trim();
    var cap = String(it.criterio_aprovacao || it.criterioAprovacao || '').trim();
    var cre = String(it.criterio_reprovacao || it.criterioReprovacao || '').trim();
    if (comp.length < 20) {
      out.ok = false;
      out.motivo = 'Item avaliável sem comportamento único suficientemente concreto';
      out.evidencia = 'item[' + i + ']';
      return out;
    }
    if (cap.length < 12 || cre.length < 12) {
      out.ok = false;
      out.motivo = 'Item sem critério claro de aprovação e reprovação';
      out.evidencia = 'item[' + i + ']';
      return out;
    }
    var bagA = iaBagNorm_(cap);
    if (bagA.indexOf('execucao conforme descricao da etapa') >= 0 || bagA.indexOf('execução conforme descrição da etapa') >= 0) {
      out.ok = false;
      out.motivo = 'Critério genérico proibido (execução conforme descrição da etapa)';
      out.evidencia = cap.slice(0, 120);
      return out;
    }
    if (bagA.indexOf('observavel no ponto de venda') >= 0 && bagA.length < 45) {
      out.ok = false;
      out.motivo = 'Critério vago (observável no ponto de venda sem especificação)';
      out.evidencia = cap.slice(0, 120);
      return out;
    }
    criteriosAprov.push(bagA);
  }
  var uniq = {};
  for (var u = 0; u < criteriosAprov.length; u++) uniq[criteriosAprov[u]] = true;
  if (Object.keys(uniq).length === 1 && criteriosAprov.length > 1) {
    out.ok = false;
    out.motivo = 'Critério de aprovação repetido em todos os itens avaliáveis';
    out.evidencia = criteriosAprov[0].slice(0, 120);
    return out;
  }
  return out;
}

/**
 * Métrica com indícios de auditabilidade: mensuração + referência de meta/prazo + contexto operacional.
 * Rejeita frases vagas conhecidas; não substitui julgamento humano no crivo.
 */
function crivoMetricaAuditavelCrivo_(met) {
  var t = String(met == null ? '' : met).trim();
  if (t.length < 20) return false;
  var bag = iaBagNorm_(t);
  var vaga = [
    'atendimento correto',
    'qualidade do atendimento',
    'executar bem',
    'melhorar atendimento',
    'processo adequado',
  ];
  for (var i = 0; i < vaga.length; i++) {
    if (bag.indexOf(iaBagNorm_(vaga[i])) >= 0) return false;
  }

  var temMensuracao =
    bag.indexOf('percentagem') >= 0 ||
    bag.indexOf('percentual') >= 0 ||
    bag.indexOf('quantidade') >= 0 ||
    bag.indexOf('contagem') >= 0 ||
    (bag.indexOf('numero') >= 0 && bag.indexOf('de') >= 0) ||
    bag.indexOf('total de') >= 0 ||
    t.indexOf('%') >= 0 ||
    /meta[\s:]*\d/.test(t);

  var temMetaPrazoOuAuditoria =
    bag.indexOf('meta') >= 0 ||
    /quinzen|seman|mensal|diari(amente)?|bimensal|trimestr|anual|frequ(ê|e)ncia|semestre|hora|horas|semana|semanas|dias?|turno|turnos|prazo|auditori|audita/i.test(
      t,
    ) ||
    /por\s+(\d|semana|dia|dias|turno|m[eê]s|quinzena|auditoria)/i.test(t);

  var temContextoMensuravel =
    bag.indexOf('atend') >= 0 ||
    bag.indexOf('falh') >= 0 ||
    bag.indexOf('erro') >= 0 ||
    bag.indexOf('checklist') >= 0 ||
    bag.indexOf('vend') >= 0 ||
    bag.indexOf('entreg') >= 0 ||
    bag.indexOf('caix') >= 0 ||
    bag.indexOf('pedid') >= 0 ||
    bag.indexOf('diverg') >= 0 ||
    bag.indexOf('confer') >= 0 ||
    bag.indexOf('balc') >= 0 ||
    bag.indexOf('conforme') >= 0 ||
    bag.indexOf('medicament') >= 0 ||
    bag.indexOf('otc') >= 0;

  return temMensuracao && temMetaPrazoOuAuditoria && temContextoMensuravel;
}

/**
 * Crivo de execução: POP estruturado (conteudoJson) — não altera persistência.
 * Flags opcionais no objeto pop: crivo_nao_enviado_ao_crivo, crivo_em_revisao (atalhos de workflow).
 *
 * @param {Object} pop POP com conteudoJson / conteudoObj colaborativo típico
 * @returns {Object}
 */
function avaliarCrivoExecucaoPop_(pop) {
  if (pop && pop.crivo_nao_enviado_ao_crivo === true) {
    return {
      status_crivo: 'rascunho',
      aprovado: false,
      aprovado_com_ajuste: false,
      bloqueado: false,
      bloqueadores: [],
      alertas: [],
      score_crivo: null,
      criterios: [],
      resumo: 'POP ainda não enviado ao crivo de execução.',
    };
  }
  if (pop && pop.crivo_em_revisao === true) {
    return {
      status_crivo: 'em_revisao',
      aprovado: false,
      aprovado_com_ajuste: false,
      bloqueado: false,
      bloqueadores: [],
      alertas: [],
      score_crivo: null,
      criterios: [],
      resumo: 'POP em revisão no crivo (análise humana).',
    };
  }

  var ex = crivoExtrairConteudoPop_(pop);
  var cj = ex.cj;
  var bloqueadores = [];
  var alertas = [];
  var criterios = [];

  function addBloq(codigo, motivo, evidencia) {
    bloqueadores.push({ codigo: codigo, motivo: motivo, evidencia: String(evidencia || '').slice(0, 400) });
  }
  function addAlerta(codigo, motivo, evidencia) {
    alertas.push({ codigo: codigo, motivo: motivo, evidencia: String(evidencia || '').slice(0, 400) });
  }

  var objetivo = popJsonCampoTextoOuAlternativo_(cj.objetivo, cj.objetivo_pop);
  var regra = popJsonCampoTextoOuAlternativo_(cj.regra_de_ouro, cj.regraDeOuro);
  var proc = cj.procedimento || [];
  var como = popJsonCampoTextoOuAlternativo_(cj.como_fazer_bem, cj.comoFazerBem);
  var erroC = popJsonCampoTextoOuAlternativo_(cj.erro_critico, cj.erroCritico);
  var errosComuns = cj.errosComuns || cj.erros_comuns || [];
  var pAt = cj.pontosDeAtencao || cj.pontos_de_atencao || [];
  var chkL = cj.checklist_lider || cj.checklistLider || [];
  var chk = cj.checklist || [];
  var trein = String(cj.treinamento || '').trim();
  var desv = cj.desvios || [];

  var essenciais = [
    { key: 'objetivo', val: objetivo },
    { key: 'regra_de_ouro', val: regra },
    { key: 'como_fazer_bem', val: como },
    { key: 'erro_critico', val: erroC },
  ];
  for (var e = 0; e < essenciais.length; e++) {
    if (crivoCampoMortoEssencial_(essenciais[e].val, { permiteNaoSeAplicaJustificado: false })) {
      addBloq('campo_morto_essencial', 'Campo essencial vazio ou placeholder inválido', essenciais[e].key);
    }
  }
  if (countProcedimentoEtapasValidas_(proc) < 1) {
    addBloq('campo_morto_essencial', 'Procedimento ausente ou sem etapas válidas', 'procedimento');
  }

  if (!crivoCampoMortoEssencial_(objetivo, {}) && crivoObjetivoContaminadoBriefing_(objetivo)) {
    addBloq('objetivo_contaminado_briefing', 'Objetivo mistura briefing/contexto (Situação/Erro/Exemplo)', String(objetivo).slice(0, 200));
  }

  if (crivoChecklistFraco_(chk, 5)) {
    addBloq('checklist_operacional_fraco', 'Checklist operacional abaixo do mínimo ou etapas muito fracas', 'checklist.length=' + (Array.isArray(chk) ? chk.length : 0));
  }
  if (!Array.isArray(chkL) || chkL.length < 3 || crivoChecklistFraco_(chkL, 3)) {
    addBloq('checklist_lider_fraco', 'Checklist do líder abaixo do mínimo ou muito vago', 'checklist_lider');
  }

  if (!Array.isArray(pAt) || pAt.length < 3) {
    addBloq('pontos_atencao_insuficientes', 'Pontos de atenção abaixo do mínimo (3)', String((pAt || []).length));
  }

  var ecArr = Array.isArray(errosComuns) ? errosComuns : [];
  var ecOk = ecArr.filter(function (x) {
    return String(x == null ? '' : x).trim() !== '';
  });
  if (ecOk.length < 3) {
    addBloq('erros_comuns_insuficientes', 'Erros comuns / proibido abaixo do mínimo (3 quando aplicável)', String(ecOk.length));
  }

  if (crivoAcaoCorretivaVaga_(desv)) {
    addBloq('acao_corretiva_vaga', 'Desvios / ação corretiva genérica ou curta demais', 'desvios');
  }

  if (crivoContarPartesPraticas_(trein, 2) < 2) {
    addBloq('treinamento_insuficiente', 'Treinamento precisa de ao menos 2 ações práticas discerníveis', trein.slice(0, 120));
  }

  if (crivoContarPartesPraticas_(como, 4) < 4) {
    addBloq('como_fazer_bem_insuficiente', 'Como fazer bem precisa de ao menos 4 orientações práticas', String(como).slice(0, 120));
  }

  var textoHum = [String(como), String(objetivo), String(erroC)].join(' ');
  if (crivoTextoTemFraseVaga_(textoHum)) {
    addBloq('linguagem_vaga_operacional', 'Texto com frase vaga operacional (atender bem, cordial, etc.)', textoHum.slice(0, 160));
  } else if (!crivoTextoTemHumanizacaoObservavel_(textoHum) && iaBagNorm_(textoHum).indexOf('cliente') >= 0 && iaBagNorm_(textoHum).length > 40) {
    addBloq('humanizacao_abstrata', 'Humanização sem comportamentos observáveis mínimos (balcão)', 'como_fazer_bem/objetivo');
  }

  var itensA = cj.itens_avaliaveis || cj.itensAvaliaveis || [];
  var chkIt = crivoAvaliarItensAvaliaveis_(itensA);
  if (!chkIt.ok) {
    addBloq('item_avaliavel_generico', chkIt.motivo, chkIt.evidencia);
  }

  var clarFalha = crivoCampoMortoEssencial_(objetivo, {}) || crivoObjetivoContaminadoBriefing_(objetivo) || String(objetivo || '').trim().length < 80;
  var clarOk = !clarFalha;
  criterios.push({
    id: 'clareza_operacional',
    status: clarOk ? 'aprovado' : 'reprovado',
    motivo: clarOk ? 'Objetivo claro e sem contaminação de briefing' : 'Objetivo precisa ser mais claro ou está contaminado',
    evidencia: String(objetivo).slice(0, 200),
    severidade: clarOk ? 'baixa' : 'alta',
  });

  var nDesv = (Array.isArray(desv) ? desv : []).filter(function (x) {
    return String(x || '').trim();
  }).length;
  var compOk =
    countProcedimentoEtapasValidas_(proc) >= 3 &&
    ecOk.length >= 3 &&
    pAt.length >= 3 &&
    chkL.length >= 3 &&
    chk.length >= 5 &&
    crivoContarPartesPraticas_(trein, 2) >= 2 &&
    crivoContarPartesPraticas_(como, 4) >= 4 &&
    nDesv >= 3;
  if (!compOk && !bloqueadores.length) {
    addAlerta('completude_reforco', 'Algum mínimo de completude está no limite', 'ver checklist e desvios');
  }
  criterios.push({
    id: 'completude',
    status: compOk ? 'aprovado' : 'alerta',
    motivo: compOk ? 'Mínimos de completude atendidos' : 'Completude abaixo do ideal',
    evidencia: JSON.stringify({
      proc: countProcedimentoEtapasValidas_(proc),
      errosComuns: ecOk.length,
      pAt: pAt.length,
      chkL: chkL.length,
      chk: chk.length,
      desv: (desv || []).length,
    }),
    severidade: compOk ? 'baixa' : 'media',
  });

  var densOk = true;
  for (var pi = 0; pi < proc.length; pi++) {
    var ps = String(proc[pi] == null ? '' : proc[pi]).trim();
    if (ps.length > 0 && ps.length < 25) densOk = false;
  }
  if (!densOk) addAlerta('densidade_operacional', 'Algumas etapas do procedimento são curtas demais', 'procedimento');
  criterios.push({
    id: 'densidade_operacional',
    status: densOk ? 'aprovado' : 'alerta',
    motivo: densOk ? 'Procedimento com etapas operacionais densas' : 'Etapas curtas — reforçar verbo e contexto de piso',
    evidencia: 'etapas=' + proc.length,
    severidade: densOk ? 'baixa' : 'media',
  });

  var met = String(cj.metrica || '').trim();
  var auditOk = crivoMetricaAuditavelCrivo_(met);
  if (!auditOk) addAlerta('auditabilidade_metrica', 'Métrica pode ficar mais auditável (número, prazo, checklist)', met.slice(0, 120));
  criterios.push({
    id: 'auditabilidade',
    status: auditOk ? 'aprovado' : 'alerta',
    motivo: auditOk ? 'Métrica com indício de verificação' : 'Métrica fraca para auditoria',
    evidencia: met.slice(0, 160),
    severidade: auditOk ? 'baixa' : 'media',
  });

  var utilOk = trein.length >= 80;
  if (!utilOk) addAlerta('utilidade_gerencial_treino', 'Treinamento pode ser mais útil para gestão (detalhar práticas)', trein.slice(0, 120));
  criterios.push({
    id: 'utilidade_gerencial',
    status: utilOk ? 'aprovado' : 'alerta',
    motivo: utilOk ? 'Treinamento com densidade gerencial' : 'Treinamento curto para utilidade gerencial',
    evidencia: 'len=' + trein.length,
    severidade: utilOk ? 'baixa' : 'media',
  });

  var bloqueado = bloqueadores.length > 0;
  var alertasRelevantes = alertas.some(function (a) {
    return String(a.codigo || '').indexOf('densidade') >= 0 || String(a.codigo || '').indexOf('auditabilidade') >= 0;
  })
    ? alertas.length >= 1
    : alertas.length >= 2;

  var status_crivo = 'aprovado_para_operacao';
  if (bloqueado) status_crivo = 'reprovado_no_crivo';
  else if (alertasRelevantes) status_crivo = 'aprovado_com_ajuste';

  var scorePartes = 0;
  var scoreTotal = 0;
  for (var ci = 0; ci < criterios.length; ci++) {
    scoreTotal++;
    if (criterios[ci].status === 'aprovado') scorePartes++;
    else if (criterios[ci].status === 'alerta') scorePartes += 0.5;
  }
  var score_crivo = scoreTotal > 0 ? Math.round((scorePartes / scoreTotal) * 10000) / 100 : 0;

  var aprovado = status_crivo === 'aprovado_para_operacao';
  var aprovado_com_ajuste = status_crivo === 'aprovado_com_ajuste';

  var resumo = bloqueado
    ? 'Reprovado no crivo: ' + bloqueadores.length + ' bloqueador(es).'
    : aprovado_com_ajuste
      ? 'Aprovado com ajustes: revisar alertas antes do piso.'
      : 'Aprovado para operação.';

  return {
    status_crivo: status_crivo,
    aprovado: aprovado,
    aprovado_com_ajuste: aprovado_com_ajuste,
    bloqueado: bloqueado,
    bloqueadores: bloqueadores,
    alertas: alertas,
    score_crivo: score_crivo,
    criterios: criterios,
    resumo: resumo,
  };
}

/**
 * Self-test do crivo de execução (sem persistência).
 * @returns {{ ok: boolean, casos: Array<Object> }}
 */
function crivoSelfTestExecucaoPop_() {
  function basePop() {
    return {
      titulo: 'POP teste crivo',
      tipo: 'colaborativo',
      conteudoJson: {
        objetivo:
          'Garantir atendimento seguro no balcão com escuta ativa e registo de exceções quando o cliente relatar sintoma ou pedir orientação fora do perfil OTC.',
        regra_de_ouro: 'Em dúvida clínica ou legal, chamar farmacêutico antes de concluir o atendimento.',
        procedimento: [
          'Cumprimentar e repetir em voz audível o pedido ou a dúvida no balcão',
          'Confirmar leitura da embalagem antes de explicar posologia de OTC',
          'Registar no sistema qualquer exceção ou reclamação com data e responsável',
        ],
        como_fazer_bem:
          'Olhar para o cliente ao falar · Perguntar antes de sugerir produto · Confirmar se entendeu o próximo passo · Encerrar dizendo o que vai acontecer a seguir',
        erro_critico: 'Sugerir produto sem ouvir a necessidade completa no balcão.',
        errosComuns: ['Prometer prazo sem consultar sistema', 'Ignorar fila sem aceno', 'Dispensar sem conferir identidade'],
        pontosDeAtencao: ['Fila no rush', 'Cliente idoso', 'SKU em falta na gôndola'],
        checklist_lider: ['Auditar 3 atendimentos por turno', 'Revisar registo de exceções', 'Confirmar leitura do POP na abertura'],
        checklist: [
          'Confirmar identidade do cliente antes de entregar medicamento controlado',
          'Ler em voz alta o pedido e apontar o passo do POP em execução',
          'Registar exceção com data, hora e nome do responsável no sistema',
          'Medir tempo de espera quando há fila e acenar quem chegou por último',
          'Chamar farmacêutico quando a dúvida exceder OTC ou houver risco clínico',
        ],
        treinamento: 'Roleplay de 10 min no balcão. Checklist de observação no piso com 3 itens sim/não.',
        desvios: [
          'Cliente sem identificação na retirada de controlado — recusar e chamar farmacêutico',
          'Fila sem reconhecimento de quem espera mais tempo — corrigir na hora e anotar',
          'Promessa de prazo sem verificação no sistema — cancelar promessa e informar cliente',
        ],
        metrica: 'Percentagem de atendimentos sem sugestão precoce (meta 90% por auditoria quinzenal)',
      },
    };
  }
  var casos = [];

  var p1 = basePop();
  var r1 = avaliarCrivoExecucaoPop_(p1);
  var ok1 = r1.status_crivo === 'aprovado_para_operacao' && r1.aprovado === true && r1.bloqueado === false;
  casos.push({ id: 1, nome: 'POP bom completo', ok: ok1, det: r1.status_crivo });

  var p2 = basePop();
  p2.conteudoJson.objetivo = '';
  var r2 = avaliarCrivoExecucaoPop_(p2);
  var ok2 = r2.status_crivo === 'reprovado_no_crivo' && r2.bloqueado && r2.bloqueadores.some(function (b) { return b.codigo === 'campo_morto_essencial'; });
  casos.push({ id: 2, nome: 'campo morto essencial', ok: ok2 });

  var p3 = basePop();
  p3.conteudoJson.objetivo = 'Situação: cliente no balcão. Erro ou risco: demora. Objetivo real aqui.';
  var r3 = avaliarCrivoExecucaoPop_(p3);
  var ok3 = r3.status_crivo === 'reprovado_no_crivo' && r3.bloqueadores.some(function (b) { return b.codigo === 'objetivo_contaminado_briefing'; });
  casos.push({ id: 3, nome: 'objetivo contaminado', ok: ok3 });

  var p4 = basePop();
  p4.conteudoJson.checklist = ['a', 'b'];
  var r4 = avaliarCrivoExecucaoPop_(p4);
  var ok4 = r4.status_crivo === 'reprovado_no_crivo' && r4.bloqueadores.some(function (b) { return b.codigo === 'checklist_operacional_fraco'; });
  casos.push({ id: 4, nome: 'checklist fraco', ok: ok4 });

  var p5 = basePop();
  p5.conteudoJson.desvios = ['orientar corretamente', 'ok ok ok ok ok ok ok', 'curto'];
  var r5 = avaliarCrivoExecucaoPop_(p5);
  var ok5 = r5.status_crivo === 'reprovado_no_crivo' && r5.bloqueadores.some(function (b) { return b.codigo === 'acao_corretiva_vaga'; });
  casos.push({ id: 5, nome: 'ação corretiva vaga', ok: ok5 });

  var p6 = basePop();
  p6.conteudoJson.como_fazer_bem = 'Demonstrar empatia e ser cordial com o cliente no balcão.';
  var r6 = avaliarCrivoExecucaoPop_(p6);
  var ok6 = r6.status_crivo === 'reprovado_no_crivo' && r6.bloqueadores.some(function (b) { return b.codigo === 'linguagem_vaga_operacional'; });
  casos.push({ id: 6, nome: 'humanização / linguagem vaga', ok: ok6 });

  var p7 = basePop();
  p7.conteudoJson.itens_avaliaveis = [
    { comportamento: 'Passo A', criterio_aprovacao: 'Execução conforme descrição da etapa', criterio_reprovacao: 'Não executar' },
    { comportamento: 'Passo B', criterio_aprovacao: 'Execução conforme descrição da etapa', criterio_reprovacao: 'Não executar' },
  ];
  var r7 = avaliarCrivoExecucaoPop_(p7);
  var ok7 = r7.status_crivo === 'reprovado_no_crivo' && r7.bloqueadores.some(function (b) { return b.codigo === 'item_avaliavel_generico'; });
  casos.push({ id: 7, nome: 'item avaliável genérico', ok: ok7 });

  var p8 = basePop();
  p8.conteudoJson.metrica = 'Qualidade no balcão';
  p8.conteudoJson.procedimento[2] = 'OK';
  var r8 = avaliarCrivoExecucaoPop_(p8);
  var ok8 = r8.status_crivo === 'aprovado_com_ajuste' && r8.aprovado_com_ajuste === true && r8.bloqueado === false;
  casos.push({ id: 8, nome: 'POP bom com ajuste leve', ok: ok8, det: r8.alertas.length });

  var p9 = basePop();
  p9.conteudoJson.treinamento =
    'Simular atendimento com cliente em dúvida. Observar atendimento real no balcão e corrigir sugestão precoce no turno.';
  var r9 = avaliarCrivoExecucaoPop_(p9);
  var ok9 = r9.status_crivo === 'aprovado_para_operacao' && r9.bloqueado === false;
  casos.push({ id: 9, nome: 'treinamento: duas ações (ponto final)', ok: ok9, det: r9.status_crivo });

  var p10 = basePop();
  p10.conteudoJson.treinamento = 'Orientar equipe. Reforçar atendimento.';
  var r10 = avaliarCrivoExecucaoPop_(p10);
  var ok10 =
    r10.status_crivo === 'reprovado_no_crivo' &&
    r10.bloqueadores.some(function (b) { return b.codigo === 'treinamento_insuficiente'; });
  casos.push({ id: 10, nome: 'treinamento: parte vaga não conta', ok: ok10 });

  var p11 = basePop();
  p11.conteudoJson.checklist = [
    'Item operacional A com conteúdo mínimo exigido para o crivo',
    'Item operacional B com conteúdo mínimo exigido para o crivo',
    'Item operacional C com conteúdo mínimo exigido para o crivo',
    'Item operacional D com conteúdo mínimo exigido para o crivo',
  ];
  var r11 = avaliarCrivoExecucaoPop_(p11);
  var ok11 = r11.status_crivo === 'reprovado_no_crivo' && r11.bloqueadores.some(function (b) { return b.codigo === 'checklist_operacional_fraco'; });
  casos.push({ id: 11, nome: 'checklist operacional: mínimo 5', ok: ok11 });

  var allOk = casos.every(function (c) {
    return c.ok;
  });
  return { ok: allOk, casos: casos };
}

// =============================================================================
// Fase 4 — Gerador + Matriz_Mae (conceito) + Crivo + Score (integração incremental)
// =============================================================================

/** Enums oficiais base operacional (Fase 4 / itens avaliáveis). */
function fase4EnumsTipoItem_() {
  return [
    'tempo',
    'clareza',
    'escuta',
    'personalizacao',
    'humanizacao',
    'antecipacao',
    'conducao',
    'retorno',
    'orientacao',
    'fechamento',
    'apresentacao',
    'limpeza',
    'organizacao',
    'sinalizacao',
    'conveniencia',
    'seguranca',
    'conformidade',
  ];
}
function fase4EnumsCanalItem_() {
  return ['presencial', 'telefone', 'whatsapp', 'entrega', 'estrutura_fisica'];
}
function fase4EnumsAplicabilidadeItem_() {
  return [
    'quando_houver_entrada_de_cliente',
    'quando_houver_fluxo_no_salao',
    'quando_houver_atendimento_no_balcao',
    'quando_houver_receita',
    'quando_houver_atendimento_farmaceutico',
    'quando_houver_espera_ou_consulta_de_estoque',
    'quando_houver_fechamento_de_venda',
    'quando_houver_entrega_ou_retirada',
    'quando_houver_contato_telefonico',
    'quando_houver_contato_whatsapp',
    'quando_houver_auditoria_estrutural',
  ];
}
function fase4ItemEnumCamposOficiaisValidos_(item) {
  if (!item || typeof item !== 'object') return false;
  var t = fase4EnumsTipoItem_();
  var c = fase4EnumsCanalItem_();
  var a = fase4EnumsAplicabilidadeItem_();
  if (t.indexOf(String(item.tipo || '')) < 0) return false;
  if (c.indexOf(String(item.canal || '')) < 0) return false;
  if (a.indexOf(String(item.aplicabilidade || '')) < 0) return false;
  return true;
}

/** Todos os códigos de matriz no mapeamento pertencem à mesma família (prefixo ATD- ou EST-). */
function fase4CodigosSoFamilia_(refs, prefix) {
  var list = (refs && refs.codigos_matriz_mae) || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i] == null ? '' : list[i]).indexOf(String(prefix)) !== 0) return false;
  }
  return true;
}

/** Cada item deve usar codigo (e codigo_matriz_mae) presentes em matrizRefs.codigos_matriz_mae; enums oficiais. */
function fase4ValidarItensRastreioMatrizEEnums_(itens, matrizRefs) {
  if (!Array.isArray(itens) || itens.length < 1) return false;
  var list = (matrizRefs && matrizRefs.codigos_matriz_mae) || [];
  for (var i = 0; i < itens.length; i++) {
    var it = itens[i];
    var cod = String((it && it.codigo) || '');
    if (!cod || list.indexOf(cod) < 0) return false;
    if (String((it && it.codigo_matriz_mae) || '') !== cod) return false;
    if (!fase4ItemEnumCamposOficiaisValidos_(it)) return false;
  }
  return true;
}

/**
 * Catálogo conceitual: códigos = identificadores oficiais da Matriz_Mae (não inventar fora do catálogo).
 */
function matrizMaeCatalogoConceito_() {
  return [
    {
      codigo: 'ATD-001',
      familia: 'ATD',
      dominio: 'atendimento/balcão',
      gatilhos: ['atend', 'balc', 'cliente', 'dúvida', 'duvida', 'sugere', 'produto', 'necess', 'escuta', 'pergunta'],
      secao: 'Atendimento no balcão de medicamentos',
      dimensao: 'Escuta e orientação ao cliente',
      classificacao: 'Comunicação e escuta (Básico)',
      padrao: 'Confirmar a necessidade antes de sugerir produto no balcão',
      fase4_tipo: 'escuta',
      fase4_canal: 'presencial',
      fase4_aplic: 'quando_houver_atendimento_no_balcao',
    },
    {
      codigo: 'ATD-002',
      familia: 'ATD',
      dominio: 'atendimento/balcão',
      gatilhos: ['humaniz', 'tom', 'postura', 'cordial', 'acolh', 'olhar', 'fala'],
      secao: 'Atendimento no balcão de medicamentos',
      dimensao: 'Conduta e postura no atendimento',
      classificacao: 'Humanização observável (Básico)',
      padrao: 'Postura e linguagem alinhadas ao protocolo de acolhimento',
      fase4_tipo: 'humanizacao',
      fase4_canal: 'presencial',
      fase4_aplic: 'quando_houver_atendimento_no_balcao',
    },
    {
      codigo: 'ATD-015',
      familia: 'ATD',
      dominio: 'atendimento/balcão',
      gatilhos: ['segur', 'farmaceut', 'controlad', 'otc', 'orient'],
      secao: 'Atendimento no balcão de medicamentos',
      dimensao: 'Segurança do medicamento e encaminhamento',
      classificacao: 'Segurança operacional (Crítico)',
      padrao: 'Encaminhar ao farmacêutico quando a dúvida exceder OTC ou houver risco',
      fase4_tipo: 'orientacao',
      fase4_canal: 'presencial',
      fase4_aplic: 'quando_houver_atendimento_farmaceutico',
    },
    {
      codigo: 'EST-001',
      familia: 'EST',
      dominio: 'estrutura/organização',
      gatilhos: ['organiz', 'salão', 'corredor', 'passagem', 'circular', 'caixa', 'bloque', 'gôndola', 'loja'],
      secao: 'Loja e operação diária',
      dimensao: 'Circulação e organização do piso',
      classificacao: 'Conveniência e segurança de circulação (Básico)',
      padrao: 'Manter corredores e passagens livres para circulação segura do cliente',
      fase4_tipo: 'organizacao',
      fase4_canal: 'estrutura_fisica',
      fase4_aplic: 'quando_houver_fluxo_no_salao',
    },
    {
      codigo: 'EST-002',
      familia: 'EST',
      dominio: 'estrutura/organização',
      gatilhos: ['queda', 'acidente', 'atropel', 'emerg', 'evacu', 'risco', 'tomb'],
      secao: 'Loja e operação diária',
      dimensao: 'Risco estrutural e emergência',
      classificacao: 'Segurança física (Crítico)',
      padrao: 'Eliminar ou sinalizar obstáculos com risco imediato de queda ou atropelamento',
      fase4_tipo: 'seguranca',
      fase4_canal: 'estrutura_fisica',
      fase4_aplic: 'quando_houver_auditoria_estrutural',
    },
  ];
}

function matrizMaeRowPorCodigoF4_(cod) {
  var c = String(cod || '').trim();
  if (!c) return null;
  var cat = matrizMaeCatalogoConceito_();
  for (var i = 0; i < cat.length; i++) {
    if (String(cat[i].codigo) === c) return cat[i];
  }
  return null;
}

/** Só códigos cuja família no catálogo coincide com a família alvo (coerência ATD vs EST). */
function geradorFiltrarCodigosPorFamiliaMatriz_(codigos, familia) {
  var fam = String(familia || '').toUpperCase();
  var cat = matrizMaeCatalogoConceito_();
  var mapa = {};
  for (var h = 0; h < cat.length; h++) {
    mapa[String(cat[h].codigo)] = String(cat[h].familia || '').toUpperCase();
  }
  var out = [];
  for (var i = 0; i < (codigos || []).length; i++) {
    var c = String(codigos[i] == null ? '' : codigos[i]).trim();
    if (!c) continue;
    if (mapa[c] === fam) out.push(c);
  }
  return out;
}

/** Garante pelo menos dois códigos distintos da família mapeada para itens duplets. */
function geradorCompletarCodigosMatrizMae_(codigos, familia) {
  var fam = String(familia || '').toUpperCase();
  var out = geradorFiltrarCodigosPorFamiliaMatriz_(codigos, familia);
  var cat = matrizMaeCatalogoConceito_();
  var famRows = cat.filter(function (r) {
    return String(r.familia || '').toUpperCase() === fam;
  });
  var seen = {};
  for (var i = 0; i < out.length; i++) {
    seen[out[i]] = true;
  }
  for (var j = 0; j < famRows.length && out.length < 2; j++) {
    var co = famRows[j].codigo;
    if (!seen[co]) {
      out.push(co);
      seen[co] = true;
    }
  }
  return out;
}

/**
 * Mapeia entrada do gerador para referências da Matriz_Mae (conceito).
 * @param {{ processo: string, situacao: string, erro: string, area: string, linhaPop: string, conteudoGerado: Object }} contexto
 */
function geradorMapearMatrizConceito_(contexto) {
  var cx = contexto || {};
  var blob = iaBagNorm_(
    String(cx.processo || '') + ' ' + String(cx.situacao || '') + ' ' + String(cx.erro || '') + ' ' + String(cx.area || ''),
  );
  var cat = matrizMaeCatalogoConceito_();
  var scores = [];
  for (var i = 0; i < cat.length; i++) {
    var row = cat[i];
    var g = row.gatilhos || [];
    var n = 0;
    for (var gk = 0; gk < g.length; gk++) {
      if (blob.indexOf(iaBagNorm_(g[gk])) >= 0) n++;
    }
    scores.push({ row: row, score: n });
  }
  scores.sort(function (a, b) {
    return b.score - a.score;
  });
  var best = scores.length && scores[0].score > 0 ? scores[0].row : cat[0];
  var familiaP = String(best.familia || '');
  var alerta = !scores.length || scores[0].score < 1;
  var codigos = [];
  var padroes = [];
  for (var s = 0; s < scores.length && s < 4; s++) {
    if (scores[s].score > 0 && String(scores[s].row.familia || '') === familiaP) {
      codigos.push(scores[s].row.codigo);
      padroes.push(scores[s].row.familia + ': ' + scores[s].row.padrao);
    }
  }
  if (!codigos.length) {
    codigos.push(best.codigo);
    padroes.push(best.familia + ': ' + best.padrao);
  }
  codigos = geradorCompletarCodigosMatrizMae_(codigos, familiaP);
  return {
    dominio: best.dominio,
    secao_sugerida: best.secao,
    dimensao_sugerida: best.dimensao,
    classificacao_sugerida: best.classificacao,
    codigos_matriz_mae: codigos,
    padroes_relacionados: padroes,
    alerta_mapeamento_aproximado: alerta,
    familia_prioritaria: familiaP,
  };
}

function geradorCampoTextoMortoF4_(v) {
  if (v == null) return true;
  var t = String(v).trim();
  if (!t) return true;
  if (popEsNaoInformadoLiteral_(t)) return true;
  var k = popNormTextoPlaceholder_(t);
  if (k === 'a definir' || k === 'indefinido') return true;
  if (/^n\?o\s+informado$/i.test(String(t).trim())) return true;
  return false;
}

function geradorEnriquecerConteudoColaborativoMinimoCrivo_(cj, contract, situacaoIn, erroIn) {
  if (!cj || typeof cj !== 'object') return;
  var c = contract || {};
  var exec = c.execucao || {};
  var ctl = c.controle || {};
  var steps = Array.isArray(exec.o_que_fazer) ? exec.o_que_fazer.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean) : [];
  var eg = Array.isArray(ctl.erros_graves) ? ctl.erros_graves.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean) : [];
  var ecs = Array.isArray(cj.errosComuns) ? cj.errosComuns.slice() : [];

  if (geradorCampoTextoMortoF4_(cj.regra_de_ouro)) {
    cj.regra_de_ouro =
      'Em dúvida clínica ou de produto, confirmar a necessidade com o cliente e escalar ao farmacêutico quando o risco exceder o balcão.';
  }
  if (!Array.isArray(cj.pontosDeAtencao) || cj.pontosDeAtencao.length < 3) {
    var pd = Array.isArray(cj.pontosDeAtencao) ? cj.pontosDeAtencao.slice() : [];
    while (pd.length < 3) {
      pd.push('Fila no horário de pico — manter olhar no cliente e prioridade de quem aguarda há mais tempo');
    }
    cj.pontosDeAtencao = pd;
  }
  if (!Array.isArray(cj.checklist_lider) || cj.checklist_lider.length < 3) {
    var cl = Array.isArray(cj.checklist_lider) ? cj.checklist_lider.slice() : [];
    var clPad = [
      'Auditar dois atendimentos por turno verificando escuta e encaminhamento conforme POP',
      'Rever registo de exceções e devolutiva ao colaborador na mesma semana',
      'Confirmar leitura do POP na abertura do turno no balcão',
    ];
    for (var ci = 0; ci < clPad.length && cl.length < 3; ci++) {
      if (cl.indexOf(clPad[ci]) < 0) cl.push(clPad[ci]);
    }
    cj.checklist_lider = cl.slice(0, Math.max(3, cl.length));
  }
  if (!Array.isArray(cj.checklist) || cj.checklist.length < 5) {
    var ck = Array.isArray(cj.checklist) ? cj.checklist.slice() : [];
    for (var si = 0; si < steps.length && ck.length < 5; si++) {
      var line = 'Executar etapa operacional: ' + String(steps[si]).slice(0, 120);
      ck.push(line);
    }
    var seed = String(ctl.criterio_sucesso || cj.metrica || '').trim();
    while (ck.length < 5) {
      ck.push('Verificar conformidade com critério de sucesso: ' + (seed ? seed.slice(0, 80) : 'observação no piso com registo'));
    }
    cj.checklist = ck.slice(0, Math.max(5, ck.length));
  }
  if (!Array.isArray(cj.desvios) || cj.desvios.length < 3) {
    var dv = Array.isArray(cj.desvios) ? cj.desvios.slice() : [];
    for (var ei = 0; ei < ecs.length && dv.length < 3; ei++) {
      dv.push(String(ecs[ei]));
    }
    for (var ej = 0; ej < eg.length && dv.length < 3; ej++) {
      var dline = 'Corrigir na hora: ' + String(eg[ej]).slice(0, 160);
      if (dv.indexOf(dline) < 0) dv.push(dline);
    }
    while (dv.length < 3) {
      dv.push('Registrar ocorrência no sistema e comunicar ao farmacêutico quando houver risco.');
    }
    cj.desvios = dv.slice(0, Math.max(3, dv.length));
  }
  if (geradorCampoTextoMortoF4_(cj.treinamento)) {
    var erT = String(erroIn || '').trim().slice(0, 80);
    cj.treinamento =
      'Roleplay de 10 minutos no balcão com cenário de ' +
      (erT || 'atendimento') +
      '. Observação de campo com checklist sim/não no mesmo turno. Retorno de feedback ao colaborador na semana.';
  }
}

/**
 * Itens no formato do score; codigo = codigo_matriz_mae (códigos do mapeamento, sem sufixos artificiais).
 */
function geradorConstruirItensAvaliaveisDaMatriz_(pop, matrizRefs) {
  var refs = matrizRefs || {};
  var codLista = geradorCompletarCodigosMatrizMae_(refs.codigos_matriz_mae || [], refs.familia_prioritaria);
  var c1 = codLista.length > 0 ? String(codLista[0]) : '';
  var c2 = codLista.length > 1 ? String(codLista[1]) : c1;
  var r1 = matrizMaeRowPorCodigoF4_(c1);
  var r2 = matrizMaeRowPorCodigoF4_(c2);
  if (!r1) {
    var cat0 = matrizMaeCatalogoConceito_();
    r1 = cat0[0];
    c1 = r1.codigo;
  }
  if (!r2) r2 = r1;
  c2 = r2.codigo;
  if (c1 === c2 && codLista.length > 1) {
    r2 = matrizMaeRowPorCodigoF4_(String(codLista[1])) || r1;
    c2 = r2.codigo;
  }
  if (c1 === c2) {
    var cat = matrizMaeCatalogoConceito_();
    for (var z = 0; z < cat.length; z++) {
      if (String(cat[z].codigo) !== c1) {
        r2 = cat[z];
        c2 = r2.codigo;
        break;
      }
    }
  }

  var out = [];
  function pushDeRow(row, grav, comp, cap, cre) {
    var codM = String(row.codigo);
    out.push({
      codigo: codM,
      codigo_matriz_mae: codM,
      secao: row.secao,
      dimensao: row.dimensao,
      classificacao: row.classificacao,
      tipo: String(row.fase4_tipo),
      canal: String(row.fase4_canal),
      aplicabilidade: String(row.fase4_aplic),
      padrao: comp,
      evidencia_minima: 'Registo em checklist de piso ou evidência equivalente',
      gravidade: grav,
      resultado: '',
      pontuacao: '',
      observacoes: '',
      acao_corretiva_padrao: scoreConceitoAcaoCorretivaPadraoPorCodigo_(codM),
      responsavel_correcao: '',
      prazo_correcao: '',
      status_correcao: 'pendente_avaliacao',
      data_reauditoria_prevista: null,
      comportamento: comp,
      criterio_aprovacao: cap,
      criterio_reprovacao: cre,
    });
  }
  if (String(refs.familia_prioritaria || '').toUpperCase() === 'EST') {
    pushDeRow(
      r1,
      'normal',
      'Corredor e passagem permanecem livres para circulação do cliente sem obstrução de caixas ou paletes',
      'Área de passagem verificada sem bloqueio acima do limite definido pela loja',
      'Obstáculo fixo ou temporário impede circulação segura ou força desvio em área de risco',
    );
    pushDeRow(
      r2,
      'critica',
      'Obstáculo com risco de queda ou atropelamento é sinalizado e removido ou isolado no mesmo turno',
      'Isolamento ou remoção registrada com responsável e prazo',
      'Obstáculo permanece sem sinalização ou sem ação no prazo',
    );
  } else {
    pushDeRow(
      r1,
      'normal',
      'Colaborador confirma a necessidade ou a dúvida do cliente antes de sugerir produto no balcão',
      'Repetição ou confirmação da necessidade em voz audível ou registo no fluxo do balcão',
      'Sugestão de produto sem confirmação prévia da necessidade',
    );
    pushDeRow(
      r2,
      'normal',
      'Registo de exceção quando a orientação sair do perfil OTC ou houver risco clínico',
      'Exceção com data, hora e responsável no sistema ou livro definido',
      'Seguimento sem registo quando a exceção exigir rastreio',
    );
  }
  return out;
}

function geradorValidarCamposEssenciaisFase4_(pop) {
  var erros = [];
  var cj = (pop && pop.conteudoJson) || {};
  var camposStr = [
    { k: 'objetivo', v: cj.objetivo },
    { k: 'regra_de_ouro', v: cj.regra_de_ouro },
    { k: 'como_fazer_bem', v: cj.como_fazer_bem || cj.comoFazerBem },
    { k: 'erro_critico', v: cj.erro_critico || cj.erroCritico },
    { k: 'treinamento', v: cj.treinamento },
  ];
  for (var i = 0; i < camposStr.length; i++) {
    if (geradorCampoTextoMortoF4_(camposStr[i].v)) {
      erros.push('Campo essencial vazio ou placeholder: ' + camposStr[i].k);
    }
  }
  var proc = cj.procedimento;
  if (!Array.isArray(proc) || countProcedimentoEtapasValidas_(proc) < 1) {
    erros.push('Procedimento obrigatório com pelo menos uma etapa válida');
  }
  var pAt = cj.pontosDeAtencao || [];
  if (!Array.isArray(pAt) || pAt.length < 3) erros.push('pontosDeAtencao: mínimo 3 itens');
  var chkL = cj.checklist_lider || cj.checklistLider || [];
  if (!Array.isArray(chkL) || chkL.length < 3) erros.push('checklist_lider: mínimo 3 itens');
  var chk = cj.checklist || [];
  if (!Array.isArray(chk) || chk.length < 5) erros.push('checklist operacional: mínimo 5 itens');
  var desv = cj.desvios || [];
  if (!Array.isArray(desv) || desv.filter(function (x) { return String(x || '').trim(); }).length < 3) {
    erros.push('desvios: mínimo 3 entradas');
  }
  return { ok: erros.length === 0, erros: erros };
}

function geradorAplicarMetadadosCrivoNoConteudo_(cj, crivo) {
  if (!cj || typeof cj !== 'object') return;
  if (!crivo || typeof crivo !== 'object') return;
  cj.status_crivo = String(crivo.status_crivo || '');
  cj.bloqueadores_crivo = crivo.bloqueadores || [];
  cj.alertas_crivo = crivo.alertas || [];
  cj.score_crivo = crivo.score_crivo;
  cj.resumo_crivo = String(crivo.resumo || '');
}

/** Bloqueadores que a 1ª passada de reparo F4 sabe endereçar (apenas estes, em conjunto isolado). */
function geradorCrivoCodigosReparoF4_() {
  return {
    objetivo_contaminado_briefing: true,
    erros_comuns_insuficientes: true,
    como_fazer_bem_insuficiente: true,
    humanizacao_abstrata: true,
  };
}

/**
 * Só aplica reparo se não houver bloqueador estrutural fora do conjunto (ex.: item genérico, checklist morto).
 */
function geradorCrivoApenasBloqReparoF4_(bloqueadores) {
  var alvo = geradorCrivoCodigosReparoF4_();
  if (!Array.isArray(bloqueadores) || !bloqueadores.length) return false;
  for (var i = 0; i < bloqueadores.length; i++) {
    var c = bloqueadores[i] && bloqueadores[i].codigo ? String(bloqueadores[i].codigo) : '';
    if (!alvo[c]) return false;
  }
  return true;
}

/**
 * Reparo determinístico pós-crivo (1 passada). Não altera itens avaliáveis, matriz, enums.
 * @param {Object} conteudoObj conteudoJson mutável
 * @param {{ processo: string, situacao: string, erro: string }} contexto
 * @param {Object} resultadoCrivo resultado de avaliarCrivoExecucaoPop_
 * @returns {{ bloqueadoresEnderecados: string[] }}
 */
function geradorRepararBloqueadoresCrivoFase4_(conteudoObj, contexto, resultadoCrivo) {
  var cj = conteudoObj || {};
  var cx = contexto || {};
  var bagPE = iaBagNorm_(String(cx.processo || '') + ' ' + String(cx.situacao || '') + ' ' + String(cx.erro || ''));
  var fix = {};
  var bl = (resultadoCrivo && resultadoCrivo.bloqueadores) || [];
  for (var h = 0; h < bl.length; h++) {
    var cod = bl[h] && bl[h].codigo ? String(bl[h].codigo) : '';
    if (cod) fix[cod] = true;
  }

  var OBJ_BALCAO_NEC_ =
    'Garantir que o atendente entenda a necessidade do cliente antes de sugerir produto, reduzindo indicação inadequada e aumentando a segurança do atendimento no balcão.';
  var OBJ_FALLBACK_ =
    'Garantir execução segura e alinhada ao processo no piso, com passos claros e verificáveis para reduzir risco ao cliente e à operação.';

  if (fix.objetivo_contaminado_briefing) {
    if (bagPE.indexOf('balc') >= 0 && (bagPE.indexOf('necess') >= 0 || bagPE.indexOf('suger') >= 0 || bagPE.indexOf('dúv') >= 0 || bagPE.indexOf('duv') >= 0)) {
      cj.objetivo = OBJ_BALCAO_NEC_;
    } else {
      cj.objetivo = OBJ_FALLBACK_;
    }
  }

  if (fix.erros_comuns_insuficientes) {
    cj.errosComuns = [
      'Sugerir produto antes de perguntar a necessidade do cliente',
      'Assumir o problema do cliente sem confirmar a dúvida',
      'Encerrar o atendimento sem explicar o próximo passo',
    ];
  }

  if (fix.como_fazer_bem_insuficiente || fix.humanizacao_abstrata) {
    cj.como_fazer_bem = [
      'Olhar para o cliente ao iniciar a fala',
      'Perguntar a necessidade principal antes de sugerir qualquer produto',
      'Ouvir a explicação do cliente sem interromper',
      'Confirmar o entendimento da dúvida em frase curta',
      'Adaptar a pergunta à pressa, dor ou dúvida percebida',
      'Evitar que o cliente repita a mesma informação',
      'Encerrar informando o próximo passo com clareza',
      'Encaminhar ao farmacêutico quando houver dúvida técnica, receita, risco ou insegurança',
    ].join(' · ');
  }

  var end = Object.keys(fix);
  return { bloqueadoresEnderecados: end };
}

/**
 * Integração Fase 4 após normalize no gerador IA: enriquecimento, itens, validação, crivo, score.
 * @returns {{ ok: boolean, crivo: Object, score_conceito: Object, matriz: Object, preview_bloqueado_publicacao: boolean, message: string }}
 */
function geradorIntegrarFase4PosNormalizacao_(user, requestId, normalized, contract, processoIn, situacaoIn, erroIn, linhaServ) {
  void user;
  void requestId;
  void linhaServ;
  var out = {
    ok: true,
    crivo: null,
    score_conceito: null,
    matriz: null,
    preview_bloqueado_publicacao: false,
    message: '',
  };
  if (!normalized || typeof normalized !== 'object') {
    out.ok = false;
    out.message = 'Payload inválido para Fase 4';
    return out;
  }
  var tPopF4 = normalizeTipoPop_(normalized.tipo);
  if (tPopF4 !== 'colaborativo' && tPopF4 !== 'critico') {
    return out;
  }
  var cj = normalized.conteudoJson || {};
  geradorEnriquecerConteudoColaborativoMinimoCrivo_(cj, contract, situacaoIn, erroIn);
  normalized.conteudoJson = cj;

  var matriz = geradorMapearMatrizConceito_({
    processo: processoIn,
    situacao: situacaoIn,
    erro: erroIn,
    area: normalized.area,
    linhaPop: linhaServ,
    conteudoGerado: cj,
  });
  out.matriz = matriz;
  cj.fase4_matriz_mapeamento = matriz;

  var itens = geradorConstruirItensAvaliaveisDaMatriz_(normalized, matriz);
  cj.itens_avaliaveis = itens;

  var val = geradorValidarCamposEssenciaisFase4_(normalized);
  if (!val.ok) {
    out.ok = false;
    out.message = val.erros.join(' | ');
    return out;
  }

  var crivo = avaliarCrivoExecucaoPop_(normalized);
  if (crivo.status_crivo === 'reprovado_no_crivo' && geradorCrivoApenasBloqReparoF4_(crivo.bloqueadores)) {
    var repF4 = geradorRepararBloqueadoresCrivoFase4_(
      cj,
      { processo: processoIn, situacao: situacaoIn, erro: erroIn },
      crivo,
    );
    cj.fase4_reparo_crivo = true;
    cj.fase4_reparo_crivo_bloqueadores = repF4.bloqueadoresEnderecados || [];
    crivo = avaliarCrivoExecucaoPop_(normalized);
  } else if (!cj.fase4_reparo_crivo) {
    cj.fase4_reparo_crivo = false;
  }

  out.crivo = crivo;
  geradorAplicarMetadadosCrivoNoConteudo_(cj, crivo);
  out.preview_bloqueado_publicacao =
    crivo.status_crivo === 'reprovado_no_crivo' || crivo.status_crivo === 'aprovado_com_ajuste';

  var scoreC = calcularScoreExecucaoConceito_(itens);
  out.score_conceito = scoreC;
  cj.fase4_score_conceito = scoreC;

  if (crivo.status_crivo === 'reprovado_no_crivo') {
    out.ok = false;
    out.message = String(crivo.resumo || 'Reprovado no crivo de execução.');
    return out;
  }
  if (crivo.status_crivo === 'aprovado_com_ajuste') {
    cj.crivo_preview_apenas = true;
    out.message = 'Aprovado com ajustes: rever alertas antes de publicar.';
  }
  return out;
}

/**
 * Self-test: normalização pós-patch de métrica + regra `metrica_fraca` (sem OpenAI).
 * @returns {{ ok: boolean, caso106: boolean, vaga: boolean, boa: boolean, regressao_global: boolean }}
 */
function iaMotorSelfTestQaMetricaPosPatchFase4_() {
  var p = 'atendimento no balcão';
  var s = 'cliente chega com dúvida';
  var e = 'atendente sugere produto sem entender a necessidade';
  var contract1 = {
    controle: {
      criterio_sucesso: '90% dos atendimentos devem ser satisfatórios em um período de 30 dias',
    },
    execucao: { tempo: 'imediato', frequencia: 'a cada dúvida' },
  };
  var merged1 = {
    tipo: 'colaborativo',
    procedimento: ['Cumprimentar o cliente no balcão', 'Perguntar a necessidade completa antes de sugerir produto'],
    como_fazer_bem:
      'Perguntar em voz alta a necessidade no balcão antes de apontar produto na gôndola e confirmar a leitura do rótulo',
    erro_critico: 'Sugerir medicamento de prateleira no balcão sem ouvir a dúvida do cliente do início ao fim do pedido',
    metrica: 'Número de atendimentos corretos em relação ao total de atendimentos realizados',
    criterio_sucesso: '90% dos atendimentos devem ser satisfatórios em um período de 30 dias',
  };
  iaMotorNormalizarMetricaOperacional_(merged1, { contract: contract1, processo: p, situacao: s, erro: e, linhaPop: 'critico' });
  iaMotorSincronizarContratoComIncoming_(contract1, merged1);
  var f1 = iaMotorQaChecklistIncoming_(merged1, contract1);
  var ok1 =
    !f1.some(function (x) { return x && x.codigo === 'metrica_fraca'; }) && iaMotorQaMetricaOperacionalOk_(merged1.metrica);

  var contract2 = { controle: { criterio_sucesso: 'Em 30 dias, 90% dos atendimentos com checklist de balcão concluída' }, execucao: { tempo: '1', frequencia: '1' } };
  var merged2 = {
    tipo: 'colaborativo',
    procedimento: ['Cumprimentar o visitante de forma clara', 'Confirmar a dúvida do cliente no balcão hoje'],
    como_fazer_bem: 'Olhar o cliente, perguntar a necessidade no balcão e só depois apontar artigo de prateleira visível',
    erro_critico: 'Sugerir medicamento de prateleira sem confirmar a queixa do cliente no atendimento hoje no balcão',
    metrica: 'qualidade do atendimento',
    criterio_sucesso: 'Em 30 dias, 90% dos atendimentos com checklist de balcão concluída',
  };
  iaMotorNormalizarMetricaOperacional_(merged2, { contract: contract2, processo: p, situacao: s, erro: e, linhaPop: 'critico' });
  var f2 = iaMotorQaChecklistIncoming_(merged2, contract2);
  var ok2 = f2.some(function (x) { return x && x.codigo === 'metrica_fraca'; });

  var contract3 = { controle: { criterio_sucesso: '90% por auditoria mensal no balcão' }, execucao: { tempo: '1', frequencia: '1' } };
  var merged3 = {
    tipo: 'colaborativo',
    procedimento: ['Cumprimentar o visitante de forma clara', 'Perguntar a necessidade antes de sugerir item'],
    como_fazer_bem: 'Fazer contato visual no balcão e registrar a dúvida do cliente no sistema em cada atendimento',
    erro_critico: 'Sugerir produto de prateleira no balcão sem registrar a dúvida do cliente com data e turno hoje',
    metrica: 'Percentual semanal de atendimentos no balcão com pergunta de necessidade antes da sugestão de produto',
    criterio_sucesso: '90% por auditoria mensal no balcão',
  };
  var f3 = iaMotorQaChecklistIncoming_(merged3, contract3);
  var ok3 = !f3.some(function (x) { return x && x.codigo === 'metrica_fraca'; });

  var r4 = fase4SelfTestGeradorMatrizCrivoScore_();
  var rC = crivoSelfTestExecucaoPop_();
  var rS = scoreSelfTestConceito_();
  var reg = r4.ok && rC.ok && rS.ok;

  return {
    ok: ok1 && ok2 && ok3 && reg,
    caso106: ok1,
    vaga: ok2,
    boa: ok3,
    regressao_global: reg,
  };
}

/**
 * Self-test: QA `acao_observavel` no POP crítico (verbos operacionais + campos; bloqueia frases vagas conhecidas).
 * @returns {{ ok: boolean, novos_verbos: boolean, tradicional: boolean, vago: boolean, caso108: boolean, caso109: boolean, diagnostico_falha_ok: boolean, regressao: boolean }}
 */
function iaMotorSelfTestQaAcaoObservavelCritico_() {
  var contractB = { execucao: { tempo: 'imediato', frequencia: 'a cada ocorrência' }, controle: { criterio_sucesso: '90% em 30 dias com auditoria quinzenal' } };
  var mergedB = {
    metrica: 'Percentual semanal de atendimentos com checklist no balcão (80% em 30 dias com auditoria)',
    criterio_sucesso: '90% em 30 dias com auditoria quinzenal',
    como_fazer_bem:
      'Perguntar a necessidade no balcão antes de sugerir produto, olhar o cliente, registrar a dúvida com data e turno, confirmar o pedido e encaminhar ao farmacêutico quando a dúvida for clínica',
    erro_critico:
      'Sugerir medicamento de prateleira sem consultar a queixa e sem chamar o farmacêutico no atendimento de hoje no piso, na fila e no caixa com cliente aguardando muito tempo no horário de pico',
  };

  var procA = [
    { itemId: 'A', acao: 'Entender a necessidade do cliente antes de sugerir produto', descricao: 'Entender a necessidade do cliente antes de sugerir produto' },
    { itemId: 'B', acao: 'Esclarecer a dúvida principal do cliente', descricao: 'Esclarecer a dúvida principal do cliente' },
    { itemId: 'C', acao: 'Solicitar informação complementar quando necessário', descricao: 'Solicitar informação complementar quando necessário' },
  ];
  var fa = iaMotorQaChecklistIncoming_(Object.assign({ tipo: 'critico', procedimento: procA }, mergedB), contractB);
  var okNovos = !fa.some(function (x) { return x.codigo === 'acao_observavel'; });

  var procT = [
    { itemId: 'T1', acao: 'Perguntar a necessidade do cliente', descricao: 'Perguntar a necessidade do cliente' },
    { itemId: 'T2', acao: 'Confirmar o entendimento com frase curta', descricao: 'Confirmar o entendimento com frase curta' },
    { itemId: 'T3', acao: 'Encaminhar ao farmacêutico quando a dúvida for técnica', descricao: 'Encaminhar ao farmacêutico quando a dúvida for técnica' },
  ];
  var ft = iaMotorQaChecklistIncoming_(Object.assign({ tipo: 'critico', procedimento: procT }, mergedB), contractB);
  var okTr = !ft.some(function (x) { return x.codigo === 'acao_observavel'; });

  var proc109 = [
    { itemId: 'S1', acao: 'Saudar o cliente no balcão', descricao: 'Saudar o cliente no balcão' },
    { itemId: 'S2', acao: 'Ouvir a dúvida do cliente', descricao: 'Ouvir a dúvida do cliente' },
    { itemId: 'S3', acao: 'Consultar o histórico e verificar produtos disponíveis', descricao: 'Consultar o histórico e verificar produtos disponíveis' },
    { itemId: 'S4', acao: 'Sugerir produtos que atendam à necessidade informada', descricao: 'Sugerir produtos que atendam à necessidade informada' },
    { itemId: 'S5', acao: 'Acompanhar o cliente até finalizar o atendimento', descricao: 'Acompanhar o cliente até finalizar o atendimento' },
  ];
  var f109 = iaMotorQaChecklistIncoming_(Object.assign({ tipo: 'critico', procedimento: proc109 }, mergedB), contractB);
  var ok109 = !f109.some(function (x) { return x.codigo === 'acao_observavel'; });
  var okLexSaudSugCon =
    iaMotorTemVerboAcao_('Saudar o cliente no balcão') && iaMotorTemVerboAcao_('Sugerir produtos') && iaMotorTemVerboAcao_('Consultar o histórico e verificar');

  var procV = [
    { itemId: 'V1', acao: 'Atendimento adequado e cordial com atenção mínima', descricao: 'Atendimento adequado e cordial com atenção mínima' },
    { itemId: 'V2', acao: 'Agir com atenção geral e postura mínima', descricao: 'Agir com atenção geral e postura mínima' },
    { itemId: 'V3', acao: 'Melhorar postura e reforçar o atendimento geral hoje e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e sempre e always e always e always e always' },
  ];
  var fv = iaMotorQaChecklistIncoming_(Object.assign({ tipo: 'critico', procedimento: procV }, mergedB), contractB);
  var okVago = fv.some(function (x) { return x.codigo === 'acao_observavel'; });
  var falV = fv.filter(function (x) { return x && x.codigo === 'acao_observavel'; })[0];
  var okDiagFalha = !!(falV && Array.isArray(falV.diagnostico_itens) && falV.diagnostico_itens.length === 3 && falV.criterio_maioria);

  var contr108 = {
    titulo: 'POP @108',
    area: 'Atendimento e vendas',
    processo: 'atendimento no balcão',
    execucao: {
      o_que_fazer: [
        'Entender a necessidade do cliente antes de sugerir produto no balcão',
        'Esclarecer a dúvida principal do cliente com clareza e voz audível no ponto de venda',
        'Solicitar informação complementar quando a dúvida ainda for ambígua no ponto de venda e no caixa',
      ],
      tempo: 'imediato',
      frequencia: 'a cada ocorrência',
    },
    controle: {
      metrica: 'Meta 80% com auditoria quinzenal de balcão em 30 dias consecutivos',
      criterio_sucesso: '90% com auditoria quinzenal de balcão em 30 dias consecutivos',
      erros_graves: ['Sugerir produto sem entender a necessidade completa do cliente no balcão.'],
    },
    abordagem: {},
    contexto: { quando_aplicar: 'Cliente com dúvida no ponto de venda' },
  };
  var merge108 = mapContratoIaConceitoToIncoming_(
    {},
    contr108,
    'critico',
    'cliente chega com dúvida',
    'atendente sugere produto sem entender a necessidade',
  );
  merge108.como_fazer_bem = mergedB.como_fazer_bem;
  merge108.erro_critico = mergedB.erro_critico;
  var c108q = { execucao: contr108.execucao, controle: contr108.controle, abordagem: {} };
  var f108 = iaMotorQaChecklistIncoming_(merge108, c108q);
  var ok108 = !f108.some(function (x) { return x.codigo === 'acao_observavel'; });

  var rQa = iaMotorSelfTestQaMetricaPosPatchFase4_();
  var r4 = fase4SelfTestGeradorMatrizCrivoScore_();
  var rC = crivoSelfTestExecucaoPop_();
  var rS = scoreSelfTestConceito_();
  var reg = rQa.ok && r4.ok && rC.ok && rS.ok;

  return {
    ok: okNovos && okTr && okVago && ok108 && ok109 && okLexSaudSugCon && okDiagFalha && reg,
    novos_verbos: okNovos,
    tradicional: okTr,
    vago: okVago,
    caso108: ok108,
    caso109: ok109,
    sm109_lex: okLexSaudSugCon,
    diagnostico_falha_ok: okDiagFalha,
    regressao: reg,
  };
}

/**
 * Reparo pós-crivo (1 passada) no fluxo Fase 4.
 * @returns {{ ok: boolean, caso107: boolean, casoRuim: boolean, regressao: boolean, det: Object }}
 */
function fase4SelfTestReparoCrivoPosGeracao_() {
  var ctx = {
    processo: 'atendimento no balcão',
    situacao: 'cliente chega com dúvida',
    erro: 'atendente sugere produto sem entender a necessidade',
  };
  var matB = geradorMapearMatrizConceito_({
    processo: ctx.processo,
    situacao: ctx.situacao,
    erro: ctx.erro,
    area: 'Atendimento e vendas',
    linhaPop: 'colaborativo',
    conteudoGerado: {},
  });

  var cj0 = {
    regra_de_ouro: 'Em dúvida clínica ou legal, chamar farmacêutico antes de concluir o atendimento.',
    procedimento: [
      'Cumprimentar e repetir em voz audível o pedido ou a dúvida no balcão',
      'Confirmar leitura da embalagem antes de explicar posologia de OTC',
      'Registar no sistema qualquer exceção ou reclamação com data e responsável',
    ],
    erro_critico: 'Sugerir produto sem ouvir a necessidade completa no balcão.',
    pontosDeAtencao: ['Fila no rush', 'Cliente idoso', 'SKU em falta na gôndola'],
    checklist_lider: ['Auditar 3 atendimentos por turno', 'Revisar registo de exceções', 'Confirmar leitura do POP na abertura'],
    checklist: [
      'Confirmar identidade do cliente antes de entregar medicamento controlado',
      'Ler em voz alta o pedido e apontar o passo do POP em execução',
      'Registar exceção com data, hora e nome do responsável no sistema',
      'Medir tempo de espera quando há fila e acenar quem chegou por último',
      'Chamar farmacêutico quando a dúvida exceder OTC ou houver risco clínico',
    ],
    treinamento: 'Roleplay de 10 min no balcão. Checklist de observação no piso com 3 itens sim/não.',
    desvios: [
      'Cliente sem identificação na retirada de controlado — recusar e chamar farmacêutico',
      'Fila sem reconhecimento de quem espera mais tempo — corrigir na hora e anotar',
      'Promessa de prazo sem verificação no sistema — cancelar promessa e informar cliente',
    ],
    metrica: 'Percentagem de atendimentos sem sugestão precoce (meta 90% por auditoria quinzenal)',
    itens_avaliaveis: [],
  };

  var popBom = {
    tipo: 'colaborativo',
    titulo: 'Reparo crivo @107',
    area: 'Atendimento e vendas',
    processo: 'Atendimento',
    conteudoJson: {},
  };
  cj0.objetivo = 'Contexto operacional: atendimento com cliente no balcão. Erro ou risco: sugestão de produto sem entender a necessidade.';
  cj0.errosComuns = ['Erro de fluxo rastreado sozinho'];
  cj0.como_fazer_bem = 'Acompanhar a sequência padrão do atendimento no ponto de venda com o cliente hoje no balcão';
  popBom.conteudoJson = cj0;
  var itPre = geradorConstruirItensAvaliaveisDaMatriz_(popBom, matB);
  popBom.conteudoJson.itens_avaliaveis = itPre;

  var c0 = avaliarCrivoExecucaoPop_(popBom);
  var tinhaFix =
    c0.status_crivo === 'reprovado_no_crivo' &&
    geradorCrivoApenasBloqReparoF4_(c0.bloqueadores) &&
    c0.bloqueadores &&
    c0.bloqueadores.some(function (b) { return b.codigo === 'objetivo_contaminado_briefing'; }) &&
    c0.bloqueadores.some(function (b) { return b.codigo === 'erros_comuns_insuficientes'; });

  var popA = JSON.parse(JSON.stringify(popBom));
  var integ = geradorIntegrarFase4PosNormalizacao_(
    { id: 'reparo_test' },
    'f4rep2',
    popA,
    {},
    ctx.processo,
    ctx.situacao,
    ctx.erro,
    'colaborativo',
  );
  var cA = integ.crivo;
  var cjF = popA.conteudoJson || {};
  var blCodes = (cA && cA.bloqueadores) || [];
  var semOsQuatro = !blCodes.some(function (b) {
    return b.codigo === 'objetivo_contaminado_briefing' || b.codigo === 'erros_comuns_insuficientes' || b.codigo === 'como_fazer_bem_insuficiente' || b.codigo === 'humanizacao_abstrata';
  });
  var okRua =
    integ.ok === true &&
    cA &&
    cA.status_crivo === 'aprovado_para_operacao' &&
    cjF.fase4_reparo_crivo === true &&
    Array.isArray(cjF.fase4_reparo_crivo_bloqueadores) &&
    cjF.fase4_reparo_crivo_bloqueadores.length >= 1 &&
    semOsQuatro;
  var objOk = String(cjF.objetivo || '').indexOf('Garantir que o atendente entenda a necessidade') >= 0;
  var errOk = (cjF.errosComuns || []).length >= 3;
  var comoN = crivoContarPartesPraticas_(String(cjF.como_fazer_bem || ''), 4);
  var humOk = crivoTextoTemHumanizacaoObservavel_(
    String(cjF.como_fazer_bem || '') + ' ' + String(cjF.objetivo || '') + ' ' + String(cjF.erro_critico || ''),
  );
  var caso107 =
    okRua && tinhaFix && objOk && errOk && comoN >= 4 && humOk;

  var mixNao = !geradorCrivoApenasBloqReparoF4_([
    { codigo: 'objetivo_contaminado_briefing' },
    { codigo: 'item_avaliavel_generico' },
  ]);
  var cjLivre = {
    objetivo:
      'Garantir atendimento seguro no balcão com escuta ativa e registo de exceções quando o cliente relatar sintoma ou pedir orientação fora do perfil OTC.',
    regra_de_ouro: 'Em dúvida clínica ou legal, chamar farmacêutico antes de concluir o atendimento.',
    procedimento: cj0.procedimento.slice(),
    como_fazer_bem:
      'Olhar para o cliente ao falar · Perguntar antes de sugerir produto · Confirmar se entendeu o próximo passo · Encerrar dizendo o que vai acontecer a seguir',
    erro_critico: cj0.erro_critico,
    errosComuns: ['Prometer prazo sem consultar sistema', 'Ignorar fila sem aceno', 'Dispensar sem conferir identidade'],
    pontosDeAtencao: cj0.pontosDeAtencao.slice(),
    checklist_lider: cj0.checklist_lider.slice(),
    checklist: cj0.checklist.slice(),
    treinamento: cj0.treinamento,
    desvios: cj0.desvios.slice(),
    metrica: cj0.metrica,
    itens_avaliaveis: [
      {
        codigo: 'ATD-001',
        comportamento: 'Executar a etapa operacional padrão no balcão de forma geral e adequada e repetível',
        criterio_aprovacao: 'Execução conforme descrição da etapa e observável no ponto de venda com detalhamento mínimo',
        criterio_reprovacao: 'Não cumpre o padrão mínimo descrito de forma inaceitável no piso hoje no balcão com registo',
      },
    ],
  };
  var popLivre = { tipo: 'colaborativo', titulo: 'Item gen', area: 'Atendimento e vendas', processo: 'Atendimento', conteudoJson: cjLivre };
  var crivLivre = avaliarCrivoExecucaoPop_(popLivre);
  var casoRuim = mixNao && crivLivre.bloqueadores.some(function (b) { return b.codigo === 'item_avaliavel_generico'; });

  var rQa = iaMotorSelfTestQaMetricaPosPatchFase4_();
  var rAc = iaMotorSelfTestQaAcaoObservavelCritico_();
  var rF4 = fase4SelfTestGeradorMatrizCrivoScore_();
  var rCr = crivoSelfTestExecucaoPop_();
  var rSc = scoreSelfTestConceito_();
  var reg = rQa.ok && rAc.ok && rF4.ok && rCr.ok && rSc.ok;

  return {
    ok: caso107 && casoRuim && reg,
    caso107: caso107,
    casoRuim: casoRuim,
    regressao: reg,
    det: { tinha_somente_reparo: tinhaFix, crivo_apos: cA && cA.status_crivo, bloqueadores_apos: blCodes },
  };
}

/**
 * Self-test Fase 4 (sem OpenAI): matriz, itens, crivo, campos, score, rastreio e enums.
 */
function fase4SelfTestGeradorMatrizCrivoScore_() {
  var casos = [];
  var ctxAt = {
    processo: 'atendimento no balcão',
    situacao: 'cliente chega com dúvida',
    erro: 'atendente sugere produto sem entender a necessidade',
  };

  var mat1 = geradorMapearMatrizConceito_({
    processo: ctxAt.processo,
    situacao: ctxAt.situacao,
    erro: ctxAt.erro,
    area: 'Atendimento e vendas',
    linhaPop: 'colaborativo',
    conteudoGerado: {},
  });
  var okMat1 =
    (mat1.codigos_matriz_mae || []).indexOf('ATD-001') >= 0 &&
    (mat1.dominio || '').indexOf('atend') >= 0 &&
    (mat1.padroes_relacionados || []).some(function (p) { return String(p).indexOf('ATD') >= 0; }) &&
    fase4CodigosSoFamilia_(mat1, 'ATD-');

  var pop1 = {
    tipo: 'colaborativo',
    titulo: 'Teste F4 balcão',
    area: 'Atendimento e vendas',
    processo: 'Atendimento',
    conteudoJson: {
      objetivo:
        'Garantir atendimento seguro no balcão com escuta ativa e registo de exceções quando o cliente relatar sintoma ou pedir orientação fora do perfil OTC.',
      regra_de_ouro: 'Em dúvida clínica ou legal, chamar farmacêutico antes de concluir o atendimento.',
      procedimento: [
        'Cumprimentar e repetir em voz audível o pedido ou a dúvida no balcão',
        'Confirmar leitura da embalagem antes de explicar posologia de OTC',
        'Registar no sistema qualquer exceção ou reclamação com data e responsável',
      ],
      como_fazer_bem:
        'Olhar para o cliente ao falar · Perguntar antes de sugerir produto · Confirmar se entendeu o próximo passo · Encerrar dizendo o que vai acontecer a seguir',
      erro_critico: 'Sugerir produto sem ouvir a necessidade completa no balcão.',
      errosComuns: ['Prometer prazo sem consultar sistema', 'Ignorar fila sem aceno', 'Dispensar sem conferir identidade'],
      pontosDeAtencao: ['Fila no rush', 'Cliente idoso', 'SKU em falta na gôndola'],
      checklist_lider: ['Auditar 3 atendimentos por turno', 'Revisar registo de exceções', 'Confirmar leitura do POP na abertura'],
      checklist: [
        'Confirmar identidade do cliente antes de entregar medicamento controlado',
        'Ler em voz alta o pedido e apontar o passo do POP em execução',
        'Registar exceção com data, hora e nome do responsável no sistema',
        'Medir tempo de espera quando há fila e acenar quem chegou por último',
        'Chamar farmacêutico quando a dúvida exceder OTC ou houver risco clínico',
      ],
      treinamento: 'Roleplay de 10 min no balcão. Checklist de observação no piso com 3 itens sim/não.',
      desvios: [
        'Cliente sem identificação na retirada de controlado — recusar e chamar farmacêutico',
        'Fila sem reconhecimento de quem espera mais tempo — corrigir na hora e anotar',
        'Promessa de prazo sem verificação no sistema — cancelar promessa e informar cliente',
      ],
      metrica: 'Percentagem de atendimentos sem sugestão precoce (meta 90% por auditoria quinzenal)',
    },
  };
  var itens1 = geradorConstruirItensAvaliaveisDaMatriz_(pop1, mat1);
  pop1.conteudoJson.itens_avaliaveis = itens1;
  var crivo1 = avaliarCrivoExecucaoPop_(pop1);
  var score1 = calcularScoreExecucaoConceito_(itens1);
  var morto1 = geradorValidarCamposEssenciaisFase4_(pop1);
  var okTraceEnums = fase4ValidarItensRastreioMatrizEEnums_(itens1, mat1);
  var ok1 =
    okMat1 &&
    itens1.length >= 2 &&
    itens1.every(function (it) { return String((it && it.codigo) || '').indexOf('ATD-') === 0; }) &&
    morto1.ok &&
    crivo1.status_crivo === 'aprovado_para_operacao' &&
    score1 &&
    score1.score_por_dimensao != null &&
    okTraceEnums;

  casos.push({
    id: 1,
    nome: 'colaborativo — balcão ATD, crivo, score, rastreio',
    ok: ok1,
    det: { matriz: mat1.familia_prioritaria, crivo: crivo1.status_crivo, cod: mat1.codigos_matriz_mae },
  });

  var pop4 = JSON.parse(JSON.stringify(pop1));
  pop4.tipo = 'critico';
  pop4.criticidade = 'alta';
  var f4c = geradorIntegrarFase4PosNormalizacao_(
    { id: 'selftest' },
    'f4st',
    pop4,
    {},
    ctxAt.processo,
    ctxAt.situacao,
    ctxAt.erro,
    'critico',
  );
  var ok4 =
    f4c.ok === true &&
    f4c.crivo != null &&
    f4c.score_conceito != null &&
    pop4.conteudoJson.fase4_score_conceito != null &&
    geradorValidarCamposEssenciaisFase4_(pop4).ok &&
    f4c.matriz != null &&
    fase4CodigosSoFamilia_(f4c.matriz, 'ATD-');

  casos.push({
    id: 2,
    nome: 'crítico — integração Fase 4 (matriz, crivo, score)',
    ok: ok4,
    det: { status: f4c.crivo && f4c.crivo.status_crivo, familia: f4c.matriz && f4c.matriz.familia_prioritaria },
  });

  var mat2 = geradorMapearMatrizConceito_({
    processo: 'organização do salão',
    situacao: 'corredor com caixa bloqueando passagem',
    erro: 'cliente não consegue circular',
    area: 'Loja e operação diária',
    linhaPop: 'colaborativo',
    conteudoGerado: {},
  });
  var okMat2 =
    (mat2.familia_prioritaria === 'EST' || (mat2.codigos_matriz_mae || []).indexOf('EST-001') >= 0) &&
    fase4CodigosSoFamilia_(mat2, 'EST-');
  var pop2 = JSON.parse(JSON.stringify(pop1));
  pop2.conteudoJson.objetivo =
    'Manter circulação segura no salão com passagens livres e sinalização adequada para o cliente.';
  pop2.conteudoJson.erro_critico = 'Deixar caixa ou palete obstruindo passagem sem sinalização.';
  var itens2 = geradorConstruirItensAvaliaveisDaMatriz_(pop2, mat2);
  itens2[1].resultado = 'nao';
  var score2 = calcularScoreExecucaoConceito_(itens2);
  var ok2 =
    okMat2 &&
    fase4CodigosSoFamilia_(mat2, 'EST-') &&
    itens2.every(function (it) { return String((it && it.codigo) || '').indexOf('EST-') === 0; }) &&
    score2.falha_critica === true &&
    fase4ValidarItensRastreioMatrizEEnums_(itens2, mat2);

  casos.push({
    id: 3,
    nome: 'estrutura — EST, falha crítica, rastreio',
    ok: ok2,
    det: { familia: mat2.familia_prioritaria, falha_critica: score2.falha_critica, cod: mat2.codigos_matriz_mae },
  });

  var pop3 = JSON.parse(JSON.stringify(pop1));
  pop3.conteudoJson.objetivo = 'Situação: teste. Erro ou risco: x. Contexto operacional: y';
  pop3.conteudoJson.checklist = ['a', 'b'];
  var crivo3 = avaliarCrivoExecucaoPop_(pop3);
  var ok3 = crivo3.status_crivo === 'reprovado_no_crivo' && (crivo3.bloqueadores || []).length >= 1;

  casos.push({ id: 4, nome: 'caso ruim — crivo reprova', ok: ok3, det: { n: (crivo3.bloqueadores || []).length } });

  var ok5 = okTraceEnums;
  casos.push({ id: 5, nome: 'códigos e codigo_matriz_mae rastreáveis', ok: ok5, det: {} });

  var ok6 = itens1.every(function (it) {
    return fase4ItemEnumCamposOficiaisValidos_(it);
  });
  casos.push({ id: 6, nome: 'enums oficiais tipo/canal/aplicabilidade', ok: ok6, det: {} });

  var regOk = scoreSelfTestConceito_().ok && crivoSelfTestExecucaoPop_().ok;

  return { ok: casos.every(function (c) { return c.ok; }) && regOk, casos: casos, regressao_global: regOk };
}

/**
 * Executar no editor Apps Script: valida que os casos conhecidos normalizam para "nao informado".
 * @returns {{ ok: boolean, detalhes: Array<{entrada: string, normalizado: string, esperado: string, pass: boolean}> }}
 */
function popSelfTestPlaceholderNormalizacao_() {
  var samples = [
    'Não informado',
    'nao informado',
    'NÃO INFORMADO',
    'Não   informado',
    'não-informado',
    'Não\u00A0informado',
    'N?o informado',
    'N?O INFORMADO',
    'N?o   informado',
    'N?o-informado',
  ];
  var want = 'nao informado';
  var detalhes = [];
  var ok = true;
  for (var i = 0; i < samples.length; i++) {
    var k = popNormTextoPlaceholder_(samples[i]);
    var pass = k === want;
    if (!pass) ok = false;
    detalhes.push({ entrada: samples[i], normalizado: k, esperado: want, pass: pass });
  }
  var samplesSeAplica = ['N?o se aplica', 'n?o se aplica', 'N?o   se aplica'];
  var wantSa = 'nao se aplica';
  for (var j = 0; j < samplesSeAplica.length; j++) {
    var ks = popNormTextoPlaceholder_(samplesSeAplica[j]);
    var passS = ks === wantSa && popEsNaoInformadoLiteral_(samplesSeAplica[j]);
    if (!passS) ok = false;
    detalhes.push({
      entrada: samplesSeAplica[j],
      normalizado: ks,
      esperado: wantSa,
      pass: passS,
    });
  }
  return { ok: ok, detalhes: detalhes };
}

/** Texto coerente para validação de publicação (objeto/lista → string legível para popEsNaoInformadoLiteral_). */
function popTextoCampoPublicacao_(v) {
  if (v == null) return '';
  if (typeof v === 'object' && !Array.isArray(v)) return normalizeText_(stringifyMixedContentItem_(v));
  if (Array.isArray(v)) return normalizeText_(normalizeStringArray_(v).join(' '));
  return normalizeText_(String(v));
}

/** Se `primary` não tem texto útil após coerção, usa `fallback` (ex.: como_fazer_bem vazio + comoFazerBem preenchido). */
function popJsonCampoTextoOuAlternativo_(primary, fallback) {
  if (primary !== undefined && primary !== null && popTextoCampoPublicacao_(primary) !== '') return primary;
  return fallback;
}

/**
 * Chave de conteúdo JSON normalizada para casar variantes (BOM, camel/snake, espaços, hífens).
 * Usado só em publicação/diagnóstico — não altera dados persistidos.
 */
function popNormalizarChaveConteudoJson_(k) {
  var s = String(k == null ? '' : k).replace(/^\uFEFF+/g, '');
  s = popRemoverDiacriticosLatinos_(s.toLowerCase());
  return s.replace(/[\s_\-]/g, '');
}

function popListarParesChaveValorPorSlug_(cj, slugNorm) {
  var out = [];
  var keys = Object.keys(cj || {});
  for (var i = 0; i < keys.length; i++) {
    var rawKey = keys[i];
    if (popNormalizarChaveConteudoJson_(rawKey) === slugNorm) {
      out.push({ k: rawKey, v: cj[rawKey] });
    }
  }
  return out;
}

function popOrdenarParesPreferindoChavesCanonicas_(pares, snakePrefer, camelPrefer) {
  return pares.slice().sort(function (a, b) {
    function rank(k) {
      if (k === snakePrefer) return 0;
      if (k === camelPrefer) return 1;
      return 2;
    }
    var ra = rank(a.k);
    var rb = rank(b.k);
    if (ra !== rb) return ra - rb;
    return String(a.k).localeCompare(String(b.k), 'pt');
  });
}

function popPrimeiroTextoUtilConteudo_(pares) {
  for (var i = 0; i < pares.length; i++) {
    var t = popTextoCampoPublicacao_(pares[i].v);
    if (t) return t;
  }
  return '';
}

function popAlgumCandidatoPlaceholderConteudo_(pares) {
  for (var i = 0; i < pares.length; i++) {
    var t = popTextoCampoPublicacao_(pares[i].v);
    if (!t) continue;
    if (popEsNaoInformadoLiteral_(t)) return true;
  }
  return false;
}

/**
 * Fonte: `pop.conteudoObj` (= JSON.parse(conteudoJson) em normalizePopRow_).
 * Agrega snake/camel e qualquer chave cujo slug case-insensitive coincide (ex.: chave com BOM).
 */
function popExtrairComoErroCriticoParaPublicacao_(cj) {
  cj = cj && typeof cj === 'object' ? cj : {};
  var paresComo = popOrdenarParesPreferindoChavesCanonicas_(
    popListarParesChaveValorPorSlug_(cj, 'comofazerbem'),
    'como_fazer_bem',
    'comoFazerBem'
  );
  var paresErro = popOrdenarParesPreferindoChavesCanonicas_(
    popListarParesChaveValorPorSlug_(cj, 'errocritico'),
    'erro_critico',
    'erroCritico'
  );
  return {
    comoTexto: popPrimeiroTextoUtilConteudo_(paresComo),
    erroTexto: popPrimeiroTextoUtilConteudo_(paresErro),
    temPlaceholderComo: popAlgumCandidatoPlaceholderConteudo_(paresComo),
    temPlaceholderErro: popAlgumCandidatoPlaceholderConteudo_(paresErro),
  };
}

/** Só publicação: não chama heurística leve se qualquer texto já for placeholder (evita “abstrato” falso). */
function iaMotorValidarComoFazerErroCriticoLevePublicacao_(comoTxt, erroTxt) {
  if (popEsNaoInformadoLiteral_(comoTxt) || popEsNaoInformadoLiteral_(erroTxt)) return '';
  return iaMotorValidarComoFazerErroCriticoLeve_(comoTxt, erroTxt);
}

function popCampoEssencialPlaceholderSomente_(erros, nomeCampo, valor) {
  var t = popTextoCampoPublicacao_(valor);
  if (!t) return;
  if (popEsNaoInformadoLiteral_(t)) erros.push('campo essencial com placeholder inválido: ' + nomeCampo);
}

function popCampoEssencialPlaceholderLista_(erros, nomeCampo, arr) {
  var list = normalizeStringArray_(arr || []);
  for (var i = 0; i < list.length; i++) {
    if (popEsNaoInformadoLiteral_(list[i])) {
      erros.push('campo essencial com placeholder inválido: ' + nomeCampo);
      return;
    }
  }
}

function popThrowValidacaoPublicacao_(erros) {
  if (!erros || !erros.length) return;
  var msg = 'Publicação bloqueada: ' + erros.join(' · ');
  var e = new Error(msg);
  e.popValidacaoErros = erros;
  throw e;
}

/** Igual a validatePopCritico_, mas devolve lista (e aplica frequência canónica no JSON). */
function validatePopCriticoListaErros_(normalized) {
  var out = [];
  if (normalizeTipoPop_(normalized.tipo) !== 'critico') return out;
  var cj = normalized.conteudoJson || {};
  var fq = normalizeFrequenciaCritico_(cj.frequencia || '');
  if (!fq) {
    out.push('frequência inválida ou ausente (use diário, semanal ou por demanda)');
    return out;
  }
  normalized.conteudoJson.frequencia = fq;
  var proc = normalized.conteudoJson.procedimento;
  if (!Array.isArray(proc) || proc.length < POP_PUBLISH_MIN_PROC_CRITICO_) {
    out.push('procedimento insuficiente (mínimo ' + POP_PUBLISH_MIN_PROC_CRITICO_ + ' itens avaliáveis)');
    return out;
  }
  var seen = {};
  for (var i = 0; i < proc.length; i++) {
    var it = proc[i];
    if (!it || typeof it !== 'object') {
      out.push('procedimento: item ' + (i + 1) + ' inválido (objeto esperado)');
      continue;
    }
    var id = String(it.itemId || '').trim();
    if (!id) out.push('procedimento: item sem itemId');
    else if (seen[id]) out.push('itemId duplicado no procedimento: ' + id);
    else seen[id] = true;
    if (!String(it.etapa || '').trim()) out.push('POP crítico: etapa obrigatória no item ' + (id || String(i + 1)));
    if (!String(it.acao || '').trim()) out.push('POP crítico: ação obrigatória no item ' + (id || String(i + 1)));
    var crit = String(it.criterioAvaliacao || '').trim();
    if (!crit) out.push('POP crítico: critério de avaliação obrigatório no item ' + (id || String(i + 1)));
    else {
      if (crit.length < 14) out.push('criterio_avaliacao vago ou curto no item ' + (id || String(i + 1)));
      if (iaMotorContemFraseBanidaLeve_(crit)) out.push('criterio_avaliacao abstrato no item ' + (id || String(i + 1)));
      var critOk =
        /\b(%|\b\d+\b|zero|nenhum|checklist|binario|sim\/nao|sim\/não|confirmar|contar|registrar|medir|prazo|minutos|minuto|horas|hora|dias|dia|semana|semanal|diario|diário)\b/.test(iaBagNorm_(crit));
      if (!critOk) out.push('criterio_avaliacao não auditável (sem indício mensurável) no item ' + (id || String(i + 1)));
    }
    if (String(it.tipoAvaliacao || 'binario') !== 'binario') out.push('POP crítico: tipoAvaliacao deve ser binario no item ' + (id || String(i + 1)));
    var pe = String(it.peso != null ? it.peso : '').trim();
    if (!pe) out.push('POP crítico: peso obrigatório no item ' + (id || String(i + 1)));
    else if (isNaN(parseFloat(pe))) out.push('POP crítico: peso numérico inválido no item ' + (id || String(i + 1)));
    if (it.obrigatorio === undefined) out.push('POP crítico: campo obrigatorio obrigatório no item ' + (id || String(i + 1)));
    if (it.critico === undefined) out.push('POP crítico: campo critico obrigatório no item ' + (id || String(i + 1)));
    var acTxt = String(it.acao || it.descricao || '').trim();
    if (acTxt && !iaMotorTemVerboAcao_(acTxt)) out.push('acao sem verbo observável no item ' + (id || String(i + 1)));
  }
  return out;
}

function popCatalogoParAreaProcessoOk_(area, processo) {
  var cat = getProcessosCatalog_();
  var aBag = iaBagNorm_(area);
  var pBag = iaBagNorm_(processo);
  for (var i = 0; i < cat.length; i++) {
    if (iaBagNorm_(cat[i].area) === aBag && iaBagNorm_(cat[i].processo) === pBag) return { ok: true, area: cat[i].area, processo: cat[i].processo };
  }
  return { ok: false, area: area, processo: processo };
}

/**
 * Corrige o que for normalizável in-place (também em conteudoObj). Devolve true se alterou dados persistíveis.
 */
function popAplicarNormalizaveisPublicacao_(pop) {
  var mudou = false;
  if (!pop) return false;
  var t0 = normalizeText_(pop.titulo);
  if (t0 !== pop.titulo) {
    pop.titulo = t0;
    mudou = true;
  }
  pop.publicoAlvo = normalizePerfil_(pop.publicoAlvo || 'todos');
  pop.criticidade = normalizeCriticidade_(pop.criticidade || 'media');
  pop.tipo = normalizeTipoPop_(pop.tipo || 'colaborativo');
  var cj = pop.conteudoObj && typeof pop.conteudoObj === 'object' ? pop.conteudoObj : {};
  pop.conteudoObj = cj;

  var keys = Object.keys(cj);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var v = cj[key];
    if (typeof v === 'string') {
      var nt = normalizeText_(v);
      if (nt !== v) {
        cj[key] = nt;
        mudou = true;
      }
    }
  }

  var par = popCatalogoParAreaProcessoOk_(pop.area, pop.processo);
  if (par.ok) {
    if (pop.area !== par.area || pop.processo !== par.processo) {
      pop.area = par.area;
      pop.processo = par.processo;
      mudou = true;
    }
    if (cj.area !== par.area || cj.processo !== par.processo) {
      cj.area = par.area;
      cj.processo = par.processo;
      mudou = true;
    }
  }

  if (normalizeTipoPop_(pop.tipo) === 'critico') {
    var fq = normalizeFrequenciaCritico_(cj.frequencia || '');
    if (fq && fq !== cj.frequencia) {
      cj.frequencia = fq;
      mudou = true;
    }
  }

  return mudou;
}

function popTokensSignificativos_(s) {
  var stop = {
    de: 1,
    da: 1,
    do: 1,
    das: 1,
    dos: 1,
    e: 1,
    a: 1,
    o: 1,
    os: 1,
    as: 1,
    em: 1,
    no: 1,
    na: 1,
    nos: 1,
    nas: 1,
    para: 1,
    com: 1,
    por: 1,
    um: 1,
    uma: 1,
    que: 1,
    se: 1,
  };
  return iaBagNorm_(s)
    .split(/\s+/g)
    .filter(function (t) {
      return t.length > 2 && !stop[t];
    });
}

function popSimilaridadeBagOfWords_(a, b) {
  var A = popTokensSignificativos_(a);
  var B = popTokensSignificativos_(b);
  if (!A.length || !B.length) return 0;
  var setA = {};
  for (var i = 0; i < A.length; i++) setA[A[i]] = 1;
  var inter = 0;
  for (var j = 0; j < B.length; j++) {
    if (setA[B[j]]) inter++;
  }
  var uni = A.length + B.length - inter;
  return uni ? inter / uni : 0;
}

function popValidarChecklistPublicacao_(checklistArr) {
  var erros = [];
  var arr = normalizeStringArray_(checklistArr || []);
  var valid = [];
  for (var i = 0; i < arr.length; i++) {
    var raw = arr[i];
    if (popEsNaoInformadoLiteral_(raw)) {
      erros.push('checklist com item "Não informado"');
      continue;
    }
    var t = normalizeText_(raw);
    if (t) valid.push(t);
  }
  if (valid.length < POP_PUBLISH_MIN_CHECKLIST_) {
    erros.push('checklist insuficiente (' + valid.length + '/' + POP_PUBLISH_MIN_CHECKLIST_ + ')');
  }
  var seen = {};
  for (var a = 0; a < valid.length; a++) {
    var k = iaBagNorm_(valid[a]).replace(/\s+/g, ' ').trim();
    if (!k) continue;
    if (seen[k]) erros.push('repetição de itens no checklist');
    seen[k] = true;
  }
  for (var p = 0; p < valid.length; p++) {
    for (var q = p + 1; q < valid.length; q++) {
      if (popSimilaridadeBagOfWords_(valid[p], valid[q]) >= 0.82) {
        erros.push('checklist com variações superficiais do mesmo comportamento');
        break;
      }
    }
    if (erros.indexOf('checklist com variações superficiais do mesmo comportamento') >= 0) break;
  }
  if (valid.length >= POP_PUBLISH_MIN_CHECKLIST_) {
    var curtas = 0;
    for (var c = 0; c < valid.length; c++) {
      if (iaMotorContagemTokens_(valid[c]) <= 2) curtas++;
    }
    if (curtas >= 3) erros.push('preenchimento artificial no checklist (itens muito curtos)');
  }
  return erros;
}

function popObjetivoContaminadoOuFraco_(titulo, objetivo) {
  var o = normalizeText_(objetivo);
  if (!o) return 'objetivo ausente';
  if (o.length < POP_PUBLISH_MIN_OBJETIVO_LEN_) return 'objetivo insuficiente (menos de ' + POP_PUBLISH_MIN_OBJETIVO_LEN_ + ' caracteres)';
  var t = iaBagNorm_(titulo);
  var ob = iaBagNorm_(o);
  if (t && ob === t) return 'objetivo contaminado (igual ao título)';
  var wt = t.split(/\s+/).filter(function (x) {
    return x.length > 2;
  });
  var wo = ob.split(/\s+/).filter(function (x) {
    return x.length > 2;
  });
  if (wt.length && wo.length) {
    var set = {};
    for (var i = 0; i < wt.length; i++) set[wt[i]] = 1;
    var hit = 0;
    for (var j = 0; j < wo.length; j++) {
      if (set[wo[j]]) hit++;
    }
    if (hit / wo.length > 0.85 && o.length < 120) return 'objetivo contaminado (repete o título sem resultado mensurável)';
  }
  return '';
}

function popValidacaoConteudoBloqueantePublicacao_(pop) {
  var erros = [];
  var tipo = normalizeTipoPop_(pop && pop.tipo);
  var cj = (pop && pop.conteudoObj) || {};

  try {
    assertPopCamposMinimosFluxo_(pop);
  } catch (e0) {
    erros.push(String(e0.message || e0));
  }

  var titPub = popTextoCampoPublicacao_(pop.titulo);
  if (popEsNaoInformadoLiteral_(titPub)) erros.push('campo essencial com placeholder inválido: titulo');
  else if (!titPub) erros.push('titulo ausente ou inválido');
  var areaPub = popTextoCampoPublicacao_(pop.area);
  if (popEsNaoInformadoLiteral_(areaPub)) erros.push('campo essencial com placeholder inválido: area');
  else if (!areaPub) erros.push('area ausente ou inválida');
  var procPub = popTextoCampoPublicacao_(pop.processo);
  if (popEsNaoInformadoLiteral_(procPub)) erros.push('campo essencial com placeholder inválido: processo');
  else if (!procPub) erros.push('processo ausente ou inválido');

  var catOk = popCatalogoParAreaProcessoOk_(pop.area, pop.processo);
  if (!catOk.ok) erros.push('area/processo fora do cadastro (enum)');

  var perf = normalizePerfil_(pop.publicoAlvo || 'todos');
  var perfOk = ['todos', 'farmaceutico', 'gerente', 'diretor', 'atendente', 'entregador'].indexOf(perf) >= 0;
  if (!perfOk) erros.push('publicoAlvo enum inválido');

  var objStr = popTextoCampoPublicacao_(cj.objetivo || pop.objetivo);
  if (popEsNaoInformadoLiteral_(objStr)) erros.push('campo essencial com placeholder inválido: objetivo');
  else {
    var objMsg = popObjetivoContaminadoOuFraco_(pop.titulo, objStr);
    if (objMsg) {
      if (objMsg.indexOf('contaminado') >= 0) erros.push('objetivo contaminado');
      else if (objMsg.indexOf('insuficiente') >= 0) erros.push('objetivo insuficiente');
      else erros.push(objMsg);
    }
  }

  if (tipo === 'colaborativo') {
    popCampoEssencialPlaceholderSomente_(erros, 'escopo', cj.escopo);
    popCampoEssencialPlaceholderLista_(erros, 'responsaveis', cj.responsaveis);
    popCampoEssencialPlaceholderSomente_(erros, 'regra_de_ouro', cj.regra_de_ouro);
    popCampoEssencialPlaceholderSomente_(erros, 'frequencia', cj.frequencia);
    popCampoEssencialPlaceholderLista_(erros, 'pontos_criticos', cj.pontos_criticos);
    popCampoEssencialPlaceholderLista_(erros, 'checklist_lider', cj.checklist_lider);
    popCampoEssencialPlaceholderLista_(erros, 'desvios', cj.desvios);
    popCampoEssencialPlaceholderSomente_(erros, 'treinamento', cj.treinamento);

    var cePub = popExtrairComoErroCriticoParaPublicacao_(cj);
    var comoRaw = cePub.comoTexto;
    var erroCRaw = cePub.erroTexto;
    if (cePub.temPlaceholderComo) erros.push('como_fazer_bem contém placeholder inválido');
    else if (!comoRaw) erros.push('como_fazer_bem ausente');
    if (cePub.temPlaceholderErro) erros.push('erro_critico contém placeholder inválido');
    else if (!erroCRaw) erros.push('erro_critico ausente');
    if (comoRaw && erroCRaw && !cePub.temPlaceholderComo && !cePub.temPlaceholderErro) {
      var qCE = iaMotorValidarComoFazerErroCriticoLevePublicacao_(comoRaw, erroCRaw);
      if (qCE) {
        if (qCE.indexOf('Como fazer bem') >= 0) erros.push('como_fazer_bem abstrato');
        if (qCE.indexOf('Erro crítico') >= 0) erros.push('erro_critico abstrato');
      }
    }

    var metRaw = popTextoCampoPublicacao_(cj.metrica || '');
    if (popEsNaoInformadoLiteral_(metRaw)) erros.push('campo essencial com placeholder inválido: metrica');
    else if (metRaw.length < POP_PUBLISH_MIN_METRICA_LEN_) {
      erros.push('metrica ausente ou insuficiente (mínimo ' + POP_PUBLISH_MIN_METRICA_LEN_ + ' caracteres)');
    }

    var proc = cj.procedimento;
    if (Array.isArray(proc)) {
      for (var ph = 0; ph < proc.length; ph++) {
        var stepPh = proc[ph];
        var txtPh = typeof stepPh === 'string' ? stepPh : stringifyMixedContentItem_(stepPh);
        var txPh = popTextoCampoPublicacao_(txtPh);
        if (txPh && popEsNaoInformadoLiteral_(txPh)) {
          erros.push('campo essencial com placeholder inválido: procedimento');
          break;
        }
      }
    }

    var nEt = countProcedimentoEtapasValidas_(proc);
    if (nEt < POP_PUBLISH_MIN_PROC_COLAB_) {
      erros.push('procedimento insuficiente (mínimo ' + POP_PUBLISH_MIN_PROC_COLAB_ + ' etapas com conteúdo)');
    } else {
      var verbOk = 0;
      if (Array.isArray(proc)) {
        for (var i = 0; i < proc.length; i++) {
          var st = popBehavioralProcedimentoStepText_(proc[i]);
          if (st && iaMotorTemVerboAcao_(st)) verbOk++;
        }
      }
      if (verbOk < Math.max(2, Math.ceil(nEt * 0.5))) {
        erros.push('procedimento de balcão: maioria das etapas sem verbo de ação observável');
      }
    }

    var pe = popBehavioralPontosExec_(cj.pontosDeAtencao || [], cj.pontos_criticos || []);
    if (!pe.length) erros.push('humanizacao concreta ausente (use Fala/script, Tom, Postura ou Critério de sucesso em pontos de atenção)');

    var chkErr = popValidarChecklistPublicacao_(cj.checklist);
    for (var ce = 0; ce < chkErr.length; ce++) {
      if (erros.indexOf(chkErr[ce]) < 0) erros.push(chkErr[ce]);
    }

  } else if (tipo === 'critico') {
    var normCrit = {
      tipo: 'critico',
      autorNome: normalizeText_(cj.autorNome || ''),
      aprovador: normalizeText_(pop.aprovador || cj.aprovadorEsperado || ''),
      conteudoJson: JSON.parse(JSON.stringify(cj)),
    };
    var ceList = validatePopCriticoListaErros_(normCrit);
    for (var t = 0; t < ceList.length; t++) {
      if (erros.indexOf(ceList[t]) < 0) erros.push(ceList[t]);
    }
    pop.conteudoObj = normCrit.conteudoJson;

    var chkErr2 = popValidarChecklistPublicacao_(normCrit.conteudoJson.checklist);
    for (var u = 0; u < chkErr2.length; u++) {
      if (erros.indexOf(chkErr2[u]) < 0) erros.push(chkErr2[u]);
    }
  }

  var uniq = [];
  for (var r = 0; r < erros.length; r++) {
    if (uniq.indexOf(erros[r]) < 0) uniq.push(erros[r]);
  }
  return uniq;
}

/**
 * POP colaborativo mínimo para exercitar popValidacaoConteudoBloqueantePublicacao_ (mesmo caminho que assertPopValidacaoTecnicaPublicacao_).
 * Executar no editor: popSelfTestPublicacaoComoErroCaminhoReal_()
 */
function popFixtureColaborativoPublicacaoMinimoTeste_() {
  var chk = [
    'Confirmar identidade do cliente com dois dados no balcão',
    'Verificar receituário antes de dispensar medicamentos',
    'Registrar orientação ao cliente na ficha do sistema',
    'Conferir endereço e contacto da receita',
    'Explicar posologia de forma clara em voz calma',
  ];
  var proc = [
    'Olhar para o cliente e acenar ao aproximar-se da farmácia',
    'Perguntar nome completo e motivo da visita no balcão',
    'Confirmar dados do pedido e entregar o medicamento no balcão',
  ];
  return {
    titulo: 'Atendimento padrão na farmácia vinte e cinco',
    area: 'Atendimento e vendas',
    processo: 'Atendimento',
    tipo: 'colaborativo',
    publicoAlvo: 'todos',
    status: 'rascunho',
    exclusivoFarmaceutico: false,
    leituraObrigatoria: false,
    treinamentoObrigatorio: false,
    criticidade: 'media',
    conteudoObj: {
      objetivo: 'Garantir que cada cliente seja atendido com segurança e cordialidade no balcão da farmácia',
      escopo: 'Aplica-se ao balcão em horário de funcionamento',
      responsaveis: ['Farmacêutico', 'Atendente'],
      regra_de_ouro: 'Cliente sempre em primeiro lugar com postura acolhedora',
      frequencia: 'sempre que houver cliente',
      pontos_criticos: ['Tom: voz clara e ritmo calmo com o cliente'],
      checklist_lider: ['verificar fila', 'apoio ao caixa'],
      desvios: ['postura fechada'],
      treinamento: 'Integração ao onboarding da equipe',
      metrica: 'Percentagem de atendimentos com checklist cumprida no dia',
      procedimento: proc,
      checklist: chk,
      pontosDeAtencao: ['Postura: costas alinhadas e olhar para o cliente'],
      como_fazer_bem:
        'Olhar para o cliente e falar em voz calma no balcão, explicando em duas frases o que acontece a seguir na farmácia',
      erro_critico: 'Ignorar o cliente ou desviar o olhar quando ele pede ajuda na gôndola',
    },
  };
}

/**
 * Testa como/erro no mesmo fluxo de lista de erros da publicação (popValidacaoConteudoBloqueantePublicacao_).
 * @returns {{ ok: boolean, casos: Array<{ tag: string, ok: boolean, erros: string[] }> }}
 */
function popSelfTestPublicacaoComoErroCaminhoReal_() {
  var base = popFixtureColaborativoPublicacaoMinimoTeste_();
  var casos = [];

  function run(tag, patchCj, deveConter, naoDeveConter, opts) {
    var pop = JSON.parse(JSON.stringify(base));
    if (opts && opts.conteudoObjCompleto) {
      pop.conteudoObj = opts.conteudoObjCompleto;
    } else {
      pop.conteudoObj = merge_(pop.conteudoObj, patchCj || {});
    }
    // Mesmo caminho que assertPopValidacaoTecnicaPublicacao_: normalizáveis antes da lista bloqueante.
    popAplicarNormalizaveisPublicacao_(pop);
    var erros = popValidacaoConteudoBloqueantePublicacao_(pop);
    var blob = erros.join(' | ');
    var ok = true;
    var dc = deveConter || [];
    var nd = naoDeveConter || [];
    for (var i = 0; i < dc.length; i++) {
      if (blob.indexOf(dc[i]) < 0) ok = false;
    }
    for (var j = 0; j < nd.length; j++) {
      if (blob.indexOf(nd[j]) >= 0) ok = false;
    }
    casos.push({ tag: tag, ok: ok, erros: erros });
  }

  run(
    'snake_placeholder',
    { como_fazer_bem: 'Não informado' },
    ['como_fazer_bem contém placeholder inválido'],
    ['como_fazer_bem abstrato']
  );

  run(
    'camel_placeholder',
    { como_fazer_bem: '', comoFazerBem: 'Não informado' },
    ['como_fazer_bem contém placeholder inválido'],
    ['como_fazer_bem abstrato']
  );

  run(
    'erro_snake_placeholder',
    { erro_critico: 'Não informado' },
    ['erro_critico contém placeholder inválido'],
    ['erro_critico abstrato']
  );

  run(
    'erro_camel_placeholder',
    { erro_critico: '', erroCritico: 'Não informado' },
    ['erro_critico contém placeholder inválido'],
    ['erro_critico abstrato']
  );

  run(
    'snake_placeholder_mojibake',
    { como_fazer_bem: 'N?o informado' },
    ['como_fazer_bem contém placeholder inválido'],
    ['como_fazer_bem abstrato']
  );

  run(
    'camel_placeholder_mojibake',
    { como_fazer_bem: '', comoFazerBem: 'N?O INFORMADO' },
    ['como_fazer_bem contém placeholder inválido'],
    ['como_fazer_bem abstrato']
  );

  run(
    'erro_snake_placeholder_mojibake',
    { erro_critico: 'N?o-informado' },
    ['erro_critico contém placeholder inválido'],
    ['erro_critico abstrato']
  );

  run(
    'erro_camel_placeholder_mojibake',
    { erro_critico: '', erroCritico: 'N?o   informado' },
    ['erro_critico contém placeholder inválido'],
    ['erro_critico abstrato']
  );

  var bomKey = '\uFEFFcomo_fazer_bem';
  var cjBom = JSON.parse(JSON.stringify(base.conteudoObj));
  delete cjBom.como_fazer_bem;
  cjBom[bomKey] = 'Não informado';
  run('bom_na_chave_com_bom', null, ['como_fazer_bem contém placeholder inválido'], ['como_fazer_bem abstrato'], { conteudoObjCompleto: cjBom });

  run(
    'abstrato_como',
    { como_fazer_bem: 'aa aa aa aa aa' },
    ['como_fazer_bem abstrato'],
    ['erro_critico abstrato']
  );

  run(
    'abstrato_erro',
    { erro_critico: 'bb bb bb bb bb' },
    ['erro_critico abstrato'],
    ['como_fazer_bem abstrato']
  );

  run('conteudo_bom_fixture', {}, [], ['como_fazer_bem contém placeholder inválido', 'como_fazer_bem abstrato', 'erro_critico abstrato']);

  var allOk = true;
  for (var c = 0; c < casos.length; c++) {
    if (!casos[c].ok) allOk = false;
  }
  return { ok: allOk, casos: casos };
}

function popSnapshotPersistiveisPublicacao_(pop) {
  return stableJson_({
    titulo: pop.titulo,
    area: pop.area,
    processo: pop.processo,
    publicoAlvo: pop.publicoAlvo,
    criticidade: pop.criticidade,
    tipo: pop.tipo,
    cj: pop.conteudoObj || {},
  });
}

function assertPopValidacaoTecnicaPublicacao_(pop, sheet, rowIndex) {
  var antes = popSnapshotPersistiveisPublicacao_(pop);
  popAplicarNormalizaveisPublicacao_(pop);
  var lista = popValidacaoConteudoBloqueantePublicacao_(pop);
  if (lista.length) popThrowValidacaoPublicacao_(lista);
  var depois = popSnapshotPersistiveisPublicacao_(pop);
  if (antes !== depois) {
    applyRowPatch_(sheet, rowIndex, {
      titulo: String(pop.titulo || ''),
      area: String(pop.area || ''),
      processo: String(pop.processo || ''),
      publicoAlvo: String(pop.publicoAlvo || 'todos'),
      criticidade: String(pop.criticidade || 'media'),
      tipo: String(pop.tipo || 'colaborativo'),
      conteudoJson: JSON.stringify(pop.conteudoObj || {}),
      atualizadoEm: new Date(),
    });
  }
}

function isPopCriticoFluxo_(pop) {
  var cj = pop && pop.conteudoObj || {};
  if (normalizeTipoPop_(pop && pop.tipo) === 'critico') return true;
  if (normalizeTipoPop_(cj && cj.tipo) === 'critico') return true;
  return String(cj.linhaPop || cj.linha_pop_ia || '').toLowerCase() === 'critico';
}

function assertCanEditPopFlow_(user, pop) {
  var perfil = normalizePerfil_(user && user.perfil);
  var status = String(pop && pop.status || '');
  var uid = String(user && (user.id || user.userId) || '');
  var autor = String(pop && pop.autorUserId || '');
  var isGestao = perfil === 'gerente' || perfil === 'diretor';

  if (status === 'rascunho') {
    if (isGestao || (uid && autor && sameUsuarioId_(uid, autor))) return;
    throw new Error('Apenas o autor, gerente ou diretor podem editar este rascunho.');
  }
  if (status === 'em_aprovacao') {
    if (isGestao) return;
    throw new Error('POP em aprovação só pode ser editado por gerente ou diretor.');
  }
  if (status === 'aguardando_diretor') {
    if (perfil === 'diretor') return;
    throw new Error('POP aguardando diretor só pode ser editado pela diretoria.');
  }
  throw new Error('Edição não permitida para o status atual.');
}

function stableJson_(v) {
  if (v == null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(stableJson_).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stableJson_(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Texto da etapa em procedimento colaborativo (string ou objeto legado). */
function popBehavioralProcedimentoStepText_(x) {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return normalizeText_(x);
  if (typeof x === 'object') {
    return normalizeText_(x.texto || x.descricao || x.passo || x.item || x.titulo || x.conteudo || x.acao || '');
  }
  return '';
}

function popBehavioralProcedimentoColab_(proc) {
  if (!Array.isArray(proc)) return [];
  var out = [];
  for (var i = 0; i < proc.length; i++) {
    var t = popBehavioralProcedimentoStepText_(proc[i]);
    if (t) out.push(t);
  }
  return out;
}

/** Linhas de pontos que alteram fala/postura ou critério explícito (ignora texto meramente explicativo). */
function popBehavioralPontosExec_(pontos, criticos) {
  var re = /^(Fala\s*\/\s*script|Tom|Postura|Critério de sucesso):/i;
  var out = [];
  var arrs = [pontos, criticos];
  for (var a = 0; a < arrs.length; a++) {
    var arr = Array.isArray(arrs[a]) ? arrs[a] : [];
    for (var i = 0; i < arr.length; i++) {
      var s = normalizeText_(arr[i]);
      if (s && re.test(s)) out.push(s);
    }
  }
  return out;
}

function popBehavioralErrosGraves_(erros, proib) {
  var seen = {};
  var acc = [];
  function pushArr(arr) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      var t = normalizeText_(arr[i]);
      if (!t) continue;
      var k = t.toLowerCase();
      if (seen[k]) continue;
      seen[k] = true;
      acc.push(t);
    }
  }
  pushArr(erros);
  pushArr(proib);
  acc.sort(function (x, y) {
    return String(x).localeCompare(String(y), 'pt');
  });
  return acc;
}

function popBehavioralCritProcedimento_(proc) {
  if (!Array.isArray(proc)) return [];
  var out = [];
  for (var i = 0; i < proc.length; i++) {
    var it = proc[i];
    if (!it || typeof it !== 'object') continue;
    out.push({
      itemId: normalizeText_(it.itemId || ''),
      etapa: normalizeText_(it.etapa || ''),
      acao: normalizeText_(it.acao || ''),
      descricao: normalizeText_(it.descricao || ''),
      criterioAvaliacao: normalizeText_(it.criterioAvaliacao || ''),
      obrigatorio: it.obrigatorio === undefined ? null : !!normalizeBoolean_(it.obrigatorio),
      critico: it.critico === undefined ? null : !!normalizeBoolean_(it.critico),
      peso: normalizeText_(it.peso != null ? String(it.peso) : ''),
    });
  }
  return out;
}

/**
 * Visão só do que muda o comportamento no chão (ações, ordem, tempo/frequência, abordagem executável,
 * critério de sucesso explícito, erros graves). Exclui título, área, processo, metadados e textos só explicativos.
 */
function popBehavioralSnapshot_(pop) {
  var tipo = normalizeTipoPop_(pop && pop.tipo);
  var cj = (pop && pop.conteudoObj) || {};
  if (!cj || typeof cj !== 'object') cj = {};
  var frame = { snapBehavior: 1, tipo: tipo };

  if (tipo === 'critico') {
    frame.frequencia = normalizeFrequenciaCritico_(cj.frequencia || '');
    frame.procedimento = popBehavioralCritProcedimento_(cj.procedimento || []);
    return frame;
  }

  frame.frequencia = normalizeText_(cj.frequencia || '');
  frame.procedimento = popBehavioralProcedimentoColab_(cj.procedimento || []);
  frame.metrica = normalizeText_(cj.metrica || '');
  frame.pontosExec = popBehavioralPontosExec_(cj.pontosDeAtencao || [], cj.pontos_criticos || []);
  frame.errosGraves = popBehavioralErrosGraves_(cj.errosComuns || [], cj.proibido || []);
  frame.checklist = normalizeStringArray_(cj.checklist || [])
    .map(function (x) {
      return normalizeText_(x);
    })
    .filter(Boolean);
  return frame;
}

function popRelevantSnapshot_(pop) {
  return stableJson_(popBehavioralSnapshot_(pop));
}

/** Snapshots gravados antes da v2 comparavam JSON amplo; não travar reenvio até o próximo baseline comportamental. */
function isLegacyPopSubmitRelevantSnapshot_(snapStr) {
  var o = safeJsonParse_(String(snapStr || ''));
  if (!o || typeof o !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(o, 'snapBehavior')) return false;
  if (Object.prototype.hasOwnProperty.call(o, 'conteudoJson')) return true;
  if (Object.prototype.hasOwnProperty.call(o, 'titulo')) return true;
  return false;
}

function latestSubmitSnapshotForPop_(popId) {
  var rows = listRows_(getSheet_(SHEET_AUDITORIA));
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (String(r.acao || '') !== 'POP_SUBMIT') continue;
    var d = safeJsonParse_(r.detalhesJson) || {};
    if (String(d.popId || '') === String(popId || '') && d.snapshot) return String(d.snapshot);
  }
  return '';
}

function assertPopChangedSinceLastSubmit_(pop) {
  var prev = latestSubmitSnapshotForPop_(pop && pop.popId);
  if (!prev) return;
  if (isLegacyPopSubmitRelevantSnapshot_(prev)) return;
  if (prev === popRelevantSnapshot_(pop)) {
    throw new Error(
      'Nenhuma mudança na execução foi detectada desde o último envio. Altere ação, tempo, frequência, gatilho ou critério de sucesso para reenviar à aprovação (por exemplo: ordem das etapas, métrica, falas/postura operacional, checklist no chão ou erros graves concretos).'
    );
  }
}

// =============================================================================
// Core: POPs
// =============================================================================

/**
 * Fonte única de verdade: mesma lista para biblioteca (getPortalData) e métricas do dashboard.
 */
function getPopsLibraryForUser_(user) {
  return listPopsForUser_(user);
}

function listPopsForUser_(user) {
  POP_LAST_LIST_TRIAGE_ = null;
  var sheet = getSheet_(SHEET_POPS);
  var raw = listRows_(sheet);
  var rawSample = raw.slice(0, 5).map(function (row) {
    return {
      popId: row.popId || row.id || '',
      versaoId: row.versaoId || '',
      titulo: row.titulo || '',
      status: row.status == null ? '(null)' : String(row.status),
    };
  });
  popDiagLog_('listPopsForUser.start', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    rawRows: raw.length,
    rawSample: rawSample,
    userPerfil: normalizePerfil_(user.perfil),
    userId: String(user.id || user.userId || ''),
  });
  var normErrors = 0;
  var pops = raw.map(function (row) {
    try {
      return normalizePopRow_(row);
    } catch (e) {
      normErrors++;
      popDiagLog_('listPopsForUser.normalizeError', { err: String(e && e.message ? e.message : e) });
      return null;
    }
  }).filter(Boolean);

  var beforeSample = pops.slice(0, 15).map(function (p) {
    return { popId: p.popId, titulo: p.titulo, status: p.status, publicoAlvo: p.publicoAlvo, exclusivoFarmaceutico: p.exclusivoFarmaceutico };
  });
  var rowsLostBeforeCanView = raw.length - pops.length;
  popDiagLog_('listPopsForUser.afterNormalize', {
    count: pops.length,
    normalizeErrors: normErrors,
    rowsLostBeforeCanView: rowsLostBeforeCanView,
    sample: beforeSample,
  });

  var before = pops.length;
  var dropped = 0;
  var maxDropLogs = 80;
  var dropHist = {};
  pops = pops.filter(function (p) {
    var vr = canViewPopReason_(user, p);
    if (!vr.ok) {
      dropped++;
      dropHist[vr.reason] = (dropHist[vr.reason] || 0) + 1;
      if (dropped <= maxDropLogs) {
        popDiagLog_('listPopsForUser.drop_canView', {
          reason: vr.reason,
          popId: p.popId,
          versaoId: p.versaoId,
          titulo: p.titulo,
          status: p.status,
          publicoAlvo: p.publicoAlvo,
          exclusivoFarmaceutico: p.exclusivoFarmaceutico,
        });
      }
    }
    return vr.ok;
  });
  if (dropped > maxDropLogs) {
    popDiagLog_('listPopsForUser.drop_canView_truncated', { totalDropped: dropped, loggedFirst: maxDropLogs });
  }
  if (dropped > 0) {
    popDiagLog_('listPopsForUser.drop_aggregate_NAO_SILENCIOSO', {
      dropped: dropped,
      dropReasonHistogram: dropHist,
      dominantDropReason: dominantKeyInHistogram_(dropHist),
    });
  }
  var outSample = pops.slice(0, 15).map(function (p) {
    return { popId: p.popId, titulo: p.titulo, status: p.status };
  });
  popDiagLog_('listPopsForUser.end', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    afterCanView: pops.length,
    dropped: before - pops.length,
    popsReturned: pops.length,
    sample: outSample,
  });

  POP_LAST_LIST_TRIAGE_ = {
    rawRows: raw.length,
    afterNormalize: before,
    popsReturned: pops.length,
    dropped: before - pops.length,
    normalizeErrors: normErrors,
    rowsLostBeforeCanView: rowsLostBeforeCanView,
    dropReasonHistogram: dropHist,
    dominantDropReason: dominantKeyInHistogram_(dropHist),
    userId: String(user.id || user.userId || ''),
    userPerfil: normalizePerfil_(user.perfil),
  };

  return enrichPopsWithReadStatus_(user, pops);
}

function getPopForUser_(user, popId, versaoId) {
  var sheet = getSheet_(SHEET_POPS);
  var rawRows = listRows_(sheet);
  popDiagLog_('getPopForUser_.read', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    rawRows: rawRows.length,
    popId: String(popId || ''),
    versaoId: versaoId ? String(versaoId) : '',
  });
  var rows = rawRows.map(function (r) { return normalizePopRow_(r); });
  var match = rows.find(function (p) {
    if (versaoId) return String(p.versaoId) === String(versaoId);
    return String(p.popId) === String(popId) || String(p.versaoId) === String(popId) || String(p.id) === String(popId);
  });
  if (!match) throw new Error('POP não encontrado.');
  var vr = canViewPopReason_(user, match);
  if (!vr.ok) throw new Error('Sem acesso a este POP.');

  var enriched = enrichPopsWithReadStatus_(user, [match])[0];
  return enriched;
}

function createPopDraft_(user, incoming) {
  var sheet = getSheet_(SHEET_POPS);
  var headers = getHeaders_(sheet);

  var normalized = normalizePopJsonPayload_(user, incoming || {});
  assertTipoLinhaPopPermitidos_(user, normalized, incoming || {});
  assertTipoPopPermitido_(user, normalized.tipo);
  assertPortalPopMinimoSemanticoPersistencia_(normalized);
  validatePopCritico_(normalized);
  assertAutorDiferenteDeAprovadorCritico_(normalized);

  var popId = normalized.popId || uuid_();
  var versaoId = uuid_();

  var numero = normalized.numero;
  if (!numero) numero = generatePopNumeroForFamily_(popId);

  var now = new Date();
  var rowObj = {
    popId: popId,
    versaoId: versaoId,
    numero: numero,
    versao: String(normalized.versao || '1.0'),
    titulo: String(normalized.titulo || ''),
    area: String(normalized.area || ''),
    processo: String(normalized.processo || ''),
    criticidade: normalizeCriticidade_(normalized.criticidade || 'media'),
    status: normalizeStatus_(normalized.status || 'rascunho'),
    exclusivoFarmaceutico: normalizeBoolean_(normalized.exclusivoFarmaceutico),
    leituraObrigatoria: normalizeBoolean_(normalized.leituraObrigatoria),
    treinamentoObrigatorio: normalizeBoolean_(normalized.treinamentoObrigatorio),
    publicoAlvo: normalizePerfil_(normalized.publicoAlvo || 'todos'),
    tags: String(normalized.tags || ''),
    vigenciaInicio: normalized.vigenciaInicio || '',
    revisaoPrevista: normalized.revisaoPrevista || '',
    autorUserId: String(user.id || user.userId || ''),
    autorEmail: String(user.email || ''),
    criadoEm: now,
    atualizadoEm: now,
    conteudoJson: JSON.stringify(normalized.conteudoJson || {}),
    conteudoHtmlGerado: normalized.conteudoHtmlGerado || '',
    drivePdfFileId: '',
    driveFolderAnexosId: '',
    tipo: normalizeTipoPop_(normalized.tipo || 'colaborativo'),
    origem: normalizeOrigemPop_(normalized.origem || ''),
  };

  // Sprint 1: garantir rascunho ao criar
  rowObj.status = 'rascunho';

  appendRowObj_(sheet, headers, rowObj);
  var created = normalizePopRow_(rowObj);
  popDiagLog_('createPopDraft', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    popId: created.popId,
    versaoId: created.versaoId,
    titulo: created.titulo,
    status: created.status,
  });
  return created;
}

function updatePopDraft_(user, popId, versaoId, incoming) {
  var sheet = getSheet_(SHEET_POPS);
  var rows = listRowsWithRowIndex_(sheet).map(function (x) {
    return { rowIndex: x.rowIndex, obj: normalizePopRow_(x.obj) };
  });

  var match = rows.find(function (p) {
    if (versaoId) return String(p.obj.versaoId) === String(versaoId);
    return String(p.obj.popId) === String(popId) || String(p.obj.versaoId) === String(popId) || String(p.obj.id) === String(popId);
  });
  if (!match) throw new Error('POP não encontrado.');
  if (!canViewPop_(user, match.obj)) throw new Error('Sem acesso a este POP.');
  var st = String(match.obj.status || '');
  assertCanEditPopFlow_(user, match.obj);
  var editaveis = ['rascunho', 'em_aprovacao', 'aguardando_diretor'];
  if (editaveis.indexOf(st) < 0) throw new Error('Edição não permitida para o status atual.');

  var normalized = normalizePopJsonPayload_(user, incoming || {});
  assertTipoLinhaPopPermitidos_(user, normalized, incoming || {});
  assertPortalPopMinimoSemanticoPersistencia_(normalized);

  // numero estável por família: não pode mudar
  normalized.numero = match.obj.numero;

  // Preserva área e processo quando o payload vem vazio (edição/aprovação parcial no portal).
  if (!normalizeText_(normalized.area)) {
    normalized.area = normalizeText_(match.obj.area || '');
  }
  if (!normalizeText_(normalized.processo)) {
    normalized.processo = normalizeText_(match.obj.processo || '');
  }
  var cjMerge = normalized.conteudoJson || {};
  if (!normalizeText_(cjMerge.area)) {
    cjMerge.area = normalizeText_(match.obj.area || cjMerge.area || '');
  }
  if (!normalizeText_(cjMerge.processo)) {
    cjMerge.processo = normalizeText_(match.obj.processo || cjMerge.processo || '');
  }
  normalized.conteudoJson = cjMerge;

  if (normalizeTipoPop_(normalized.tipo) === 'critico') {
    var prevCj0 = match.obj.conteudoObj || {};
    normalized.conteudoJson.procedimento = mergeCriticoProcedimentoImutavelItemId_(
      prevCj0.procedimento,
      normalized.conteudoJson.procedimento
    );
  }
  validatePopCritico_(normalized);
  assertAutorDiferenteDeAprovadorCritico_(normalized);

  var tipoPersistido = normalizeTipoPop_(
    normalized.tipo !== undefined && normalized.tipo !== '' ? normalized.tipo : match.obj.tipo || 'colaborativo'
  );
  assertTipoPopPermitido_(user, tipoPersistido);

  var now = new Date();
  var patch = {
    titulo: String(normalized.titulo || match.obj.titulo || ''),
    area: String(normalized.area || match.obj.area || ''),
    processo: String(normalized.processo || match.obj.processo || ''),
    versao: String(normalized.versao || match.obj.versao || '1.0'),
    status: (function () {
      var raw = incoming && incoming.status != null ? String(incoming.status) : '';
      raw = normalizeText_(raw);
      if (!raw) return normalizeStatus_(match.obj.status || 'rascunho');
      return normalizeStatus_(raw);
    })(),
    criticidade: normalizeCriticidade_(normalized.criticidade || match.obj.criticidade || 'media'),
    exclusivoFarmaceutico: normalizeBoolean_(normalized.exclusivoFarmaceutico),
    leituraObrigatoria: normalizeBoolean_(normalized.leituraObrigatoria),
    treinamentoObrigatorio: normalizeBoolean_(normalized.treinamentoObrigatorio),
    publicoAlvo: normalizePerfil_(normalized.publicoAlvo || match.obj.publicoAlvo || 'todos'),
    tags: String(normalized.tags || match.obj.tags || ''),
    vigenciaInicio: String(normalized.vigenciaInicio || match.obj.vigenciaInicio || ''),
    revisaoPrevista: String(normalized.revisaoPrevista || match.obj.revisaoPrevista || ''),
    conteudoJson: JSON.stringify(normalized.conteudoJson || match.obj.conteudoObj || {}),
    conteudoHtmlGerado: normalized.conteudoHtmlGerado || match.obj.conteudoHtmlGerado || '',
    atualizadoEm: now,
    tipo: tipoPersistido,
    origem: normalizeOrigemPop_(normalized.origem !== undefined ? normalized.origem : match.obj.origem || ''),
  };

  applyRowPatch_(sheet, match.rowIndex, patch);
  var updated = getPopForUser_(user, match.obj.popId, match.obj.versaoId);
  popDiagLog_('updatePopDraft', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    popId: updated.popId,
    versaoId: updated.versaoId,
    titulo: updated.titulo,
    status: updated.status,
  });
  return updated;
}

function setPopVigenteBasic_(user, popId, versaoId) {
  var sheet = getSheet_(SHEET_POPS);
  var rows = listRowsWithRowIndex_(sheet).map(function (x) {
    return { rowIndex: x.rowIndex, obj: normalizePopRow_(x.obj) };
  });

  var match = rows.find(function (p) {
    if (versaoId) return String(p.obj.versaoId) === String(versaoId);
    return String(p.obj.popId) === String(popId) || String(p.obj.versaoId) === String(popId) || String(p.obj.id) === String(popId);
  });
  if (!match) throw new Error('POP não encontrado.');
  if (!canViewPop_(user, match.obj)) throw new Error('Sem acesso a este POP.');

  var st = String(match.obj.status || '');
  if (st === 'vigente') throw new Error('Este POP já está vigente.');
  assertPopValidacaoTecnicaPublicacao_(match.obj, sheet, match.rowIndex);
  var podePublicarDe =
    st === 'rascunho' || st === 'aguardando_diretor' || st === 'em_aprovacao' || st === 'em revisão';
  if (!podePublicarDe) throw new Error('Status atual não permite publicação.');

  applyRowPatch_(sheet, match.rowIndex, {
    status: 'vigente',
    vigenciaInicio: formatDateIso_(new Date()),
    revisaoPrevista: computeRevisaoPrevista_(match.obj.criticidade),
    atualizadoEm: new Date(),
  });

  var pub = getPopForUser_(user, match.obj.popId, match.obj.versaoId);
  popDiagLog_('setPopVigenteBasic', {
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_POPS,
    popId: pub.popId,
    versaoId: pub.versaoId,
    titulo: pub.titulo,
    status: pub.status,
  });
  return pub;
}

// =============================================================================
// DEBUG temporário: diagnóstico publicação como_fazer_bem / erro_critico
// (não altera publicação; remover quando já não for necessário)
// =============================================================================

function debugPublicacaoComoErroChavePareceRelacionada_(rawKey) {
  var norm = popNormalizarChaveConteudoJson_(rawKey);
  if (!norm) return false;
  return (
    norm.indexOf('como') >= 0 ||
    norm.indexOf('fazer') >= 0 ||
    norm.indexOf('bem') >= 0 ||
    norm.indexOf('erro') >= 0 ||
    norm.indexOf('critico') >= 0
  );
}

function debugPublicacaoComoErroValorDiag_(v) {
  var tPub = popTextoCampoPublicacao_(v);
  var normPh = popNormTextoPlaceholder_(tPub);
  var codes = [];
  if (v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
    var s = String(v);
    for (var i = 0; i < Math.min(32, s.length); i++) {
      codes.push({ i: i, ch: s.charAt(i), code: s.charCodeAt(i) });
    }
  }
  var jsonVal = '';
  try {
    jsonVal = JSON.stringify(v);
  } catch (e1) {
    jsonVal = String(e1 && e1.message ? e1.message : e1);
  }
  return {
    tipoValor: Object.prototype.toString.call(v),
    valorJson: jsonVal.length > 800 ? jsonVal.slice(0, 800) + '…' : jsonVal,
    textoPublicacao: tPub,
    normPlaceholder: normPh,
    esNaoInformado: popEsNaoInformadoLiteral_(tPub),
    primeirosCodepoints: codes,
  };
}

/**
 * Mesmo critério de localização que setPopVigenteBasic_ (listRowsWithRowIndex_ + normalizePopRow_ + find).
 * Mostra conteudoJson bruto da célula, conteudoObj após normalizePopRow_, e duas validações:
 * - sem popAplicarNormalizaveisPublicacao_ (caminho incompleto, útil para comparar)
 * - com popAplicarNormalizaveisPublicacao_ (igual assertPopValidacaoTecnicaPublicacao_ / publicação real)
 */
function debugPublicacaoComoErro_(popId) {
  ensureSchema_();
  var sheet = getSheet_(SHEET_POPS);
  var rows = listRowsWithRowIndex_(sheet).map(function (x) {
    return { rowIndex: x.rowIndex, raw: x.obj, pop: normalizePopRow_(x.obj) };
  });
  var match = rows.find(function (p) {
    return (
      String(p.pop.popId) === String(popId) ||
      String(p.pop.versaoId) === String(popId) ||
      String(p.pop.id) === String(popId)
    );
  });
  if (!match) {
    return { ok: false, erro: 'POP não encontrado (mesmo critério de setPopVigenteBasic_)', popIdBuscado: String(popId || '') };
  }
  var raw = match.raw || {};
  var cjStrBruto = raw.conteudoJson;
  var parseBruto = safeJsonParse_(cjStrBruto == null ? '' : String(cjStrBruto));

  var popBase = JSON.parse(JSON.stringify(match.pop));
  var cjBase = popBase.conteudoObj || {};
  var ceBase = popExtrairComoErroCriticoParaPublicacao_(cjBase);
  var errosSemNorm = popValidacaoConteudoBloqueantePublicacao_(JSON.parse(JSON.stringify(popBase)));

  var popPub = JSON.parse(JSON.stringify(match.pop));
  popAplicarNormalizaveisPublicacao_(popPub);
  var cjPub = popPub.conteudoObj || {};
  var cePub = popExtrairComoErroCriticoParaPublicacao_(cjPub);
  var errosComNorm = popValidacaoConteudoBloqueantePublicacao_(popPub);

  var todasChaves = Object.keys(cjPub || {}).sort();
  var relacionadas = [];
  for (var i = 0; i < todasChaves.length; i++) {
    var kk = todasChaves[i];
    if (debugPublicacaoComoErroChavePareceRelacionada_(kk)) {
      relacionadas.push({
        chave: kk,
        slugChave: popNormalizarChaveConteudoJson_(kk),
        diagnostico: debugPublicacaoComoErroValorDiag_(cjPub[kk]),
      });
    }
  }

  return {
    ok: true,
    popId: popBase.popId,
    versaoId: popBase.versaoId,
    tipo: popBase.tipo,
    status: popBase.status,
    rowIndex: match.rowIndex,
    conteudoJson_tipoCelula: cjStrBruto == null ? 'null' : typeof cjStrBruto,
    conteudoJson_stringPreview: String(cjStrBruto == null ? '' : cjStrBruto).slice(0, 4000),
    parseConteudoJsonDireto_ok: parseBruto != null && typeof parseBruto === 'object',
    conteudoObj_chaves_apos_normalizePopRow: Object.keys(cjBase || {}).sort(),
    conteudoObj_chaves_apos_normalizaveis: todasChaves,
    chaves_relacionadas_diag: relacionadas,
    extracao_sem_popAplicarNormalizaveis: ceBase,
    erros_validacao_sem_popAplicarNormalizaveis: errosSemNorm,
    extracao_PATH_REAL_pos_normalizaveis: cePub,
    erros_validacao_PATH_REAL_pos_normalizaveis: errosComNorm,
  };
}

function debugPublicacaoComoErroConteudoBaseColab_() {
  return JSON.parse(JSON.stringify(popFixtureColaborativoPublicacaoMinimoTeste_().conteudoObj));
}

function debugPublicacaoComoErroPrimeiroUsuarioPlanilha_() {
  var users = listRows_(getSheet_(SHEET_USUARIOS));
  if (!users.length) throw new Error('Folha USUARIOS vazia: impossível criar POP de teste.');
  var u = users[0];
  return { id: String(u.id || ''), email: String(u.email || '') };
}

/**
 * Insere 4 rascunhos na aba POPs (tags DBG_PUBLICACAO_COMO_ERRO) para inspeção com debugPublicacaoComoErro_(popId).
 * @returns {{ A: string, B: string, C: string, D: string, titulos: Object }}
 */
function debugPublicacaoComoErroSeedQuatroNaPlanilha_() {
  ensureSchema_();
  var auth = debugPublicacaoComoErroPrimeiroUsuarioPlanilha_();
  var sheet = getSheet_(SHEET_POPS);
  var headers = getHeaders_(sheet);
  var now = new Date();

  function appendVariant(titulo, cj) {
    var popId = uuid_();
    var versaoId = uuid_();
    var rowObj = {
      popId: popId,
      versaoId: versaoId,
      numero: 'DBG-' + popId.slice(0, 8),
      versao: '1.0',
      titulo: titulo,
      area: 'Atendimento e vendas',
      processo: 'Atendimento',
      criticidade: 'media',
      status: 'rascunho',
      exclusivoFarmaceutico: false,
      leituraObrigatoria: false,
      treinamentoObrigatorio: false,
      publicoAlvo: 'todos',
      tags: 'DBG_PUBLICACAO_COMO_ERRO',
      vigenciaInicio: '',
      revisaoPrevista: '',
      autorUserId: auth.id,
      autorEmail: auth.email,
      criadoEm: now,
      atualizadoEm: now,
      conteudoJson: JSON.stringify(cj),
      conteudoHtmlGerado: '',
      drivePdfFileId: '',
      driveFolderAnexosId: '',
      tipo: 'colaborativo',
      origem: 'debug_seed',
    };
    appendRowObj_(sheet, headers, rowObj);
    return popId;
  }

  var base = debugPublicacaoComoErroConteudoBaseColab_();
  var cjA = merge_(base, { como_fazer_bem: 'Não informado' });
  var cjB = merge_(base, {});
  delete cjB.como_fazer_bem;
  cjB.comoFazerBem = 'Não informado';

  var cjC = merge_(base, { erro_critico: 'Não informado' });
  var cjD = merge_(base, {});
  delete cjD.erro_critico;
  cjD.erroCritico = 'Não informado';

  var titulos = {
    A: '[DBG_COMO_SNAKE] Não informado em como_fazer_bem',
    B: '[DBG_COMO_CAMEL] Não informado só em comoFazerBem',
    C: '[DBG_ERRO_SNAKE] Não informado em erro_critico',
    D: '[DBG_ERRO_CAMEL] Não informado só em erroCritico',
  };
  var idA = appendVariant(titulos.A, cjA);
  var idB = appendVariant(titulos.B, cjB);
  var idC = appendVariant(titulos.C, cjC);
  var idD = appendVariant(titulos.D, cjD);

  return { A: idA, B: idB, C: idC, D: idD, titulos: titulos };
}

/** Executa debugPublicacaoComoErro_ nos quatro POPs criados pelo seed (cria novas linhas a cada chamada). */
function debugPublicacaoComoErroRodarQuatroAposSeed_() {
  var ids = debugPublicacaoComoErroSeedQuatroNaPlanilha_();
  return {
    seed: ids,
    debugA: debugPublicacaoComoErro_(ids.A),
    debugB: debugPublicacaoComoErro_(ids.B),
    debugC: debugPublicacaoComoErro_(ids.C),
    debugD: debugPublicacaoComoErro_(ids.D),
  };
}

function normalizePopRow_(row) {
  var obj = clone_(row);

  // compatibilidade com bases antigas: id/codigo/payload
  if (!obj.popId && obj.id) obj.popId = String(obj.id);
  if (!obj.versaoId && obj.id) obj.versaoId = String(obj.id);
  if (!obj.numero && obj.codigo) obj.numero = String(obj.codigo);

  obj.popId = String(obj.popId || '');
  obj.versaoId = String(obj.versaoId || '');
  obj.numero = String(obj.numero || '');

  obj.titulo = String(obj.titulo || '');
  obj.area = String(obj.area || '');
  obj.processo = String(obj.processo || '');

  obj.criticidade = normalizeCriticidade_(obj.criticidade || 'media');

  obj.exclusivoFarmaceutico = normalizeBoolean_(obj.exclusivoFarmaceutico);
  obj.leituraObrigatoria = normalizeBoolean_(obj.leituraObrigatoria);
  obj.treinamentoObrigatorio = normalizeBoolean_(obj.treinamentoObrigatorio);
  obj.publicoAlvo = normalizePerfil_(obj.publicoAlvo || 'todos');

  obj.tipo = normalizeTipoPop_(obj.tipo);
  obj.origem = normalizeOrigemPop_(obj.origem);

  obj.vigenciaInicio = obj.vigenciaInicio ? String(obj.vigenciaInicio) : '';
  obj.revisaoPrevista = obj.revisaoPrevista ? String(obj.revisaoPrevista) : '';

  obj.autorUserId = String(obj.autorUserId || obj.autorId || '');
  obj.autorEmail = String(obj.autorEmail || '');

  obj.criadoEm = obj.criadoEm || obj.createdAt || '';
  obj.atualizadoEm = obj.atualizadoEm || '';

  obj.conteudoJson = obj.conteudoJson || obj.payload || '';
  obj.conteudoHtmlGerado = obj.conteudoHtmlGerado || '';

  obj.conteudoObj = safeJsonParse_(obj.conteudoJson) || {};

  // Compat: campos vazios na linha mas presentes no JSON de conteúdo (bases antigas / import).
  var cj = obj.conteudoObj;
  obj.titulo = String(obj.titulo || cj.titulo || cj.title || cj.nome || '').trim() || 'POP sem título';
  if (!obj.area && cj.area) obj.area = String(cj.area);
  if (!obj.processo && cj.processo) obj.processo = String(cj.processo);

  // Status sempre canonizado (nunca undefined/null em memória).
  obj.status = normalizeStatus_(obj.status || 'rascunho');

  // viewer usa o próprio JSON; html derivado é opcional
  if (!obj.conteudoHtmlGerado) obj.conteudoHtmlGerado = '';

  return obj;
}

/** Motivo do filtro canView (logs de diagnóstico). */
function canViewPopReason_(user, pop) {
  var perfil = normalizePerfil_(user.perfil);
  if (perfil === 'diretor') return { ok: true, reason: 'diretor' };

  // Criador sempre enxerga o próprio POP (rascunho/fila), sem esconder por público-alvo/exclusivo.
  var uid = String(user.id || user.userId || '');
  var autor = String(pop.autorUserId || '');
  if (uid && autor && sameUsuarioId_(uid, autor)) return { ok: true, reason: 'autor' };

  // Após troca manual de id na planilha: mesmo criador se autorEmail bater.
  var uEm = String(user.email || '').trim().toLowerCase();
  var pEm = String(pop.autorEmail || '').trim().toLowerCase();
  if (uEm && pEm && uEm === pEm) return { ok: true, reason: 'autor_email' };

  // Gerente enxerga fila de aprovação da equipe (submetidos por colaboradores).
  if (perfil === 'gerente' && String(pop.status) === 'em_aprovacao') return { ok: true, reason: 'gerente_fila_aprovacao' };

  // Gerente enxerga próprios POPs já encaminhados ao diretor (fila direção).
  if (perfil === 'gerente' && String(pop.status) === 'aguardando_diretor' && uid && autor && sameUsuarioId_(uid, autor)) {
    return { ok: true, reason: 'gerente_proprio_aguardando_diretor' };
  }

  if (normalizeBoolean_(pop.exclusivoFarmaceutico)) {
    return perfil === 'farmaceutico' ? { ok: true, reason: 'exclusivo_ok' } : { ok: false, reason: 'exclusivo_farmaceutico' };
  }
  if (String(pop.publicoAlvo) === 'farmaceutico') {
    return perfil === 'farmaceutico' ? { ok: true, reason: 'publico_farmaceutico_ok' } : { ok: false, reason: 'publico_farmaceutico' };
  }
  return { ok: true, reason: 'geral' };
}

function canViewPop_(user, pop) {
  return canViewPopReason_(user, pop).ok;
}

function enrichPopsWithReadStatus_(user, pops) {
  var reads = listRows_(getSheet_(SHEET_LEITURAS));
  var byKey = {};
  reads.forEach(function (r) {
    var key = String(r.userId || '') + '|' + String(r.popId || '') + '|' + String(r.versaoId || '');
    byKey[key] = r;
  });

  return pops.map(function (p) {
    var key = String(user.id || user.userId || '') + '|' + String(p.popId) + '|' + String(p.versaoId);
    var leitura = byKey[key];
    p.lido = !!leitura;
    p.dataLeitura = leitura ? (leitura.lidaEm || '') : '';
    p.pdfUrl = ''; // Sprint 1: sem drive/pdf
    p.versao = String(p.versao || '1.0');
    return p;
  });
}

/** Garante string/JSON-safe para google.script.run (evita Date da planilha quebrar a serialização). */
function valueForClientJson_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    try {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (e) {
      return String(v);
    }
  }
  return String(v);
}

function conteudoObjClientSafe_(obj) {
  try {
    return JSON.parse(JSON.stringify(obj == null ? {} : obj));
  } catch (e) {
    return {};
  }
}

function toPortalPopCompat_(p) {
  // mantém nomes esperados no HTML atual: id/codigo/versao/status/criticidade/...
  var cj = conteudoObjClientSafe_(p.conteudoObj || {});
  return {
    id: p.popId,
    autorUserId: String(p.autorUserId || ''),
    codigo: p.numero,
    titulo: p.titulo,
    area: p.area,
    processo: p.processo,
    tipo: p.tipo || 'colaborativo',
    origem: String(p.origem || ''),
    versao: p.versao || '1.0',
    status: p.status,
    criticidade: p.criticidade,
    publicoAlvo: p.publicoAlvo || 'todos',
    leituraObrigatoria: !!p.leituraObrigatoria,
    treinamentoObrigatorio: !!p.treinamentoObrigatorio,
    lido: !!p.lido,
    dataLeitura: valueForClientJson_(p.dataLeitura),
    revisaoPrevista: valueForClientJson_(p.revisaoPrevista),
    vigenciaInicio: valueForClientJson_(p.vigenciaInicio),
    pdfUrl: '',
    conteudoObj: cj,
    // compat antigos
    payload: cj,
  };
}

function toPortalPopDetailCompat_(p) {
  // Mesma regra da lista: conteúdo só via clone JSON-safe (não repor p.conteudoObj cru).
  var c = conteudoObjClientSafe_(p.conteudoObj || {});
  var base = toPortalPopCompat_(p);
  base.resumoAlteracao = String(c.resumoAlteracao || '');
  base.motivoRevisao = String(c.motivoRevisao || '');
  base.anexos = Array.isArray(c.anexos) ? c.anexos : [];
  base.documentosRelacionados = Array.isArray(c.documentosRelacionados) ? c.documentosRelacionados : [];
  base.formulariosRelacionados = Array.isArray(c.formulariosRelacionados) ? c.formulariosRelacionados : [];
  base.documentosRelacionadosReferencias = Array.isArray(c.documentosRelacionadosReferencias) ? c.documentosRelacionadosReferencias : [];
  base.formulariosRelacionadosReferencias = Array.isArray(c.formulariosRelacionadosReferencias) ? c.formulariosRelacionadosReferencias : [];
  base.checklistObj = Array.isArray(c.checklist) ? c.checklist : [];
  base.conteudoObj = c;
  base.payload = c;
  base.autorNome = String(c.autorNome || '');
  base.tipo = p.tipo || 'colaborativo';
  base.origem = String(p.origem || '');
  return base;
}

function isLikelyRealDocumentLink_(s) {
  var t = normalizeText_(s);
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/drive\.google\.com|docs\.google\.com|sheets\.google\.com|forms\.gle|forms\.google\.com/i.test(t)) return true;
  return false;
}

function partitionDocLinksAndRefs_(stringArr) {
  var links = [];
  var refs = [];
  (stringArr || []).forEach(function (s) {
    var t = normalizeText_(s);
    if (!t) return;
    if (isLikelyRealDocumentLink_(t)) links.push(t);
    else refs.push(t);
  });
  return { links: links, refs: refs };
}

function findNomePrimeiroUsuarioAtivoPerfil_(perfilWanted) {
  var sheet = getSheet_(SHEET_USUARIOS);
  var rows = listRows_(sheet).filter(function (u) {
    return String(u.ativo).toLowerCase() !== 'false' && normalizePerfil_(u.perfil) === perfilWanted;
  });
  if (!rows.length) return '';
  return normalizeText_(rows[0].nome || rows[0].usuario || '');
}

function computeGovernancaDefaults_(user) {
  var perfil = normalizePerfil_(user.perfil);
  var nomeUser = normalizeText_(user.nome || user.usuario || user.email || '');
  var dono = nomeUser || 'Responsável pela versão';
  var apr = '';
  if (perfil === 'diretor') {
    // Evita colisão "autor == aprovador esperado" no POP crítico quando o próprio diretor cria o documento.
    var outroDir = findNomePrimeiroUsuarioAtivoPerfilDiferenteDe_('diretor', nomeUser);
    apr = outroDir || 'Diretoria — revisão independente';
  } else if (perfil === 'gerente') apr = findNomePrimeiroUsuarioAtivoPerfil_('diretor') || 'Diretor';
  else apr = findNomePrimeiroUsuarioAtivoPerfil_('gerente') || 'Gerente';
  return { autorNome: nomeUser || 'Autor', donoDocumento: dono, aprovadorEsperado: apr };
}

function findNomePrimeiroUsuarioAtivoPerfilDiferenteDe_(perfilWanted, nomeExcluir) {
  var alvo = iaBagNorm_(nomeExcluir || '');
  var sheet = getSheet_(SHEET_USUARIOS);
  var rows = listRows_(sheet).filter(function (u) {
    return String(u.ativo).toLowerCase() !== 'false' && normalizePerfil_(u.perfil) === perfilWanted;
  });
  for (var i = 0; i < rows.length; i++) {
    var n = normalizeText_(rows[i].nome || rows[i].usuario || '');
    if (!n) continue;
    if (alvo && iaBagNorm_(n) === alvo) continue;
    return n;
  }
  return '';
}

function resolveProcessoForArea_(area, processoInformado, catalog) {
  var a = normalizeText_(area);
  var p = normalizeText_(processoInformado);
  var list = (catalog || []).filter(function (x) { return normalizeText_(x.area) === a; }).map(function (x) { return normalizeText_(x.processo); });
  if (p && list.indexOf(p) >= 0) return { processo: p, needsReview: false };
  // Texto vindo do POP/JSON: aceitar sem marcar revisão (evita fricção; catálogo é guia, não bloqueio).
  if (p) return { processo: p, needsReview: false };
  if (!p && list.length) return { processo: list[0], needsReview: false };
  return { processo: p, needsReview: false };
}

function normalizePopJsonPayload_(user, incoming) {
  // Aceita tanto payload "flat" do HTML atual quanto "conteudoJson" estruturado.
  var obj = incoming || {};

  // Se vier "payload" ou "conteudoObj", considerar como conteudoJson principal
  var contentCandidate = obj.conteudoJson || obj.conteudoObj || obj.payload || null;
  if (typeof contentCandidate === 'string') contentCandidate = safeJsonParse_(contentCandidate) || {};
  if (!contentCandidate || typeof contentCandidate !== 'object') contentCandidate = {};

  var tipoPop = normalizeTipoPop_(obj.tipo || contentCandidate.tipo || 'colaborativo');

  var area = normalizeText_(obj.area || contentCandidate.area || '');
  var processoRaw = normalizeText_(obj.processo || contentCandidate.processo || '');
  var catalog = getProcessosCatalog_();
  var procResolved = resolveProcessoForArea_(area, processoRaw, catalog);

  var docFlat = normalizeStringArray_(obj.documentosRelacionados || contentCandidate.documentosRelacionados || []);
  var formFlat = normalizeStringArray_(obj.formulariosRelacionados || contentCandidate.formulariosRelacionados || []);
  var docP = partitionDocLinksAndRefs_(docFlat);
  var formP = partitionDocLinksAndRefs_(formFlat);
  var gov = computeGovernancaDefaults_(user);

  var errosComunsArr = normalizeStringArray_(obj.errosComuns || contentCandidate.errosComuns || []);
  var proibidoArr = normalizeStringArray_(obj.proibido || contentCandidate.proibido || []);
  if (!proibidoArr.length && errosComunsArr.length) proibidoArr = errosComunsArr.slice();

  var pontosDeAtencaoArr = normalizeStringArray_(obj.pontosDeAtencao || contentCandidate.pontosDeAtencao || []);
  var pontosCriticosArr = normalizeStringArray_(obj.pontos_criticos || contentCandidate.pontos_criticos || []);
  if (!pontosCriticosArr.length && pontosDeAtencaoArr.length) pontosCriticosArr = pontosDeAtencaoArr.slice();

  var procedimentoRaw = obj.procedimento !== undefined ? obj.procedimento : contentCandidate.procedimento;
  var procedimentoOut =
    tipoPop === 'critico'
      ? normalizeProcedimentoCriticoLista_(procedimentoRaw || [])
      : normalizeStringArray_(procedimentoRaw || []);
  var freqRaw = obj.frequencia !== undefined ? obj.frequencia : contentCandidate.frequencia;
  var frequenciaOut =
    tipoPop === 'critico' ? normalizeFrequenciaCritico_(freqRaw || '') : normalizeText_(freqRaw || '');

  // O HTML atual manda um objeto gigante "flat"; vamos montar um conteudoJson coerente.
  var conteudoJson = {
    diretriz_executiva: normalizeText_(obj.diretriz_executiva || contentCandidate.diretriz_executiva || ''),
    objetivo: normalizeText_(obj.objetivo || contentCandidate.objetivo || ''),
    escopo: normalizeText_(obj.escopo || contentCandidate.escopo || ''),
    responsaveis: normalizeStringArray_(obj.responsaveis || contentCandidate.responsaveis || []),
    materiais_epi: normalizeStringArray_(obj.materiais_epi || contentCandidate.materiais_epi || []),
    regra_de_ouro: normalizeText_(obj.regra_de_ouro || contentCandidate.regra_de_ouro || ''),
    frequencia: frequenciaOut,
    procedimento: procedimentoOut,
    errosComuns: errosComunsArr,
    pontosDeAtencao: pontosDeAtencaoArr,
    proibido: proibidoArr,
    pontos_criticos: pontosCriticosArr,
    checklist_lider: normalizeStringArray_(obj.checklist_lider || contentCandidate.checklist_lider || []),
    checklist: normalizeStringArray_(obj.checklist || contentCandidate.checklist || []),
    desvios: normalizeStringArray_(obj.desvios || contentCandidate.desvios || []),
    metrica: normalizeText_(obj.metrica || contentCandidate.metrica || ''),
    treinamento: normalizeText_(obj.treinamento || contentCandidate.treinamento || ''),
    como_fazer_bem: normalizeText_(
      obj.como_fazer_bem ||
        obj.comoFazerBem ||
        contentCandidate.como_fazer_bem ||
        contentCandidate.comoFazerBem ||
        ''
    ),
    erro_critico: normalizeText_(
      obj.erro_critico || obj.erroCritico || contentCandidate.erro_critico || contentCandidate.erroCritico || ''
    ),

    // metadados "do documento" também ficam governáveis no JSON
    versao: normalizeText_(obj.versao || contentCandidate.versao || '1.0'),
    publicoAlvo: normalizePerfil_(obj.publicoAlvo || contentCandidate.publicoAlvo || 'todos'),
    resumoAlteracao: normalizeText_(obj.resumoAlteracao || contentCandidate.resumoAlteracao || 'Criação inicial'),
    motivoRevisao: normalizeText_(obj.motivoRevisao || contentCandidate.motivoRevisao || ''),
    anexos: normalizeStringArray_(obj.anexos || contentCandidate.anexos || []),
    documentosRelacionados: docP.links,
    documentosRelacionadosReferencias: docP.refs,
    formulariosRelacionados: formP.links,
    formulariosRelacionadosReferencias: formP.refs,
    processoRevisaoPendente: procResolved.needsReview,
    autorNome: normalizeText_(obj.autorNome || contentCandidate.autorNome || '') || gov.autorNome,
    donoDocumento: normalizeText_(obj.donoDocumento || contentCandidate.donoDocumento || '') || gov.donoDocumento,
    aprovadorEsperado: normalizeText_(obj.aprovador || contentCandidate.aprovador || contentCandidate.aprovadorEsperado || '') || gov.aprovadorEsperado,
    tipoFluxo: tipoPop,
  };

  return {
    popId: normalizeText_(obj.popId || obj.id || contentCandidate.popId || ''),
    numero: normalizeText_(obj.numero || obj.codigo || contentCandidate.numero || contentCandidate.codigo || ''),
    versao: normalizeText_(obj.versao || contentCandidate.versao || '1.0'),
    titulo: normalizeText_(obj.titulo || contentCandidate.titulo || ''),
    area: area,
    processo: procResolved.processo,
    criticidade: normalizeCriticidade_(obj.criticidade || contentCandidate.criticidade || 'media'),
    // Importante: não defaultar para rascunho quando status vier ausente no payload (edição preserva status no updatePopDraft_).
    status: (function () {
      var raw = obj.status != null ? String(obj.status) : contentCandidate.status != null ? String(contentCandidate.status) : '';
      raw = normalizeText_(raw);
      if (!raw) return '';
      return normalizeStatus_(raw);
    })(),
    exclusivoFarmaceutico: normalizeBoolean_(obj.exclusivoFarmaceutico || false),
    leituraObrigatoria: obj.leituraObrigatoria !== undefined ? normalizeBoolean_(obj.leituraObrigatoria) : true,
    treinamentoObrigatorio: obj.treinamentoObrigatorio !== undefined ? normalizeBoolean_(obj.treinamentoObrigatorio) : true,
    publicoAlvo: normalizePerfil_(obj.publicoAlvo || contentCandidate.publicoAlvo || 'todos'),
    tags: normalizeText_(obj.tags || ''),
    vigenciaInicio: (function () {
      var v = normalizeText_(obj.vigenciaInicio || contentCandidate.vigenciaInicio || '');
      return v || formatDateIso_(new Date());
    })(),
    revisaoPrevista: (function () {
      var r = normalizeText_(obj.revisaoPrevista || contentCandidate.revisaoPrevista || '');
      var crit = normalizeCriticidade_(obj.criticidade || contentCandidate.criticidade || 'media');
      return r || computeRevisaoPrevista_(crit);
    })(),
    donoDocumento: conteudoJson.donoDocumento,
    aprovador: conteudoJson.aprovadorEsperado,
    autorNome: conteudoJson.autorNome,
    conteudoJson: conteudoJson,
    conteudoHtmlGerado: '', // derivado opcional
    tipo: tipoPop,
    origem: normalizeOrigemPop_(obj.origem || contentCandidate.origem || ''),
  };
}

function generatePopNumeroForFamily_(popId) {
  // numero estável por família: persiste no Parametros (popId -> numero)
  var key = 'POP_NUMERO_FOR_' + String(popId);
  var existing = getParam_(key);
  if (existing) return existing;

  var seq = parseInt(getParam_('POP_NUM_SEQ') || '0', 10);
  if (!seq || seq < 0) seq = 0;
  seq++;
  setParam_('POP_NUM_SEQ', String(seq));

  var numero = 'POP-' + String(seq).padStart(4, '0');
  setParam_(key, numero);
  return numero;
}

function computeRevisaoPrevista_(criticidade) {
  var crit = normalizeCriticidade_(criticidade);
  var days = 90;
  if (crit === 'critica') days = 30;
  else if (crit === 'alta') days = 60;
  else days = 90;
  var d = new Date();
  d.setDate(d.getDate() + days);
  return formatDateIso_(d);
}

// =============================================================================
// Core: Leituras
// =============================================================================

function confirmRead_(user, pop) {
  var existing = getReadForUserAndVersion_(user.id || user.userId || '', pop.popId, pop.versaoId);
  if (existing) return existing;

  var sheet = getSheet_(SHEET_LEITURAS);
  var headers = getHeaders_(sheet);

  var now = new Date();
  var leitura = {
    leituraId: uuid_(),
    userId: String(user.id || user.userId || ''),
    popId: String(pop.popId),
    versaoId: String(pop.versaoId),
    lidaEm: now,
    expiraEm: '', // Sprint 4 pode usar expiração de leitura
    confirmacao: true,
    observacao: '',
  };
  appendRowObj_(sheet, headers, leitura);
  return leitura;
}

function getReadForUserAndVersion_(userId, popId, versaoId) {
  var reads = listRows_(getSheet_(SHEET_LEITURAS));
  return reads.find(function (r) {
    return String(r.userId || '') === String(userId) &&
      String(r.popId || '') === String(popId) &&
      String(r.versaoId || '') === String(versaoId);
  }) || null;
}

function listMyPendingReads_(user) {
  var pops = getPopsLibraryForUser_(user).filter(function (p) {
    return p.status === 'vigente' && !!p.leituraObrigatoria && !p.lido;
  });
  return pops.map(function (p) {
    return {
      popId: p.popId,
      versaoId: p.versaoId,
      numero: p.numero,
      titulo: p.titulo,
      criticidade: p.criticidade,
    };
  });
}

function listPendingCriticalReads_(user) {
  return getPopsLibraryForUser_(user)
    .filter(function (p) {
      return p.status === 'vigente' &&
        !!p.leituraObrigatoria &&
        !p.lido &&
        String(p.criticidade) === 'critica';
    })
    .map(function (p) {
      return { popId: p.popId, versaoId: p.versaoId, numero: p.numero, titulo: p.titulo };
    });
}

// =============================================================================
// Portal Stats / Dashboard helpers
// =============================================================================

function computePortalStats_(user, pops) {
  var total = pops.length;
  var vigentes = pops.filter(function (p) { return p.status === 'vigente'; });
  var totalVigentes = vigentes.length;
  var criticosVigentes = vigentes.filter(function (p) { return p.criticidade === 'critica' || p.criticidade === 'alta'; }).length;
  var lidos = vigentes.filter(function (p) { return p.lido; }).length;
  var pendentes = vigentes.filter(function (p) { return p.leituraObrigatoria && !p.lido; }).length;

  return {
    total: totalVigentes,
    totalVigentes: totalVigentes,
    totalBiblioteca: total,
    criticos: criticosVigentes,
    criticosVigentes: criticosVigentes,
    lidos: lidos,
    pendentes: pendentes,
  };
}

function countActiveUsers_() {
  var users = listRows_(getSheet_(SHEET_USUARIOS));
  return users.filter(function (u) { return String(u.ativo).toLowerCase() !== 'false'; }).length;
}

function safeBuildRankingConformidade_(viewer) {
  try {
    return buildRankingConformidade_(viewer);
  } catch (e) {
    popDiagLog_('buildRankingConformidade.error', { err: String(e && e.message ? e.message : e) });
    return [];
  }
}

function buildRankingConformidade_(viewer) {
  // ranking simples Sprint 1: % de POPs vigentes obrigatórios lidos
  var users = listRows_(getSheet_(SHEET_USUARIOS)).filter(function (u) { return String(u.ativo).toLowerCase() !== 'false'; });
  if (viewer && normalizePerfil_(viewer.perfil) === 'gerente') {
    users = users.filter(function (u) { return normalizePerfil_(u.perfil) !== 'diretor'; });
  }
  var allPops = listRows_(getSheet_(SHEET_POPS)).map(function (r) { return normalizePopRow_(r); });
  var vigentesObrig = allPops.filter(function (p) { return p.status === 'vigente' && !!p.leituraObrigatoria; });
  var reads = listRows_(getSheet_(SHEET_LEITURAS));

  var out = users.map(function (u) {
    var userObj = { id: String(u.id || u.userId || ''), perfil: normalizePerfil_(u.perfil) };
    var popsForUser = vigentesObrig.filter(function (p) { return canViewPop_(userObj, p); });
    var total = popsForUser.length;
    var lidos = popsForUser.filter(function (p) {
      return reads.find(function (r) {
        return String(r.userId) === String(userObj.id) &&
          String(r.popId) === String(p.popId) &&
          String(r.versaoId) === String(p.versaoId);
      });
    }).length;
    var percentual = total ? Math.round((lidos / total) * 100) : 100;
    return {
      usuarioNome: String(u.nome || ''),
      lidos: lidos,
      obrigatorios: total,
      percentual: percentual,
    };
  });

  out.sort(function (a, b) { return (b.percentual - a.percentual) || a.usuarioNome.localeCompare(b.usuarioNome); });
  return out;
}

function buildMeusPendentes_(user) {
  var pending = listMyPendingReads_(user);
  return pending.slice(0, 8).map(function (p) {
    return { titulo: p.titulo, criticidade: p.criticidade };
  });
}

// =============================================================================
// Schema / DB helpers
// =============================================================================

function ensureSchema_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheet_(ss, SHEET_USUARIOS, [
    'id', 'email', 'nome', 'usuario', 'senha', 'perfil', 'ativo', 'criadoEm', 'atualizadoEm', 'codigo',
  ]);
  backfillUsuarioCodigos_();

  // Sprint 1 (ajuste obrigatório): sessões enxutas + usuario (login estável após troca manual de id)
  ensureSheet_(ss, SHEET_SESSOES, [
    'sessionId', 'userId', 'email', 'criadoEm', 'expiraEm', 'revogadoEm', 'usuario',
  ]);

  ensureSheet_(ss, SHEET_POPS, [
    'popId',
    'versaoId',
    'numero',
    'versao',
    'titulo',
    'area',
    'processo',
    'criticidade',
    'status',
    'exclusivoFarmaceutico',
    'leituraObrigatoria',
    'treinamentoObrigatorio',
    'publicoAlvo',
    'tags',
    'vigenciaInicio',
    'revisaoPrevista',
    'autorUserId',
    'autorEmail',
    'criadoEm',
    'atualizadoEm',
    'conteudoJson',
    'conteudoHtmlGerado',
    'drivePdfFileId',
    'driveFolderAnexosId',
    'tipo',
    'origem',
  ]);

  ensureSheet_(ss, SHEET_LEITURAS, [
    'leituraId',
    'userId',
    'popId',
    'versaoId',
    'lidaEm',
    'expiraEm',
    'confirmacao',
    'observacao',
  ]);

  ensureSheet_(ss, SHEET_PARAMETROS, ['chave', 'valor', 'atualizadoEm']);
  ensureSheet_(ss, SHEET_AUDITORIA, ['eventoId', 'quando', 'userId', 'acao', 'entidade', 'entidadeId', 'detalhesJson']);
  ensureSheet_(ss, SHEET_LOGS_FLUXO, [
    'id',
    'userId',
    'acao',
    'etapa',
    'status',
    'mensagem',
    'tipo',
    'origem',
    'popId',
    'timestamp',
    'payloadResumo',
  ]);

  seedDefaultAdminIfEmpty_(ss);
}

function seedDefaultAdminIfEmpty_(ss) {
  var sh = ss.getSheetByName(SHEET_USUARIOS);
  var data = sh.getDataRange().getValues();
  if (data.length > 1) return;

  // Usuário inicial: diretor / admin
  var headers = data[0];
  var userId = uuid_();
  var row = objToRow_(headers, {
    id: userId,
    email: '',
    nome: 'Diretor (Admin)',
    usuario: 'admin',
    senha: 'admin',
    perfil: 'diretor',
    ativo: true,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    codigo: '1',
  });
  sh.appendRow(row);
}

function loginMatchesUsuarioCodigo_(loginInput, codigoCell) {
  var raw = String(codigoCell != null ? codigoCell : '').trim();
  if (!raw && codigoCell != null && typeof codigoCell === 'number') raw = String(codigoCell);
  if (!raw) return false;
  var login = String(loginInput || '').trim();
  if (login === raw) return true;
  if (/^\d+$/.test(login) && /^\d+$/.test(raw)) return parseInt(login, 10) === parseInt(raw, 10);
  return false;
}

function maxUsuarioCodigoNumerico_(rows) {
  var maxC = 0;
  (rows || []).forEach(function (u) {
    var c = String(u.codigo != null ? u.codigo : '').trim();
    if (/^\d+$/.test(c)) {
      var n = parseInt(c, 10);
      if (!isNaN(n) && n > maxC) maxC = n;
    }
  });
  return maxC;
}

function nextUsuarioCodigoDisponivel_() {
  return maxUsuarioCodigoNumerico_(listRows_(getSheet_(SHEET_USUARIOS))) + 1;
}

function backfillUsuarioCodigos_() {
  var sheet = getSheet_(SHEET_USUARIOS);
  var headers = getHeaders_(sheet);
  if (headers.indexOf('codigo') < 0) return;
  var rows = listRowsWithRowIndex_(sheet);
  var next = maxUsuarioCodigoNumerico_(rows.map(function (r) { return r.obj; })) + 1;
  rows.forEach(function (r) {
    var c = String(r.obj.codigo != null ? r.obj.codigo : '').trim();
    if (c) return;
    setCell_(sheet, r.rowIndex, 'codigo', String(next));
    next++;
  });
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var range = sh.getDataRange();
  var values = range.getValues();
  if (values.length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  if (values.length === 1 && values[0].length === 1 && values[0][0] === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  var existingHeaders = values[0].map(function (h) { return String(h || '').trim(); });
  var needsWrite = false;
  headers.forEach(function (h, idx) {
    if (existingHeaders[idx] !== h) needsWrite = true;
  });

  // Se for uma sheet nova ou inconsistente, força cabeçalho na primeira linha.
  if (needsWrite) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function getSheet_(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Aba não encontrada: ' + name);
  return sh;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var values = sheet.getRange(1, 1, 1, lastCol).getValues();
  return (values[0] || []).map(function (h, idx) {
    var s = String(h || '').trim();
    // NUNCA remover coluna: célula vazia no cabeçalho deslocava popId/titulo e “sumia” POP na leitura.
    return s || '_col' + (idx + 1);
  });
}

function listRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = getHeaders_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var values = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  return values
    .filter(function (row) { return row.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (row) { return rowToObj_(headers, row); });
}

function listRowsWithRowIndex_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = getHeaders_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var values = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row.some(function (c) { return c !== '' && c !== null; })) continue;
    out.push({ rowIndex: i + 2, obj: rowToObj_(headers, row) });
  }
  return out;
}

function appendRowObj_(sheet, headers, obj) {
  sheet.appendRow(objToRow_(headers, obj));
}

function applyRowPatch_(sheet, rowIndex, patchObj) {
  var headers = getHeaders_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var current = rowToObj_(headers, sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0]);
  var merged = merge_(current, patchObj);
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([objToRow_(headers, merged)]);
}

function setCell_(sheet, rowIndex, headerName, value) {
  var headers = getHeaders_(sheet);
  var idx = headers.indexOf(headerName);
  if (idx < 0) return;
  sheet.getRange(rowIndex, idx + 1).setValue(value);
}

function rowToObj_(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }
  return obj;
}

function objToRow_(headers, obj) {
  return headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
}

// =============================================================================
// Parametros
// =============================================================================

function getParam_(key) {
  var sheet = getSheet_(SHEET_PARAMETROS);
  var rows = listRows_(sheet);
  var match = rows.find(function (r) { return String(r.chave) === String(key); });
  return match ? String(match.valor || '') : '';
}

function setParam_(key, value) {
  var sheet = getSheet_(SHEET_PARAMETROS);
  var rows = listRowsWithRowIndex_(sheet);
  var match = rows.find(function (r) { return String(r.obj.chave) === String(key); });
  var now = new Date();
  if (match) {
    applyRowPatch_(sheet, match.rowIndex, { chave: key, valor: String(value || ''), atualizadoEm: now });
    return;
  }
  appendRowObj_(sheet, getHeaders_(sheet), { chave: key, valor: String(value || ''), atualizadoEm: now });
}

// =============================================================================
// Auditoria
// =============================================================================

function logAudit_(user, acao, entidade, entidadeId, details) {
  var sheet = getSheet_(SHEET_AUDITORIA);
  var headers = getHeaders_(sheet);
  var row = {
    eventoId: uuid_(),
    quando: new Date(),
    userId: String(user && (user.id || user.userId) || ''),
    acao: String(acao || ''),
    entidade: String(entidade || ''),
    entidadeId: String(entidadeId || ''),
    detalhesJson: JSON.stringify(details || {}),
  };
  appendRowObj_(sheet, headers, row);
}

/** Resumo curto para coluna payloadResumo (máx. 500 caracteres). */
function fluxoResumoPayloadMax500_(v) {
  var s = '';
  if (v == null) s = '';
  else if (typeof v === 'string') s = v;
  else {
    try {
      s = JSON.stringify(v);
    } catch (e) {
      s = String(v);
    }
  }
  s = String(s);
  if (s.length <= 500) return s;
  return s.substring(0, 499) + '…';
}

/**
 * Log append-only na aba LogsFluxo (trilha colaborativa).
 * acao: copiar_prompt | validacao_json | salvar_rascunho | enviar_aprovacao | erro_fluxo_colaborativo | pop_input_abandonado
 * etapa (funil POP): input | preview | aprovacao
 */
function logFluxo_(user, fields) {
  fields = fields || {};
  try {
    ensureSchema_();
    var sheet = getSheet_(SHEET_LOGS_FLUXO);
    var headers = getHeaders_(sheet);
    var row = {
      id: uuid_(),
      userId: String(user && (user.id || user.userId) || ''),
      acao: String(fields.acao || ''),
      etapa: String(fields.etapa || ''),
      status: String(fields.status || ''),
      mensagem: String(fields.mensagem != null ? fields.mensagem : '').substring(0, 2000),
      tipo: String(fields.tipo || ''),
      origem: String(fields.origem || ''),
      popId: String(fields.popId || ''),
      timestamp: new Date(),
      payloadResumo: fluxoResumoPayloadMax500_(fields.payloadResumo != null ? fields.payloadResumo : ''),
    };
    appendRowObj_(sheet, headers, row);
  } catch (e) {
    try {
      Logger.log('[logFluxo_] ' + String(e && e.message ? e.message : e));
    } catch (e2) {}
  }
}

/** Compat HTML: registra evento da trilha (ex.: copiar_prompt no cliente). */
function registrarLogFluxoColaborativo(token, partial) {
  try {
    ensureSchema_();
    var ctx = requireSession_(token);
    assertCan_(ctx.user, 'POP_CREATE_DRAFT');
    partial = partial || {};
    logFluxo_(ctx.user, {
      acao: partial.acao,
      etapa: partial.etapa,
      status: partial.status,
      mensagem: partial.mensagem,
      tipo: partial.tipo,
      origem: partial.origem,
      popId: partial.popId,
      payloadResumo: partial.payloadResumo,
    });
    return { ok: true };
  } catch (e) {
    try {
      Logger.log('[registrarLogFluxoColaborativo] ' + String(e && e.message ? e.message : e));
    } catch (e2) {}
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/** Normaliza etapa do funil enviada pelo cliente (abandono). */
function normalizarEtapaAbandonoFluxo_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (s === 'preview' || s === 'aprovacao') return s;
  return 'input';
}

/** Abandono mínimo do bloco de entrada da IA (sem novo sistema de eventos). */
function registrarPopInputAbandonadoIa(token, tempoSegundos, etapaFluxo) {
  try {
    ensureSchema_();
    var ctx = requireSession_(token);
    assertCan_(ctx.user, 'POP_CREATE_DRAFT');
    var sec = Math.max(0, Math.floor(Number(tempoSegundos) || 0));
    var etapaLog = normalizarEtapaAbandonoFluxo_(etapaFluxo);
    var u = ctx.user || {};
    logFluxo_(ctx.user, {
      acao: 'pop_input_abandonado',
      etapa: etapaLog,
      status: 'ok',
      mensagem: '',
      tipo: 'ia_conceito',
      origem: 'geracao_ia_conceito',
      popId: '',
      payloadResumo: {
        usuario: String(u.nome || u.usuario || u.email || u.id || u.userId || ''),
        tempo_ate_abandono: sec,
        versao_prompt: IA_POP_PROMPT_VERSAO_,
      },
    });
    return { ok: true };
  } catch (e) {
    try {
      Logger.log('[registrarPopInputAbandonadoIa] ' + String(e && e.message ? e.message : e));
    } catch (e2) {}
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

// =============================================================================
// Utils: normalize / dates / json / envelope
// =============================================================================

function ok_(data) {
  return { ok: true, data: data };
}

function fail_(code, message, details) {
  return { ok: false, error: { code: code, message: message, details: details || null } };
}

function okCompat_(obj) {
  // compat com HTML atual que espera { ok: true, ... }
  var out = clone_(obj || {});
  out.ok = true;
  return out;
}

function uuid_() {
  return Utilities.getUuid();
}

function normalizeText_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/** Converte item de lista (string ou objeto vindo de JSON/IA) em texto único — evita "[object Object]". */
function stringifyMixedContentItem_(x) {
  if (x === null || x === undefined) return '';
  if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return String(x).trim();
  if (typeof x !== 'object') return String(x);
  if (Array.isArray(x)) {
    return x
      .map(function (y) {
        return stringifyMixedContentItem_(y);
      })
      .filter(Boolean)
      .join(' — ');
  }
  var keys = [
    'texto',
    'descricao',
    'descricao_passo',
    'passo',
    'item',
    'titulo',
    'conteudo',
    'label',
    'detalhe',
    'acao',
    'nome',
    'valor',
  ];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
    var v = x[k];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
    if (typeof v === 'object') {
      var inner = stringifyMixedContentItem_(v);
      if (inner) return inner;
    }
  }
  try {
    return JSON.stringify(x);
  } catch (e) {
    return '';
  }
}

function normalizePerfil_(p) {
  return String(p || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeStatus_(v) {
  var value = String(v || '').toLowerCase().trim();
  if (value.indexOf('vigente') >= 0 || value.indexOf('aprovado') >= 0 || value.indexOf('publicado') >= 0) return 'vigente';
  if (value.indexOf('aguardando') >= 0 && value.indexOf('diretor') >= 0) return 'aguardando_diretor';
  if (value.indexOf('revis') >= 0) return 'em revisão';
  if (value.indexOf('em_aprov') >= 0) return 'em_aprovacao';
  if (value.indexOf('reprov') >= 0) return 'reprovado';
  return 'rascunho';
}

function normalizeCriticidade_(v) {
  var value = String(v || '').toLowerCase().trim();
  if (value.indexOf('crit') >= 0) return 'critica';
  if (value.indexOf('alta') >= 0) return 'alta';
  if (value.indexOf('baixa') >= 0) return 'baixa';
  return 'media';
}

function normalizeBoolean_(v) {
  if (v === true || v === false) return v;
  return ['true', '1', 'sim', 'yes'].indexOf(String(v || '').toLowerCase().trim()) >= 0;
}

function normalizeStringArray_(v) {
  if (Array.isArray(v)) {
    return v.map(function (x) { return stringifyMixedContentItem_(x); }).filter(Boolean);
  }
  // se vier string grande (textarea), tenta quebrar por linha
  var s = normalizeText_(v);
  if (!s) return [];
  if (s.indexOf('\n') >= 0) return s.split('\n').map(function (x) { return normalizeText_(x); }).filter(Boolean);
  // se vier separado por vírgula
  if (s.indexOf(',') >= 0) return s.split(',').map(function (x) { return normalizeText_(x); }).filter(Boolean);
  return [s];
}

function safeJsonParse_(s) {
  if (!s) return null;
  try {
    return JSON.parse(String(s));
  } catch (e) {
    return null;
  }
}

function parseDateSafe_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return value;
  var d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatDateIso_(date) {
  var d = parseDateSafe_(date);
  if (!d) return '';
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function clone_(obj) {
  var out = {};
  for (var k in obj) out[k] = obj[k];
  return out;
}

function merge_(a, b) {
  var out = clone_(a || {});
  for (var k in b) {
    if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
}

function indexBy_(arr, keyFn) {
  var out = {};
  (arr || []).forEach(function (x) { out[String(keyFn(x))] = x; });
  return out;
}

