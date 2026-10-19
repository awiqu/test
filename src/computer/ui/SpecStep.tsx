import { useComputer } from '../store';
import { ComputerSpec, DeviceType, FlagName } from '../types';
import { ALL_ALU_OPS } from '../types';
import { ALU_INFO, DEVICE_INFO, DEVICE_ORDER, FLAG_INFO, SpecPreset, describeEstimate, makeDevice, portMap, validateSpec } from '../spec';
import { Chips, IssueList, NumField, Section } from './common';

const PRESETS: { id: SpecPreset; title: string; sub: string; points: string[] }[] = [
  { id: 'acc4', title: 'Мини-4', sub: 'Реально собрать в игре', points: ['4 бита, аккумулятор', '16 слов ПЗУ × 8 бит', '4 лампы, 4 рычага, индикатор'] },
  { id: 'risc8', title: 'Учебный-8', sub: 'Золотая середина', points: ['8 бит, 4 регистра, стек', '64 слова ПЗУ × 16 бит', 'экран, пиксели, клавиатура, терминал'] },
  { id: 'risc16', title: 'Учебный-16', sub: 'Для больших программ', points: ['16 бит, 8 регистров, MUL', '256 слов ПЗУ × 28 бит', 'таймер, кнопки, все флаги'] },
];

const FLAGS: FlagName[] = ['Z', 'C', 'N', 'V'];

