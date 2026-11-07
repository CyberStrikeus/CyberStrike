.class public Lfixture/Outer$Worker;
.super Ljava/lang/Object;

.annotation system Ldalvik/annotation/EnclosingClass;
    value = Lfixture/Outer;
.end annotation
.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x9
    name = "Worker"
.end annotation

.method public static notifyNested(Landroid/app/NotificationManager;Landroid/app/Notification;I)V
    .registers 3
    invoke-virtual {p0, p2, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V
    return-void
.end method
