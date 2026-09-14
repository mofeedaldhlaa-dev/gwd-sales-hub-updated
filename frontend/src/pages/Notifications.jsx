import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmt, fmtDate } from "@/lib/utils";
import { Bell, Check, X, UserPlus } from "lucide-react";

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const [approveForm, setApproveForm] = useState({ credit_limit: 5000, customer_type: "customer", password: "" });

  const load = async () => {
    setItems((await api.get("/notifications")).data);
    try { setRequests((await api.get("/register-requests")).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const approve = async (rid) => {
    try {
      await api.post(`/register-requests/${rid}/approve`, {
        credit_limit: Number(approveForm.credit_limit) || 0,
        customer_type: approveForm.customer_type,
        password: approveForm.password || null,
      });
      toast.success("تمت الموافقة وإنشاء الحساب");
      setApprovingId(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const reject = async (rid) => {
    try { await api.post(`/register-requests/${rid}/reject`); toast.success("تم الرفض"); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4" data-testid="notifications-page">
      {pending.length > 0 && (
        <Card className="p-4">
          <div className="font-bold text-[#221340] mb-3 flex items-center gap-2"><UserPlus size={18}/> طلبات إنشاء حسابات جديدة ({pending.length})</div>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="border rounded-lg p-3 bg-amber-50/50 flex flex-col md:flex-row md:items-center justify-between gap-2" data-testid={`req-${r.id}`}>
                <div className="flex-1">
                  <div className="font-bold">{r.full_name}</div>
                  <div className="text-xs text-slate-600">{r.phone} • {r.address || "-"}</div>
                  <div className="text-xs text-slate-400">{fmtDate(r.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setApprovingId(r.id)} className="bg-green-600 hover:bg-green-700" data-testid={`req-approve-${r.id}`}><Check size={14} className="ml-1"/> موافقة</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(r.id)}><X size={14}/></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {items.map((n) => (
          <Card key={n.id} className="p-4 flex items-start gap-3">
            <Bell className="text-[#D4AF37] mt-0.5" size={18}/>
            <div className="flex-1"><div className="font-bold">{n.title}</div><div className="text-sm text-slate-600">{n.message}</div><div className="text-xs text-slate-400 mt-1">{fmtDate(n.created_at)}</div></div>
          </Card>
        ))}
        {items.length === 0 && pending.length === 0 && <div className="text-center text-slate-400 p-8">لا توجد إشعارات</div>}
      </div>

      <Dialog open={!!approvingId} onOpenChange={(o) => !o && setApprovingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>الموافقة على الطلب</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>نوع الحساب</Label>
              <Select value={approveForm.customer_type} onValueChange={(v) => setApproveForm({ ...approveForm, customer_type: v })}>
                <SelectTrigger data-testid="approve-type"><SelectValue/></SelectTrigger>
                <SelectContent><SelectItem value="customer">عميل</SelectItem><SelectItem value="pos">نقطة بيع</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>سقف الحساب</Label><Input type="number" value={approveForm.credit_limit} onChange={(e) => setApproveForm({ ...approveForm, credit_limit: e.target.value })} data-testid="approve-limit"/></div>
            <div><Label>كلمة المرور (اتركها فارغة للتوليد)</Label><Input value={approveForm.password} onChange={(e) => setApproveForm({ ...approveForm, password: e.target.value })}/></div>
            <Button onClick={() => approve(approvingId)} className="w-full bg-[#221340]" data-testid="approve-confirm">إنشاء الحساب</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
