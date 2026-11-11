// Prepara a planilha do Google: cria as abas das funções ligadas (MODULOS),
// os cabeçalhos, os menus de opções e as configurações padrão.
// Uso: npm run setup-planilha
import { garantirAbas, lerTabela, adicionarLinha, aplicarListas } from "../src/planilha.js";
import { estruturaAtiva, CONFIG_PADRAO, LISTAS } from "../src/dados.js";
import { config } from "../src/config.js";

const estrutura = estruturaAtiva();
const novas = await garantirAbas(estrutura);
console.log(`Funções ligadas: ${config.modulos.join(", ")}`);
console.log(novas.length ? `Abas criadas: ${novas.join(", ")}` : "Todas as abas já existiam.");

for (const aba of Object.keys(estrutura)) {
  if (LISTAS[aba]) await aplicarListas(aba, LISTAS[aba]);
}

// Configurações de cada função só aparecem se a função estiver ligada.
const daFuncao = (chave) =>
  chave.startsWith("acompanhamento_") ? config.ligado("acompanhamentos")
  : chave.startsWith("agenda_") ? config.ligado("agenda")
  : ["nome_secretaria", "informacoes_empresa"].includes(chave) ? config.ligado("ia")
  : chave === "encaminhar_respostas" ? !config.ligado("ia")
  : true;

const existentes = new Set((await lerTabela("Config")).map((l) => l.chave));
for (const [chave, valor, explicacao] of CONFIG_PADRAO) {
  if (existentes.has(chave) || !daFuncao(chave)) continue;
  await adicionarLinha("Config", { chave, valor, explicacao });
  console.log(`Config adicionada: ${chave}`);
}
console.log("Planilha pronta! Preencha a aba Config (principalmente telefone_humano e chave_pix).");
