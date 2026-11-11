import "dotenv/config";

function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ${nome} não configurada (veja .env.example)`);
  return valor;
}

function lerContaDeServico() {
  const bruto = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!bruto) return null;
  const texto = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
  return JSON.parse(texto);
}

export const config = {
  porta: Number(process.env.PORT || 3000),
  fuso: process.env.TZ || "America/Sao_Paulo",

  whatsapp: {
    get token() { return obrigatoria("WHATSAPP_TOKEN"); },
    get phoneNumberId() { return obrigatoria("WHATSAPP_PHONE_NUMBER_ID"); },
    get verifyToken() { return obrigatoria("WHATSAPP_VERIFY_TOKEN"); },
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    versaoApi: process.env.WHATSAPP_API_VERSION || "v23.0",
    simulacao: process.env.WHATSAPP_DRY_RUN === "true",
  },

  claude: {
    modelo: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  },

  google: {
    get planilhaId() { return obrigatoria("GOOGLE_SHEET_ID"); },
    get contaDeServico() {
      const conta = lerContaDeServico();
      if (!conta) throw new Error("Variável GOOGLE_SERVICE_ACCOUNT_JSON não configurada");
      return conta;
    },
  },

  rotinas: {
    ativas: process.env.ROTINAS_ATIVAS !== "false",
    token: process.env.ROTINAS_TOKEN || "",
  },
};
