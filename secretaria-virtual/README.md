# Secretária virtual no WhatsApp — Agência FAZ

Uma secretária que funciona no WhatsApp oficial da empresa. Ela:

- **Cobra clientes automaticamente**, com lembretes antes do vencimento, no dia e depois do vencimento, sempre com o link de pagamento ou o PIX.
- **Acompanha trabalhos**: pede aprovação de materiais, avisa entregas e cobra retornos. Quando o cliente responde, ela registra se ele aprovou ou pediu ajustes.
- **Atende clientes 24h com IA (Claude)**: tira dúvidas, informa valores e vencimentos, registra quem diz que pagou e cadastra contatos novos.
- **Agenda reuniões e gravações**: mostra horários livres, marca, cancela e manda lembrete na véspera.
- **Chama você quando precisa**: passa o atendimento para um humano e manda um aviso no seu WhatsApp.

Tudo fica numa **planilha do Google Sheets**. Você cadastra os clientes e as mensalidades ali, e a secretária lê e atualiza a mesma planilha.

```
Cliente no WhatsApp ──► Meta (WhatsApp Cloud API) ──► este servidor ──► Claude (IA)
                                                         │
                                                         └──► Google Sheets (clientes, cobranças, agenda...)
```

---

## Comece por aqui: cobrança de mensalidades

O sistema vem configurado para começar **só com a cobrança das mensalidades dos clientes de recorrência** (`MODULOS=cobrancas`), sem IA. Tudo fica na aba **Clientes**, uma linha por cliente:

| Coluna | O que colocar |
|---|---|
| `empresa` | Nome da empresa cliente (ex.: CASA PORTO). Vai na mensagem como "Casa Porto" |
| `contato` | Nome da pessoa com quem falamos. A mensagem começa com "Olá, " e o primeiro nome. Sem contato, usa o nome da empresa |
| `telefone` | WhatsApp com DDD (ex.: 11 98765-4321) |
| `cobranca_automatica` | `sim` para receber lembretes. `não` ou em branco: **nunca** recebe mensagem. Use para quem sempre paga em dia |
| `valor` | Valor da mensalidade |
| `dia_vencimento` | Dia do mês em que vence (1 a 31). Dia 31 em mês curto vira o último dia do mês |
| `link_pagamento` | Opcional. Sem link, a mensagem leva a `chave_pix` da aba Config |
| `pago_ate` | **Último mês pago** (ex.: 10/2026). Sem isso o cliente não é cobrado, para ninguém receber cobrança de um mês que já pagou |
| `aviso_mes`, `avisos_enviados`, `ultimo_aviso` | Preenchidas pelo sistema. Não precisa mexer |

**Como funciona:**

1. O sistema sempre cobra o mês seguinte ao `pago_ate`. Com `pago_ate = 10/2026` e vencimento dia 10, ele cobra novembro, que vence em 10/11/2026.
2. De segunda a sábado, às 9h30, saem os lembretes na régua da aba Config (padrão: 5 dias antes, no dia, e 1, 3 e 7 dias depois do vencimento).
3. **Quando o cliente pagar, atualize o `pago_ate`** (ex.: de 10/2026 para 11/2026). Os lembretes de novembro param, e a régua de dezembro começa 5 dias antes do próximo vencimento. Se ele pagar adiantado, coloque o mês até onde pagou.
4. Se o cliente passar por toda a régua sem pagar, você recebe um aviso para fazer um contato pessoal.
5. **Quando o cliente responder**, ninguém responde automaticamente. Você responde pessoalmente:
   - Se o número da empresa continua no app **WhatsApp Business** do celular (modo coexistência), as respostas aparecem lá normalmente. Coloque `encaminhar_respostas = não` na aba Config.
   - Se o número ficou só na API, deixe `encaminhar_respostas = sim`. Cada resposta de cliente chega no seu WhatsApp (`telefone_humano`), e você responde mandando para o número da empresa: `#r 5511988887777 Oi! Obrigado, vou conferir.`

**Exemplo:**

| empresa | contato | telefone | cobranca_automatica | valor | dia_vencimento | pago_ate |
|---|---|---|---|---|---|---|
| CASA PORTO | Marcelo | 21 98765-4321 | sim | R$ 3.500,00 | 10 | 10/2026 |
| LARGO | Ana | 21 91111-2222 | não | R$ 1.500,00 | 5 | |

