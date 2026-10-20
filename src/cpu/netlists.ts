/** Тексты нетлистов макросов процессора (компилируются в блоки существующим компилятором схем). */

export function clockNetlist(): string {
  return `# Фазы тактирования: lkM — замок ведущих триггеров, lkS — замок ведомых, W — импульс записи в ОЗУ, nW — его инверсия
input clk
nclk = NOT(clk)
clkd = BUF(clk, delay=3)
nclkd = NOT(clkd)
clkd2 = BUF(clk, delay=2)
lkM = OR(clk, clkd)
lkS = OR(nclk, nclkd)
w = NOR(nclk, clkd2)
nw = NOT(w)
output lkM = lkM
output lkS = lkS
output W = w
output nW = nw
`;
}

/** Логика счётчика команд: следующий адрес = reset ? 0 : (take ? операнд : pc + 1); плюс инверсии pc для дешифратора. */
export function pcLogicNetlist(P: number): string {
  const L: string[] = [];
  const pcs = Array.from({ length: P }, (_, i) => `pc${i}`);
  const obs = Array.from({ length: P }, (_, i) => `ob${i}`);
  L.push(`input ${pcs.join(' ')} ${obs.join(' ')} take reset`);
  L.push('nreset = NOT(reset)', 'ntake = NOT(take)');
  let carry = '';
  for (let i = 0; i < P; i++) {
    if (i === 0) L.push('s0 = NOT(pc0)');
    else L.push(`s${i} = XOR(pc${i}, ${carry})`);
    if (i === 0) carry = 'pc0';
    else if (i < P - 1) {
      L.push(`k${i} = AND(${carry}, pc${i})`);
      carry = `k${i}`;
    }
    L.push(`a${i} = AND(take, ob${i})`, `b${i} = AND(ntake, s${i})`, `m${i} = OR(a${i}, b${i})`, `d${i} = AND(nreset, m${i})`, `n${i} = NOT(pc${i})`);
  }
  for (let i = 0; i < P; i++) L.push(`output d${i} = d${i}`);
  for (let i = 0; i < P; i++) L.push(`output npc${i} = n${i}`);
  return L.join('\n') + '\n';
}
