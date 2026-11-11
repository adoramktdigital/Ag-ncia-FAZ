// Avisos para o responsável humano (telefone_humano na aba Config).
import { enviarTemplate } from "./whatsapp.js";
import { lerConfig } from "./dados.js";
import { normalizarTelefone } from "./util/telefone.js";
import { TEMPLATES, IDIOMA_TEMPLATES } from "./templates.js";

/** Parâmetros de template não aceitam quebra de linha nem mais de 4 espaços seguidos. */
export function paraParametro(texto, limite = 900) {
  return String(texto ?? "").replace(/[\r\n\t]+/g, " | ").replace(/ {4,}/g, "   ").trim().slice(0, limite);
}

/**
 * Manda um aviso para a equipe. Usa sempre o template `aviso_equipe` porque
 * a janela de 24h do responsável quase nunca está aberta.
 */
export async function avisarEquipe(texto) {
  const cfg = await lerConfig();
  const destino = normalizarTelefone(cfg.telefone_humano);
  console.log("[Aviso para a equipe]", texto);
  if (!destino) return;
  try {
    await enviarTemplate(destino, TEMPLATES.avisoEquipe, IDIOMA_TEMPLATES, [paraParametro(texto)]);
  } catch (e) {
    console.error("Falha ao avisar a equipe:", e.message);
  }
}
