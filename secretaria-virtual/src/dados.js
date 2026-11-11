// Regras de negócio em cima da planilha: clientes, cobranças, acompanhamentos, agenda.
import { lerTabela, adicionarLinha, atualizarLinha } from "./planilha.js";
import { mesmoTelefone, normalizarTelefone } from "./util/telefone.js";
import { agoraTexto, normalizarData, normalizarDataHora } from "./util/datas.js";
import { config } from "./config.js";

/** Estrutura da planilha (abas e colunas). O script `npm run setup-planilha` cria tudo isso. */
export const ESTRUTURA = {
  Clientes: ["id", "nome", "telefone", "cobranca_automatica", "email", "empresa", "status", "observacoes", "criado_em"],
  Cobrancas: ["id", "cliente_id", "descricao", "valor", "vencimento", "status", "link_pagamento",
    "avisos_enviados", "ultimo_aviso", "pago_em", "observacoes"],
  Acompanhamentos: ["id", "cliente_id", "tipo", "descricao", "link", "status", "proximo_contato",
    "tentativas", "resposta_cliente", "atualizado_em"],
  Agenda: ["id", "cliente_id", "titulo", "inicio", "duracao_min", "status", "lembrete_enviado", "observacoes"],
  Config: ["chave", "valor", "explicacao"],
  Atendimento: ["telefone", "modo", "motivo", "atualizado_em"],
  Conversas: ["data", "telefone", "nome", "direcao", "mensagem"],
};

/** Abas usadas por cada função. */
const ABAS_POR_MODULO = {
  cobrancas: ["Clientes", "Cobrancas", "Config", "Conversas"],
  acompanhamentos: ["Clientes", "Acompanhamentos", "Config", "Conversas"],
  agenda: ["Clientes", "Agenda", "Config", "Conversas"],
  ia: ["Clientes", "Config", "Atendimento", "Conversas"],
};

/** Só as abas das funções ligadas (MODULOS), para a planilha não ficar poluída. */
export function estruturaAtiva(modulos = config.modulos) {
  const abas = new Set(modulos.flatMap((m) => ABAS_POR_MODULO[m] || []));
  return Object.fromEntries(Object.entries(ESTRUTURA).filter(([aba]) => abas.has(aba)));
}

/** Listas de opções (menu suspenso) aplicadas pelo setup em algumas colunas. */
export const LISTAS = {
  Clientes: { cobranca_automatica: ["sim", "não"] },
  Cobrancas: { status: ["pendente", "em_verificacao", "pago", "cancelado"] },
  Acompanhamentos: { tipo: ["aprovacao", "entrega", "retorno"], status: ["aguardando", "aprovado", "ajustes", "concluido", "sem_resposta"] },
  Agenda: { status: ["confirmado", "cancelado"] },
  Atendimento: { modo: ["bot", "humano"] },
};

/** Valores iniciais da aba Config (o setup só grava os que ainda não existem). */
export const CONFIG_PADRAO = [
  ["nome_empresa", "Agência FAZ", "Nome da empresa"],
  ["telefone_humano", "", "Seu WhatsApp: recebe os avisos e as respostas dos clientes (ex.: 5511999999999)"],
  ["chave_pix", "", "Chave PIX padrão, usada quando a cobrança não tem link de pagamento"],
  ["cobranca_etapas", "-3,0,1,3,7", "Dias em relação ao vencimento em que a cobrança é enviada (negativo = antes)"],
  ["encaminhar_respostas", "sim", "sim = quando um cliente responder, a mensagem é encaminhada para o telefone_humano. Use não se você vê as mensagens direto no app WhatsApp Business"],
  ["nome_secretaria", "Fá", "Nome da secretária virtual (só com a IA ligada)"],
  ["acompanhamento_intervalo_dias", "2", "Dias entre um lembrete de acompanhamento e outro"],
  ["acompanhamento_max_tentativas", "3", "Depois de tantos lembretes sem resposta, avisa um humano"],
  ["agenda_dias_semana", "1,2,3,4,5", "Dias com horário disponível (0=domingo ... 6=sábado)"],
  ["agenda_inicio", "09:00", "Primeiro horário do dia"],
  ["agenda_fim", "18:00", "Horário em que o último compromisso precisa terminar"],
  ["agenda_almoco", "12:00-13:30", "Intervalo sem agendamentos (deixe vazio se não houver)"],
  ["agenda_duracao_padrao", "60", "Duração padrão de uma reunião, em minutos"],
  ["agenda_antecedencia_horas", "4", "Antecedência mínima para o cliente agendar"],
  ["informacoes_empresa", "", "Texto livre com serviços, preços, endereço, horário de atendimento etc. A IA usa para responder dúvidas"],
];

// ---------- Config ----------

let cacheConfig = { valor: null, quando: 0 };
export async function lerConfig() {
  if (cacheConfig.valor && Date.now() - cacheConfig.quando < 60_000) return cacheConfig.valor;
  const cfg = Object.fromEntries(CONFIG_PADRAO.map(([k, v]) => [k, v]));
  for (const linha of await lerTabela("Config")) {
    if (linha.chave) cfg[String(linha.chave).trim()] = String(linha.valor ?? "").trim();
  }
  cacheConfig = { valor: cfg, quando: Date.now() };
  return cfg;
}

