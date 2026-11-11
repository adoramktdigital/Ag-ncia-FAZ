// Prepara a planilha do Google: cria as abas, os cabeçalhos e as configurações padrão.
// Uso: npm run setup-planilha
import { garantirAbas, lerTabela, adicionarLinha } from "../src/planilha.js";
import { ESTRUTURA, CONFIG_PADRAO } from "../src/dados.js";

const novas = await garantirAbas(ESTRUTURA);
console.log(novas.length ? `Abas criadas: ${novas.join(", ")}` : "Todas as abas já existiam.");

const existentes = new Set((await lerTabela("Config")).map((l) => l.chave));
for (const [chave, valor, explicacao] of CONFIG_PADRAO) {
  if (existentes.has(chave)) continue;
  await adicionarLinha("Config", { chave, valor, explicacao });
  console.log(`Config adicionada: ${chave}`);
}
console.log("Planilha pronta! Preencha a aba Config (principalmente telefone_humano, chave_pix e informacoes_empresa).");
