.class public Lfixture/Caller;
.super Ljava/lang/Object;

.method public static notify0(Landroid/app/NotificationManager;Landroid/app/Notification;)V
    .registers 3
    const/4 v0, 0x1
    invoke-virtual {p0, v0, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V
    invoke-virtual {p0, v0, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V
    invoke-static {}, Lfixture/Target;->mark()V
    return-void
.end method

.method public static notify0(Landroid/app/NotificationManager;Landroid/app/Notification;I)V
    .registers 3
    invoke-virtual {p0, p2, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V
    return-void
.end method

.method public static notify1(Landroid/app/NotificationManager;Ljava/lang/String;Landroid/app/Notification;)V
    .registers 4
    const/4 v0, 0x2
    invoke-virtual {p0, p1, v0, p2}, Landroid/app/NotificationManager;->notify(Ljava/lang/String;ILandroid/app/Notification;)V
    return-void
.end method
