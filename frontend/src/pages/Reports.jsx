import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fmt, fmtDate } from "@/lib/utils";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { printReport } from "@/lib/print";
import { useAuth } from "@/lib/auth";

const TAB_TITLES = {
  sales: "تقرير المبيعات", purchases: "تقرير المشتريات",
  electronic: "تقرير المبيعات الإلكترونية", card_order_log: "سجل طلبات الرابط",
  customer_debts: "تقرير مديونية العملاء", supplier_debts: "تقرير مديونية الموردين",
  stock: "تقرير المخزون",
};

export default function Reports() {
  const { user } = useAuth();
  const [tab, setTab] = useState("sales");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");

  const load = async () => {
    const endpoints = {
      sales: "/reports/sales", purchases: "/reports/purchases",
      customer_debts: "/reports/customer-debts", supplier_debts: "/reports/supplier-debts",
      stock: "/stock", electronic: "/reports/electronic-sales",
      card_order_log: "/reports/card-order-log",
    };
    const params = ["sales","purchases"].includes(tab) && start && end ? { start, end } : {};
    try {
      const r = await api.get(endpoints[tab], { params });
      setData(r.data);
    } catch (e) { toast.error(errText(e)); setData([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tab]);

  const filtered = data.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
  const username = user?.name || user?.username;

  const printCurrent = () => {
    const title = TAB_TITLES[tab] || "تقرير";
    if (tab === "sales" || tab === "purchases") {
      const total = filtered.reduce((s, x) => s + (x.total || 0), 0);
      printReport({
        title, headers: ["الرقم","التاريخ",tab==="sales"?"العميل":"المورد","الإجمالي","المدفوع","المتبقي"],
        rows: filtered.map((s) => [s.number, fmtDate(s.created_at), s.customer_name || s.supplier_name || "-", fmt(s.total), fmt(s.paid), fmt(s.remaining)]),
        totals: [{ label: "الإجمالي", value: fmt(total) }], username,
      });
    } else if (tab === "electronic") {
      const total = filtered.reduce((s, x) => s + (x.total || 0), 0);
      printReport({
        title, headers: ["الرقم","التاريخ","العميل","الفئة","الكمية","الإجمالي","الكروت"],
        rows: filtered.map((s) => { const it = s.items?.[0] || {}; return [s.number, fmtDate(s.created_at), s.customer_name, it.category_name, it.quantity, fmt(s.total), (it.card_numbers||[]).join(", ")]; }),
        totals: [{ label: "الإجمالي", value: fmt(total) }], username,
      });
    } else if (tab === "card_order_log") {
      printReport({
        title, headers: ["التاريخ","العميل","الهاتف","الفئة","الكمية","القيمة","الحالة","السبب"],
        rows: filtered.map((a) => [fmtDate(a.created_at), a.customer_name || "-", a.phone, a.category_name || "-", a.quantity || 0, fmt(a.total || 0), a.status==="success"?"ناجح":a.status==="rejected_over_limit"?"مرفوض - تجاوز السقف":a.status==="rejected_no_stock"?"مرفوض - عدم توفر":"مرفوض - غير موجود", a.reason || "-"]),
        username,
      });
    } else if (tab === "customer_debts" || tab === "supplier_debts") {
      const total = filtered.reduce((s, x) => s + (x.balance || 0), 0);
      const label = tab === "customer_debts" ? "العميل" : "المورد";
      printReport({
        title, headers: [label, "الهاتف", "السقف", "المديونية", "المتاح"],
        rows: filtered.map((c) => [c.name, c.phone, fmt(c.credit_limit), fmt(c.balance), fmt(Math.max(0,(c.credit_limit||0)-(c.balance||0)))]),
        totals: [{ label: "إجمالي المديونية", value: fmt(total) }], username,
      });
    } else if (tab === "stock") {
      printReport({
        title, headers: ["الفئة","مرقم إجمالي","مرقم متاح","مرقم مباع","كمية إجمالي","كمية متاح","المتاح الكلي"],
        rows: filtered.map((s) => [s.category_name, s.numbered?.total || 0, s.numbered?.available || 0, s.numbered?.sold || 0, s.quantity?.total || 0, s.quantity?.available || 0, s.available_total || 0]),
        username,
      });
    }
  };

  return (
    <div className="space-y-4" data-testid="reports-page">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sales" data-testid="rep-sales">المبيعات</TabsTrigger>
          <TabsTrigger value="purchases" data-testid="rep-purchases">المشتريات</TabsTrigger>
          <TabsTrigger value="electronic" data-testid="rep-electronic">المبيعات الإلكترونية</TabsTrigger>
          <TabsTrigger value="card_order_log" data-testid="rep-order-log">سجل طلبات الرابط</TabsTrigger>
          <TabsTrigger value="customer_debts" data-testid="rep-cdebts">مديونية العملاء</TabsTrigger>
          <TabsTrigger value="supplier_debts" data-testid="rep-sdebts">مديونية الموردين</TabsTrigger>
          <TabsTrigger value="stock" data-testid="rep-stock">المخزون</TabsTrigger>
        </TabsList>

        <Card className="p-3 flex flex-col sm:flex-row gap-2 sm:items-end flex-wrap mt-3 no-print">
          {["sales", "purchases"].includes(tab) && (
            <>
              <div className="w-full sm:w-auto"><label className="text-xs">من</label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)}/></div>
              <div className="w-full sm:w-auto"><label className="text-xs">إلى</label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)}/></div>
              <Button onClick={load} className="bg-[#221340] w-full sm:w-auto">تصفية</Button>
            </>
          )}
          <Input placeholder="بحث..." value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs"/>
          <Button onClick={printCurrent} variant="outline" data-testid="print-report" className="w-full sm:w-auto"><Printer size={14} className="ml-1"/> طباعة / PDF</Button>
        </Card>

        <TabsContent value="sales"><ReportTable data={filtered} kind="sales"/></TabsContent>
        <TabsContent value="purchases"><ReportTable data={filtered} kind="purchases"/></TabsContent>
        <TabsContent value="electronic"><ElectronicTable data={filtered}/></TabsContent>
        <TabsContent value="card_order_log"><OrderLogTable data={filtered}/></TabsContent>
        <TabsContent value="customer_debts"><DebtTable data={filtered} label="العميل"/></TabsContent>
        <TabsContent value="supplier_debts"><DebtTable data={filtered} label="المورد"/></TabsContent>
        <TabsContent value="stock"><StockTable data={filtered}/></TabsContent>
      </Tabs>
    </div>
  );
}

