import { ComputerProject, Instruction } from './types';
import { DEVICE_INFO, describeEstimate, ioBase, portMap } from './spec';
import { layoutOf } from './isa';
import { EXAMPLES } from './examples';
import readme from '../../docs/ai/README.md?raw';
import computerFormat from '../../docs/ai/computer-format.md?raw';
import rtlReference from '../../docs/ai/rtl-reference.md?raw';
import assemblerSyntax from '../../docs/ai/assembler-syntax.md?raw';
import circuitNetlist from '../../docs/ai/circuit-netlist.md?raw';
import exampleComputer from '../../docs/ai/example-computer.json?raw';
import tplDesignComputer from '../../docs/ai/prompt-design-computer.md?raw';
import tplWriteProgram from '../../docs/ai/prompt-write-program.md?raw';
import tplDesignCircuit from '../../docs/ai/prompt-design-circuit.md?raw';

/** Документы для ИИ (те же файлы, что лежат в docs/ai/). */
export interface AiDoc {
  id: string;
  file: string;
  title: string;
  text: string;
}

export const AI_DOCS: AiDoc[] = [
  { id: 'readme', file: 'README.md', title: 'Обзор', text: readme },
  { id: 'netlist', file: 'circuit-netlist.md', title: 'Формат логической схемы', text: circuitNetlist },
  { id: 'computer', file: 'computer-format.md', title: 'Формат компьютера (JSON)', text: computerFormat },
  { id: 'rtl', file: 'rtl-reference.md', title: 'Язык RTL', text: rtlReference },
  { id: 'asm', file: 'assembler-syntax.md', title: 'Синтаксис ассемблера', text: assemblerSyntax },
  { id: 'example', file: 'example-computer.json', title: 'Пример компьютера', text: exampleComputer },
];

export const PROMPT_TEMPLATES = {
  designComputer: tplDesignComputer,
  writeProgram: tplWriteProgram,
  designCircuit: tplDesignCircuit,
};

/** Подставляет значения вместо {{КЛЮЧ}}; незаполненные ключи остаются на месте. */
export function fillTemplate(tpl: string, values: Record<string, string>): string {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** Схема битов слова: «опкод(5) rd(2) rs(2) —(7)». */
export function bitLayout(inst: Instruction, p: ComputerProject): string {
  const lay = layoutOf(inst.format, p.spec);
  const parts = [`opcode(${p.spec.opcodeBits})`, ...lay.fields.map((f) => `${f.name}(${f.bits})`)];
  const free = p.spec.instrBits - lay.usedBits;
  if (free > 0) parts.push(`—(${free})`);
  return parts.join(' ');
}

export function specSummary(p: ComputerProject): string {
  const s = p.spec;
  const est = describeEstimate(s);
  const lines = [
    `* Название: ${s.name}`,
    `* Архитектура: ${s.arch === 'accumulator' ? 'аккумуляторная (единственный регистр — аккумулятор `A`)' : `регистровая, ${s.regCount} регистров: ${Array.from({ length: s.regCount }, (_, i) => `r${i}`).join(', ')}`}`,
    `* Данные: ${s.dataBits} бит (значения 0…${2 ** s.dataBits - 1}; со знаком ${-(2 ** (s.dataBits - 1))}…${2 ** (s.dataBits - 1) - 1})`,
    `* Команда: ${s.instrBits} бит, код операции ${s.opcodeBits} бит`,
    `* ПЗУ программы: ${s.romWords} слов (адрес ${s.pcBits} бит)`,
    `* ОЗУ данных: ${s.ramWords} слов по адресам 0…${Math.max(0, s.ramWords - 1)}; адресное пространство данных 0…${2 ** s.ramAddrBits - 1}`,
    `* Флаги: ${s.flags.length ? s.flags.join(', ') : 'нет'}`,
    `* Операции АЛУ: ${s.aluOps.join(', ') || 'нет'}`,
    `* Стек: ${s.stack.enabled ? `есть, ${s.stack.words} слов (вершина — \`STACK_TOP\` = ${s.ramWords}, растёт вниз)` : 'нет'}`,
    `* Порты устройств: ${est.ioPorts} (адреса ${est.ioPorts ? `${est.ioBase}…${2 ** s.ramAddrBits - 1}` : '—'})`,
  ];
  return lines.join('\n');
}

export function isaTable(p: ComputerProject): string {
  const rows = [...p.instructions].sort((a, b) => a.opcode - b.opcode);
  const lines = ['| Мнемоника | Код | Операнды | Биты слова | Что делает | RTL |', '|---|---|---|---|---|---|'];
  for (const i of rows) {
    const ops = i.format.trim() ? i.format.split(',').map((x) => x.trim()).join(', ') : '—';
    const rtl = i.code.trim().replace(/\n/g, '; ').replace(/\|/g, '\\|');
    lines.push(`| \`${i.mnemonic}\` | ${i.opcode} (${hex(i.opcode)}) | ${ops} | ${bitLayout(i, p)} | ${(i.pseudo || i.description).replace(/\|/g, '\\|')} | \`${rtl}\` |`);
  }
  return lines.join('\n');
}

