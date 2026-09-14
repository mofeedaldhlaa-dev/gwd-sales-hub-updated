import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Edit, Trash2 } from "lucide-react";

export default function Cards() {
  const [cats, setCats] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [numbers, setNumbers] = useState("");
  const [qty, setQty] = useState(0);
  const [cardsList, setCardsList] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState("numbers");
  const [editCard, setEditCard] = useState(null);

  const loadCats = async () => setCats((await api.get("/categories")).data);
  const loadCards = async () => setCardsList((await api.get("/cards", { params: { q: search, status_filter: statusFilter || undefined } })).data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCats(); loadCards(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCards(); }, [search, statusFilter]);

  const parseNumbers = () => numbers.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const addNumbers = async () => {
    if (!categoryId) { toast.error("اختر الفئة"); return; }
    try {
      const list = parseNumbers();
      const r = await api.post("/cards/add-numbers", { category_id: categoryId, numbers: list });
      setResult(r.data);
      toast.success(`تمت إضافة ${r.data.added} كرت`);
      setNumbers("");
      loadCards();
    } catch (e) { toast.error(errText(e)); }
  };

  const addQty = async () => {
    if (!categoryId || !qty) { toast.error("اختر الفئة والكمية"); return; }
    try {
      await api.post("/cards/add-quantity", { category_id: categoryId, quantity: Number(qty) });
      toast.success("تمت الإضافة"); setQty(0);
    } catch (e) { toast.error(errText(e)); }
  };

  const removeCard = async (id) => {
    try {
      const r = await api.delete(`/cards/${id}`);
      toast.success(r.data.action === "deleted" ? "تم الحذف" : "تم إلغاء الكرت (لأنه مباع)");
      loadCards();
    } catch (e) { toast.error(errText(e)); }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/cards/${editCard.id}`, { number: editCard.number, category_id: editCard.category_id, status: editCard.status, notes: editCard.notes });
      toast.success("تم التعديل"); setEditCard(null); loadCards();
    } catch (e) { toast.error(errText(e)); }
  };

  return (
    <div className="space-y-4" data-testid="cards-page">
      <Card className="p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 max-w-md">
            <TabsTrigger value="numbers" data-testid="tab-numbers">كروت بأرقام</TabsTrigger>
            <TabsTrigger value="qty" data-testid="tab-qty">كمية بدون أرقام</TabsTrigger>
          </TabsList>
          <TabsContent value="numbers" className="space-y-3">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger data-testid="cards-cat"><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
              <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea rows={10} placeholder="ألصق أرقام الكروت هنا (كل رقم في سطر)" value={numbers} onChange={(e) => setNumbers(e.target.value)} data-testid="cards-numbers" className="font-mono" />
            <div className="text-sm text-slate-500">عدد الأسطر: {parseNumbers().length}</div>
            <Button onClick={addNumbers} className="bg-[#221340]" data-testid="cards-add-numbers">إضافة الكروت</Button>
            {result && (
              <Card className="p-4 bg-slate-50">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><div className="text-slate-500">الصحيحة</div><div className="text-xl font-bold text-green-600">{result.added}</div></div>
                  <div><div className="text-slate-500">المكررة</div><div className="text-xl font-bold text-amber-600">{result.duplicates?.length || 0}</div></div>
                  <div><div className="text-slate-500">غير صالحة</div><div className="text-xl font-bold text-red-600">{result.invalid?.length || 0}</div></div>
                </div>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="qty" className="space-y-3">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
              <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" placeholder="الكمية" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="cards-qty" />
            <Button onClick={addQty} className="bg-[#221340]" data-testid="cards-add-qty">إضافة</Button>
          </TabsContent>
        </Tabs>
      </Card>

      <Card className="p-4">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <div className="font-bold text-[#221340]">قائمة الكروت المرقمة</div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v==="all"?"":v)}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="كل الحالات"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="available">متوفر</SelectItem>
                <SelectItem value="sold">مباع</SelectItem>
                <SelectItem value="used">مستخدم</SelectItem>
                <SelectItem value="cancelled">ملغي</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="بحث برقم الكرت" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:max-w-xs" data-testid="cards-search" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">الفئة</th><th className="p-2">الحالة</th><th className="p-2"></th></tr></thead>
            <tbody>
              {cardsList.slice(0, 300).map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="p-2 font-mono">{c.number}</td>
                  <td className="p-2">{c.category_name}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${c.status==='available'?'bg-green-100 text-green-700':c.status==='sold'?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-700'}`}>{c.status==='available'?'متوفر':c.status==='sold'?'مباع':c.status==='used'?'مستخدم':'ملغي'}</span></td>
                  <td className="p-2 flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditCard({...c})} data-testid={`card-edit-${c.id}`}><Edit size={12}/></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="sm" variant="outline" data-testid={`card-del-${c.id}`}><Trash2 size={12} className="text-red-500"/></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>تأكيد</AlertDialogTitle>
                          <AlertDialogDescription>هل تريد حذف الكرت {c.number}؟ إذا كان مباعاً سيتم إلغاؤه فقط.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => removeCard(c.id)}>تأكيد</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
              {cardsList.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-slate-400">لا توجد كروت</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editCard && (
        <Dialog open onOpenChange={() => setEditCard(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>تعديل الكرت</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>رقم الكرت</Label><Input value={editCard.number} onChange={(e) => setEditCard({...editCard, number: e.target.value})} data-testid="edit-card-number"/></div>
              <div><Label>الفئة</Label>
                <Select value={editCard.category_id} onValueChange={(v) => setEditCard({...editCard, category_id: v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>الحالة</Label>
                <Select value={editCard.status} onValueChange={(v) => setEditCard({...editCard, status: v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">متوفر</SelectItem>
                    <SelectItem value="sold">مباع</SelectItem>
                    <SelectItem value="used">مستخدم</SelectItem>
                    <SelectItem value="cancelled">ملغي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea placeholder="ملاحظات" value={editCard.notes || ""} onChange={(e) => setEditCard({...editCard, notes: e.target.value})}/>
              <Button onClick={saveEdit} className="w-full bg-[#221340]" data-testid="edit-card-save">حفظ</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
