import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fmt } from "@/lib/utils";
import { Link } from "react-router-dom";
import { Search, Plus, FileText, Edit, KeyRound, Eye } from "lucide-react";

function CustomerForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState(initial || { name: "", phone: "", password: "", credit_limit: 0, opening_balance: 0, address: "", notes: "", status: "active", customer_type: "customer" });
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { ...f, credit_limit: Number(f.credit_limit) || 0, opening_balance: Number(f.opening_balance) || 0 };
      if (initial?.id) await api.put(`/customers/${initial.id}`, body);
      else await api.post("/customers", body);
      toast.success("تم الحفظ بنجاح");
      onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="customer-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>الاسم *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="cust-name" /></div>
        <div><Label>نوع الحساب</Label>
          <Select value={f.customer_type || "customer"} onValueChange={(v) => setF({ ...f, customer_type: v })}>
            <SelectTrigger data-testid="cust-type"><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="customer">عميل</SelectItem><SelectItem value="pos">نقطة بيع</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>رقم الهاتف</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="cust-phone" /></div>
      {!initial?.id && <div><Label>كلمة المرور (اتركها فارغة للتوليد)</Label><Input value={f.password || ""} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="JWDXXXXX" data-testid="cust-password" /></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>سقف الحساب</Label><Input type="number" value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: e.target.value })} data-testid="cust-limit" /></div>
        <div><Label>الرصيد الافتتاحي</Label><Input type="number" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} data-testid="cust-opening" /></div>
      </div>
      <div><Label>العنوان</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="cust-save">{loading ? "جاري..." : "حفظ"}</Button>
    </form>
  );
}

