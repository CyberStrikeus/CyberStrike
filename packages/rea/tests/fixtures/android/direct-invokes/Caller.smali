.class public Lfixture/Caller;
.super Ljava/lang/Object;

.method public static twice()V
    .registers 0
    invoke-static {}, Lfixture/Target;->mark()V
    invoke-static {}, Lfixture/Target;->mark()V
    return-void
.end method
