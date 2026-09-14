import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { fmtDate } from "@/lib/utils";
import { Plus, Edit } from "lucide-react";

const PERMS_LABELS = {
  dashboard: "لوحة التحكم", sales: "المبيعات", purchases: "المشتريات", customers: "العملاء",
  suppliers: "الموردون", stock: "المخزون", categories: "الفئات", receipts: "السندات",
  reports: "التقارير", print_reports: "طباعة التقارير", users: "المستخدمون", settings: "الإعدادات",
  card_orders: "طلبات الكروت", delete_ops: "حذف/إلغاء العمليات", edit_ops: "تعديل العمليات",
  cards: "الكروت", backup: "النسخ الاحتياطي",
};

function UserForm({ initial, allPerms, onSaved, onClose }) {
  const [f, setF] = useState(initial ? { ...initial, password: "" } : { name: "", username: "", password: "", role: "user", status: "active", permissions: [] });
  const [loading, setLoading] = useState(false);
  const toggle = (p) => setF({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] });
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { ...f };
      if (!body.password && initial?.id) delete body.password;
      if (initial?.id) await api.put(`/users/${initial.id}`, body);
      else await api.post("/users", body);
      toast.success("تم الحفظ"); onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>الاسم</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="usr-name"/></div>
        <div><Label>اسم المستخدم</Label><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required data-testid="usr-username"/></div>
      </div>
      <div><Label>كلمة المرور {initial?.id && "(اتركها فارغة لعدم التغيير)"}</Label><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={!initial?.id} data-testid="usr-password"/></div>
      <div>
        <Label>الصلاحيات</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-52 overflow-y-auto p-2 bg-slate-50 rounded">
          {allPerms.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.permissions.includes(p)} onCheckedChange={() => toggle(p)} data-testid={`perm-${p}`}/>
              {PERMS_LABELS[p] || p}
            </label>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="usr-save">{loading?"جاري...":"حفظ"}</Button>
    </form>
  );
}

export default function UsersPage() {
  const [items, setItems] = useState([]);
  const [perms, setPerms] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const load = async () => setItems((await api.get("/users")).data);
  useEffect(() => { load(); api.get("/users/permissions/list").then((r) => setPerms(r.data)); }, []);
  return (
    <div className="space-y-4" data-testid="users-page">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild><Button className="bg-[#221340]" data-testid="add-user-btn"><Plus size={16} className="ml-1"/> إضافة مستخدم</Button></DialogTrigger>
          <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{edit?"تعديل":"مستخدم جديد"}</DialogTitle></DialogHeader>
            <UserForm initial={edit} allPerms={perms} onSaved={load} onClose={() => setOpen(false)}/>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الاسم</th><th className="p-3">المستخدم</th><th className="p-3">الدور</th><th className="p-3">الحالة</th><th className="p-3">آخر دخول</th><th></th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t"><td className="p-3">{u.name}</td><td className="p-3 font-mono">{u.username}</td><td className="p-3">{u.role==='admin'?'مدير':'مستخدم'}</td><td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${u.status==='active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{u.status==='active'?'نشط':'معطل'}</span></td><td className="p-3">{fmtDate(u.last_login)}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => { setEdit(u); setOpen(true); }}><Edit size={14}/></Button></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {items.map((u) => (
          <Card key={u.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-bold truncate">{u.name}</div>
                <div className="text-xs text-slate-500 font-mono truncate">{u.username} • {u.role==='admin'?'مدير':'مستخدم'}</div>
                <div className="text-xs text-slate-400 mt-1">آخر دخول: {fmtDate(u.last_login)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full ${u.status==='active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{u.status==='active'?'نشط':'معطل'}</span>
                <Button size="sm" variant="outline" onClick={() => { setEdit(u); setOpen(true); }}><Edit size={14}/></Button>
              </div>
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا يوجد مستخدمون</div>}
      </div>
    </div>
  );
}
