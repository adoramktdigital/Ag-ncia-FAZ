// Teste de ponta a ponta sem serviços externos: planilha em memória, WhatsApp em
// modo simulação e um servidor falso no lugar da API do Claude.
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { hoje, somarDias } from "../src/util/datas.js";

// ---- planilha em memória ----
const abas = {
  Clientes: [{ id: "C1", nome: "Ana Souza", telefone: "(11) 98765-4321", status: "ativo" }],
  Cobrancas: [{ id: "K1", cliente_id: "C1", descricao: "Gestão de redes - nov", valor: "1500", vencimento: somarDias(hoje(), 3), status: "pendente", avisos_enviados: "", ultimo_aviso: "" }],
  Acompanhamentos: [{ id: "P1", cliente_id: "C1", tipo: "aprovacao", descricao: "Posts de dezembro", link: "https://exemplo.com/posts", status: "aguardando", proximo_contato: "", tentativas: "" }],
  Agenda: [], Config: [{ chave: "telefone_humano", valor: "5511900000000" }], Atendimento: [], Conversas: [],
};
const comLinha = (aba) => abas[aba].map((o, i) => ({ ...o, _linha: i + 2 }));
mock.module("../src/planilha.js", { namedExports: {
  lerTabela: async (aba) => comLinha(aba),
  adicionarLinha: async (aba, obj) => { abas[aba].push({ ...obj }); },
  atualizarLinha: async (aba, linha, campos) => { Object.assign(abas[aba][linha - 2], campos); },
  garantirAbas: async () => [],
} });

// ---- WhatsApp: captura o que seria enviado ----
const enviados = [];
process.env.WHATSAPP_DRY_RUN = "true";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1"; process.env.WHATSAPP_TOKEN = "x"; process.env.WHATSAPP_VERIFY_TOKEN = "x";
const logOriginal = console.log;
console.log = (...a) => { if (String(a[0]).includes("[WhatsApp simulação]")) enviados.push(JSON.parse(a[1])); };

// ---- API do Claude falsa ----
const pedidos = [];
const servidor = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const pedido = JSON.parse(corpo);
    pedidos.push(pedido);
    const ultima = pedido.messages.at(-1);
    const temResultado = Array.isArray(ultima.content) && ultima.content.some((b) => b.type === "tool_result");
    const conteudo = !temResultado
      ? [{ type: "tool_use", id: "tu1", name: "registrar_resposta_acompanhamento", input: { acompanhamento_id: "P1", resultado: "aprovado", comentario: "Pode publicar" } },
         { type: "tool_use", id: "tu2", name: "informar_pagamento", input: { cobranca_id: "K1", observacao: "Pagou via PIX hoje" } }]
      : [{ type: "text", text: "Obrigada, Ana! Registrei a aprovação e já pedi para a equipe conferir o pagamento." }];
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg", type: "message", role: "assistant", model: pedido.model, content: conteudo,
      stop_reason: temResultado ? "end_turn" : "tool_use", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
});
await new Promise((r) => servidor.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${servidor.address().port}`;
process.env.ANTHROPIC_API_KEY = "teste";

const { receberMensagem } = await import("../src/atendimento.js");
const { executarRotinas } = await import("../src/rotinas/index.js");

test("rotinas enviam cobrança D-3 e pedido de aprovação", async () => {
  enviados.length = 0;
  const r = await executarRotinas(["cobrancas", "acompanhamentos"]);
  assert.equal(r.cobrancas.enviadas, 1);
  assert.equal(r.acompanhamentos.enviadas, 1);
  const nomes = enviados.map((e) => e.template?.name);
  assert.ok(nomes.includes("acompanhamento_aprovacao"));
  assert.ok(nomes.includes("cobranca_lembrete"));
  assert.equal(abas.Cobrancas[0].avisos_enviados, "-3");
  assert.equal(abas.Acompanhamentos[0].tentativas, 1);
});

test("cliente responde e a IA registra aprovação e pagamento", async () => {
  enviados.length = 0;
  receberMensagem({ id: "w1", de: "5511987654321", nome: "Ana", tipo: "text", texto: "Aprovado! E já paguei o boleto" });
  receberMensagem({ id: "w1", de: "5511987654321", nome: "Ana", tipo: "text", texto: "duplicada" }); // reenvio da Meta
  await new Promise((r) => setTimeout(r, 5500));

  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0].fallbacks, "default");
  assert.match(pedidos[0].messages[0].content, /^\[.+\] Aprovado! E já paguei o boleto$/);
  assert.equal(abas.Acompanhamentos[0].status, "aprovado");
  assert.equal(abas.Cobrancas[0].status, "em_verificacao");
  assert.ok(enviados.some((e) => e.status === "read" && e.message_id === "w1"));
  const texto = enviados.find((e) => e.type === "text" && e.to === "5511987654321");
  assert.match(texto.text.body, /Obrigada, Ana/);
  const avisos = enviados.filter((e) => e.template?.name === "aviso_equipe" && e.to === "5511900000000");
  assert.equal(avisos.length, 2);
  assert.ok(abas.Conversas.some((c) => c.direcao === "entrada"));
});

test("contato em atendimento humano não recebe resposta da IA", async () => {
  enviados.length = 0;
  abas.Atendimento.push({ telefone: "5511987654321", modo: "humano" });
  const antes = pedidos.length;
  receberMensagem({ id: "w2", de: "5511987654321", nome: "Ana", tipo: "text", texto: "Oi?" });
  await new Promise((r) => setTimeout(r, 4500));
  assert.equal(pedidos.length, antes);
  assert.equal(enviados.length, 0);
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
  console.log = logOriginal;
});