function PasswordDialog({ customer, onClose, onSaved }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unbinding, setUnbinding] = useState(false);
  const save = async () => {
    if (pwd !== confirm) { toast.error("كلمة المرور وتأكيدها غير متطابقين"); return; }
    if (pwd.length < 4) { toast.error("كلمة المرور قصيرة"); return; }
    try {
      await api.post(`/customers/${customer.id}/password`, { password: pwd });
      toast.success("تم تغيير كلمة المرور");
      onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
  };
  const unbind = async () => {
    if (!window.confirm(`إلغاء ربط الجهاز الحالي عن ${customer.name}؟\nسيتمكن العميل من تسجيل الدخول من جهاز جديد وسيُربط تلقائياً.`)) return;
    setUnbinding(true);
    try {
      await api.post(`/customers/${customer.id}/unbind-device`);
      toast.success("تم إلغاء ربط الجهاز. يمكن للعميل الآن تسجيل الدخول من جهاز جديد.");
      onSaved();
    } catch (e) { toast.error(errText(e)); }
    setUnbinding(false);
  };
  const isBound = !!customer?.bound_device;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>إدارة حساب {customer?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="font-bold text-sm text-[#221340]">تغيير كلمة المرور</div>
            <div><Label>كلمة المرور الجديدة</Label><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} data-testid="admin-cust-pwd"/></div>
            <div><Label>تأكيد كلمة المرور</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="admin-cust-pwd-confirm"/></div>
            <Button onClick={save} className="w-full bg-[#221340]" data-testid="admin-cust-pwd-save">حفظ كلمة المرور</Button>
          </div>
          <div className="border-t pt-4 space-y-2">
            <div className="font-bold text-sm text-[#221340]">ربط الجهاز</div>
            <div className="text-xs text-slate-600">
              {isBound
                ? <>الجهاز الحالي: <span className="font-mono bg-slate-100 px-2 py-0.5 rounded" data-testid="cust-bound-device">{String(customer.bound_device).slice(0, 24)}…</span></>
                : <span className="text-amber-700">لا يوجد جهاز مرتبط — سيُربط تلقائياً بعد أول تسجيل دخول ناجح.</span>}
            </div>
            <Button onClick={unbind} disabled={unbinding || !isBound} variant="outline" className="w-full border-amber-500 text-amber-700 disabled:opacity-50" data-testid="admin-cust-unbind">
              {unbinding ? "جاري..." : "إلغاء ربط الجهاز الحالي"}
            </Button>
            <div className="text-[11px] text-slate-500">استخدم هذا الخيار عندما يستبدل العميل هاتفه القديم. سيتمكن من تسجيل الدخول من الجهاز الجديد بكلمة المرور، وسيُربط تلقائياً.</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevealButton({ id }) {
  const [pwd, setPwd] = useState(null);
  const reveal = async () => {
    try { const r = await api.get(`/customers/${id}/password`); setPwd(r.data.password); setTimeout(() => setPwd(null), 6000); }
    catch (e) { toast.error(errText(e)); }
  };
  return pwd ? <span className="font-mono text-xs bg-amber-100 px-2 py-1 rounded">{pwd}</span>
             : <Button size="sm" variant="outline" onClick={reveal} data-testid={`cust-reveal-${id}`}><Eye size={12}/></Button>;
}

// Mobile-friendly inline reveal: shows dots + explicit label button that toggles
function RevealButtonInline({ id, testid }) {
  const [pwd, setPwd] = useState(null);
  const toggle = async () => {
    if (pwd) { setPwd(null); return; }
    try { const r = await api.get(`/customers/${id}/password`); setPwd(r.data.password); }
    catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded select-all break-all" data-testid={`${testid}-value`}>
        {pwd || "••••••••"}
      </span>
      <Button size="sm" variant="outline" onClick={toggle} data-testid={testid}>
        <Eye size={12} className="ml-1"/> {pwd ? "إخفاء" : "مشاهدة"}
      </Button>
    </div>
  );
}

export default function Customers() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pwdCustomer, setPwdCustomer] = useState(null);

  const load = async () => setItems((await api.get("/customers")).data);
  useEffect(() => { load(); }, []);

  const filtered = items.filter((c) => (!q || c.name.includes(q) || (c.phone || "").includes(q)) && (typeFilter === "all" || (c.customer_type || "customer") === typeFilter));

  return (
    <div className="space-y-4" data-testid="customers-page">
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={18} />
            <Input placeholder="بحث بالاسم أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} className="pr-10" data-testid="cust-search" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="customer">عملاء</SelectItem>
              <SelectItem value="pos">نقاط بيع</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button className="bg-[#221340]" data-testid="add-customer-btn"><Plus size={16} className="ml-1" /> إضافة عميل</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{edit ? "تعديل عميل" : "إضافة عميل جديد"}</DialogTitle></DialogHeader>
            <CustomerForm initial={edit} onSaved={load} onClose={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-right">
                <th className="p-3">الاسم</th><th className="p-3">النوع</th><th className="p-3">الهاتف</th><th className="p-3">السقف</th>
                <th className="p-3">المديونية</th><th className="p-3">المتاح</th><th className="p-3">كلمة المرور</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-slate-100" data-testid={`cust-row-${c.id}`}>
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${(c.customer_type||'customer')==='pos'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700'}`}>{(c.customer_type||'customer')==='pos'?'نقطة بيع':'عميل'}</span></td>
                  <td className="p-3">{c.phone}</td>
                  <td className="p-3 num">{fmt(c.credit_limit)}</td>
                  <td className="p-3 num">{fmt(c.balance)}</td>
                  <td className="p-3 num text-green-700">{fmt(Math.max(0, (c.credit_limit || 0) - (c.balance || 0)))}</td>
                  <td className="p-3"><RevealButton id={c.id}/></td>
                  <td className="p-3 flex gap-2">
                    <Link to={`/customers/${c.id}`}><Button size="sm" variant="outline" data-testid={`cust-stmt-${c.id}`}><FileText size={14} /></Button></Link>
                    <Button size="sm" variant="outline" onClick={() => { setEdit(c); setOpen(true); }} data-testid={`cust-edit-${c.id}`}><Edit size={14} /></Button>
                    <Button size="sm" variant="outline" onClick={() => setPwdCustomer(c)} data-testid={`cust-pwd-${c.id}`}><KeyRound size={14} /></Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">لا يوجد عملاء</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y">
          {filtered.map((c) => (
            <div key={c.id} className="p-3" data-testid={`cust-card-${c.id}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate">{c.name} <span className="text-xs text-slate-500">({(c.customer_type||'customer')==='pos'?'نقطة بيع':'عميل'})</span></div>
                  <div className="text-xs text-slate-500 truncate">{c.phone}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link to={`/customers/${c.id}`}><Button size="sm" variant="outline"><FileText size={14} /></Button></Link>
                  <Button size="sm" variant="outline" onClick={() => { setEdit(c); setOpen(true); }}><Edit size={14} /></Button>
                  <Button size="sm" variant="outline" onClick={() => setPwdCustomer(c)}><KeyRound size={14} /></Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                <div><div className="text-slate-500">السقف</div><div className="num font-bold">{fmt(c.credit_limit)}</div></div>
                <div><div className="text-slate-500">المديونية</div><div className="num font-bold">{fmt(c.balance)}</div></div>
                <div><div className="text-slate-500">المتاح</div><div className="num font-bold text-green-700">{fmt(Math.max(0, (c.credit_limit || 0) - (c.balance || 0)))}</div></div>
              </div>
              <div className="mt-2 pt-2 border-t flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-slate-500 shrink-0">كلمة المرور</span>
                <RevealButtonInline id={c.id} testid={`cust-reveal-m-${c.id}`} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {pwdCustomer && <PasswordDialog customer={pwdCustomer} onClose={() => setPwdCustomer(null)} onSaved={load}/>}
    </div>
  );
}
