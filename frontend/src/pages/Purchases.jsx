import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fmt, fmtDate, openWhatsApp, buildInvoiceMessage } from "@/lib/utils";
import { Plus, Printer, Eye, Edit, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { printPurchase } from "@/lib/print";
import { useAuth } from "@/lib/auth";

export default function Purchases() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [successInvoice, setSuccessInvoice] = useState(null);
  const [settings, setSettings] = useState({ company_name: "شبكة جواد نت اللاسلكية" });
  const location = useLocation();
  const nav = useNavigate();

  const load = () => api.get("/purchases").then((r) => setItems(r.data));
  useEffect(() => { load(); api.get("/suppliers").then((r) => setSuppliers(r.data)); api.get("/settings").then((r) => setSettings(r.data)); }, []);

  useEffect(() => {
    if (location.state?.invoiceSuccess) {
      setSuccessInvoice(location.state.invoiceSuccess);
      nav(location.pathname, { replace: true, state: {} });
    }
  }, [location, nav]);

  const doPrint = (p) => {
    const supplier = suppliers.find((s) => s.id === p.supplier_id);
    printPurchase({ purchase: p, supplier, username: user?.name || user?.username });
  };

  const sendWA = (p) => {
    const supplier = suppliers.find((s) => s.id === p.supplier_id);
    if (!supplier?.phone) { toast.error("لا يوجد رقم هاتف مسجل لهذا المورد."); return; }
    const details = (p.items || []).map((i) => `${i.category_name} × ${i.quantity} = ${fmt(i.total)}`).join("\n");
    const msg = buildInvoiceMessage({ company: settings.company_name, number: p.number, kind: "مشتريات", details, amount: p.subtotal, discount: p.discount, total: p.total, paid: p.paid, remaining: p.remaining, balance_after: p.balance_after });
    openWhatsApp(supplier.phone, msg);
  };

  return (
    <div className="space-y-4" data-testid="purchases-page">
      <div className="flex justify-end no-print"><Link to="/purchases/new"><Button className="bg-[#221340]" data-testid="new-purchase-btn"><Plus size={16} className="ml-1"/> مشتريات جديدة</Button></Link></div>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الرقم</th><th className="p-3">التاريخ</th><th className="p-3">المورد</th><th className="p-3">الإجمالي</th><th className="p-3">المدفوع</th><th className="p-3">المتبقي</th><th className="p-3 no-print"></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-[#452480] font-bold">{p.number}</td>
                <td className="p-3">{fmtDate(p.created_at)}</td>
                <td className="p-3">{p.supplier_name}</td>
                <td className="p-3 num">{fmt(p.total)}</td>
                <td className="p-3 num">{fmt(p.paid)}</td>
                <td className="p-3 num text-amber-700">{fmt(p.remaining)}</td>
                <td className="p-3 no-print flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setViewing(p)} data-testid={`purch-view-${p.id}`}><Eye size={12}/></Button>
                  <Link to={`/purchases/${p.id}/edit`}><Button size="sm" variant="outline" data-testid={`purch-edit-${p.id}`}><Edit size={12}/></Button></Link>
                  <Button size="sm" variant="outline" onClick={() => doPrint(p)} data-testid={`purch-print-${p.id}`}><Printer size={12}/></Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد فواتير مشتريات</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2 no-print">
        {items.map((p) => (
          <Card key={p.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-mono font-bold text-[#452480] truncate">{p.number}</div>
                <div className="text-xs text-slate-500 truncate">{p.supplier_name} • {fmtDate(p.created_at)}</div>
              </div>
              <div className="text-left text-xs shrink-0">
                <div>الإجمالي: <span className="num font-bold">{fmt(p.total)}</span></div>
                <div className="text-amber-700">المتبقي: <span className="num font-bold">{fmt(p.remaining)}</span></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <Button size="sm" variant="outline" onClick={() => setViewing(p)}><Eye size={12} className="ml-1"/> عرض</Button>
              <Link to={`/purchases/${p.id}/edit`}><Button size="sm" variant="outline"><Edit size={12} className="ml-1"/> تعديل</Button></Link>
              <Button size="sm" variant="outline" onClick={() => doPrint(p)}><Printer size={12} className="ml-1"/> طباعة</Button>
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد فواتير مشتريات</div>}
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>فاتورة مشتريات {viewing?.number}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>التاريخ</span><span>{fmtDate(viewing.created_at)}</span></div>
              <div className="flex justify-between"><span>المورد</span><span>{viewing.supplier_name}</span></div>
              <div className="border-t pt-2">
                {(viewing.items || []).map((it, i) => (
                  <div key={i} className="flex justify-between py-1"><span>{it.category_name} × {it.quantity}</span><span className="num">{fmt(it.total)}</span></div>
                ))}
              </div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span>الإجمالي</span><span className="num font-bold">{fmt(viewing.total)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between"><span>الخصم</span><span className="num">{fmt(viewing.discount)}</span></div>}
                <div className="flex justify-between"><span>المدفوع</span><span className="num">{fmt(viewing.paid)}</span></div>
                <div className="flex justify-between"><span>المتبقي</span><span className="num font-bold text-amber-700">{fmt(viewing.remaining)}</span></div>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <Button onClick={() => doPrint(viewing)} className="bg-[#221340] flex-1 min-w-[120px]"><Printer size={14} className="ml-1"/> طباعة</Button>
                <Link to={`/purchases/${viewing.id}/edit`} className="flex-1 min-w-[120px]"><Button variant="outline" className="w-full"><Edit size={14} className="ml-1"/> تعديل الفاتورة</Button></Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!successInvoice} onOpenChange={(o) => !o && setSuccessInvoice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تم حفظ الفاتورة بنجاح</DialogTitle></DialogHeader>
          {successInvoice && <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
              <div className="flex justify-between"><span>رقم الفاتورة</span><span className="font-mono font-bold">{successInvoice.number}</span></div>
              <div className="flex justify-between"><span>مبلغ الفاتورة</span><span className="num font-bold">{fmt(successInvoice.total)}</span></div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => doPrint(successInvoice)} className="bg-[#221340] flex-1 min-w-[130px]"><Printer size={14} className="ml-1"/> طباعة</Button>
              <Button onClick={() => sendWA(successInvoice)} variant="outline" className="border-green-600 text-green-700 flex-1 min-w-[130px]"><MessageCircle size={14} className="ml-1"/> إرسال واتساب</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

    </div>
  );
}
