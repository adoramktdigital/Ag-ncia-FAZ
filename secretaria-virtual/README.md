# Secretária virtual no WhatsApp — Agência FAZ

Uma secretária que funciona no WhatsApp oficial da empresa. Ela:

- **Cobra clientes automaticamente**, com lembretes antes do vencimento, no dia e depois do vencimento, sempre com o link de pagamento ou o PIX.
- **Acompanha trabalhos**: pede aprovação de materiais, avisa entregas e cobra retornos. Quando o cliente responde, ela registra se ele aprovou ou pediu ajustes.
- **Atende clientes 24h com IA (Claude)**: tira dúvidas, informa valores e vencimentos, registra quem diz que pagou e cadastra contatos novos.
- **Agenda reuniões e gravações**: mostra horários livres, marca, cancela e manda lembrete na véspera.
- **Chama você quando precisa**: passa o atendimento para um humano e manda um aviso no seu WhatsApp.

Tudo fica numa **planilha do Google Sheets**. Você cadastra clientes, cobranças e trabalhos ali, e a secretária lê e atualiza a mesma planilha.

```
Cliente no WhatsApp ──► Meta (WhatsApp Cloud API) ──► este servidor ──► Claude (IA)
                                                         │
                                                         └──► Google Sheets (clientes, cobranças, agenda...)
```

---

## Passo a passo de instalação

Você vai precisar de 4 coisas: **(1)** WhatsApp Cloud API, **(2)** templates de mensagem aprovados, **(3)** a planilha do Google com uma conta de serviço e **(4)** uma chave da API do Claude. Depois disso, é colocar o servidor no ar.

### 1. WhatsApp Cloud API (Meta)

1. Crie (ou use) uma conta no **Meta Business** em business.facebook.com.
2. Acesse developers.facebook.com, clique em **Criar app**, escolha o tipo **Empresa** e adicione o produto **WhatsApp**.
3. Em **WhatsApp > Configuração da API**, adicione o número da empresa e verifique por SMS ou ligação.
   - Se o número já está no app **WhatsApp Business**, a Meta permite usar os dois juntos ("coexistência"): o celular continua funcionando e a API recebe as mensagens também. Escolha essa opção ao conectar o número, se aparecer. Se não aparecer, o número sai do app e passa a funcionar só pela API.
