import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNavigate, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Wifi } from "lucide-react";

export default function Login() {
  const { login, error, user } = useAuth();
  const nav = useNavigate();
  const [username, setU] = useState("admin");
  const [password, setP] = useState("admin123");
  const [loading, setLoading] = useState(false);

  if (user) nav("/");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(username, password);
    setLoading(false);
    if (ok) nav("/");
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row" data-testid="login-page">
      <div className="hidden md:flex md:w-1/2 brand-gradient text-white items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{background: 'radial-gradient(circle at 30% 30%, #D4AF37 0%, transparent 50%)'}} />
        <div className="relative z-10 max-w-md p-10 text-right">
          <div className="text-3xl font-black gold-text mb-4">شبكة جواد نت اللاسلكية</div>
          <div className="text-lg opacity-90 mb-8">نظام محاسبة ومبيعات ومخزون متكامل</div>
          <div className="flex items-center gap-3 text-sm opacity-80"><Wifi size={16}/> إدارة الكروت والمبيعات والعملاء بسهولة</div>
          <div className="text-sm mt-2 opacity-80">📞 784225716</div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 card-elevated">
          <div className="text-center mb-6">
            <div className="text-2xl font-black text-[#221340]">تسجيل الدخول</div>
            <div className="text-sm text-slate-500 mt-1">أدخل بيانات حسابك للمتابعة</div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm mb-1 block font-medium">اسم المستخدم</label>
              <Input value={username} onChange={(e) => setU(e.target.value)} required data-testid="login-username" className="text-right" />
            </div>
            <div>
              <label className="text-sm mb-1 block font-medium">كلمة المرور</label>
              <Input type="password" value={password} onChange={(e) => setP(e.target.value)} required data-testid="login-password" className="text-right" />
            </div>
            {error && <div className="text-sm text-red-600" data-testid="login-error">{error}</div>}
            <Button type="submit" disabled={loading} data-testid="login-submit" className="w-full bg-[#221340] hover:bg-[#311B5C]">
              {loading ? "جاري..." : "دخول"}
            </Button>
          </form>
          <div className="mt-4 flex justify-between text-sm">
            <Link to="/order" className="text-[#452480] hover:underline" data-testid="link-order">هل أنت عميل؟ اطلب كرت</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
