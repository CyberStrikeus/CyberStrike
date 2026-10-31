.class public Lsb;
.super Ljava/lang/Object;

.method public static native readNative(I)I
.end method

.method public static callNative(I)I
    .registers 2
    invoke-static {p0}, Lsb;->readNative(I)I
    move-result v0
    return v0
.end method
