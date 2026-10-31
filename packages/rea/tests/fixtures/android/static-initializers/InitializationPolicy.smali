.class public abstract Lfixture/InitializationPolicy;
.super Ljava/lang/Object;

.field public static final POLICY:Ljava/util/List;

.method static constructor <clinit>()V
    .registers 1
    const-string v0, "declared-policy"
    invoke-static {v0}, Ljava/util/Collections;->singletonList(Ljava/lang/Object;)Ljava/util/List;
    move-result-object v0
    sput-object v0, Lfixture/InitializationPolicy;->POLICY:Ljava/util/List;
    return-void
.end method

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public abstract missing()V
.end method

.method public native originalNative()V
.end method
