// Agenda: cálculo de horários livres e lembretes de compromissos.
import { listarAgenda, listarClientes, atualizarAgendamento, lerConfig, registrarConversa } from "../dados.js";
import { enviarTemplate } from "../whatsapp.js";
import { paraParametro } from "../avisos.js";
import { TEMPLATES, IDIOMA_TEMPLATES } from "../templates.js";
import { dataBR, diaDaSemana, hhmm, minutosDoDia, paraDate, somarDias, hoje, nomeDoDia } from "../util/datas.js";
import { normalizarTelefone } from "../util/telefone.js";

export function regrasDaAgenda(cfg) {
  const [almocoIni, almocoFim] = String(cfg.agenda_almoco || "").split("-").map((s) => s.trim());
  return {
    diasSemana: String(cfg.agenda_dias_semana || "1,2,3,4,5").split(/[,;\s]+/).map(Number),
    inicio: minutosDoDia(cfg.agenda_inicio || "09:00"),
    fim: minutosDoDia(cfg.agenda_fim || "18:00"),
    almoco: almocoIni && almocoFim ? [minutosDoDia(almocoIni), minutosDoDia(almocoFim)] : null,
    duracaoPadrao: Number(cfg.agenda_duracao_padrao) || 60,
    antecedenciaMin: (Number(cfg.agenda_antecedencia_horas) || 0) * 60,
  };
}

function sobrepoe(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

/** Compromissos confirmados de um dia, como intervalos [início, fim] em minutos. */
function ocupadosNoDia(agenda, data) {
  return agenda
    .filter((a) => a.status === "confirmado" && a.inicio.startsWith(data))
    .map((a) => {
      const ini = minutosDoDia(a.inicio.slice(11));
      return [ini, ini + a.duracao_min];
    });
}

/** Verifica se um horário específico pode ser agendado. Retorna null se pode, ou o motivo. */
export function motivoIndisponivel(inicio, duracao, agenda, regras, agora = new Date()) {
  const [data, hora] = inicio.split(" ");
  if (!data || !hora) return "Horário em formato inválido; use AAAA-MM-DD HH:mm.";
  if (!regras.diasSemana.includes(diaDaSemana(data))) return "Não atendemos nesse dia da semana.";
  const ini = minutosDoDia(hora);
  const fim = ini + duracao;
  if (ini < regras.inicio || fim > regras.fim) return `Fora do horário de atendimento (${hhmm(regras.inicio)} às ${hhmm(regras.fim)}).`;
  if (regras.almoco && sobrepoe(ini, fim, ...regras.almoco)) return "Esse horário cai no intervalo de almoço.";
  const minutosAteLa = (paraDate(inicio).getTime() - agora.getTime()) / 60_000;
  if (minutosAteLa < regras.antecedenciaMin) return "Esse horário já passou ou está em cima da hora.";
  if (ocupadosNoDia(agenda, data).some(([a, b]) => sobrepoe(ini, fim, a, b))) return "Esse horário já está ocupado.";
  return null;
}

/** Lista horários livres a partir de uma data, em blocos de 30 minutos. */
export function horariosLivres({ agenda, regras, aPartirDe, dias = 5, duracao, agora = new Date(), limitePorDia = 8 }) {
  const dur = duracao || regras.duracaoPadrao;
  const resultado = [];
  let data = aPartirDe;
  let diasVerificados = 0;
  for (let i = 0; i < 31 && diasVerificados < dias; i++, data = somarDias(data, 1)) {
    if (!regras.diasSemana.includes(diaDaSemana(data))) continue;
    diasVerificados++;
    const horarios = [];
    for (let m = regras.inicio; m + dur <= regras.fim; m += 30) {
      const inicio = `${data} ${hhmm(m)}`;
      if (!motivoIndisponivel(inicio, dur, agenda, regras, agora)) horarios.push(hhmm(m));
      if (horarios.length >= limitePorDia) break;
    }
    if (horarios.length) resultado.push({ data, dia_semana: nomeDoDia(data), horarios });
  }
  return resultado;
}

/** Envia lembrete para compromissos que começam nas próximas 24 horas. */
export async function executarLembretesAgenda({ agora = new Date() } = {}) {
  const [agenda, clientes] = await Promise.all([listarAgenda(), listarClientes()]);
  const resultado = { enviadas: 0, erros: 0 };
  for (const ag of agenda) {
    if (ag.status !== "confirmado" || ag.lembrete_enviado || !ag.inicio) continue;
    const horasAte = (paraDate(ag.inicio).getTime() - agora.getTime()) / 3_600_000;
    if (horasAte <= 0 || horasAte > 24) continue;

    const cliente = clientes.find((c) => String(c.id) === String(ag.cliente_id));
    const telefone = normalizarTelefone(cliente?.telefone);
    if (!telefone) continue;

    const [data, hora] = ag.inicio.split(" ");
    const quando = data === hoje(agora) ? `hoje (${dataBR(data)})` : dataBR(data);
    const parametros = [String(cliente.nome || "").split(" ")[0] || "tudo bem", paraParametro(ag.titulo || "nossa reunião"), quando, hora];
    try {
      await enviarTemplate(telefone, TEMPLATES.agendaLembrete, IDIOMA_TEMPLATES, parametros);
      await atualizarAgendamento(ag, { lembrete_enviado: "sim" });
      await registrarConversa(telefone, cliente.nome, "saida", `[template ${TEMPLATES.agendaLembrete}] ${parametros.join(" | ")}`);
      resultado.enviadas++;
    } catch (e) {
      resultado.erros++;
      console.error(`Erro no lembrete do agendamento ${ag.id}:`, e.message);
    }
  }
  return resultado;
}

export async function carregarAgendaERegras() {
  const [agenda, cfg] = await Promise.all([listarAgenda(), lerConfig()]);
  return { agenda, regras: regrasDaAgenda(cfg) };
}
