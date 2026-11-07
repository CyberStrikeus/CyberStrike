.class public Lfixture/MergedMethod;
.super Ljava/lang/Object;

.field public static VALUE:I

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method private highlightText()V
    .registers 2
    :try_start
    sget v0, Lfixture/MergedMethod;->VALUE:I
    if-nez v0, :assigned
    const/16 v0, 0x77
    sput v0, Lfixture/MergedMethod;->VALUE:I
    :assigned
    :try_end
    return-void
    .catch Ljava/lang/RuntimeException; {:try_start .. :try_end} :handler
    :handler
    move-exception v0
    throw v0
.end method

.method private highlightText(I)V
    .registers 2
    const/16 p1, 0x2a
    sput p1, Lfixture/MergedMethod;->VALUE:I
    return-void
.end method

.method public synthetic lambda$highlight$0()V
    .registers 1
    invoke-direct {p0}, Lfixture/MergedMethod;->highlightText()V
    return-void
.end method

.method public decoy()Ljava/lang/String;
    .registers 2
    const-string v0, "renamed from: highlightText, reason: merged with bridge method [inline-methods]"
    return-object v0
.end method
