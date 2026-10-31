.class public final Lfixture/NativeOverload;
.super Ljava/lang/Object;

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public static native zLastNative()V
.end method

.method public final native readBuffer(Ljava/nio/ByteBuffer;I)Ljava/lang/String;
.end method

.method public final readBuffer(Ljava/nio/ByteBuffer;Ljava/lang/String;)Ljava/lang/String;
    .registers 4
    const/4 v0, 0x0
    invoke-virtual {p0, p1, v0}, Lfixture/NativeOverload;->readBuffer(Ljava/nio/ByteBuffer;I)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public final toText(Z)Ljava/lang/String;
    .registers 3
    const-string v0, "neighbour-member"
    return-object v0
.end method