A Casa Porto recebe lembretes de novembro em 05/11, 10/11, 11/11, 13/11 e 17/11, até o `pago_ate` virar 11/2026. A mensagem diz, por exemplo: "Olá, Marcelo! Tudo bem? Passando para lembrar do vencimento dos serviços de marketing da empresa Casa Porto, no valor de R$ 3.500,00, que vence em 10/11/2026. Para facilitar o pagamento, seguem os dados abaixo: Chave PIX: ...". O Largo nunca recebe.

**O que você precisa para essa primeira etapa:** os passos 1, 2, 3 e 5 abaixo. A chave do Claude (passo 4) não é necessária. Dos templates, crie só estes 4: `cobranca_lembrete`, `cobranca_vencimento_hoje`, `cobranca_em_atraso` e `aviso_equipe`.

Quando quiser ligar as outras funções, mude a variável `MODULOS` (ex.: `MODULOS=cobrancas,acompanhamentos,agenda,ia`) e rode `npm run setup-planilha` de novo. As abas que faltarem são criadas.

---

## Passo a passo de instalação

Você vai precisar de: **(1)** WhatsApp Cloud API, **(2)** templates de mensagem aprovados, **(3)** a planilha do Google com uma conta de serviço e **(4)** uma chave da API do Claude, mas esta só quando ligar a IA. Depois disso, é colocar o servidor no ar.

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
| `cobranca_lembrete` | Olá, {{1}}! Tudo bem?<br>Passando para lembrar do vencimento dos serviços de marketing da empresa *{{2}}*, no valor de R$ {{3}}, que vence em {{4}}.<br>Para facilitar o pagamento, seguem os dados abaixo:<br>{{5}}<br>Qualquer dúvida, é só responder esta mensagem. |
| `cobranca_vencimento_hoje` | Olá, {{1}}! Tudo bem?<br>Hoje vence o pagamento dos serviços de marketing da empresa *{{2}}*, no valor de R$ {{3}} ({{4}}).<br>Para facilitar o pagamento, seguem os dados abaixo:<br>{{5}}<br>Se já realizou o pagamento, pode desconsiderar esta mensagem. |
| `cobranca_em_atraso` | Olá, {{1}}! Tudo bem?<br>Ainda não identificamos o pagamento dos serviços de marketing da empresa *{{2}}*, no valor de R$ {{3}}, que venceu em {{4}}.<br>Para facilitar, seguem os dados para pagamento:<br>{{5}}<br>Se já pagou, é só responder esta mensagem que conferimos. |
| `acompanhamento_aprovacao` | Olá, {{1}}! O material *{{2}}* está pronto para sua aprovação: {{3}}. Pode responder por aqui se aprova ou se quer algum ajuste. |
| `acompanhamento_entrega` | Olá, {{1}}! Entregamos *{{2}}*: {{3}}. Pode confirmar o recebimento por aqui? |
| `acompanhamento_retorno` | Olá, {{1}}! Estamos aguardando seu retorno sobre *{{2}}* para seguir com o trabalho. Consegue nos responder por aqui? |
| `agenda_lembrete` | Olá, {{1}}! Lembrando do nosso compromisso: *{{2}}*, {{3}} às {{4}}. Se precisar remarcar, é só responder esta mensagem. |
| `aviso_equipe` | Aviso da secretária virtual: {{1}} |

Onde aparece `<br>`, pule uma linha no texto do template. Nas cobranças, as variáveis são: {{1}} nome do contato, {{2}} nome da empresa, {{3}} valor, {{4}} data de vencimento e {{5}} dados para pagamento ("Chave PIX: ..." ou "Link para pagamento: ...").

Ao criar cada template, a Meta pede exemplos para as variáveis. Use algo como "Marcelo", "Casa Porto", "3.500,00", "10/11/2026", "Chave PIX: 00.000.000/0001-00".

O `aviso_equipe` serve para a secretária avisar **você** (cobranças esgotadas, atendimentos transferidos, pagamentos informados, novos agendamentos).

### 3. Planilha do Google + conta de serviço

