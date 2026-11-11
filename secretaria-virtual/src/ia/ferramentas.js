// Ferramentas que a IA pode usar durante o atendimento.
// Segurança: o telefone de quem está conversando vem do servidor (contexto), nunca da IA,
// então um cliente só consegue ver e alterar os próprios dados.
import {
  clientePorTelefone, cadastrarContato, cobrancasEmAberto, atualizarCobranca,
  acompanhamentosAbertos, atualizarAcompanhamento, listarAgenda, criarAgendamento,
  atualizarAgendamento, definirModoAtendimento, valorEmReais, lerConfig,
} from "../dados.js";
import { avisarEquipe } from "../avisos.js";
import { carregarAgendaERegras, horariosLivres, motivoIndisponivel } from "../rotinas/agenda.js";
import { hoje, agoraTexto, normalizarData, normalizarDataHora, dataBR, nomeDoDia, paraDate } from "../util/datas.js";

const objeto = (properties, required = Object.keys(properties)) => ({
  type: /** @type {const} */ ("object"), properties, required, additionalProperties: false,
});

/** @type {import("@anthropic-ai/sdk").default.Beta.BetaTool[]} */
export const DEFINICOES = [
  {
    name: "consultar_situacao_cliente",
    description:
      "Busca o cadastro de quem está conversando e tudo o que está em aberto: cobranças pendentes, " +
      "materiais aguardando aprovação/retorno e próximos agendamentos. Use no início do atendimento " +
      "e sempre que precisar de dados atualizados. Se a pessoa não for cliente, retorna cliente = null.",
    strict: true,
    input_schema: objeto({}),
  },
  {
    name: "cadastrar_contato",
    description:
      "Cadastra uma pessoa nova (que ainda não é cliente) como lead, para a equipe dar sequência. " +
      "Use quando alguém novo demonstrar interesse nos serviços e já tiver dito o nome.",
    strict: true,
    input_schema: objeto({
      nome: { type: "string", description: "Nome da pessoa" },
      empresa: { type: "string", description: "Empresa ou marca, se informada; senão string vazia" },
      interesse: { type: "string", description: "Resumo do que a pessoa procura" },
    }),
  },
  {
    name: "informar_pagamento",
    description:
      "Registra que o cliente disse que já pagou uma cobrança. A cobrança fica 'em_verificacao' " +
      "e a equipe é avisada para conferir — nunca diga que o pagamento foi confirmado.",
    strict: true,
    input_schema: objeto({
      cobranca_id: { type: "string", description: "ID da cobrança (veja consultar_situacao_cliente)" },
      observacao: { type: "string", description: "O que o cliente disse (data, forma de pagamento, se mandou comprovante)" },
    }),
  },
  {
    name: "registrar_resposta_acompanhamento",
    description:
      "Registra a resposta do cliente a um acompanhamento (aprovação de material, confirmação de entrega, retorno). " +
      "A equipe é avisada automaticamente.",
    strict: true,
    input_schema: objeto({
      acompanhamento_id: { type: "string" },
      resultado: {
        type: "string",
        enum: ["aprovado", "ajustes", "recebido", "respondido"],
        description: "aprovado = aprovou o material; ajustes = pediu alterações; recebido = confirmou que recebeu; respondido = deu o retorno pedido",
      },
      comentario: { type: "string", description: "Detalhes: quais ajustes, o retorno dado etc." },
    }),
  },
  {
    name: "listar_horarios_livres",
    description: "Lista horários disponíveis para reunião/gravação a partir de uma data.",
    strict: true,
    input_schema: objeto({
      a_partir_de: { type: "string", description: "Data inicial AAAA-MM-DD (use a data de hoje se o cliente não especificar)" },
      dias: { type: "integer", description: "Quantos dias úteis consultar (1 a 10)" },
      duracao_min: { type: "integer", description: "Duração em minutos; use 0 para a duração padrão" },
    }),
  },
  {
    name: "agendar",
    description:
      "Agenda um compromisso para quem está conversando. Só chame depois que o cliente confirmar data e horário. " +
      "Se a pessoa não for cliente, cadastre-a antes com cadastrar_contato.",
    strict: true,
    input_schema: objeto({
      inicio: { type: "string", description: "Data e hora no formato AAAA-MM-DD HH:mm" },
      titulo: { type: "string", description: "Ex.: Reunião de briefing, Gravação de conteúdo" },
      duracao_min: { type: "integer", description: "Duração em minutos; use 0 para a duração padrão" },
    }),
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um agendamento do próprio cliente. Para remarcar, cancele e agende de novo.",
    strict: true,
    input_schema: objeto({
      agendamento_id: { type: "string" },
      motivo: { type: "string" },
    }),
  },
  {
    name: "transferir_para_humano",
    description:
      "Passa a conversa para uma pessoa da equipe e para de responder automaticamente esse contato. " +
      "Use quando o cliente pedir para falar com alguém, estiver insatisfeito, quiser negociar valores/prazos, " +
      "ou quando o assunto fugir do que você consegue resolver.",
    strict: true,
    input_schema: objeto({
      motivo: { type: "string", description: "Resumo do assunto para a equipe já chegar sabendo" },
    }),
  },
];

