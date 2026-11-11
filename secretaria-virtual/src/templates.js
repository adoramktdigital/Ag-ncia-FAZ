// Templates de mensagem que precisam ser criados e aprovados no WhatsApp Manager
// (business.facebook.com > WhatsApp Manager > Modelos de mensagem), categoria "Utilidade",
// idioma "Português (BR)". O nome e a ordem das variáveis {{1}}, {{2}}... precisam bater com o que está aqui.
// O texto sugerido de cada um está no README.

export const IDIOMA_TEMPLATES = "pt_BR";

export const TEMPLATES = {
  // {{1}} nome, {{2}} descrição, {{3}} valor, {{4}} vencimento, {{5}} como pagar
  cobrancaAntes: "cobranca_lembrete",
  cobrancaHoje: "cobranca_vencimento_hoje",
  cobrancaAtraso: "cobranca_em_atraso",

  // {{1}} nome, {{2}} descrição do material, {{3}} link
  acompanhamentoAprovacao: "acompanhamento_aprovacao",
  // {{1}} nome, {{2}} descrição do material, {{3}} link
  acompanhamentoEntrega: "acompanhamento_entrega",
  // {{1}} nome, {{2}} assunto
  acompanhamentoRetorno: "acompanhamento_retorno",

  // {{1}} nome, {{2}} compromisso, {{3}} data, {{4}} horário
  agendaLembrete: "agenda_lembrete",

  // {{1}} texto do aviso — usado para avisar o responsável humano mesmo fora da janela de 24h
  avisoEquipe: "aviso_equipe",
};