1. Crie uma planilha vazia no Google Sheets e copie o **ID** da URL: `docs.google.com/spreadsheets/d/`**`ESTE_TRECHO`**`/edit`. Ele vai em `GOOGLE_SHEET_ID`.
2. Acesse console.cloud.google.com, crie um projeto e ative a **Google Sheets API**.
3. Vá em **IAM e administrador > Contas de serviço**, crie uma conta de serviço, abra-a e, em **Chaves > Adicionar chave > JSON**, baixe o arquivo.
4. Abra a planilha, clique em **Compartilhar** e dê acesso de **Editor** ao e-mail da conta de serviço (algo como `nome@projeto.iam.gserviceaccount.com`).
5. Coloque o conteúdo do JSON em `GOOGLE_SERVICE_ACCOUNT_JSON`. Pode ser o JSON numa linha só ou em base64 (`base64 -w0 arquivo.json`).
6. Rode `npm run setup-planilha` (passo 5). Ele cria todas as abas e colunas.

### 4. Chave da API do Claude (só com a função `ia` ligada)

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
6. Teste: cadastre você mesmo como cliente com `cobranca_automatica = sim`, `dia_vencimento` igual ao dia de hoje e `pago_ate` igual ao mês passado. Depois mande `#rotinas` do seu WhatsApp. A cobrança deve chegar em seguida 🎉

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
| **Clientes** | Uma linha por cliente, com a mensalidade. Com outras funções ligadas, ganha as colunas `id` (código do cliente, ex.: C001), `email`, `empresa` e `status`. Com a IA ligada, contatos novos entram aqui como `lead`. | `nome`, `telefone`, `cobranca_automatica`, `valor`, `dia_vencimento`, `pago_ate` |
| **Acompanhamentos** | Materiais aguardando aprovação, entregas e retornos. | `id`, `cliente_id`, `tipo` (`aprovacao`, `entrega` ou `retorno`), `descricao`, `link`, `status` |
| **Agenda** | Compromissos. A secretária marca aqui, e você também pode lançar à mão para bloquear horários. | `inicio` (DD/MM/AAAA HH:mm), `duracao_min`, `status` |
| **Config** | Ajustes: nome da empresa, seu telefone, PIX, régua de cobrança, horários da agenda e informações para a IA. | `chave`, `valor` |
| **Atendimento** | Contatos em atendimento humano (`modo = humano`). A secretária não responde esses contatos. | `telefone`, `modo` (`bot` ou `humano`) |
| **Conversas** | Histórico de tudo que entrou e saiu. | — |

### Status

- **Mensalidade:** controlada pelo `pago_ate`. Para parar de cobrar um cliente de vez, coloque `cobranca_automatica = não`.
- **Acompanhamento:**
  - `aguardando`: a secretária manda lembretes a cada X dias.
  - `aprovado`, `ajustes`, `concluido` ou `sem_resposta`: os lembretes param.
- **Agenda:** `confirmado` ou `cancelado`.

### Primeiros ajustes na aba Config

- `telefone_humano`: **seu WhatsApp**, que recebe os avisos (ex.: 5511999999999).
- `chave_pix`: usada quando o cliente não tem link de pagamento.
- `informacoes_empresa`: **muito importante**. Escreva os serviços, como funciona, preços que podem ser informados, endereço, horário e perguntas frequentes. É daqui que a IA tira as respostas.
- `cobranca_etapas`: o padrão `-5,0,1,3,7` significa 5 dias antes, no dia, e 1, 3 e 7 dias depois. Como não há envio aos domingos, uma etapa que cair num domingo sai na segunda. Depois da última etapa, você recebe um aviso para fazer um contato pessoal.
- `agenda_*`: dias e horários em que a secretária pode agendar.

### Quando as mensagens automáticas saem

- **Cobranças e acompanhamentos:** de segunda a sábado, às 9h30.
- **Lembretes de agenda:** de hora em hora, das 8h às 20h, para compromissos das próximas 24h.

Se preferir disparar por um agendador externo (por exemplo cron-job.org), use `ROTINAS_ATIVAS=false` e chame:
`POST https://SEU-ENDERECO/rotinas/executar` com o cabeçalho `Authorization: Bearer SEU_ROTINAS_TOKEN`.

### Comandos pelo WhatsApp

Do número cadastrado em `telefone_humano`, mande para o número da empresa:

- `#r 5511988887777 sua mensagem`: responde o cliente pelo número da empresa. Funciona até 24h depois da última mensagem dele, que é a regra da Meta.
- `#humano 5511988887777`: (com a IA ligada) a secretária para de responder esse cliente, e você assume.
- `#bot 5511988887777`: (com a IA ligada) a secretária volta a atender esse cliente.
- `#rotinas`: faz agora os envios do dia. Útil para testar; não repete mensagem que já saiu no dia.

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
