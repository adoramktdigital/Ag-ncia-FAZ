// Datas sempre no fuso da empresa (padrão America/Sao_Paulo), no formato
// "AAAA-MM-DD" para dias e "AAAA-MM-DD HH:mm" para horários — o mesmo usado na planilha.

const FUSO = process.env.TZ || "America/Sao_Paulo";

function partes(data, fuso = FUSO) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    weekday: "short",
  });
  const p = Object.fromEntries(fmt.formatToParts(data).map((x) => [x.type, x.value]));
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, diaSemana: dias[p.weekday] };
}

/** "AAAA-MM-DD" de hoje (ou da data informada) no fuso da empresa. */
export function hoje(agora = new Date()) {
  const p = partes(agora);
  return `${p.ano}-${p.mes}-${p.dia}`;
}

/** "AAAA-MM-DD HH:mm" de agora no fuso da empresa. */
export function agoraTexto(agora = new Date()) {
  const p = partes(agora);
  return `${p.ano}-${p.mes}-${p.dia} ${p.hora}:${p.minuto}`;
}

/** Converte valores vindos da planilha ("2026-11-20", "20/11/2026") para "AAAA-MM-DD". */
export function normalizarData(valor) {
  if (!valor) return "";
  const t = String(valor).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

/** Converte "AAAA-MM-DD HH:mm" ou "DD/MM/AAAA HH:mm" para "AAAA-MM-DD HH:mm". */
export function normalizarDataHora(valor) {
  if (!valor) return "";
  const t = String(valor).trim();
  const data = normalizarData(t);
  const hora = t.match(/(\d{1,2}):(\d{2})/);
  if (!data || !hora) return "";
  return `${data} ${hora[1].padStart(2, "0")}:${hora[2]}`;
}

/** Diferença em dias de calendário: diasEntre("2026-11-10", "2026-11-13") === 3. */
export function diasEntre(de, ate) {
  const utc = (d) => { const [ano, mes, dia] = d.split("-").map(Number); return Date.UTC(ano, mes - 1, dia); };
  const a = utc(de);
  const b = utc(ate);
  return Math.round((b - a) / 86_400_000);
}

export function somarDias(data, dias) {
  const [a, m, d] = data.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado, para uma data "AAAA-MM-DD". */
export function diaDaSemana(data) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function minutosDoDia(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/** "2026-11-20" -> "20/11/2026" */
export function dataBR(data) {
  const d = normalizarData(data);
  if (!d) return String(data || "");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}`;
}

const NOMES_DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export function nomeDoDia(data) {
  return NOMES_DIAS[diaDaSemana(data)];
}

/** Converte "AAAA-MM-DD HH:mm" (horário local da empresa) em Date, para comparar com "agora". */
export function paraDate(dataHora, fuso = FUSO) {
  const [d, h] = dataHora.split(" ");
  const [a, m, dia] = d.split("-").map(Number);
  const [hh, mm] = (h || "00:00").split(":").map(Number);
  // Chute em UTC e corrige pela diferença do fuso naquele instante.
  const chute = Date.UTC(a, m - 1, dia, hh, mm);
  const p = partes(new Date(chute), fuso);
  const comoLocal = Date.UTC(Number(p.ano), Number(p.mes) - 1, Number(p.dia), Number(p.hora), Number(p.minuto));
  return new Date(chute - (comoLocal - chute));
}
