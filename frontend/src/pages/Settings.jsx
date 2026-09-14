import { useState, useEffect } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fmt } from "@/lib/utils";
import { Database, RotateCcw, Trash2, Download, Upload } from "lucide-react";

export default function SettingsPage() {
  const [s, setS] = useState({ currency: "ريال", logo_url: "", low_stock_default: 20, backup_email: "" });
  const [backupEmail, setBackupEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [backupSettings, setBackupSettings] = useState({ time: "02:00", auto: false });
  const [savingAuto, setSavingAuto] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetForm, setResetForm] = useState({ username: "", password: "" });

  useEffect(() => {
    api.get("/settings").then((r) => {
      setS(r.data);
      setBackupEmail(r.data.backup_email || "");
      setBackupSettings({
        time: r.data.backup_time || "02:00",
        auto: !!r.data.backup_auto,
      });
    });
  }, []);

  const save = async () => {
    try { await api.post("/settings", s); toast.success("تم الحفظ"); } catch (e) { toast.error(errText(e)); }
  };

  const saveBackupEmail = async () => {
    const v = (backupEmail || "").trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("البريد الإلكتروني غير صحيح. يرجى إدخال بريد إلكتروني صالح.");
      return;
    }
    setSavingEmail(true);
    try {
      await api.post("/settings", { backup_email: v });
      setS((prev) => ({ ...prev, backup_email: v }));
      toast.success("تم حفظ البريد الإلكتروني بنجاح.");
    } catch (e) { toast.error(errText(e)); }
    setSavingEmail(false);
  };

  const saveBackupAuto = async () => {
    const time = backupSettings.time || "02:00";
    if (!/^\d{2}:\d{2}$/.test(time)) {
      toast.error("الرجاء إدخال وقت صحيح بصيغة HH:MM.");
      return;
    }
    if (backupSettings.auto && !((backupEmail || "").trim())) {
      toast.error("يرجى حفظ البريد الإلكتروني للنسخ أولاً قبل تفعيل النسخ التلقائي.");
      return;
    }
    setSavingAuto(true);
    try {
      await api.post("/settings", { backup_time: time, backup_auto: !!backupSettings.auto });
      toast.success(backupSettings.auto ? "تم تفعيل النسخ الاحتياطي التلقائي." : "تم حفظ إعدادات النسخ التلقائي.");
    } catch (e) { toast.error(errText(e)); }
    setSavingAuto(false);
  };

  const exportBackup = async () => {
    try {
      const r = await api.get("/backup/export");
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jawad-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم إنشاء النسخة الاحتياطية");
    } catch (e) { toast.error(errText(e)); }
  };

  const uploadBackup = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm("سيتم استبدال البيانات الحالية. سيتم إنشاء نسخة أمان تلقائية أولاً. تأكيد؟")) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.post("/backup/restore", { data });
      toast.success("تمت الاستعادة");
    } catch (e) { toast.error(errText(e)); }
  };

  const performReset = async () => {
    try {
      await api.post("/settings/reset-data", { username: resetForm.username, password: resetForm.password, confirm: true });
      toast.success("تم مسح جميع البيانات");
      setResetOpen(false);
      setResetForm({ username: "", password: "" });
    } catch (e) { toast.error(errText(e)); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <Card className="p-6 space-y-4">
        <div className="text-lg font-bold text-[#221340]">إعدادات عامة</div>
        <div><Label>اسم الشبكة</Label><Input value={s.company_name || ""} disabled/></div>
        <div><Label>الهاتف</Label><Input value={s.company_phone || ""} disabled/></div>
        <div><Label>العملة</Label><Input value={s.currency || ""} onChange={(e) => setS({ ...s, currency: e.target.value })} data-testid="set-currency"/></div>
        <div><Label>حد التنبيه الافتراضي للمخزون</Label><Input type="number" value={s.low_stock_default || 20} onChange={(e) => setS({ ...s, low_stock_default: Number(e.target.value) })}/></div>
        <div><Label>رابط الشعار</Label><Input value={s.logo_url || ""} onChange={(e) => setS({ ...s, logo_url: e.target.value })}/></div>
        <Button onClick={save} className="bg-[#221340]" data-testid="set-save">حفظ</Button>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="text-lg font-bold text-[#221340] flex items-center gap-2"><Database size={20}/> النسخ الاحتياطي والمزامنة</div>
        <div>
          <Label>البريد الإلكتروني للنسخ الاحتياطية</Label>
          <Input
            type="email"
            value={backupEmail}
            onChange={(e) => setBackupEmail(e.target.value)}
            data-testid="backup-email"
            placeholder="admin@example.com"
            autoComplete="email"
            inputMode="email"
          />
          <div className="text-xs text-slate-500 mt-1">سيتم استخدام هذا البريد تلقائياً عند إرسال النسخ الاحتياطية.</div>
          <Button
            onClick={saveBackupEmail}
            disabled={savingEmail}
            className="mt-2 bg-[#452480] hover:bg-[#5A2FA0]"
            data-testid="backup-email-save"
          >
            {savingEmail ? "جاري..." : "حفظ البريد الإلكتروني"}
          </Button>
        </div>
        <div className="pt-3 border-t space-y-3">
          <div><Label>وقت النسخ اليومي</Label><Input type="time" value={backupSettings.time} onChange={(e) => setBackupSettings({ ...backupSettings, time: e.target.value })} data-testid="backup-time"/></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={backupSettings.auto} onChange={(e) => setBackupSettings({ ...backupSettings, auto: e.target.checked })} data-testid="backup-auto-toggle"/> تفعيل النسخ الاحتياطي التلقائي</label>
          <Button
            onClick={saveBackupAuto}
            disabled={savingAuto}
            className="bg-[#452480] hover:bg-[#5A2FA0] w-full sm:w-auto"
            data-testid="backup-auto-save"
          >
            {savingAuto ? "جاري..." : "حفظ إعدادات النسخ التلقائي"}
          </Button>
          <div className="flex gap-2 flex-wrap pt-3 border-t">
            <Button onClick={exportBackup} className="bg-[#221340]" data-testid="backup-export"><Download size={14} className="ml-1"/> إنشاء نسخة الآن</Button>
            <label className="inline-flex">
              <input type="file" accept=".json" onChange={uploadBackup} className="hidden" data-testid="backup-upload"/>
              <span className="bg-[#452480] text-white px-4 py-2 rounded cursor-pointer flex items-center gap-1 text-sm hover:bg-[#5A2FA0]"><Upload size={14}/> استعادة نسخة</span>
            </label>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3 border-red-200 bg-red-50/40">
        <div className="text-lg font-bold text-red-700 flex items-center gap-2"><Trash2 size={20}/> منطقة الخطر</div>
        <div className="text-sm text-slate-700">مسح جميع البيانات السابقة يحذف: العملاء، الموردون، الكروت، المخزون، الفواتير، السندات، الطلبات، الإشعارات. المستخدمون والإعدادات محفوظة.</div>
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogTrigger asChild><Button variant="destructive" data-testid="reset-btn"><Trash2 size={14} className="ml-1"/> مسح جميع البيانات السابقة</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-700">⚠️ عملية غير قابلة للتراجع</AlertDialogTitle>
              <AlertDialogDescription>هذا الإجراء سيحذف جميع بيانات العمليات نهائياً. أدخل بيانات المدير للتأكيد.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div><Label>اسم المستخدم</Label><Input value={resetForm.username} onChange={(e) => setResetForm({ ...resetForm, username: e.target.value })} data-testid="reset-username"/></div>
              <div><Label>كلمة المرور</Label><Input type="password" value={resetForm.password} onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })} data-testid="reset-password"/></div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={performReset} className="bg-red-600 hover:bg-red-700" data-testid="reset-confirm">تأكيد المسح</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </div>
  );
}