const ReportTable = ({ data, kind }) => {
  const total = data.reduce((s, x) => s + (x.total || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">التاريخ</th><th className="p-2">{kind==='sales'?'العميل':'المورد'}</th><th className="p-2">الإجمالي</th><th className="p-2">المدفوع</th><th className="p-2">المتبقي</th></tr></thead>
        <tbody>
          {data.map((s) => <tr key={s.id} className="border-t"><td className="p-2 font-mono">{s.number}</td><td className="p-2">{fmtDate(s.created_at)}</td><td className="p-2">{s.customer_name || s.supplier_name}</td><td className="p-2 num">{fmt(s.total)}</td><td className="p-2 num">{fmt(s.paid)}</td><td className="p-2 num">{fmt(s.remaining)}</td></tr>)}
          {data.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={3} className="p-2">الإجمالي</td><td className="p-2 num">{fmt(total)}</td><td colSpan={2}></td></tr></tfoot>
      </table>
    </Card>
  );
};
const ElectronicTable = ({ data }) => {
  const total = data.reduce((s, x) => s + (x.total || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">التاريخ</th><th className="p-2">العميل</th><th className="p-2">الفئة</th><th className="p-2">الكمية</th><th className="p-2">الإجمالي</th><th className="p-2">الكروت</th></tr></thead>
        <tbody>
          {data.map((s) => { const it = s.items?.[0] || {}; return <tr key={s.id} className="border-t"><td className="p-2 font-mono">{s.number}</td><td className="p-2">{fmtDate(s.created_at)}</td><td className="p-2">{s.customer_name}</td><td className="p-2">{it.category_name}</td><td className="p-2 num">{it.quantity}</td><td className="p-2 num">{fmt(s.total)}</td><td className="p-2 text-xs font-mono">{(it.card_numbers||[]).join(", ")}</td></tr>; })}
          {data.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={5} className="p-2">الإجمالي</td><td className="p-2 num">{fmt(total)}</td><td></td></tr></tfoot>
      </table>
    </Card>
  );
};
const OrderLogTable = ({ data }) => (
  <Card className="mt-3 overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">العميل</th><th className="p-2">الهاتف</th><th className="p-2">الفئة</th><th className="p-2">الكمية</th><th className="p-2">القيمة</th><th className="p-2">الحالة</th><th className="p-2">السبب</th></tr></thead>
      <tbody>
        {data.map((a) => (
          <tr key={a.id} className="border-t">
            <td className="p-2">{fmtDate(a.created_at)}</td><td className="p-2">{a.customer_name || "-"}</td><td className="p-2">{a.phone}</td><td className="p-2">{a.category_name || "-"}</td><td className="p-2 num">{a.quantity || 0}</td><td className="p-2 num">{fmt(a.total || 0)}</td>
            <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${a.status==='success'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{a.status==='success'?'ناجح':a.status==='rejected_over_limit'?'مرفوض - تجاوز السقف':a.status==='rejected_no_stock'?'مرفوض - عدم توفر':'مرفوض - غير موجود'}</span></td>
            <td className="p-2 text-xs">{a.reason}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
      </tbody>
    </table>
  </Card>
);
const DebtTable = ({ data, label }) => {
  const total = data.reduce((s, x) => s + (x.balance || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">{label}</th><th className="p-2">الهاتف</th><th className="p-2">السقف</th><th className="p-2">المديونية</th><th className="p-2">المتاح</th></tr></thead>
        <tbody>{data.map((c) => <tr key={c.id} className="border-t"><td className="p-2">{c.name}</td><td className="p-2">{c.phone}</td><td className="p-2 num">{fmt(c.credit_limit)}</td><td className="p-2 num font-bold">{fmt(c.balance)}</td><td className="p-2 num text-green-600">{fmt(Math.max(0, (c.credit_limit||0) - (c.balance||0)))}</td></tr>)}
          {data.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={3} className="p-2">إجمالي المديونية</td><td className="p-2 num">{fmt(total)}</td><td></td></tr></tfoot>
      </table>
    </Card>
  );
};
const StockTable = ({ data }) => {
  if (!data || data.length === 0) return <Card className="mt-3 p-6 text-center text-slate-400">لا توجد بيانات لعرضها</Card>;
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الفئة</th><th className="p-2">مرقم إجمالي</th><th className="p-2">مرقم متاح</th><th className="p-2">مرقم مباع</th><th className="p-2">كمية إجمالي</th><th className="p-2">كمية متاح</th><th className="p-2">المتاح الكلي</th></tr></thead>
        <tbody>{data.map((s) => <tr key={s.category_id} className={`border-t ${s.low_stock?'bg-amber-50':''}`}><td className="p-2">{s.category_name}</td><td className="p-2 num">{s.numbered?.total || 0}</td><td className="p-2 num text-green-600">{s.numbered?.available || 0}</td><td className="p-2 num">{s.numbered?.sold || 0}</td><td className="p-2 num">{s.quantity?.total || 0}</td><td className="p-2 num text-green-600">{s.quantity?.available || 0}</td><td className="p-2 num font-bold">{s.available_total || 0}</td></tr>)}</tbody>
      </table>
    </Card>
  );
};
