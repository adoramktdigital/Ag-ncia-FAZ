import cron from "node-cron";
import { executarCobrancas } from "./cobranca.js";
import { executarAcompanhamentos } from "./acompanhamento.js";
import { executarLembretesAgenda } from "./agenda.js";
import { config } from "../config.js";

const vazio = { enviadas: 0, erros: 0 };

async function seguro(nome, fn) {
  try {
    const r = await fn();
    console.log(`[Rotina] ${nome}:`, r);
    return r;
  } catch (e) {
    console.error(`[Rotina] ${nome} falhou:`, e);
    return { ...vazio, erros: 1 };
  }
}

/** Roda as rotinas de envio. `quais` permite escolher só algumas. */
export async function executarRotinas(quais = ["cobrancas", "acompanhamentos", "agenda"]) {
  return {
    cobrancas: quais.includes("cobrancas") ? await seguro("cobranças", executarCobrancas) : vazio,
    acompanhamentos: quais.includes("acompanhamentos") ? await seguro("acompanhamentos", executarAcompanhamentos) : vazio,
    agenda: quais.includes("agenda") ? await seguro("lembretes de agenda", executarLembretesAgenda) : vazio,
  };
}

export function agendarRotinas() {
  const opcoes = { timezone: config.fuso };
  // Cobranças e acompanhamentos: segunda a sábado, às 9h30.
  cron.schedule("30 9 * * 1-6", () => executarRotinas(["cobrancas", "acompanhamentos"]), opcoes);
  // Lembretes de agenda: de hora em hora, das 8h às 20h.
  cron.schedule("0 8-20 * * *", () => executarRotinas(["agenda"]), opcoes);
  console.log("Rotinas automáticas agendadas (cobranças/acompanhamentos 9h30 seg-sáb; agenda de hora em hora).");
}
