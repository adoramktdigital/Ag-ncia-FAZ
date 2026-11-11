// Acompanhamento de clientes: pedidos de aprovação, avisos de entrega e retornos pendentes.
import { listarAcompanhamentos, listarClientes, atualizarAcompanhamento, lerConfig, registrarConversa } from "../dados.js";
import { enviarTemplate } from "../whatsapp.js";
import { avisarEquipe, paraParametro } from "../avisos.js";
import { TEMPLATES, IDIOMA_TEMPLATES } from "../templates.js";
import { hoje, somarDias } from "../util/datas.js";
import { normalizarTelefone } from "../util/telefone.js";

export function precisaContato(acomp, dataHoje) {
  if (acomp.status !== "aguardando") return false;
  // Sem data definida = enviar já na primeira execução.
  return !acomp.proximo_contato || acomp.proximo_contato <= dataHoje;
}

function templateDoTipo(tipo) {
  if (tipo === "entrega") return TEMPLATES.acompanhamentoEntrega;
  if (tipo === "retorno") return TEMPLATES.acompanhamentoRetorno;
  return TEMPLATES.acompanhamentoAprovacao;
}

export async function executarAcompanhamentos({ agora = new Date() } = {}) {
  const cfg = await lerConfig();
  const intervalo = Number(cfg.acompanhamento_intervalo_dias) || 2;
  const maxTentativas = Number(cfg.acompanhamento_max_tentativas) || 3;
  const dataHoje = hoje(agora);
  const [acomps, clientes] = await Promise.all([listarAcompanhamentos(), listarClientes()]);
  const resultado = { enviadas: 0, erros: 0 };

  for (const acomp of acomps) {
    if (!precisaContato(acomp, dataHoje)) continue;
    const tentativas = Number(acomp.tentativas) || 0;
    const cliente = clientes.find((c) => String(c.id) === String(acomp.cliente_id));
    const telefone = normalizarTelefone(cliente?.telefone);
    if (!telefone) {
      console.warn(`Acompanhamento ${acomp.id}: cliente ${acomp.cliente_id} sem telefone.`);
      continue;
    }

    if (tentativas >= maxTentativas) {
      await atualizarAcompanhamento(acomp, { status: "sem_resposta" });
      await avisarEquipe(
        `${cliente.nome} não respondeu sobre "${acomp.descricao}" (${acomp.id}) depois de ${tentativas} lembretes. ` +
        `Marquei como sem_resposta; vale um contato pessoal.`,
      );
      continue;
    }

    const template = templateDoTipo(acomp.tipo);
    const primeiroNome = String(cliente.nome || "").split(" ")[0] || "tudo bem";
    const parametros = acomp.tipo === "retorno"
      ? [primeiroNome, paraParametro(acomp.descricao)]
      : [primeiroNome, paraParametro(acomp.descricao), paraParametro(acomp.link || "o material foi enviado por e-mail")];

    try {
      await enviarTemplate(telefone, template, IDIOMA_TEMPLATES, parametros);
      await atualizarAcompanhamento(acomp, {
        tentativas: tentativas + 1,
        proximo_contato: somarDias(dataHoje, intervalo),
      });
      await registrarConversa(telefone, cliente.nome, "saida", `[template ${template}] ${parametros.join(" | ")}`);
      resultado.enviadas++;
    } catch (e) {
      resultado.erros++;
      console.error(`Erro no acompanhamento ${acomp.id}:`, e.message);
    }
  }
  return resultado;
}
