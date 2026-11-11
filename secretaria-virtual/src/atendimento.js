// Recebe as mensagens do webhook e decide o que fazer com cada uma:
// comandos da equipe, contato em atendimento humano, ou resposta da IA.
import { enviarTexto, marcarComoLida } from "./whatsapp.js";
import { responder, encerrarConversa } from "./ia/agente.js";
import { lerConfig, modoAtendimento, definirModoAtendimento, registrarConversa } from "./dados.js";
import { avisarEquipe } from "./avisos.js";
import { mesmoTelefone, normalizarTelefone } from "./util/telefone.js";
import { executarRotinas } from "./rotinas/index.js";

// A Meta pode reenviar o mesmo webhook; guardamos os IDs já vistos.
const vistos = new Map();
function jaVisto(id) {
  const agora = Date.now();
  for (const [k, t] of vistos) if (agora - t > 24 * 3600_000) vistos.delete(k);
  if (vistos.has(id)) return true;
  vistos.set(id, agora);
  return false;
}

// Uma fila por contato: as mensagens de uma mesma pessoa são tratadas em ordem,
// e mensagens mandadas em sequência rápida ("oi" / "tudo bem?" / "queria saber...")
// são juntadas numa resposta só.
const filas = new Map();
const ESPERA_AGRUPAR_MS = 4000;

export function receberMensagem(msg) {
  if (!msg.id || jaVisto(msg.id)) return;
  if (!msg.texto) return; // reações etc.

  let fila = filas.get(msg.de);
  if (!fila) {
    fila = { pendentes: [], ids: [], nome: msg.nome, processando: Promise.resolve(), agendado: false };
    filas.set(msg.de, fila);
  }
  fila.pendentes.push(msg.texto);
  fila.ids.push(msg.id);
  fila.nome = msg.nome || fila.nome;
  if (fila.agendado) return;
  fila.agendado = true;

  fila.processando = fila.processando
    .then(() => new Promise((r) => setTimeout(r, ESPERA_AGRUPAR_MS)))
    .then(async () => {
      fila.agendado = false;
      const textos = fila.pendentes.splice(0);
      const ids = fila.ids.splice(0);
      if (textos.length) await tratar(msg.de, fila.nome, textos.join("\n"), ids.at(-1));
    })
    .catch((e) => console.error("Erro na fila de", msg.de, e))
    .finally(() => {
      if (!fila.pendentes.length && !fila.agendado) filas.delete(msg.de);
    });
}

async function tratar(telefone, nome, texto, ultimoId) {
  await registrarConversa(telefone, nome, "entrada", texto);
  const cfg = await lerConfig();

  if (mesmoTelefone(telefone, cfg.telefone_humano) && texto.trim().startsWith("#")) {
    return comandoDaEquipe(telefone, texto.trim());
  }

  const { modo } = await modoAtendimento(telefone);
  if (modo === "humano") {
    // Não marca como lida: a mensagem continua como "não lida" para a equipe.
    console.log(`[Atendimento humano] ${telefone} (${nome}): ${texto}`);
    return;
  }
  if (ultimoId) marcarComoLida(ultimoId);

  let resposta;
  try {
    resposta = await responder({ telefone, nomeWhatsApp: nome, texto });
  } catch (e) {
    console.error("Erro ao gerar resposta da IA:", e);
    encerrarConversa(telefone);
    await definirModoAtendimento(telefone, "humano", "Erro técnico na secretária virtual");
    await avisarEquipe(`A secretária virtual teve um erro ao responder ${nome || telefone} (tel. ${telefone}) e passou o contato para atendimento humano. Mensagem do cliente: ${texto}`);
    return enviar(telefone, nome, "Desculpe, tive um probleminha aqui. Já chamei alguém da equipe para te responder, tá bem?");
  }

  if (resposta.recusou) {
    await definirModoAtendimento(telefone, "humano", "A IA não pôde responder essa mensagem");
    await avisarEquipe(`A secretária virtual não pôde responder ${nome || telefone} (tel. ${telefone}). Mensagem: ${texto}`);
    return enviar(telefone, nome, "Vou pedir para alguém da equipe te responder sobre isso, tá bem?");
  }

  if (resposta.texto) await enviar(telefone, nome, resposta.texto);
}

async function enviar(telefone, nome, texto) {
  // Limite do WhatsApp: 4096 caracteres por mensagem.
  for (let i = 0; i < texto.length; i += 4000) {
    await enviarTexto(telefone, texto.slice(i, i + 4000));
  }
  await registrarConversa(telefone, nome, "saida", texto);
}

/**
 * Comandos que o responsável (telefone_humano) pode mandar para o número da empresa:
 *   #bot 5511999999999     -> a secretária volta a responder esse contato
 *   #humano 5511999999999  -> a secretária para de responder esse contato
 *   #rotinas               -> roda cobranças, acompanhamentos e lembretes agora
 *   #ajuda                 -> lista os comandos
 */
async function comandoDaEquipe(telefone, texto) {
  const [comando, alvoBruto] = texto.split(/\s+/, 2);
  const alvo = normalizarTelefone(alvoBruto);
  let resposta;
  switch (comando.toLowerCase()) {
    case "#bot":
      if (!alvo) { resposta = "Use: #bot 5511999999999"; break; }
      await definirModoAtendimento(alvo, "bot", "Reativado pela equipe");
      encerrarConversa(alvo);
      resposta = `Pronto, voltei a atender ${alvo}.`;
      break;
    case "#humano":
      if (!alvo) { resposta = "Use: #humano 5511999999999"; break; }
      await definirModoAtendimento(alvo, "humano", "Pausado pela equipe");
      resposta = `Ok, parei de responder ${alvo}.`;
      break;
    case "#rotinas": {
      const r = await executarRotinas();
      resposta = `Rotinas executadas. Cobranças: ${r.cobrancas.enviadas}, acompanhamentos: ${r.acompanhamentos.enviadas}, lembretes de agenda: ${r.agenda.enviadas}.`;
      break;
    }
    default:
      resposta = "Comandos: #bot <telefone> (reativar), #humano <telefone> (pausar), #rotinas (rodar envios agora).";
  }
  await enviarTexto(telefone, resposta);
}
