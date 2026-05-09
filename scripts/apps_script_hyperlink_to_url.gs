/**
 * Xertica — Conversor de Hyperlinks para URL puro
 * ------------------------------------------------
 * Use nas planilhas:
 *   - "XERTICA - Controle de Documentos - Para Licitações - Contratos"
 *   - "XERTICA - Controle de Documentos - Para Licitações - Atestados"
 *
 * O que faz:
 *   Percorre as colunas marcadas em LINK_COLUMNS (ou TODAS, se vazio) e
 *   substitui cada célula que contenha hyperlink (rich text OU fórmula
 *   =HYPERLINK) pela URL pura — assim o export CSV traz o link real e não
 *   só o texto exibido.
 *
 * Como instalar:
 *   1. Abra a planilha no Google Sheets.
 *   2. Extensões → Apps Script → cole este arquivo (substitua o Code.gs).
 *   3. Salve. Recarregue a planilha.
 *   4. Vai aparecer o menu "🔗 Xertica Links" na barra.
 *
 * Como usar:
 *   - "Converter aba ATIVA"           → roda só na aba aberta
 *   - "Converter TODAS as abas"       → roda na planilha inteira
 *   - "Pré-visualizar (dry run)"      → conta quantas células seriam alteradas
 *
 * Segurança:
 *   - Cria automaticamente um backup da aba antes de gravar (sufixo "_BKP_<timestamp>").
 *   - Só altera células que de fato contêm hyperlink. Texto puro fica intacto.
 *   - Se a célula tiver MÚLTIPLOS hyperlinks no mesmo texto, junta todas
 *     as URLs separadas por " | ".
 */

// ── Config ────────────────────────────────────────────────────────────────
// Deixe vazio [] para varrer TODAS as colunas. Ou liste por nome de cabeçalho:
const LINK_COLUMNS = [
  // — Atestados —
  'Link do contrato',
  'Link de acesso',
  'Link de acesso  (atestado traduzido)',
  'Link de acesso  (atestado apostilado)',
  'Link atestado inserido 1',
  'Link atestado inserido 2',
  // — Contratos —
  'Link pasta do Cliente/Órgão',
  'Link contrato',
  'Link do atestado gerado',
  'Imagem logo órgão',
];

const HEADER_ROW = 1;          // linha do cabeçalho (1-indexed)
const CREATE_BACKUP = true;    // cria aba "<nome>_BKP_<ts>" antes de alterar
const BATCH_LOG_EVERY = 200;   // log de progresso a cada N linhas

// ── Menu ──────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔗 Xertica Links')
    .addItem('Converter aba ATIVA', 'convertActiveSheet')
    .addItem('Converter TODAS as abas', 'convertAllSheets')
    .addSeparator()
    .addItem('Pré-visualizar (dry run) aba ativa', 'dryRunActiveSheet')
    .addToUi();
}

// ── Entry points ──────────────────────────────────────────────────────────
function convertActiveSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const result = convertSheet_(sheet, /*dryRun*/ false);
  showResult_('Conversão concluída', sheet.getName(), result);
}

function convertAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = [];
  ss.getSheets().forEach((sh) => {
    if (sh.getName().indexOf('_BKP_') !== -1) return; // pula backups
    const r = convertSheet_(sh, false);
    summary.push(`• ${sh.getName()}: ${r.cellsChanged} células · ${r.linksFound} links`);
  });
  SpreadsheetApp.getUi().alert('Conversão (todas as abas)', summary.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function dryRunActiveSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const result = convertSheet_(sheet, /*dryRun*/ true);
  showResult_('Pré-visualização (nada foi alterado)', sheet.getName(), result);
}