// ---------- Utilidades ----------

function novoId(prefixo) {
  return `${prefixo}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;
}

export function valorEmReais(valor) {
  const t = String(valor ?? "").replace(/[^\d,.-]/g, "");
  // "1.234,56" -> 1234.56 ; "1234.56" -> 1234.56
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  if (!Number.isFinite(n)) return String(valor ?? "");
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const minusculo = (v) => String(v ?? "").trim().toLowerCase();

/**
 * Coluna cobranca_automatica do cliente. Só cobra quem está marcado como "sim":
 * cliente sem nada preenchido NÃO é cobrado, para ninguém receber mensagem por engano.
 */
export function cobrancaAtivada(cliente) {
  const v = minusculo(cliente?.cobranca_automatica).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ["sim", "s", "x", "ativado", "ativada", "ativo", "true", "yes", "1"].includes(v);
}

// ---------- Clientes ----------

export async function listarClientes() {
  return lerTabela("Clientes");
}

export async function clientePorTelefone(telefone) {
  const clientes = await listarClientes();
  return clientes.find((c) => mesmoTelefone(c.telefone, telefone)) || null;
}

export async function clientePorId(id) {
  const clientes = await listarClientes();
  return clientes.find((c) => String(c.id) === String(id)) || null;
}

export async function cadastrarContato({ nome, telefone, empresa = "", email = "", observacoes = "" }) {
  const cliente = {
    id: novoId("C"),
    nome,
    telefone: normalizarTelefone(telefone),
    email,
    empresa,
    status: "lead",
    observacoes,
    criado_em: agoraTexto(),
  };
  await adicionarLinha("Clientes", cliente);
  return cliente;
}

// ---------- Cobranças ----------

export async function listarCobrancas() {
  const linhas = await lerTabela("Cobrancas");
  return linhas.map((c) => ({ ...c, vencimento: normalizarData(c.vencimento), status: minusculo(c.status) || "pendente" }));
}

export async function cobrancasEmAberto(clienteId) {
  return (await listarCobrancas()).filter(
    (c) => String(c.cliente_id) === String(clienteId) && ["pendente", "em_verificacao"].includes(c.status),
  );
}

export function atualizarCobranca(cobranca, campos) {
  return atualizarLinha("Cobrancas", cobranca._linha, campos);
}

// ---------- Acompanhamentos ----------

export async function listarAcompanhamentos() {
  const linhas = await lerTabela("Acompanhamentos");
  return linhas.map((a) => ({
    ...a,
    status: minusculo(a.status) || "aguardando",
    tipo: minusculo(a.tipo) || "aprovacao",
    proximo_contato: normalizarData(a.proximo_contato),
  }));
}

export async function acompanhamentosAbertos(clienteId) {
  return (await listarAcompanhamentos()).filter(
    (a) => String(a.cliente_id) === String(clienteId) && a.status === "aguardando",
  );
}

export function atualizarAcompanhamento(acomp, campos) {
  return atualizarLinha("Acompanhamentos", acomp._linha, { ...campos, atualizado_em: agoraTexto() });
}

// ---------- Agenda ----------

export async function listarAgenda() {
  const linhas = await lerTabela("Agenda");
  return linhas.map((a) => ({
    ...a,
    inicio: normalizarDataHora(a.inicio),
    status: minusculo(a.status) || "confirmado",
    duracao_min: Number(a.duracao_min) || 60,
  }));
}

export async function criarAgendamento({ clienteId, titulo, inicio, duracaoMin, observacoes = "" }) {
  const ag = {
    id: novoId("A"),
    cliente_id: clienteId,
    titulo,
    inicio,
    duracao_min: duracaoMin,
    status: "confirmado",
    lembrete_enviado: "",
    observacoes,
  };
  await adicionarLinha("Agenda", ag);
  return ag;
}

export function atualizarAgendamento(ag, campos) {
  return atualizarLinha("Agenda", ag._linha, campos);
}

// ---------- Atendimento (bot x humano) ----------

export async function modoAtendimento(telefone) {
  const linhas = await lerTabela("Atendimento");
  const linha = linhas.find((l) => mesmoTelefone(l.telefone, telefone));
  return { modo: minusculo(linha?.modo) || "bot", linha };
}

export async function definirModoAtendimento(telefone, modo, motivo = "") {
  const { linha } = await modoAtendimento(telefone);
  const campos = { modo, motivo, atualizado_em: agoraTexto() };
  if (linha) await atualizarLinha("Atendimento", linha._linha, campos);
  else await adicionarLinha("Atendimento", { telefone: normalizarTelefone(telefone), ...campos });
}

// ---------- Histórico ----------

export function registrarConversa(telefone, nome, direcao, mensagem) {
  return adicionarLinha("Conversas", {
    data: agoraTexto(),
    telefone,
    nome,
    direcao,
    mensagem: String(mensagem).slice(0, 5000),
  }).catch((e) => console.warn("Não consegui registrar a conversa:", e.message));
}
