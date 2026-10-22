; Нагрузочный тест: цепочки переноса, дальние переходы (все биты адреса меняются), ADC, сдвиг, флаги
        LDI  R1, 0xFF
        LDI  R2, 1
        ADD  R3, R1, R2      ; 0x00  Z=1 C=1 (перенос через все разряды)
        ADC  R4, R1, R1      ; 0xFF + 0xFF + 1 = 0x1FF -> FF, C=1
        LDI  R5, 0x7F
        ADD  R6, R5, R2      ; 0x80
        SUB  R7, R3, R2      ; 0x00 - 1 = 0xFF, C=0 (заём)
        SHR  R0, R6          ; 0x40
        JMP  far1
        .org 0xFF
far1:   OUT  D0, R4
        JMP  far2
        .org 0x100
far2:   OUT  D1, R6
        JNC  far3            ; C=0 после SUB -> переход
        HLT
        .org 0x1F0
far3:   OUT  D2, R0
        LDI  R1, 0
        LDI  R2, 31
        PLOT R1, R2          ; (0,31)
        PLOT R2, R1          ; (31,0)
        HLT
