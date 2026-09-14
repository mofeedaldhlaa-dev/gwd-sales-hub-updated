import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fmt } from "@/lib/utils";
import { Plus, Edit, Trash2 } from "lucide-react";

const empty = { name: "", value: 0, sale_price: 0, sale_price_customer: 0, sale_price_pos: 0, purchase_price: 0, validity_days: 30, data_size: "", status: "active", notes: "", low_stock_threshold: 20, low_stock_numbered: 10, low_stock_quantity: 20 };

function CategoryForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState(initial ? { ...empty, ...initial } : empty);
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { ...f };
      ["value","sale_price","sale_price_customer","sale_price_pos","purchase_price","validity_days","low_stock_threshold","low_stock_numbered","low_stock_quantity"].forEach(k => body[k] = Number(body[k]) || 0);
      // ensure sale_price fallback
      if (!body.sale_price) body.sale_price = body.sale_price_customer || body.sale_price_pos || 0;
      if (initial?.id) await api.put(`/categories/${initial.id}`, body);
      else await api.post("/categories", body);
      toast.success("تم الحفظ"); onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div><Label>اسم الفئة</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="cat-name" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>قيمة الكرت</Label><Input type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} data-testid="cat-value" /></div>
        <div><Label>سعر الشراء</Label><Input type="number" value={f.purchase_price} onChange={(e) => setF({ ...f, purchase_price: e.target.value })} /></div>
        <div><Label>سعر العملاء</Label><Input type="number" value={f.sale_price_customer} onChange={(e) => setF({ ...f, sale_price_customer: e.target.value, sale_price: e.target.value })} data-testid="cat-sale-cust" /></div>
        <div><Label>سعر نقاط البيع</Label><Input type="number" value={f.sale_price_pos} onChange={(e) => setF({ ...f, sale_price_pos: e.target.value })} data-testid="cat-sale-pos" /></div>
        <div><Label>مدة الصلاحية (يوم)</Label><Input type="number" value={f.validity_days} onChange={(e) => setF({ ...f, validity_days: e.target.value })} /></div>
        <div><Label>حجم البيانات</Label><Input value={f.data_size} onChange={(e) => setF({ ...f, data_size: e.target.value })} /></div>
        <div><Label>حد تنبيه الكمية</Label><Input type="number" value={f.low_stock_quantity} onChange={(e) => setF({ ...f, low_stock_quantity: e.target.value })} /></div>
        <div><Label>حد تنبيه المرقمة</Label><Input type="number" value={f.low_stock_numbered} onChange={(e) => setF({ ...f, low_stock_numbered: e.target.value })} /></div>
      </div>
      <Textarea placeholder="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="cat-save">{loading?"جاري...":"حفظ"}</Button>
    </form>
  );
}

export default function Categories() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const load = async () => setItems((await api.get("/categories")).data);
  useEffect(() => { load(); }, []);
  const remove = async (id) => {
    try {
      const r = await api.delete(`/categories/${id}`);
      toast.success(r.data.action === "deleted" ? "تم الحذف" : r.data.reason || "تم التعطيل");
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="space-y-4" data-testid="categories-page">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild><Button className="bg-[#221340]" data-testid="add-category-btn"><Plus size={16} className="ml-1" /> فئة جديدة</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>{edit?"تعديل فئة":"إضافة فئة"}</DialogTitle></DialogHeader>
            <CategoryForm initial={edit} onSaved={load} onClose={() => setOpen(false)}/>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((c) => (
          <Card key={c.id} className={`p-4 ${c.status==='disabled'?'opacity-50':''}`} data-testid={`cat-${c.id}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-lg text-[#221340]">{c.name}</div>
                <div className="text-xs text-slate-500">{c.data_size} • {c.validity_days} يوم</div>
              </div>
              <div className="text-left space-y-1">
                <div className="text-xs">عميل: <span className="num font-bold gold-text">{fmt(c.sale_price_customer || c.sale_price)}</span></div>
                <div className="text-xs">نقطة: <span className="num font-bold text-[#452480]">{fmt(c.sale_price_pos || c.sale_price)}</span></div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
              <span className="text-slate-500">شراء: <span className="num">{fmt(c.purchase_price)}</span></span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEdit(c); setOpen(true); }} data-testid={`cat-edit-${c.id}`}><Edit size={12}/></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="sm" variant="outline" data-testid={`cat-del-${c.id}`}><Trash2 size={12} className="text-red-500"/></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
                      <AlertDialogDescription>هل تريد حذف "{c.name}"؟ إذا كانت مرتبطة ببيانات سابقة سيتم تعطيلها فقط.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(c.id)}>تأكيد</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
