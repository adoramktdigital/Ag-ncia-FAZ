// Cliente mínimo da WhatsApp Cloud API (API oficial da Meta).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import crypto from "node:crypto";
import { config } from "./config.js";

function url(caminho) {
  return `https://graph.facebook.com/${config.whatsapp.versaoApi}/${config.whatsapp.phoneNumberId}/${caminho}`;
}

async function chamarApi(corpo) {
  if (config.whatsapp.simulacao) {
    console.log("[WhatsApp simulação] enviaria:", JSON.stringify(corpo));
    return { simulacao: true };
  }
  const resposta = await fetch(url("messages"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(`WhatsApp API ${resposta.status}: ${dados?.error?.message || "erro desconhecido"}`);
    erro.detalhes = dados?.error;
    throw erro;
  }
  return dados;
}

/**
 * Texto livre. Só é entregue se o cliente mandou mensagem nas últimas 24h
 * (regra da Meta). Fora dessa janela, use enviarTemplate.
 */
export function enviarTexto(para, texto) {
  return chamarApi({
    recipient_type: "individual",
    to: para,
    type: "text",
    text: { body: texto, preview_url: true },
  });
}

/**
 * Mensagem de template aprovado no WhatsApp Manager. É o único jeito de a
 * empresa iniciar conversa (cobranças, lembretes, acompanhamentos).
 */
export function enviarTemplate(para, nome, idioma, parametros = []) {
  const template = { name: nome, language: { code: idioma } };
  if (parametros.length) {
    template.components = [{
      type: "body",
      parameters: parametros.map((p) => ({ type: "text", text: String(p ?? "").trim() || "-" })),
    }];
  }
  return chamarApi({ to: para, type: "template", template });
}

/** Marca a mensagem como lida (os "dois tracinhos azuis"). */
export function marcarComoLida(idMensagem) {
  return chamarApi({ status: "read", message_id: idMensagem }).catch((e) =>
    console.warn("Não consegui marcar como lida:", e.message),
  );
}

/** Confere a assinatura X-Hub-Signature-256 para garantir que o webhook veio da Meta. */
export function assinaturaValida(corpoBruto, cabecalho) {
  if (!config.whatsapp.appSecret) return true; // sem segredo configurado, não dá para validar
  if (!cabecalho || !corpoBruto) return false;
  const esperado = "sha256=" + crypto.createHmac("sha256", config.whatsapp.appSecret).update(corpoBruto).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(cabecalho));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Extrai as mensagens recebidas do payload do webhook.
 * Retorna [{ id, de, nome, tipo, texto, timestamp }].
 */
export function extrairMensagens(payload) {
  const mensagens = [];
  for (const entrada of payload?.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const valor = mudanca.value || {};
      const contatos = valor.contacts || [];
      for (const msg of valor.messages || []) {
        const contato = contatos.find((c) => c.wa_id === msg.from);
        mensagens.push({
          id: msg.id,
          de: msg.from,
          nome: contato?.profile?.name || "",
          tipo: msg.type,
          texto: textoDaMensagem(msg),
          timestamp: Number(msg.timestamp) * 1000,
        });
      }
    }
  }
  return mensagens;
}

function textoDaMensagem(msg) {
  switch (msg.type) {
    case "text": return msg.text?.body || "";
    case "button": return msg.button?.text || "";
    case "interactive":
      return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
    case "image": return `[cliente enviou uma imagem]${msg.image?.caption ? " Legenda: " + msg.image.caption : ""}`;
    case "document": return `[cliente enviou um documento: ${msg.document?.filename || "arquivo"}]${msg.document?.caption ? " Legenda: " + msg.document.caption : ""}`;
    case "audio": return "[cliente enviou um áudio — ainda não consigo ouvir áudios]";
    case "video": return "[cliente enviou um vídeo]";
    case "sticker": return "[cliente enviou uma figurinha]";
    case "location": return `[cliente enviou uma localização: ${msg.location?.latitude}, ${msg.location?.longitude}]`;
    case "contacts": return "[cliente enviou um contato]";
    case "reaction": return ""; // reações são ignoradas
    default: return `[mensagem do tipo ${msg.type}]`;
  }
}