export function memoryMapText(p: ComputerProject): string {
  const s = p.spec;
  const out: string[] = [];
  out.push(`**Память данных** (адресов: ${2 ** s.ramAddrBits}):`);
  out.push('');
  out.push(`* ОЗУ: адреса 0…${Math.max(0, s.ramWords - 1)} (${s.ramWords} слов)`);
  const ports = portMap(s);
  if (ports.length) {
    out.push(`* Порты устройств: адреса ${ioBase(s)}…${2 ** s.ramAddrBits - 1} — читаются/пишутся теми же командами, что и память`);
    out.push('');
    out.push('| Адрес | Имя в ассемблере | Устройство | Доступ | Описание |');
    out.push('|---|---|---|---|---|');
    for (const q of ports) out.push(`| ${q.addr} (${hex(q.addr)}) | \`${q.name}\` | ${DEVICE_INFO[q.type].name} (\`${q.device}\`) | ${q.access} | ${q.desc.replace(/\|/g, '\\|')} |`);
  } else out.push('* Устройств нет.');
  return out.join('\n');
}

export function exampleProgramFor(p: ComputerProject): string {
  const own = p.programs.find((x) => x.source.trim());
  if (own) return own.source.trim();
  return (EXAMPLES[p.spec.arch === 'accumulator' ? 'acc4' : 'risc8'][0]?.source ?? '; ...').trim();
}

export function designComputerPrompt(wishes: string): string {
  return fillTemplate(tplDesignComputer, {
    WISHES: wishes.trim() || '(не указаны — предложи разумный вариант: небольшой 8-битный процессор со светодиодами и переключателями)',
    COMPUTER_FORMAT: computerFormat,
    RTL_REFERENCE: rtlReference,
    ASSEMBLER_SYNTAX: assemblerSyntax,
    EXAMPLE_JSON: exampleComputer.trim(),
  });
}

export function writeProgramPrompt(p: ComputerProject, task: string): string {
  return fillTemplate(tplWriteProgram, {
    NAME: p.spec.name,
    TASK: task.trim() || '(опишите задачу, например: «мигать светодиодами по очереди» или «вывести Hello на текстовый экран»)',
    SPEC_SUMMARY: specSummary(p),
    ISA_TABLE: isaTable(p),
    MEMORY_MAP: memoryMapText(p),
    ASSEMBLER_SYNTAX: assemblerSyntax,
    ROM_WORDS: String(p.spec.romWords),
    EXAMPLE_PROGRAM: exampleProgramFor(p),
  });
}

export function designCircuitPrompt(wishes: string): string {
  return fillTemplate(tplDesignCircuit, {
    WISHES: wishes.trim() || '(опишите схему: например, «сумматор двух 2-битных чисел» или «декодер 2→4»)',
    NETLIST_FORMAT: circuitNetlist,
  });
}

/** Просьба исправить ответ ИИ по списку ошибок RedLogic. */
export function fixPrompt(kind: 'computer' | 'program' | 'circuit', issuesText: string): string {
  const what = kind === 'computer' ? 'JSON-файл компьютера' : kind === 'program' ? 'программу на ассемблере' : 'нетлист схемы';
  const block = kind === 'computer' ? 'json' : kind === 'program' ? 'asm' : 'netlist';
  return `RedLogic не принял ${what}. Исправь **только** перечисленные ошибки и пришли ${kind === 'computer' ? 'файл' : 'текст'} целиком одним блоком \`\`\`${block}.\n\nОшибки:\n\n${issuesText.trim()}\n`;
}

/** Полная документация по конкретному компьютеру (для экспорта .md и передачи ИИ). */
export function computerMarkdown(p: ComputerProject): string {
  const parts = [
    `# ${p.spec.name}`,
    '',
    '## Характеристики',
    '',
    specSummary(p),
    '',
    '## Набор инструкций',
    '',
    isaTable(p),
    '',
    '### Подробно',
    '',
    ...[...p.instructions]
      .sort((a, b) => a.opcode - b.opcode)
      .flatMap((i) => [`#### ${i.mnemonic}${i.format.trim() ? ' ' + i.format.split(',').map((x) => x.trim()).join(', ') : ''}`, '', `${i.description}`, '', `* Псевдокод: ${i.pseudo || '—'}`, `* RTL: \`${i.code.trim().replace(/\n/g, '; ')}\``, `* Такты: ${i.cycles}`, '']),
    '## Память и устройства',
    '',
    memoryMapText(p),
    '',
    '## Синтаксис ассемблера',
    '',
    assemblerSyntax,
  ];
  return parts.join('\n') + '\n';
}
