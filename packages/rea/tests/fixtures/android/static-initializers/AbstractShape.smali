.class public abstract Lfixture/AbstractShape;
.super Ljava/lang/Object;

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public abstract area()D
.end method

.method public describe()Ljava/lang/String;
    .registers 2
    const-string v0, "neighbour-member"
    return-object v0
.end method