function resumoCobranca(c) {
  return {
    id: c.id, descricao: c.descricao, valor: `R$ ${valorEmReais(c.valor)}`,
    vencimento: dataBR(c.vencimento), status: c.status,
    link_pagamento: c.link_pagamento || null,
  };
}

/**
 * Executa uma ferramenta.
 * @param {string} nome
 * @param {any} entrada
 * @param {{ telefone: string, nomeWhatsApp: string }} contexto
 */
export async function executarFerramenta(nome, entrada, contexto) {
  const cliente = await clientePorTelefone(contexto.telefone);
  const nomeCliente = cliente?.nome || contexto.nomeWhatsApp || contexto.telefone;

  switch (nome) {
    case "consultar_situacao_cliente": {
      if (!cliente) return { cliente: null, telefone: contexto.telefone, nome_no_whatsapp: contexto.nomeWhatsApp };
      const cfg = await lerConfig();
      const [cobrancas, acomps, agenda] = await Promise.all([
        cobrancasEmAberto(cliente.id), acompanhamentosAbertos(cliente.id), listarAgenda(),
      ]);
      const agora = new Date();
      const proximos = agenda
        .filter((a) => String(a.cliente_id) === String(cliente.id) && a.status === "confirmado" && a.inicio && paraDate(a.inicio) > agora)
        .map((a) => ({ id: a.id, titulo: a.titulo, quando: `${nomeDoDia(a.inicio.slice(0, 10))}, ${dataBR(a.inicio)} às ${a.inicio.slice(11)}`, duracao_min: a.duracao_min }));
      return {
        cliente: { id: cliente.id, nome: cliente.nome, empresa: cliente.empresa, status: cliente.status, observacoes: cliente.observacoes },
        cobrancas_em_aberto: cobrancas.map(resumoCobranca),
        chave_pix_padrao: cfg.chave_pix || null,
        acompanhamentos_aguardando: acomps.map((a) => ({ id: a.id, tipo: a.tipo, descricao: a.descricao, link: a.link || null })),
        proximos_agendamentos: proximos,
      };
    }

    case "cadastrar_contato": {
      if (cliente) return { ok: true, aviso: "Essa pessoa já está cadastrada.", cliente_id: cliente.id };
      const novo = await cadastrarContato({
        nome: entrada.nome, telefone: contexto.telefone, empresa: entrada.empresa, observacoes: entrada.interesse,
      });
      await avisarEquipe(`Novo contato pelo WhatsApp: ${entrada.nome}${entrada.empresa ? " (" + entrada.empresa + ")" : ""}, tel. ${contexto.telefone}. Interesse: ${entrada.interesse}`);
      return { ok: true, cliente_id: novo.id };
    }

    case "informar_pagamento": {
      if (!cliente) return { ok: false, erro: "Contato não é cliente cadastrado." };
      const cobranca = (await cobrancasEmAberto(cliente.id)).find((c) => String(c.id) === String(entrada.cobranca_id));
      if (!cobranca) return { ok: false, erro: "Cobrança não encontrada entre as cobranças em aberto deste cliente." };
      await atualizarCobranca(cobranca, {
        status: "em_verificacao",
        observacoes: [cobranca.observacoes, `${agoraTexto()} cliente informou pagamento: ${entrada.observacao}`].filter(Boolean).join(" / "),
      });
      await avisarEquipe(`${nomeCliente} informou que pagou a cobrança ${cobranca.id} (${cobranca.descricao}, R$ ${valorEmReais(cobranca.valor)}). Detalhes: ${entrada.observacao}. Confira e marque como "pago" na planilha.`);
      return { ok: true, status: "em_verificacao" };
    }

    case "registrar_resposta_acompanhamento": {
      if (!cliente) return { ok: false, erro: "Contato não é cliente cadastrado." };
      const acomp = (await acompanhamentosAbertos(cliente.id)).find((a) => String(a.id) === String(entrada.acompanhamento_id));
      if (!acomp) return { ok: false, erro: "Acompanhamento não encontrado entre os pendentes deste cliente." };
      const status = { aprovado: "aprovado", ajustes: "ajustes" }[entrada.resultado] || "concluido";
      await atualizarAcompanhamento(acomp, { status, resposta_cliente: entrada.comentario || entrada.resultado });
      await avisarEquipe(`${nomeCliente} respondeu sobre "${acomp.descricao}" (${acomp.id}): ${entrada.resultado.toUpperCase()}. ${entrada.comentario || ""}`);
      return { ok: true, status };
    }

    case "listar_horarios_livres": {
      const { agenda, regras } = await carregarAgendaERegras();
      const aPartirDe = normalizarData(entrada.a_partir_de) || hoje();
      const dias = Math.min(Math.max(Number(entrada.dias) || 5, 1), 10);
      const livres = horariosLivres({ agenda, regras, aPartirDe: aPartirDe < hoje() ? hoje() : aPartirDe, dias, duracao: entrada.duracao_min || undefined });
      return { duracao_min: entrada.duracao_min || regras.duracaoPadrao, horarios_livres: livres };
    }

    case "agendar": {
      if (!cliente) return { ok: false, erro: "Cadastre o contato com cadastrar_contato antes de agendar." };
      const inicio = normalizarDataHora(entrada.inicio);
      const { agenda, regras } = await carregarAgendaERegras();
      const duracao = entrada.duracao_min || regras.duracaoPadrao;
      const motivo = motivoIndisponivel(inicio, duracao, agenda, regras);
      if (motivo) return { ok: false, erro: motivo };
      const ag = await criarAgendamento({ clienteId: cliente.id, titulo: entrada.titulo, inicio, duracaoMin: duracao });
      const quando = `${nomeDoDia(inicio.slice(0, 10))}, ${dataBR(inicio)} às ${inicio.slice(11)}`;
      await avisarEquipe(`Novo agendamento: ${entrada.titulo} com ${nomeCliente} — ${quando} (${duracao} min). ID ${ag.id}.`);
      return { ok: true, agendamento_id: ag.id, quando, duracao_min: duracao };
    }

    case "cancelar_agendamento": {
      if (!cliente) return { ok: false, erro: "Contato não é cliente cadastrado." };
      const ag = (await listarAgenda()).find(
        (a) => String(a.id) === String(entrada.agendamento_id) && String(a.cliente_id) === String(cliente.id) && a.status === "confirmado",
      );
      if (!ag) return { ok: false, erro: "Agendamento não encontrado entre os agendamentos confirmados deste cliente." };
      await atualizarAgendamento(ag, { status: "cancelado", observacoes: [ag.observacoes, `Cancelado pelo cliente: ${entrada.motivo}`].filter(Boolean).join(" / ") });
      await avisarEquipe(`${nomeCliente} cancelou "${ag.titulo}" de ${dataBR(ag.inicio)} às ${ag.inicio.slice(11)}. Motivo: ${entrada.motivo}`);
      return { ok: true };
    }

    case "transferir_para_humano": {
      await definirModoAtendimento(contexto.telefone, "humano", entrada.motivo);
      await avisarEquipe(`Atendimento transferido: ${nomeCliente} (tel. ${contexto.telefone}) precisa de você. Assunto: ${entrada.motivo}. A secretária parou de responder esse contato até alguém reativar.`);
      return { ok: true, mensagem: "Equipe avisada. A partir de agora uma pessoa responde esse contato." };
    }

    default:
      return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
  }
}