export function SpecStep() {
  const project = useComputer((s) => s.project);
  const welcomed = useComputer((s) => s.welcomed);
  const isaCustom = useComputer((s) => s.isaCustom);
  const { updateSpec, loadPreset, setStep, markWelcomed, setName, reset } = useComputer.getState();
  const spec = project.spec;
  const issues = validateSpec(spec);
  const errors = issues.filter((i) => i.level === 'error');
  const est = describeEstimate(spec);
  const ports = portMap(spec).length;
  const maxRam = Math.max(0, 2 ** spec.ramAddrBits - ports);
  const nibbles = Math.ceil(spec.instrBits / 4);
  const set = (patch: Partial<ComputerSpec>) => updateSpec(patch);

  const addDevice = (type: DeviceType) => {
    const ids = new Set(spec.devices.map((d) => d.id));
    let n = spec.devices.filter((d) => d.type === type).length + 1;
    while (ids.has(`${type}${n}`)) n++;
    set({ devices: [...spec.devices, makeDevice(type, n)] });
  };
  const patchDevice = (id: string, key: string, v: number) => set({ devices: spec.devices.map((d) => (d.id === id ? { ...d, options: { ...d.options, [key]: v } } : d)) });

  return (
    <div className="cs-page">
      {!welcomed && (
        <div className="cs-welcome">
          <h2>Давайте опишем ваш компьютер</h2>
          <p>
            Выберите заготовку или настройте всё с нуля: сколько бит, сколько памяти, какие флаги и операции умеет АЛУ, какие устройства подключены.
            От этого зависит набор команд, который предложит конструктор на следующем шаге. Потом компьютер можно запрограммировать, проверить в симуляторе и
            выгрузить программу в ПЗУ из бочек для Minecraft.
          </p>
        </div>
      )}

      <Section title="Начать с заготовки">
        <div className="cs-cards">
          {PRESETS.map((p) => (
            <button key={p.id} className={`cs-card ${project.spec.name === p.title ? 'on' : ''}`} onClick={() => loadPreset(p.id)}>
              <b>{p.title}</b>
              <em>{p.sub}</em>
              <ul>{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
            </button>
          ))}
        </div>
        <p className="hint">Выбор заготовки заменяет набор команд и примеры программ. Дальше любую характеристику можно менять.</p>
      </Section>

      <div className="cs-grid">
        <Section title="Общее">
          <label className="field">
            <span>Название компьютера</span>
            <input value={spec.name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
          <div className="field">
            <span>Архитектура</span>
            <div className="seg" role="group" aria-label="Архитектура">
              <button className={spec.arch === 'register' ? 'on' : ''} onClick={() => set({ arch: 'register', regCount: Math.max(4, spec.regCount) })}>Регистровая</button>
              <button className={spec.arch === 'accumulator' ? 'on' : ''} onClick={() => set({ arch: 'accumulator' })}>Аккумуляторная</button>
            </div>
            <small className="dim">
              {spec.arch === 'accumulator'
                ? 'Один регистр-аккумулятор: все операции работают с ним. Проще в постройке: команды короче.'
                : 'Несколько регистров общего назначения: команды вида «ADD r1, r2». Программы короче, постройка сложнее.'}
            </small>
          </div>
          {spec.arch === 'register' && (
            <div className="field">
              <span>Регистров</span>
              <div className="seg" role="group" aria-label="Число регистров">
                {[2, 4, 8, 16].map((n) => (
                  <button key={n} className={spec.regCount === n ? 'on' : ''} onClick={() => set({ regCount: n })}>{n}</button>
                ))}
              </div>
            </div>
          )}
          <NumField label="Разрядность данных" value={spec.dataBits} min={2} max={16} onChange={(v) => set({ dataBits: v })} suffix="бит" hint={`Числа 0…${2 ** spec.dataBits - 1}`} />
        </Section>

        <Section title="Программа (ПЗУ)">
          <NumField label="Ширина команды" value={spec.instrBits} min={8} max={32} onChange={(v) => set({ instrBits: v })} suffix="бит" hint={`${nibbles} бочек на слово`} />
          <NumField label="Код операции" value={spec.opcodeBits} min={1} max={Math.min(16, spec.instrBits - 1)} onChange={(v) => set({ opcodeBits: v })} suffix="бит" hint={`До ${2 ** spec.opcodeBits} различных команд`} />
          <NumField label="Адрес ПЗУ" value={spec.pcBits} min={1} max={12} onChange={(v) => set({ pcBits: v })} suffix="бит" hint={`До ${2 ** spec.pcBits} слов`} />
          <NumField label="Слов в ПЗУ" value={spec.romWords} min={1} max={2 ** spec.pcBits} step={spec.pcBits > 5 ? 4 : 1} onChange={(v) => set({ romWords: v })} hint={`${est.romBarrels} бочек, ${est.romBits} бит`} />
        </Section>

        <Section title="Память данных">
          <NumField label="Адрес данных" value={spec.ramAddrBits} min={1} max={12} onChange={(v) => set({ ramAddrBits: v })} suffix="бит" hint={`Адресов: ${2 ** spec.ramAddrBits}, из них портов устройств: ${ports}`} />
          <NumField label="ОЗУ" value={spec.ramWords} min={0} max={Math.min(maxRam, 4096)} step={spec.ramAddrBits > 5 ? 4 : 1} onChange={(v) => set({ ramWords: v })} suffix="слов" hint={`Не больше ${maxRam}: верх адресов занят устройствами`} />
          <div className="field">
            <span>Стек</span>
            <label className="check">
              <input type="checkbox" checked={spec.stack.enabled} onChange={(e) => set({ stack: { enabled: e.target.checked, words: e.target.checked ? Math.min(Math.max(spec.stack.words, 4), Math.max(2, spec.ramWords)) : 0 } })} />
              Есть стек (CALL / RET / PUSH / POP)
            </label>
            {spec.stack.enabled && <NumField label="Размер стека" value={spec.stack.words} min={2} max={Math.max(2, spec.ramWords)} onChange={(v) => set({ stack: { enabled: true, words: v } })} suffix="слов" hint="Занимает верх ОЗУ и растёт вниз" />}
          </div>
        </Section>

        <Section title="Процессор">
          <div className="field">
            <span>Флаги</span>
            <Chips
              title="Флаги"
              options={FLAGS.map((f) => ({ id: f, label: f, hint: FLAG_INFO[f].desc }))}
              value={spec.flags}
              onChange={(v) => set({ flags: FLAGS.filter((f) => v.includes(f)) })}
            />
            <small className="dim">{spec.flags.map((f) => FLAG_INFO[f].name).join(' · ') || 'Без флагов условные переходы недоступны'}</small>
          </div>
          <div className="field">
            <span>Операции АЛУ</span>
            <Chips
              title="Операции АЛУ"
              options={ALL_ALU_OPS.map((o) => ({ id: o, label: o, hint: ALU_INFO[o].name }))}
              value={spec.aluOps}
              onChange={(v) => set({ aluOps: ALL_ALU_OPS.filter((o) => v.includes(o)) })}
            />
          </div>
          <NumField label="Такт" value={spec.clockTicks} min={1} max={64} onChange={(v) => set({ clockTicks: v })} suffix="тиков редстоуна" hint={`≈ ${(10 / spec.clockTicks).toFixed(1)} команд/с в игре при 1 такте на команду`} />
        </Section>
      </div>

      <Section title="Устройства" aside={<span className="dim">{spec.devices.length} шт. · портов {ports}</span>}>
        <div className="cs-devices">
          {spec.devices.map((d) => {
            const info = DEVICE_INFO[d.type];
            return (
              <div key={d.id} className="cs-device">
                <header>
                  <span className="cs-dev-icon">{info.icon}</span>
                  <b>{info.name}</b>
                  <code>{d.id}</code>
                  <button className="btn small danger" onClick={() => set({ devices: spec.devices.filter((x) => x.id !== d.id) })} aria-label={`Убрать ${info.name}`}>Убрать</button>
                </header>
                <p className="hint">{info.desc}</p>
                <div className="cs-dev-opts">
                  {Object.keys(info.defaults).map((k) => (
                    <label key={k} className="field row">
                      <span>{OPT_LABEL[k] ?? k}</span>
                      <input type="number" value={d.options[k] ?? info.defaults[k]} min={1} max={64} onChange={(e) => patchDevice(d.id, k, Math.max(1, Math.min(64, Number(e.target.value) || 1)))} />
                    </label>
                  ))}
                  <span className="dim mono">{info.ports(d.options, spec).map((p) => p.name).join(', ')}</span>
                </div>
              </div>
            );
          })}
          {spec.devices.length === 0 && <p className="hint">Устройств нет. Добавьте хотя бы лампы или экран, иначе программа ничего не покажет.</p>}
        </div>
        <div className="cs-add-devices">
          <span className="dim">Добавить:</span>
          {DEVICE_ORDER.map((t) => (
            <button key={t} className="btn small" onClick={() => addDevice(t)} title={DEVICE_INFO[t].desc}>
              <span>{DEVICE_INFO[t].icon}</span> {DEVICE_INFO[t].name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Сводка">
        <div className="stats cs-stats">
          <div><b>{est.romBarrels}</b><span>бочек в ПЗУ</span></div>
          <div><b>{est.romBits}</b><span>бит программы</span></div>
          <div><b>{est.ramBits}</b><span>бит ОЗУ</span></div>
          <div><b>{ports}</b><span>портов ввода-вывода</span></div>
          <div><b>{ports ? `${est.ioBase}…${2 ** spec.ramAddrBits - 1}` : '—'}</b><span>адреса портов</span></div>
          <div><b>{2 ** spec.opcodeBits}</b><span>кодов команд</span></div>
        </div>
        <IssueList issues={issues} empty="Характеристики в порядке" />
      </Section>

      <div className="cs-footer">
        <button className="btn danger" onClick={() => reset('risc8')} title="Вернуть заготовку по умолчанию">Сбросить всё</button>
        <div className="tb-spacer" />
        {isaCustom && <span className="dim">Набор команд правился вручную и не пересобирается автоматически — проверьте его на шаге «Инструкции».</span>}
        <button
          className="btn primary big"
          disabled={errors.length > 0}
          onClick={() => {
            markWelcomed();
            setStep('isa');
          }}
        >
          Далее: набор команд →
        </button>
      </div>
    </div>
  );
}

const OPT_LABEL: Record<string, string> = { count: 'Количество', cols: 'Столбцов', rows: 'Строк', width: 'Ширина', height: 'Высота', period: 'Период (тактов)' };
