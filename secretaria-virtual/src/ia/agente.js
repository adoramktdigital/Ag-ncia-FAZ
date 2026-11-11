// Agente de atendimento com Claude: recebe a mensagem do cliente, usa as ferramentas
// e devolve o texto a ser enviado no WhatsApp.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { lerConfig } from "../dados.js";
import { DEFINICOES, executarFerramenta } from "./ferramentas.js";
import { montarInstrucoes } from "./prompt.js";
import { agoraTexto, nomeDoDia, hoje } from "../util/datas.js";

let clienteClaude;
function claude() {
  if (!clienteClaude) clienteClaude = new Anthropic();
  return clienteClaude;
}

// Conversas em memória, por telefone. Uma conversa nova começa depois de um tempo parado
// ou quando fica longa demais — o histórico nunca é editado, só acrescentado.
const conversas = new Map();
const INATIVIDADE_MAX_MS = 6 * 60 * 60 * 1000; // 6 horas
const MENSAGENS_MAX = 80;
const MAX_VOLTAS_FERRAMENTAS = 10;

function conversaDe(telefone) {
  const atual = conversas.get(telefone);
  const expirou = !atual || Date.now() - atual.ultimaAtividade > INATIVIDADE_MAX_MS || atual.mensagens.length > MENSAGENS_MAX;
  if (expirou) {
    const nova = { mensagens: [], ultimaAtividade: Date.now() };
    conversas.set(telefone, nova);
    return nova;
  }
  return atual;
}

export function encerrarConversa(telefone) {
  conversas.delete(telefone);
}

function textoFinal(resposta) {
  return resposta.content
    .filter((b) => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Processa a(s) mensagem(ns) de um contato e retorna a resposta em texto.
 * @param {{ telefone: string, nomeWhatsApp: string, texto: string }} entrada
 * @returns {Promise<{ texto: string, recusou?: boolean }>}
 */
export async function responder({ telefone, nomeWhatsApp, texto }) {
  const cfg = await lerConfig();
  const instrucoes = montarInstrucoes(cfg);
  const conversa = conversaDe(telefone);
  const contexto = { telefone, nomeWhatsApp };

  const carimbo = `[${nomeDoDia(hoje())}, ${agoraTexto()}]`;
  conversa.mensagens.push({ role: "user", content: `${carimbo} ${texto}` });
  conversa.ultimaAtividade = Date.now();

  for (let volta = 0; volta < MAX_VOLTAS_FERRAMENTAS; volta++) {
    const resposta = await claude().beta.messages.create({
      model: config.claude.modelo,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: instrucoes,
      tools: DEFINICOES,
      messages: conversa.mensagens,
    });

    // Sempre devolve o conteúdo completo (inclusive blocos de raciocínio) ao histórico.
    conversa.mensagens.push({ role: "assistant", content: resposta.content });

    if (resposta.stop_reason === "refusal") {
      encerrarConversa(telefone);
      return { texto: "", recusou: true };
    }

    if (resposta.stop_reason === "pause_turn") continue;

    if (resposta.stop_reason !== "tool_use") {
      return { texto: textoFinal(resposta) };
    }

    const chamadas = resposta.content.filter((b) => b.type === "tool_use");
    const resultados = await Promise.all(
      chamadas.map(async (chamada) => {
        try {
          const saida = await executarFerramenta(chamada.name, chamada.input, contexto);
          console.log(`[IA] ${telefone} usou ${chamada.name}`, JSON.stringify(chamada.input));
          return { type: "tool_result", tool_use_id: chamada.id, content: JSON.stringify(saida) };
        } catch (e) {
          console.error(`[IA] erro na ferramenta ${chamada.name}:`, e);
          return { type: "tool_result", tool_use_id: chamada.id, content: `Erro: ${e.message}`, is_error: true };
        }
      }),
    );
    conversa.mensagens.push({ role: "user", content: resultados });
  }

  // Excedeu o limite de voltas: começa do zero na próxima mensagem.
  encerrarConversa(telefone);
  throw new Error("A IA excedeu o limite de chamadas de ferramentas nesta mensagem.");
}
