; случайная программа (seed 7)
        LDI  R0, 165
        LDI  R1, 77
        LDI  R2, 202
        LDI  R3, 24
        LDI  R4, 37
        LDI  R5, 48
        LDI  R6, 187
        LDI  R7, 29
        PLOT R3, R0
        OR  R1, R3, R1
        ADDI R0, R1, -4
        CMP  R0, R6
        SUB  R0, R2, R4
        XOR  R1, R4, R2
        XOR  R3, R5, R1
        SHR  R1, R0
        ADDI R7, R6, 8
        SHR  R7, R5
        SUB  R3, R1, R4
        SHR  R5, R7
        ADD  R1, R6, R2
        IN   R2
        JNC   L0
        ADD  R0, R1, R5
L0:
        AND  R7, R7, R1
        OUT  D1, R7
        LDI  R1, 31
        IN   R4
        CMP  R7, R4
        LDI  R5, 11
        JC   L1
        ADD  R2, R1, R7
L1:
        AND  R2, R3, R6
        OR  R1, R2, R7
        AND  R2, R6, R4
        LDI  R5, 194
        JNZ   L2
        ADD  R1, R2, R2
L2:
        SUB  R0, R7, R2
        ADD  R2, R6, R5
        ADDI R5, R2, -26
        SHR  R6, R6
        ADD  R7, R6, R0
        SUB  R7, R2, R1
        ADD  R1, R0, R2
        SHR  R5, R0
        SUB  R6, R2, R4
        JC   L3
        ADD  R7, R1, R1
L3:
        OUT  D1, R7
        SHR  R1, R2
        AND  R4, R7, R2
        SHR  R3, R5
        XOR  R0, R4, R1
        LDI  R4, 187
        PLOT R5, R3
        SHR  R5, R3
        HLT
