import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";

export default function AuditLog() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/audit").then((r) => setItems(r.data)); }, []);
  return (
    <Card className="overflow-x-auto" data-testid="audit-page">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">التاريخ</th><th className="p-3">المستخدم</th><th className="p-3">العملية</th><th className="p-3">الكائن</th><th className="p-3">التفاصيل</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-t"><td className="p-3">{fmtDate(a.created_at)}</td><td className="p-3">{a.username}</td><td className="p-3">{a.action}</td><td className="p-3">{a.entity}</td><td className="p-3 text-xs font-mono break-all max-w-xs">{JSON.stringify(a.new_value || a.old_value || {})}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
