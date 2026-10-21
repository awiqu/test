; Тест 1: счётчик. D0 = младшая hex-цифра, D1 = старшая, D2 = число переносов.
        LDI  R0, 0          ; счётчик
        LDI  R3, 0          ; переносы
loop:   OUT  D0, R0         ; младший нибл
        SHR  R1, R0
        SHR  R1, R1
        SHR  R1, R1
        SHR  R1, R1
        OUT  D1, R1         ; старший нибл
        OUT  D2, R3
        INC  R0
        JNZ  loop
        INC  R3
        LDI  R2, 3
        CMP  R3, R2
        JNZ  loop
        HLT
