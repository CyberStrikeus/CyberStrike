.class public Lfixture/MixedInitialization;
.super Ljava/lang/Object;

.field public static final LABEL:Ljava/lang/String;
.field public static COUNT:I

.method static constructor <clinit>()V
    .registers 1
    const-string v0, "field-value"
    sput-object v0, Lfixture/MixedInitialization;->LABEL:Ljava/lang/String;
    invoke-static {}, Lfixture/MixedInitialization;->touch()V
    return-void
.end method

.method public static touch()V
    .registers 1
    sget v0, Lfixture/MixedInitialization;->COUNT:I
    add-int/lit8 v0, v0, 0x1
    sput v0, Lfixture/MixedInitialization;->COUNT:I
    return-void
.end method
