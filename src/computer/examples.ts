import { SpecPreset } from './spec';

export interface ExampleProgram {
  name: string;
  description: string;
  source: string;
}

/** Примеры программ для готовых наборов (ориентированы на состав устройств по умолчанию). */
export const EXAMPLES: Record<SpecPreset, ExampleProgram[]> = {
  risc8: [
    {
      name: 'Счётчик на лампах',
      description: 'Увеличивает число и показывает его на светодиодах и индикаторе.',
      source: `; Счётчик: r0 растёт, показываем на лампах и индикаторе
        ldi r0, 0
loop:   st  LEDS, r0
        st  SEG, r0
        ldi r1, 20          ; пауза
wait:   dec r1
        jnz wait
        inc r0
        jmp loop
`,
    },
    {
      name: 'Привет, мир!',
      description: 'Печатает строку на текстовом экране и в терминале.',
      source: `; Печать строки на текстовом экране (TXT) и в терминале (TERM)
        ldi r1, 'H'
        call put
        ldi r1, 'e'
        call put
        ldi r1, 'l'
        call put
        ldi r1, 'l'
        call put
        ldi r1, 'o'
        call put
        ldi r1, '!'
        call put
        ldi r1, 10
        call put
        hlt
put:    st  TXT, r1
        st  TERM, r1
        ret
`,
    },
    {
      name: 'Числа Фибоначчи (hex)',
      description: 'Первые 12 чисел Фибоначчи в шестнадцатеричном виде — проверка вызовов, стека и сравнений.',
      source: `; Печать чисел Фибоначчи в hex через TERM
        ldi r0, 0           ; a
        ldi r1, 1           ; b
        ldi r3, 12          ; сколько чисел
next:   mov r2, r0
        call hex            ; печатаем a
        ldi r2, 10
        st  TERM, r2        ; перевод строки
        mov r2, r1          ; (a, b) = (b, a + b)
        add r1, r0
        mov r0, r2
        dec r3
        jnz next
        hlt

hex:    push r0             ; r2 -> две hex-цифры
        push r1
        mov r0, r2
        shr r0
        shr r0
        shr r0
        shr r0
        call digit
        mov r0, r2
        ldi r1, 15
        and r0, r1
        call digit
        pop r1
        pop r0
        ret

digit:  cmpi r0, 10         ; r0 < 10 ?  (C = заём)
        jc  low
        addi r0, 55         ; 'A' - 10
        jmp emit
low:    addi r0, 48         ; '0'
emit:   st  TERM, r0
        ret
`,
    },
    {
      name: 'Диагональ на экране',
      description: 'Рисует диагональ на пиксельной матрице 8×8.',
      source: `; Диагональ на пиксельном экране
        ldi r0, 0
loop:   st  PX, r0
        st  PY, r0
        ldi r1, 1
        st  PIX, r1
        inc r0
        cmpi r0, 8
        jnz loop
        hlt
`,
    },
    {
      name: 'Умножение 6 × 7',
      description: 'Умножает сложением в цикле и показывает 42 на индикаторе.',
      source: `; 6 * 7 = 42 через повторное сложение
        ldi r0, 0           ; результат
        ldi r1, 6           ; множимое
        ldi r2, 7           ; сколько раз
again:  add r0, r1
        dec r2
        jnz again
        st  SEG, r0
        st  LEDS, r0
        hlt
`,
    },
    {
      name: 'Рычаги → лампы',
      description: 'Копирует состояние рычагов на лампы (откройте панель устройств и пощёлкайте).',
      source: `; Эхо: рычаги на лампы
loop:   ld  r0, SWITCH
        st  LEDS, r0
        ld  r1, BTN
        st  SEG, r1
        jmp loop
`,
    },
    {
      name: 'Эхо клавиатуры',
      description: 'Печатает на текстовом экране всё, что вы набираете на клавиатуре.',
      source: `; Эхо клавиатуры
loop:   ld  r0, KEY
        cmpi r0, 0
        jz  loop
        st  TXT, r0
        jmp loop
`,
    },
  ],
  acc4: [
    {
      name: 'Счётчик',
      description: 'Увеличивает 4-битный счётчик и показывает на лампах и индикаторе.',
      source: `; Счётчик на аккумуляторе
        ldi 1
        sta 0               ; M[0] = 1
        ldi 0
        sta 1               ; M[1] = счётчик
loop:   lda 1
        add 0
        sta 1
        sta LEDS
        sta SEG
        jmp loop
`,
    },
    {
      name: 'Сумма рычагов',
      description: 'Читает рычаги, прибавляет 3 и показывает результат.',
      source: `; рычаги + 3
        ldi 3
        sta 0
loop:   lda SWITCH
        add 0
        sta SEG
        sta LEDS
        jmp loop
`,
    },
  ],
  risc16: [
    {
      name: 'Числа Фибоначчи',
      description: 'Выводит числа Фибоначчи в терминал в виде символов-цифр (до 5 цифр).',
      source: `; 16-битный пример: пишем в лампы и таймер
        ldi r0, 0
        ldi r1, 1
loop:   st  LEDS, r0
        mov r2, r1
        add r1, r0
        mov r0, r2
        jnc loop
        hlt
`,
    },
  ],
};
