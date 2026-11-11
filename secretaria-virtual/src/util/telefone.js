// O WhatsApp identifica contatos pelo número com DDI e sem "+" (ex.: 5511987654321).
// Números brasileiros antigos às vezes chegam SEM o nono dígito (551187654321),
// então a comparação aceita as duas formas.

export function soDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/** Normaliza o que foi digitado na planilha: "(11) 98765-4321" -> "5511987654321". */
export function normalizarTelefone(valor) {
  let d = soDigitos(valor);
  if (!d) return "";
  d = d.replace(/^0+/, "");
  // Sem DDI: 10 ou 11 dígitos (DDD + número) -> assume Brasil.
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

/** Variações equivalentes de um número brasileiro (com e sem o 9 extra). */
export function variacoes(valor) {
  const d = normalizarTelefone(valor);
  const lista = new Set([d]);
  if (d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    if (resto.length === 9 && resto.startsWith("9")) lista.add(`55${ddd}${resto.slice(1)}`);
    if (resto.length === 8 && /^[6-9]/.test(resto)) lista.add(`55${ddd}9${resto}`);
  }
  return [...lista];
}

export function mesmoTelefone(a, b) {
  if (!a || !b) return false;
  const va = variacoes(a);
  return variacoes(b).some((x) => va.includes(x));
}
