import express from "express";
import { config } from "./config.js";
import { assinaturaValida, extrairMensagens } from "./whatsapp.js";
import { receberMensagem } from "./atendimento.js";
import { agendarRotinas, executarRotinas } from "./rotinas/index.js";

const app = express();

// Guardamos o corpo bruto para conferir a assinatura da Meta.
app.use(express.json({ verify: (req, _res, buf) => { req.corpoBruto = buf; } }));

app.get("/", (_req, res) => res.send("Secretária virtual no ar ✅"));

// Verificação do webhook (a Meta chama isso uma vez, ao configurar).
app.get("/webhook", (req, res) => {
  const { "hub.mode": modo, "hub.verify_token": token, "hub.challenge": desafio } = req.query;
  if (modo === "subscribe" && token === config.whatsapp.verifyToken) return res.status(200).send(desafio);
  return res.sendStatus(403);
});

// Mensagens recebidas.
app.post("/webhook", (req, res) => {
  if (!assinaturaValida(req.corpoBruto, req.get("x-hub-signature-256"))) {
    console.warn("Webhook com assinatura inválida recusado.");
    return res.sendStatus(401);
  }
  // Responde rápido para a Meta não reenviar; o processamento segue em segundo plano.
  res.sendStatus(200);
  for (const msg of extrairMensagens(req.body)) receberMensagem(msg);
});

// Disparo manual/externo das rotinas (ex.: cron-job.org), protegido por token.
app.post("/rotinas/executar", async (req, res) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.query.token;
  if (!config.rotinas.token || token !== config.rotinas.token) return res.sendStatus(401);
  const quais = req.query.quais ? String(req.query.quais).split(",") : undefined;
  res.json(await executarRotinas(quais));
});

app.listen(config.porta, () => {
  console.log(`Secretária virtual ouvindo na porta ${config.porta}`);
  if (config.whatsapp.simulacao) console.log("⚠️  WHATSAPP_DRY_RUN=true: nenhuma mensagem será enviada de verdade.");
  if (config.rotinas.ativas) agendarRotinas();
});
