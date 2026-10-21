; Самопроверка RC-8: арифметика, логика, флаги, переходы, цифры, дисплей, рычаги
        LDI  R1, 0x5A
        LDI  R2, 0x3C
        ADD  R3, R1, R2      ; 0x96
        SUB  R4, R1, R2      ; 0x1E
        AND  R5, R1, R2      ; 0x18
        OR   R6, R1, R2      ; 0x7E
        XOR  R7, R1, R2      ; 0x66
        SHR  R0, R1          ; 0x2D
        OUT  D0, R3          ; цифра 0 = 6, dp=1
        OUT  D1, R4          ; цифра 1 = E
        OUT  D2, R5          ; цифра 2 = 8
        LDI  R1, 5
        LDI  R2, 3
        PLOT R1, R2          ; пиксель (5,3)
        LDI  R1, 31
        LDI  R2, 31
        PLOT R1, R2          ; пиксель (31,31)
        LDI  R3, 3
loop:   DEC  R3
        JNZ  loop            ; цикл 3 раза
        IN   R4              ; рычаги
        HLT
