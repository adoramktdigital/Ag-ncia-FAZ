// Régua de cobrança: envia lembretes antes, no dia e depois do vencimento.
import { listarCobrancas, listarClientes, atualizarCobranca, lerConfig, valorEmReais, registrarConversa } from "../dados.js";
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

/**
 * Decide qual etapa da régua deve ser enviada hoje para uma cobrança.
 * Envia a etapa mais recente que já chegou e ainda não foi enviada — assim,
 * se o servidor ficar fora do ar um dia, a cobrança não é perdida, mas também
 * não manda várias mensagens atrasadas de uma vez.
 * Retorna o número da etapa (ex.: -3, 0, 1) ou null.
 */
export function etapaDeHoje(cobranca, etapas, dataHoje) {
  if (cobranca.status !== "pendente" || !cobranca.vencimento) return null;
  const diasDepois = diasEntre(cobranca.vencimento, dataHoje); // negativo = ainda não venceu
  const enviadas = new Set(lerEtapas(cobranca.avisos_enviados));
  const vencidas = etapas.filter((e) => e <= diasDepois);
  if (!vencidas.length) return null;
  const etapa = vencidas[vencidas.length - 1];
  if (enviadas.has(etapa)) return null;
  if (cobranca.ultimo_aviso === dataHoje) return null; // no máximo uma mensagem por dia
  return etapa;
}

function comoPagar(cobranca, cfg) {
  if (cobranca.link_pagamento) return cobranca.link_pagamento;
  if (cfg.chave_pix) return `PIX: ${cfg.chave_pix}`;
  return "responda esta mensagem que enviamos os dados de pagamento";
}

export async function executarCobrancas({ agora = new Date() } = {}) {
  const cfg = await lerConfig();
  const etapas = lerEtapas(cfg.cobranca_etapas);
  const dataHoje = hoje(agora);
  const [cobrancas, clientes] = await Promise.all([listarCobrancas(), listarClientes()]);
  const ultimaEtapa = etapas[etapas.length - 1];
  const resultado = { enviadas: 0, erros: 0 };

  for (const cobranca of cobrancas) {
    const etapa = etapaDeHoje(cobranca, etapas, dataHoje);
    if (etapa === null) continue;

    const cliente = clientes.find((c) => String(c.id) === String(cobranca.cliente_id));
    const telefone = normalizarTelefone(cliente?.telefone);
    if (!telefone) {
      console.warn(`Cobrança ${cobranca.id}: cliente ${cobranca.cliente_id} sem telefone.`);
      continue;
    }

    const template = etapa < 0 ? TEMPLATES.cobrancaAntes : etapa === 0 ? TEMPLATES.cobrancaHoje : TEMPLATES.cobrancaAtraso;
    const primeiroNome = String(cliente.nome || "").split(" ")[0] || "tudo bem";
    const parametros = [
      primeiroNome,
      paraParametro(cobranca.descricao || "serviços"),
      valorEmReais(cobranca.valor),
      dataBR(cobranca.vencimento),
      paraParametro(comoPagar(cobranca, cfg)),
    ];

    try {
      await enviarTemplate(telefone, template, IDIOMA_TEMPLATES, parametros);
      const enviadas = [...lerEtapas(cobranca.avisos_enviados), etapa];
      await atualizarCobranca(cobranca, { avisos_enviados: enviadas.join(","), ultimo_aviso: dataHoje });
      await registrarConversa(telefone, cliente.nome, "saida", `[template ${template}] ${parametros.join(" | ")}`);
      resultado.enviadas++;

      if (etapa === ultimaEtapa && etapa > 0) {
        await avisarEquipe(
          `Cobrança ${cobranca.id} de ${cliente.nome} (R$ ${valorEmReais(cobranca.valor)}, venceu em ${dataBR(cobranca.vencimento)}) ` +
          `já recebeu todos os lembretes automáticos e continua em aberto. Vale um contato pessoal.`,
        );
      }
    } catch (e) {
      resultado.erros++;
      console.error(`Erro ao cobrar ${cobranca.id}:`, e.message);
    }
  }
  return resultado;
}
