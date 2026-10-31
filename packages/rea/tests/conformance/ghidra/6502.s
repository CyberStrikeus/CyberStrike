; Source-owned NMOS 6502 fixture: direct call, conditional branch, and arithmetic.
.setcpu "6502"
.segment "CODE"
.export entry, add_three

entry:
    lda #7
    jsr add_three
    cmp #10
    bne mismatch
    lda #42
    rts
mismatch:
    lda #0
    rts
add_three:
    clc
    adc #3
    rts