4. Anote o **Phone number ID**. Ele vai em `WHATSAPP_PHONE_NUMBER_ID`.
5. Crie um **token permanente**: em business.facebook.com, vá em **Configurações do negócio > Usuários do sistema**, crie um usuário admin, gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management` e selecione o app. Esse token vai em `WHATSAPP_TOKEN`.
   - O token temporário da tela de configuração expira em 24h. Use ele só para testar.
6. Em **Configurações do app > Básico**, copie a **Chave secreta do app**. Ela vai em `WHATSAPP_APP_SECRET`.
7. O webhook é configurado no passo 5, depois que o servidor estiver no ar.
8. Cadastre uma forma de pagamento no WhatsApp Manager. As mensagens que a empresa inicia (cobranças e lembretes) são cobradas por mensagem pela Meta. Responder clientes dentro de 24h é grátis.

### 2. Templates de mensagem

A Meta só deixa a empresa **iniciar** uma conversa com mensagens de template aprovadas. Crie os templates abaixo em **WhatsApp Manager > Modelos de mensagem > Criar modelo**:

- **Categoria:** Utilidade
- **Idioma:** Português (BR)
- **Nome:** exatamente como está abaixo

A aprovação costuma levar de minutos a algumas horas. Você pode ajustar o texto, mas mantenha a **mesma quantidade e ordem de variáveis**.

| Nome | Texto sugerido |
|---|---|
| `cobranca_lembrete` | Olá, {{1}}! Passando para lembrar que a fatura de *{{2}}*, no valor de R$ {{3}}, vence em {{4}}. Para pagar: {{5}}. Qualquer dúvida é só responder por aqui. |
| `cobranca_vencimento_hoje` | Olá, {{1}}! A fatura de *{{2}}*, no valor de R$ {{3}}, vence hoje ({{4}}). Para pagar: {{5}}. Se já pagou, pode desconsiderar ou nos avisar por aqui. |
| `cobranca_em_atraso` | Olá, {{1}}, tudo bem? Não identificamos o pagamento da fatura de *{{2}}* (R$ {{3}}), que venceu em {{4}}. Para pagar: {{5}}. Se já pagou, é só responder esta mensagem que conferimos. |
| `acompanhamento_aprovacao` | Olá, {{1}}! O material *{{2}}* está pronto para sua aprovação: {{3}}. Pode responder por aqui se aprova ou se quer algum ajuste. |
| `acompanhamento_entrega` | Olá, {{1}}! Entregamos *{{2}}*: {{3}}. Pode confirmar o recebimento por aqui? |
| `acompanhamento_retorno` | Olá, {{1}}! Estamos aguardando seu retorno sobre *{{2}}* para seguir com o trabalho. Consegue nos responder por aqui? |
| `agenda_lembrete` | Olá, {{1}}! Lembrando do nosso compromisso: *{{2}}*, {{3}} às {{4}}. Se precisar remarcar, é só responder esta mensagem. |
| `aviso_equipe` | Aviso da secretária virtual: {{1}} |

Ao criar cada template, a Meta pede exemplos para as variáveis. Use algo como "Ana", "Gestão de redes – novembro", "1.500,00", "20/11/2026", "https://link.de/pagamento".

O `aviso_equipe` serve para a secretária avisar **você** (cobranças esgotadas, atendimentos transferidos, pagamentos informados, novos agendamentos).

### 3. Planilha do Google + conta de serviço

1. Crie uma planilha vazia no Google Sheets e copie o **ID** da URL: `docs.google.com/spreadsheets/d/`**`ESTE_TRECHO`**`/edit`. Ele vai em `GOOGLE_SHEET_ID`.
2. Acesse console.cloud.google.com, crie um projeto e ative a **Google Sheets API**.
3. Vá em **IAM e administrador > Contas de serviço**, crie uma conta de serviço, abra-a e, em **Chaves > Adicionar chave > JSON**, baixe o arquivo.
4. Abra a planilha, clique em **Compartilhar** e dê acesso de **Editor** ao e-mail da conta de serviço (algo como `nome@projeto.iam.gserviceaccount.com`).
5. Coloque o conteúdo do JSON em `GOOGLE_SERVICE_ACCOUNT_JSON`. Pode ser o JSON numa linha só ou em base64 (`base64 -w0 arquivo.json`).
6. Rode `npm run setup-planilha` (passo 5). Ele cria todas as abas e colunas.

### 4. Chave da API do Claude

Acesse console.anthropic.com, vá em **API Keys > Create Key** e coloque a chave em `ANTHROPIC_API_KEY`. Adicione créditos em **Billing**.

O modelo padrão é o Claude Opus 5.5 (`CLAUDE_MODEL`). Se uma mensagem for recusada pelos filtros de segurança do modelo, o código já pede para a API tentar automaticamente com outro modelo (*fallback*). Se mesmo assim não houver resposta, o atendimento vai para um humano.

### 5. Colocar no ar

O servidor precisa ficar **ligado 24h** e ter um endereço **HTTPS público**. Algumas opções simples são Render, Railway e Fly.io, ou uma VPS.

**Exemplo com Render:**

1. Suba este repositório no GitHub (ele já está lá).
2. No render.com, crie um **New > Web Service**, conecte o repositório e preencha:
   - **Root Directory:** `secretaria-virtual`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plano:** um plano pago (o gratuito "dorme" e perde mensagens e rotinas).
3. Em **Environment**, cadastre todas as variáveis do arquivo `.env.example`.
4. Depois do deploy, rode uma vez no **Shell** do Render: `npm run setup-planilha`.
5. Volte ao painel da Meta, em **WhatsApp > Configuração > Webhook**:
   - **URL de callback:** `https://SEU-ENDERECO.onrender.com/webhook`
   - **Token de verificação:** o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Clique em **Verificar e salvar** e, em **Campos do webhook**, assine **messages**.
6. Mande um "oi" para o número da empresa. A secretária deve responder 🎉

**Rodando no seu computador (para testar):**

```bash
cd secretaria-virtual
cp .env.example .env       # preencha os valores
npm install
npm run setup-planilha
npm run dev                # sobe em http://localhost:3000
```

Para a Meta enxergar seu computador, use um túnel como `ngrok http 3000` e configure a URL dele no webhook. Com `WHATSAPP_DRY_RUN=true`, nada é enviado de verdade; as mensagens só aparecem no log.

---

## Como usar no dia a dia

### Abas da planilha