// ── Core ──────────────────────────────────────────────────────────────────
function convertSheet_(sheet, dryRun) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < HEADER_ROW + 1 || lastCol < 1) {
    return { cellsChanged: 0, linksFound: 0, columnsTouched: [] };
  }

  // Resolve quais colunas processar
  const headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
  const targetCols = [];
  if (LINK_COLUMNS.length === 0) {
    for (let c = 1; c <= lastCol; c++) targetCols.push(c);
  } else {
    const wanted = new Set(LINK_COLUMNS.map((s) => s.trim().toLowerCase()));
    headers.forEach((h, i) => {
      if (wanted.has(String(h || '').trim().toLowerCase())) targetCols.push(i + 1);
    });
  }
  if (targetCols.length === 0) {
    return { cellsChanged: 0, linksFound: 0, columnsTouched: [], note: 'Nenhuma coluna alvo encontrada' };
  }

  // Backup
  if (!dryRun && CREATE_BACKUP) {
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyyMMdd_HHmmss');
    const bkpName = `${sheet.getName()}_BKP_${ts}`;
    sheet.copyTo(sheet.getParent()).setName(bkpName);
  }

  let cellsChanged = 0;
  let linksFound = 0;
  const dataStartRow = HEADER_ROW + 1;
  const numRows = lastRow - HEADER_ROW;
  const columnsTouched = [];

  targetCols.forEach((col) => {
    const range = sheet.getRange(dataStartRow, col, numRows, 1);
    const richValues = range.getRichTextValues();
    const formulas = range.getFormulas();
    const displayValues = range.getDisplayValues();

    const newValues = new Array(numRows);
    let colChanged = 0;

    for (let i = 0; i < numRows; i++) {
      const rich = richValues[i][0];
      const formula = formulas[i][0];
      const display = displayValues[i][0];

      const urls = extractUrls_(rich, formula);
      if (urls.length === 0) {
        newValues[i] = [display]; // mantém como está
        continue;
      }

      linksFound += urls.length;
      const merged = urls.join(' | ');
      if (merged !== display) {
        cellsChanged++;
        colChanged++;
      }
      newValues[i] = [merged];

      if ((i + 1) % BATCH_LOG_EVERY === 0) {
        Logger.log(`  col=${col} row=${i + dataStartRow} → ${merged.substring(0, 80)}`);
      }
    }

    if (!dryRun && colChanged > 0) {
      range.setValues(newValues);
      // Limpa formato hyperlink residual (não interfere em texto puro)
      range.setShowHyperlink(false);
    }
    if (colChanged > 0) {
      columnsTouched.push(`${headers[col - 1]} (${colChanged})`);
    }
  });

  return { cellsChanged, linksFound, columnsTouched };
}

/**
 * Extrai URLs de uma célula. Retorna array (pode ter 0, 1, ou várias).
 * Ordem de prioridade:
 *   1. Rich text com runs de hyperlink → todas as URLs únicas dos runs.
 *   2. Fórmula =HYPERLINK("url"; "label") → URL do primeiro arg.
 *   3. Vazio.
 */
function extractUrls_(richTextValue, formula) {
  const out = [];
  const seen = new Set();

  // 1) Rich text runs
  if (richTextValue && typeof richTextValue.getRuns === 'function') {
    const runs = richTextValue.getRuns();
    runs.forEach((run) => {
      const url = run.getLinkUrl();
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    });
    if (out.length === 0) {
      // fallback: link único da célula inteira
      const url = richTextValue.getLinkUrl && richTextValue.getLinkUrl();
      if (url) out.push(url);
    }
  }

  // 2) Fórmula HYPERLINK
  if (out.length === 0 && formula && /^=\s*HYPERLINK\s*\(/i.test(formula)) {
    const m = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (m && m[1]) out.push(m[1]);
  }

  return out;
}

function showResult_(title, sheetName, r) {
  const ui = SpreadsheetApp.getUi();
  const cols = r.columnsTouched && r.columnsTouched.length
    ? r.columnsTouched.join('\n  • ')
    : '(nenhuma)';
  const note = r.note ? `\n\n⚠ ${r.note}` : '';
  ui.alert(
    title,
    `Aba: ${sheetName}\n` +
    `Links encontrados: ${r.linksFound}\n` +
    `Células alteradas: ${r.cellsChanged}\n\n` +
    `Colunas afetadas:\n  • ${cols}${note}`,
    ui.ButtonSet.OK
  );
}
