// Cobrança de mensalidades (clientes de recorrência), direto da aba Clientes.
//
// Cada cliente tem: valor, dia_vencimento e pago_ate (último mês pago, ex.: 10/2026).
// O mês cobrado é sempre o mês seguinte ao pago_ate. Quando você atualiza o pago_ate,
// os lembretes daquele mês param e a régua recomeça no mês seguinte.
import {
  listarClientes, atualizarCliente, lerConfig, valorEmReais, lerValor, registrarConversa, cobrancaAtivada,
  nomeEmpresa, nomeParaSaudacao,
} from "../dados.js";
import { enviarTemplate } from "../whatsapp.js";
import { avisarEquipe, paraParametro } from "../avisos.js";
import { TEMPLATES, IDIOMA_TEMPLATES } from "../templates.js";
import { hoje, diasEntre, dataBR } from "../util/datas.js";
import { normalizarTelefone } from "../util/telefone.js";

export function lerEtapas(texto) {
  return String(texto || "")
    .split(/[,;\s]+/)
    .filter((x) => x.trim() !== "")
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x))
    .sort((a, b) => a - b);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * Lê um mês escrito de vários jeitos: "10/2026", "10/26", "2026-10", "01/10/2026",
 * "out/2026", "outubro de 2026". Retorna { ano, mes } ou null.
 */
