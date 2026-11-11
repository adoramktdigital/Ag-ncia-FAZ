import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefone, mesmoTelefone } from "../src/util/telefone.js";
import { diasEntre, somarDias, normalizarData, normalizarDataHora, paraDate, hoje, diaDaSemana } from "../src/util/datas.js";
import { etapaDeHoje, lerEtapas } from "../src/rotinas/cobranca.js";
import { precisaContato } from "../src/rotinas/acompanhamento.js";
import { regrasDaAgenda, horariosLivres, motivoIndisponivel } from "../src/rotinas/agenda.js";
import { valorEmReais, cobrancaAtivada, estruturaAtiva } from "../src/dados.js";
import { paraParametro } from "../src/avisos.js";
import { extrairMensagens } from "../src/whatsapp.js";

test("telefones: normaliza e compara com/sem nono dígito", () => {
  assert.equal(normalizarTelefone("(11) 98765-4321"), "5511987654321");
  assert.equal(normalizarTelefone("+55 11 98765-4321"), "5511987654321");
  assert.ok(mesmoTelefone("5511987654321", "551187654321"));
  assert.ok(mesmoTelefone("11 98765-4321", "5511987654321"));
  assert.ok(!mesmoTelefone("5511987654321", "5511987654322"));
});

test("datas", () => {
  assert.equal(diasEntre("2026-11-10", "2026-11-13"), 3);
  assert.equal(diasEntre("2026-11-13", "2026-11-10"), -3);
  assert.equal(somarDias("2026-12-30", 3), "2027-01-02");
  assert.equal(normalizarData("20/11/2026"), "2026-11-20");
  assert.equal(normalizarDataHora("5/1/2027 9:30"), "2027-01-05 09:30");
  assert.equal(paraDate("2026-11-11 09:00").toISOString(), "2026-11-11T12:00:00.000Z"); // São Paulo = UTC-3
  assert.equal(hoje(new Date("2026-11-12T02:00:00Z")), "2026-11-11"); // 23h em SP ainda é dia 11
  assert.equal(diaDaSemana("2026-11-11"), 3);
});

test("régua de cobrança", () => {
  const etapas = lerEtapas("-3,0,1,3,7");
  assert.deepEqual(lerEtapas(""), []);
  assert.deepEqual(lerEtapas(" -3, 0 "), [-3, 0]);
  const base = { status: "pendente", vencimento: "2026-11-20", avisos_enviados: "", ultimo_aviso: "" };
  assert.equal(etapaDeHoje(base, etapas, "2026-11-16"), null);      // D-4: nada
  assert.equal(etapaDeHoje(base, etapas, "2026-11-17"), -3);        // D-3
  assert.equal(etapaDeHoje({ ...base, avisos_enviados: "-3" }, etapas, "2026-11-18"), null);
  assert.equal(etapaDeHoje({ ...base, avisos_enviados: "-3" }, etapas, "2026-11-20"), 0);
  // servidor ficou fora no D+1 e D+2: no D+2 manda só a etapa 1 (a mais recente), não várias
  assert.equal(etapaDeHoje({ ...base, avisos_enviados: "-3,0" }, etapas, "2026-11-22"), 1);
  assert.equal(etapaDeHoje({ ...base, avisos_enviados: "-3,0,1,3,7" }, etapas, "2026-12-30"), null);
  assert.equal(etapaDeHoje({ ...base, status: "pago" }, etapas, "2026-11-20"), null);
  assert.equal(etapaDeHoje({ ...base, ultimo_aviso: "2026-11-20" }, etapas, "2026-11-20"), null);
});

test("acompanhamento", () => {
  assert.ok(precisaContato({ status: "aguardando", proximo_contato: "" }, "2026-11-11"));
  assert.ok(precisaContato({ status: "aguardando", proximo_contato: "2026-11-10" }, "2026-11-11"));
  assert.ok(!precisaContato({ status: "aguardando", proximo_contato: "2026-11-12" }, "2026-11-11"));
  assert.ok(!precisaContato({ status: "aprovado", proximo_contato: "" }, "2026-11-11"));
});

test("agenda: horários livres respeitam almoço, ocupados e antecedência", () => {
  const regras = regrasDaAgenda({ agenda_dias_semana: "1,2,3,4,5", agenda_inicio: "09:00", agenda_fim: "18:00",
    agenda_almoco: "12:00-13:30", agenda_duracao_padrao: "60", agenda_antecedencia_horas: "4" });
  const agenda = [{ status: "confirmado", inicio: "2026-11-12 10:00", duracao_min: 60 }];
  const agora = new Date("2026-11-11T12:00:00Z"); // quarta 09:00 em SP
  assert.equal(motivoIndisponivel("2026-11-12 10:30", 60, agenda, regras, agora), "Esse horário já está ocupado.");
  assert.match(motivoIndisponivel("2026-11-12 11:30", 60, agenda, regras, agora), /almoço/);
  assert.match(motivoIndisponivel("2026-11-14 10:00", 60, agenda, regras, agora), /dia da semana/);
  assert.match(motivoIndisponivel("2026-11-11 10:00", 60, agenda, regras, agora), /em cima da hora/);
  assert.equal(motivoIndisponivel("2026-11-12 11:00", 60, agenda, regras, agora), null);
  const livres = horariosLivres({ agenda, regras, aPartirDe: "2026-11-11", dias: 2, agora, limitePorDia: 20 });
  assert.equal(livres[0].data, "2026-11-11");
  assert.equal(livres[0].horarios[0], "13:30"); // antes disso: antecedência/almoço
  const quinta = livres[1];
  assert.equal(quinta.data, "2026-11-12");
  assert.ok(!quinta.horarios.includes("10:00") && !quinta.horarios.includes("09:30") && quinta.horarios.includes("09:00"));
  assert.ok(!quinta.horarios.includes("12:00") && !quinta.horarios.includes("11:30"));
  assert.equal(quinta.horarios.at(-1), "17:00");
});

test("formatações", () => {
  assert.equal(valorEmReais("1500"), "1.500,00");
  assert.equal(valorEmReais("R$ 1.234,5"), "1.234,50");
  assert.equal(paraParametro("linha 1\nlinha 2     fim"), "linha 1 | linha 2   fim");
});

test("webhook: extrai mensagens", () => {
  const payload = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "5511987654321", profile: { name: "Ana" } }],
    messages: [{ id: "wamid.1", from: "5511987654321", timestamp: "1762866000", type: "text", text: { body: "Oi!" } }],
  } }] }] };
  const [m] = extrairMensagens(payload);
  assert.deepEqual({ id: m.id, de: m.de, nome: m.nome, texto: m.texto }, { id: "wamid.1", de: "5511987654321", nome: "Ana", texto: "Oi!" });
});

test("liga/desliga de cobrança por cliente", () => {
  assert.ok(cobrancaAtivada({ cobranca_automatica: "sim" }));
  assert.ok(cobrancaAtivada({ cobranca_automatica: " Sim " }));
  assert.ok(!cobrancaAtivada({ cobranca_automatica: "não" }));
  assert.ok(!cobrancaAtivada({ cobranca_automatica: "nao" }));
  assert.ok(!cobrancaAtivada({ cobranca_automatica: "" })); // em branco não cobra
});

test("planilha só com as abas das funções ligadas", () => {
  assert.deepEqual(Object.keys(estruturaAtiva(["cobrancas"])), ["Clientes", "Cobrancas", "Config", "Conversas"]);
});