| Aba | Para que serve | Colunas importantes |
|---|---|---|
| **Clientes** | Cadastro de clientes. Contatos novos que falam com a secretária entram aqui como `lead`. | `id` (qualquer código único, ex.: C001), `nome`, `telefone` (com DDD, ex.: 11 98765-4321) |
| **Cobrancas** | Uma linha por fatura. | `id`, `cliente_id`, `descricao`, `valor`, `vencimento` (DD/MM/AAAA), `status`, `link_pagamento` |
| **Acompanhamentos** | Materiais aguardando aprovação, entregas e retornos. | `id`, `cliente_id`, `tipo` (`aprovacao`, `entrega` ou `retorno`), `descricao`, `link`, `status` |
| **Agenda** | Compromissos. A secretária marca aqui, e você também pode lançar à mão para bloquear horários. | `inicio` (DD/MM/AAAA HH:mm), `duracao_min`, `status` |
| **Config** | Ajustes: nome da empresa, seu telefone, PIX, régua de cobrança, horários da agenda e informações para a IA. | `chave`, `valor` |
| **Atendimento** | Contatos em atendimento humano (`modo = humano`). A secretária não responde esses contatos. | `telefone`, `modo` (`bot` ou `humano`) |
| **Conversas** | Histórico de tudo que entrou e saiu. | — |

### Status

- **Cobrança:**
  - `pendente`: a secretária cobra.
  - `em_verificacao`: o cliente disse que pagou. Confira e mude para `pago`.
  - `pago` ou `cancelado`: a secretária para de cobrar.
- **Acompanhamento:**
  - `aguardando`: a secretária manda lembretes a cada X dias.
  - `aprovado`, `ajustes`, `concluido` ou `sem_resposta`: os lembretes param.
- **Agenda:** `confirmado` ou `cancelado`.

### Primeiros ajustes na aba Config

- `telefone_humano`: **seu WhatsApp**, que recebe os avisos (ex.: 5511999999999).
- `chave_pix`: usada quando a cobrança não tem link de pagamento.
- `informacoes_empresa`: **muito importante**. Escreva os serviços, como funciona, preços que podem ser informados, endereço, horário e perguntas frequentes. É daqui que a IA tira as respostas.
- `cobranca_etapas`: o padrão `-3,0,1,3,7` significa 3 dias antes, no dia, e 1, 3 e 7 dias depois. Depois da última etapa, você recebe um aviso para fazer um contato pessoal.
- `agenda_*`: dias e horários em que a secretária pode agendar.

### Quando as mensagens automáticas saem

- **Cobranças e acompanhamentos:** de segunda a sábado, às 9h30.
- **Lembretes de agenda:** de hora em hora, das 8h às 20h, para compromissos das próximas 24h.

Se preferir disparar por um agendador externo (por exemplo cron-job.org), use `ROTINAS_ATIVAS=false` e chame:
`POST https://SEU-ENDERECO/rotinas/executar` com o cabeçalho `Authorization: Bearer SEU_ROTINAS_TOKEN`.

### Comandos pelo WhatsApp

Do número cadastrado em `telefone_humano`, mande para o número da empresa:

- `#humano 5511988887777`: a secretária para de responder esse cliente, e você assume.
- `#bot 5511988887777`: a secretária volta a atender esse cliente.
- `#rotinas`: dispara as cobranças, os acompanhamentos e os lembretes agora.

Também dá para mudar a coluna `modo` na aba **Atendimento** direto na planilha.

---

## Para desenvolvedores

- Node.js 20+, sem etapa de build. Para rodar os testes: `npm test` (planilha, WhatsApp e Claude simulados).
- Estrutura do código:
  - `src/index.js`: servidor HTTP (webhook e rotinas).
  - `src/atendimento.js`: fila por contato, agrupamento de mensagens em sequência, modo humano e comandos.
  - `src/ia/`: agente com Claude (instruções, ferramentas e loop de ferramentas).
  - `src/rotinas/`: régua de cobrança, acompanhamentos e agenda.
  - `src/dados.js` e `src/planilha.js`: acesso ao Google Sheets.
  - `src/whatsapp.js`: WhatsApp Cloud API.
- Segurança:
  - O webhook confere a assinatura `X-Hub-Signature-256` da Meta.
  - As ferramentas da IA só acessam os dados do telefone que está conversando. A IA nunca escolhe de quem são os dados.
- Limitações desta primeira versão:
  - O histórico da conversa com a IA fica na memória do servidor. Se o servidor reiniciar, a conversa recomeça do zero, mas os dados continuam na planilha.
  - Áudios não são transcritos ainda.
  - A agenda não sincroniza com o Google Agenda. Essa é uma boa próxima melhoria.