export function lerMes(valor) {
  const t = String(valor ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return validar(Number(m[1]), Number(m[2]));
  m = t.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/); // data completa dd/mm/aaaa
  if (m) return validar(Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$/);
  if (m) return validar(Number(m[2].length === 2 ? "20" + m[2] : m[2]), Number(m[1]));
  m = t.match(/^([a-z]{3,})\.?\s*(?:\/|-|de)?\s*(\d{2}|\d{4})$/);
  if (m) {
    const i = MESES.findIndex((nome) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").startsWith(m[1].slice(0, 3)));
    if (i >= 0) return validar(Number(m[2].length === 2 ? "20" + m[2] : m[2]), i + 1);
  }
  return null;
}

function validar(ano, mes) {
  return mes >= 1 && mes <= 12 && ano >= 2000 && ano <= 2100 ? { ano, mes } : null;
}

export function proximoMes({ ano, mes }) {
  return mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
}

/** { ano: 2026, mes: 11 } -> "11/2026" */
export function mesTexto({ ano, mes }) {
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

/** { ano: 2026, mes: 11 } -> "novembro/2026" */
export function mesPorExtenso({ ano, mes }) {
  return `${MESES[mes - 1]}/${ano}`;
}

/** Data de vencimento do mês; dia 31 em mês curto vira o último dia do mês. */
export function vencimentoDoMes({ ano, mes }, dia) {
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const d = Math.min(Math.max(Number(dia) || 1, 1), ultimoDia);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Decide a etapa da régua a enviar hoje para um vencimento.
 * Envia a etapa mais recente que já chegou e ainda não foi enviada. Assim, se o servidor
 * ficar fora do ar um dia, a cobrança não se perde, mas também não saem várias mensagens
 * atrasadas de uma vez. No máximo uma mensagem por dia.
 */
export function etapaDeHoje({ vencimento, enviadas, ultimoAviso }, etapas, dataHoje) {
  const diasDepois = diasEntre(vencimento, dataHoje); // negativo = ainda não venceu
  const vencidas = etapas.filter((e) => e <= diasDepois);
  if (!vencidas.length) return null;
  const etapa = vencidas[vencidas.length - 1];
  if (enviadas.includes(etapa)) return null;
  if (ultimoAviso === dataHoje) return null;
  return etapa;
}

/**
 * Situação da mensalidade de um cliente hoje.
 * Retorna { motivo } quando não dá para cobrar, ou os dados do mês em aberto.
 */
export function situacaoMensalidade(cliente, dataHoje) {
  if (!cobrancaAtivada(cliente)) return { motivo: "desativada" };
  const valor = lerValor(cliente.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { motivo: "sem valor" };
  const dia = Number(String(cliente.dia_vencimento ?? "").trim());
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) return { motivo: "sem dia de vencimento" };
  const pago = lerMes(cliente.pago_ate);
  if (!pago) return { motivo: "sem pago_ate" };

  const mes = proximoMes(pago);
  const vencimento = vencimentoDoMes(mes, dia);
  const mesDosAvisos = lerMes(cliente.aviso_mes);
  const mesmoMes = mesDosAvisos && mesTexto(mesDosAvisos) === mesTexto(mes);
  return {
    mes,
    vencimento,
    diasDepoisDoVencimento: diasEntre(vencimento, dataHoje),
    enviadas: mesmoMes ? lerEtapas(cliente.avisos_enviados) : [],
    ultimoAviso: String(cliente.ultimo_aviso || "").slice(0, 10),
  };
}

function comoPagar(cliente, cfg) {
  if (cliente.link_pagamento) return `Link para pagamento: ${cliente.link_pagamento}`;
  if (cfg.chave_pix) return `Chave PIX: ${cfg.chave_pix}`;
  return "Responda esta mensagem que enviamos os dados de pagamento.";
}

export async function executarCobrancas({ agora = new Date() } = {}) {
  const cfg = await lerConfig();
  const etapas = lerEtapas(cfg.cobranca_etapas);
  const ultimaEtapa = etapas[etapas.length - 1];
  const dataHoje = hoje(agora);
  const clientes = await listarClientes();
  const resultado = { enviadas: 0, erros: 0, desativadas: 0, incompletos: [] };

  for (const cliente of clientes) {
    const sit = situacaoMensalidade(cliente, dataHoje);
    if (sit.motivo === "desativada") { resultado.desativadas++; continue; }
    if (sit.motivo) {
      resultado.incompletos.push(`${nomeEmpresa(cliente) || "(sem nome)"}: ${sit.motivo}`);
      continue;
    }
    const etapa = etapaDeHoje(sit, etapas, dataHoje);
    if (etapa === null) continue;

    const telefone = normalizarTelefone(cliente.telefone);
    if (!telefone) {
      resultado.incompletos.push(`${nomeEmpresa(cliente)}: sem telefone`);
      continue;
    }

    const template = etapa < 0 ? TEMPLATES.cobrancaAntes : etapa === 0 ? TEMPLATES.cobrancaHoje : TEMPLATES.cobrancaAtraso;
    // {{1}} contato, {{2}} empresa, {{3}} valor, {{4}} vencimento, {{5}} dados para pagamento
    const parametros = [
      paraParametro(nomeParaSaudacao(cliente)),
      paraParametro(nomeEmpresa(cliente)),
      valorEmReais(cliente.valor),
      dataBR(sit.vencimento),
      paraParametro(comoPagar(cliente, cfg)),
    ];

    try {
      await enviarTemplate(telefone, template, IDIOMA_TEMPLATES, parametros);
      await atualizarCliente(cliente, {
        aviso_mes: mesTexto(sit.mes),
        avisos_enviados: [...sit.enviadas, etapa].join(" "),
        ultimo_aviso: dataHoje,
      });
      await registrarConversa(telefone, nomeEmpresa(cliente), "saida", `[template ${template}] ${parametros.join(" | ")}`);
      resultado.enviadas++;

      if (etapa === ultimaEtapa && etapa > 0) {
        await avisarEquipe(
          `A mensalidade de ${mesPorExtenso(sit.mes)} de ${nomeEmpresa(cliente)} (R$ ${valorEmReais(cliente.valor)}, venceu em ${dataBR(sit.vencimento)}) ` +
          `já recebeu todos os lembretes automáticos e continua em aberto. Vale um contato pessoal.`,
        );
      }
    } catch (e) {
      resultado.erros++;
      console.error(`Erro ao cobrar ${nomeEmpresa(cliente)}:`, e.message);
    }
  }

  if (resultado.incompletos.length) {
    console.warn("[Cobrança] clientes com cobrança ligada mas dados incompletos:", resultado.incompletos.join("; "));
  }
  return resultado;
}
