// Acesso genérico ao Google Sheets: cada aba é uma tabela, a linha 1 é o cabeçalho.
import { sheets as criarSheets, auth as googleAuth } from "@googleapis/sheets";
import { config } from "./config.js";

let clienteSheets;
function api() {
  if (!clienteSheets) {
    const credenciais = config.google.contaDeServico;
    const auth = new googleAuth.GoogleAuth({
      credentials: credenciais,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    clienteSheets = criarSheets({ version: "v4", auth });
  }
  return clienteSheets;
}

function aspas(aba) {
  return `'${aba.replace(/'/g, "''")}'`;
}

function letraColuna(indice) {
  let s = "";
  let n = indice + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Lê a aba inteira como lista de objetos. Cada objeto ganha `_linha` (número da linha na planilha). */
export async function lerTabela(aba) {
  const { data } = await api().spreadsheets.values.get({
    spreadsheetId: config.google.planilhaId,
    range: aspas(aba),
    valueRenderOption: "FORMATTED_VALUE",
  });
  const [cabecalho = [], ...linhas] = data.values || [];
  const colunas = cabecalho.map((c) => String(c).trim());
  return linhas
    .map((linha, i) => {
      const obj = { _linha: i + 2 };
      colunas.forEach((col, j) => { if (col) obj[col] = linha[j] ?? ""; });
      return obj;
    })
    .filter((obj) => colunas.some((c) => c && String(obj[c]).trim() !== ""));
}

async function lerCabecalho(aba) {
  const { data } = await api().spreadsheets.values.get({
    spreadsheetId: config.google.planilhaId,
    range: `${aspas(aba)}!1:1`,
  });
  return (data.values?.[0] || []).map((c) => String(c).trim());
}

/** Acrescenta uma linha no fim da aba, encaixando os campos pelo nome da coluna. */
export async function adicionarLinha(aba, objeto) {
  const cabecalho = await lerCabecalho(aba);
  const linha = cabecalho.map((col) => objeto[col] ?? "");
  await api().spreadsheets.values.append({
    spreadsheetId: config.google.planilhaId,
    range: aspas(aba),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [linha] },
  });
}

/** Atualiza só as colunas informadas de uma linha. */
export async function atualizarLinha(aba, numeroLinha, campos) {
  const cabecalho = await lerCabecalho(aba);
  const dados = [];
  for (const [col, valor] of Object.entries(campos)) {
    const j = cabecalho.indexOf(col);
    if (j === -1) {
      console.warn(`Coluna "${col}" não existe na aba ${aba}; ignorando.`);
      continue;
    }
    dados.push({ range: `${aspas(aba)}!${letraColuna(j)}${numeroLinha}`, values: [[valor ?? ""]] });
  }
  if (!dados.length) return;
  await api().spreadsheets.values.batchUpdate({
    spreadsheetId: config.google.planilhaId,
    requestBody: { valueInputOption: "USER_ENTERED", data: dados },
  });
}

/** Cria as abas que faltam e escreve o cabeçalho nas abas vazias (usado pelo script de setup). */
export async function garantirAbas(estrutura) {
  const { data } = await api().spreadsheets.get({ spreadsheetId: config.google.planilhaId });
  const existentes = new Set(data.sheets.map((s) => s.properties.title));
  const novas = Object.keys(estrutura).filter((aba) => !existentes.has(aba));
  if (novas.length) {
    await api().spreadsheets.batchUpdate({
      spreadsheetId: config.google.planilhaId,
      requestBody: { requests: novas.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
  for (const [aba, colunas] of Object.entries(estrutura)) {
    const atual = await lerCabecalho(aba);
    const faltando = colunas.filter((c) => !atual.includes(c));
    if (!faltando.length) continue;
    const novoCabecalho = [...atual, ...faltando];
    await api().spreadsheets.values.update({
      spreadsheetId: config.google.planilhaId,
      range: `${aspas(aba)}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [novoCabecalho] },
    });
  }
  return novas;
}

/** Coloca menus suspensos (lista de opções) nas colunas indicadas: { coluna: ["opção1", "opção2"] }. */
export async function aplicarListas(aba, listas) {
  const { data } = await api().spreadsheets.get({ spreadsheetId: config.google.planilhaId });
  const folha = data.sheets.find((s) => s.properties.title === aba);
  if (!folha) return;
  const cabecalho = await lerCabecalho(aba);
  const requests = [];
  for (const [coluna, opcoes] of Object.entries(listas)) {
    const j = cabecalho.indexOf(coluna);
    if (j === -1) continue;
    requests.push({
      setDataValidation: {
        range: { sheetId: folha.properties.sheetId, startRowIndex: 1, startColumnIndex: j, endColumnIndex: j + 1 },
        rule: {
          condition: { type: "ONE_OF_LIST", values: opcoes.map((v) => ({ userEnteredValue: v })) },
          showCustomUi: true,
          strict: false,
        },
      },
    });
  }
  // Congela a linha do cabeçalho.
  requests.push({
    updateSheetProperties: {
      properties: { sheetId: folha.properties.sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: "gridProperties.frozenRowCount",
    },
  });
  await api().spreadsheets.batchUpdate({ spreadsheetId: config.google.planilhaId, requestBody: { requests } });
}
