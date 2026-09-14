import { useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmt, fmtDate, openWhatsApp, phoneFingerprint } from "@/lib/utils";
import { printPublicOrder } from "@/lib/print";
import { Wifi, CheckCircle, Copy, KeyRound, Phone, Ban, AlertCircle, Printer, History, Search } from "lucide-react";

const ADMIN_WHATSAPP = "784225716";

const priceForCustomer = (cat, ctype) => {
  if (!cat) return 0;
  const p = ctype === "pos" ? cat.sale_price_pos : cat.sale_price_customer;
  return (p ?? cat.sale_price) || 0;
};

export default function PublicOrder() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [customer, setCustomer] = useState(null);
  const [cats, setCats] = useState([]);
  const [category_id, setCategoryId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [selectedCat, setSelectedCat] = useState(null);
  const [loginError, setLoginError] = useState("");
  const [deviceMismatch, setDeviceMismatch] = useState(false);
  // Previous orders section
  const [showHistory, setShowHistory] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const contactCSForDeviceChange = () => {
    const now = new Date();
    const msg = `طلب ربط هاتف جديد بحساب طلب الكرت\n\nرقم الهاتف / الحساب: ${phone}\nالتاريخ والوقت: ${now.toLocaleString("en-GB")}\n\nقمت باستبدال هاتفي القديم وأحتاج ربط حسابي بالهاتف الجديد.\nيرجى التواصل معي لإتمام العملية وإرسال كلمة المرور الجديدة.`;
    openWhatsApp(ADMIN_WHATSAPP, msg);
    toast.success("تم إرسال طلبك إلى خدمة العملاء، وسيتم التواصل معك لإكمال عملية ربط الهاتف.");
  };

  const login = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setLoginError(""); setDeviceMismatch(false);
    if (!phone || !password) { setLoginError("أدخل رقم الهاتف وكلمة المرور"); return; }
    setLoading(true);
    try {
      const fp = await phoneFingerprint();
      const r = await api.post("/public/card-order/login", { phone, password, device_id: fp });
      setCustomer(r.data);
      const cr = await api.get("/public/card-order/categories");
      setCats(cr.data);
      toast.success(`مرحباً ${r.data.name}`);
    } catch (err) {
      const status = err.response?.status;
      const msg = errText(err);
      if (status === 429) { setBlocked(true); setLoginError(msg); }
      else if (status === 401) { setLoginError("كلمة المرور غير صحيحة"); }
      else if (status === 404) { setLoginError("رقم الهاتف أو كلمة المرور غير صحيحة"); }
      else if (status === 403) {
        setLoginError(msg || "الحساب معطل");
        // Detect device-mismatch (backend returns a message that starts with "الهاتف غير مرتبط")
        if ((msg || "").startsWith("الهاتف غير مرتبط")) setDeviceMismatch(true);
      }
      else if (!err.response) { setLoginError("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً."); }
      else { setLoginError(msg || "حدث خطأ"); }
    }
    setLoading(false);
  };

  const request = async () => {
    if (!category_id) { toast.error("اختر الفئة"); return; }
    setLoading(true);
    try {
      const r = await api.post("/public/card-order/request", { phone, password, category_id, quantity: Number(quantity) });
      setResult(r.data);
      setSelectedCat(cats.find((c) => c.id === category_id));
      toast.success("تم تنفيذ طلبك بنجاح");
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const r = await api.post("/public/card-order/my-orders", { phone, password, start: startDate || null, end: endDate || null });
      setHistory(r.data || []);
      if (!(r.data || []).length) toast.info("لا توجد طلبات في الفترة المحددة");
    } catch (e) { toast.error(errText(e)); }
    setHistoryLoading(false);
  };

  const doPrint = (order) => {
    printPublicOrder({ order, customer });
  };

  const copyCard = async (n) => {
    try { await navigator.clipboard.writeText(n); toast.success("تم نسخ رقم الكرت بنجاح"); }
    catch { toast.error("تعذر النسخ"); }
  };

  const contactSupport = () => {
    const msg = `مرحباً، تم حظر حسابي بسبب تجاوز عدد المحاولات الفاشلة.\nرقم الهاتف: ${phone}\nأرجو رفع الحظر عن حسابي.`;
    openWhatsApp(ADMIN_WHATSAPP, msg);
  };

  if (blocked) {
    return (
      <div className="min-h-screen brand-gradient flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 bg-white text-center">
          <Ban className="mx-auto text-red-500 mb-3" size={48}/>
          <div className="font-bold text-lg">تم حظر الإدخال بسبب تجاوز عدد المحاولات الفاشلة.</div>
          <div className="text-sm text-slate-600 mt-2">مدة الحظر: 24 ساعة</div>
          <Button onClick={contactSupport} className="mt-4 bg-green-600 w-full" data-testid="contact-support"><Phone size={14} className="ml-1"/> التواصل مع خدمة العملاء</Button>
        </Card>
      </div>
    );
  }

  const currentCat = cats.find((x) => x.id === category_id);
  const ctype = customer?.customer_type || "customer";
  const currentPrice = priceForCustomer(currentCat, ctype);
  const availNumbered = currentCat?.available_numbered ?? 0;
  const wantQty = Number(quantity) || 0;
  const insufficient = category_id && wantQty > 0 && wantQty > availNumbered;
  const totalPreview = currentPrice * wantQty;

  return (
    <div className="min-h-screen brand-gradient flex items-center justify-center p-4" data-testid="public-order">
      <Card className="w-full max-w-md p-6 bg-white">
        <div className="text-center mb-6">
          <div className="text-xl font-black text-[#221340]">شبكة جواد نت اللاسلكية</div>
          <div className="mt-4 inline-block bg-[#D4AF37] text-[#1A0F33] px-6 py-2 rounded-lg font-bold text-lg">طلب كرت</div>
        </div>

        {!customer && (
          <form onSubmit={login} className="space-y-3" data-testid="po-login-form" noValidate>
            <div><Label>رقم الهاتف</Label><Input value={phone} onChange={(e) => { setPhone(e.target.value); setLoginError(""); }} data-testid="po-phone" autoComplete="tel" inputMode="tel"/></div>
            <div><Label>كلمة المرور</Label><Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setLoginError(""); }} data-testid="po-password" autoComplete="current-password"/></div>
            {loginError && (
              <div className="rounded-md border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm" data-testid="po-login-error" role="alert">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{loginError}</span>
                </div>
                {deviceMismatch && (
                  <Button
                    type="button"
                    onClick={contactCSForDeviceChange}
                    className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white"
                    data-testid="po-contact-cs-device"
                  >
                    <Phone size={14} className="ml-1"/> إرسال لخدمة العملاء
                  </Button>
                )}
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="po-login">{loading?"جاري...":"دخول"}</Button>
            <div className="flex justify-between text-sm">
              <button type="button" onClick={() => setShowForgot(true)} className="text-[#452480] hover:underline" data-testid="po-forgot">نسيت كلمة المرور؟</button>
              <button type="button" onClick={() => setShowRegister(true)} className="text-[#452480] hover:underline" data-testid="po-register">إنشاء حساب</button>
            </div>
            <div className="text-center text-xs text-slate-500 pt-2 border-t">لاتمتلك حساب .. <button type="button" onClick={() => setShowRegister(true)} className="text-[#D4AF37] font-bold hover:underline">إنشاء حساب</button></div>
          </form>
        )}

        {customer && !result && (
          <div className="space-y-3">
            <Card className="p-3 bg-slate-50">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold">{customer.name}</div>
                  <div className="text-xs text-slate-500">{ctype === "pos" ? "نقطة بيع" : "عميل"}</div>
                </div>
                <button onClick={() => setShowChangePwd(true)} className="text-xs text-[#452480] hover:underline flex items-center gap-1" data-testid="po-change-pwd"><KeyRound size={12}/> تغيير كلمة المرور</button>
              </div>
              <div className="text-xs mt-2 grid grid-cols-3 gap-2">
                <div><div className="text-slate-500">السقف</div><div className="num font-bold">{fmt(customer.credit_limit)}</div></div>
                <div><div className="text-slate-500">المديونية</div><div className="num font-bold">{fmt(customer.balance)}</div></div>
                <div><div className="text-slate-500">المتاح</div><div className="num font-bold text-green-600">{fmt(customer.available)}</div></div>
              </div>
            </Card>
            <div><Label>الفئة</Label>
              <Select value={category_id} onValueChange={setCategoryId}>
                <SelectTrigger data-testid="po-cat"><SelectValue placeholder="اختر"/></SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} - {fmt(priceForCustomer(c, ctype))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>الكمية</Label><Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="po-qty"/></div>
            {category_id && (
              <Card className="p-3 bg-amber-50 border-amber-200 text-sm space-y-1" data-testid="po-price-preview">
                <div className="flex justify-between"><span className="text-slate-600">السعر ({ctype === "pos" ? "نقطة بيع" : "عميل"})</span><span className="num font-bold gold-text">{fmt(currentPrice)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">الإجمالي</span><span className="num font-bold text-lg">{fmt(totalPreview)}</span></div>
              </Card>
            )}
            {insufficient && (
              <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm" data-testid="po-no-stock" role="alert">
                <AlertCircle size={16} className="mt-0.5 shrink-0"/><span>لا تتوفر كمية الكروت المطلوبة</span>
              </div>
            )}
            <Button onClick={request} disabled={loading || !category_id || wantQty < 1 || insufficient} className="w-full bg-[#D4AF37] text-[#1A0F33] font-bold hover:bg-[#C5A028] text-lg py-6 disabled:opacity-50" data-testid="po-request">طلب</Button>

            {/* Previous orders section */}
            <div className="pt-3 border-t">
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold text-[#221340]" data-testid="po-history-toggle">
                <span className="flex items-center gap-2"><History size={16}/> الطلبات السابقة</span>
                <span className="text-[#452480]">{showHistory ? "إخفاء" : "عرض"}</span>
              </button>
              {showHistory && (
                <div className="mt-3 space-y-3" data-testid="po-history">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="po-history-start"/></div>
                    <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="po-history-end"/></div>
                  </div>
                  <Button onClick={loadHistory} disabled={historyLoading} variant="outline" className="w-full" data-testid="po-history-search"><Search size={14} className="ml-1"/> {historyLoading ? "جاري..." : "بحث"}</Button>

                  <div className="space-y-2">
                    {history.map((o) => (
                      <Card key={o.id} className="p-3 text-sm border-slate-200" data-testid={`po-order-${o.id}`}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-[#452480]" data-testid={`po-order-number-${o.id}`}>{o.number}</div>
                            <div className="text-xs text-slate-500">{fmtDate(o.created_at)}</div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => doPrint(o)} className="shrink-0" data-testid={`po-order-print-${o.id}`}><Printer size={12} className="ml-1"/> طباعة</Button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div><div className="text-slate-500">الحساب</div><div className="font-bold truncate">{o.customer_name}</div></div>
                          <div><div className="text-slate-500">الفئة</div><div className="font-bold truncate">{o.category_name || "-"}</div></div>
                          <div><div className="text-slate-500">الكمية</div><div className="num font-bold">{o.quantity}</div></div>
                          <div><div className="text-slate-500">الإجمالي</div><div className="num font-bold">{fmt(o.total)}</div></div>
                        </div>
                        {o.cards?.length > 0 && (
                          <div className="mt-2 pt-2 border-t">
                            <div className="text-slate-500 text-xs mb-1">الكروت:</div>
                            <div className="space-y-1">
                              {o.cards.map((c) => (
                                <div key={c} className="flex items-center justify-between bg-slate-50 p-1.5 rounded text-xs">
                                  <span className="font-mono tracking-wider">{c}</span>
                                  <Button size="sm" variant="outline" onClick={() => copyCard(c)} className="h-6 px-2 text-xs"><Copy size={10}/> نسخ</Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                    {history.length === 0 && !historyLoading && <div className="text-center text-xs text-slate-400 py-4">لا توجد طلبات لعرضها. اختر فترة واضغط بحث.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="text-center">
              <CheckCircle className="mx-auto text-green-500" size={48}/>
              <div className="font-bold text-lg mt-2">تم تنفيذ طلبك بنجاح</div>
            </div>
            {selectedCat && <div className="text-center text-sm bg-slate-50 py-2 rounded">فئة الكرت: <span className="font-bold gold-text">{selectedCat.name}</span></div>}
            {result.cards?.length > 0 && (
              <Card className="p-3 bg-green-50">
                <div className="text-sm font-bold mb-2">الكروت المطلوبة:</div>
                <div className="space-y-2">
                  {result.cards.map((c) => (
                    <div key={c} className="flex items-center justify-between bg-white p-2 rounded border">
                      <span className="text-lg tracking-wider font-mono" data-testid={`card-${c}`}>{c}</span>
                      <Button size="sm" variant="outline" onClick={() => copyCard(c)} data-testid={`copy-${c}`}><Copy size={14}/> نسخ</Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <div className="text-center text-sm">
              <div className="text-slate-500">المديونية بعد العملية</div>
              <div className="text-2xl font-bold num">{fmt(result.balance_after)}</div>
            </div>
            <Button onClick={() => { setResult(null); setCategoryId(""); setQuantity(1); setSelectedCat(null); }} variant="outline" className="w-full">طلب جديد</Button>
          </div>
        )}
      </Card>

      <Dialog open={showForgot} onOpenChange={setShowForgot}>
        <ForgotPasswordForm onClose={() => setShowForgot(false)}/>
      </Dialog>
      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <RegisterForm onClose={() => setShowRegister(false)}/>
      </Dialog>
      <Dialog open={showChangePwd} onOpenChange={setShowChangePwd}>
        <ChangePasswordForm phone={phone} currentPassword={password} onClose={() => setShowChangePwd(false)} onDone={(np) => setPassword(np)}/>
      </Dialog>
    </div>
  );
}

function ForgotPasswordForm({ onClose }) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post("/public/customer/forgot-password", { phone });
      const now = new Date();
      const msg = `طلب استعادة كلمة المرور\n\nاسم العميل: ${r.data.name}\nالرقم: ${r.data.phone}\nالهاتف: ${r.data.phone}\nالعنوان: ${r.data.address || "-"}\n\nأرجو من الإدارة مساعدتي في استعادة كلمة المرور.\n\n${now.toLocaleString("en-GB")}`;
      openWhatsApp(ADMIN_WHATSAPP, msg);
      toast.success("جاري فتح واتساب");
      onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>نسيت كلمة المرور؟</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-sm text-slate-600">سيتم إرسال طلب استعادة كلمة المرور إلى الإدارة عبر واتساب.</div>
        <div><Label>رقم الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} required data-testid="fp-phone"/></div>
        <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="fp-submit">{loading?"جاري...":"إرسال الطلب للإدارة"}</Button>
      </form>
    </DialogContent>
  );
}

function RegisterForm({ onClose }) {
  const [f, setF] = useState({ full_name: "", phone: "", address: "" });
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/public/customer/register-request", f);
      const now = new Date();
      const msg = `طلب إنشاء حساب جديد\n\nاسم العميل: ${f.full_name}\nرقم الهاتف: ${f.phone}\nالعنوان: ${f.address || "-"}\n\nيرجى الموافقة على الطلب.\n\n${now.toLocaleString("en-GB")}`;
      openWhatsApp(ADMIN_WHATSAPP, msg);
      toast.success("تم إرسال الطلب، سيتم التواصل معك قريباً");
      onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>إنشاء حساب جديد</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>الاسم الكامل</Label><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required data-testid="reg-name"/></div>
        <div><Label>رقم الهاتف</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required data-testid="reg-phone"/></div>
        <div><Label>العنوان</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="reg-address"/></div>
        <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="reg-submit">{loading?"جاري...":"تسجيل"}</Button>
      </form>
    </DialogContent>
  );
}

function ChangePasswordForm({ phone, currentPassword, onClose, onDone }) {
  const [current, setCurrent] = useState(currentPassword || "");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) { toast.error("كلمة المرور وتأكيدها غير متطابقين"); return; }
    if ((next || "").length < 4) { toast.error("كلمة المرور قصيرة"); return; }
    setLoading(true);
    try {
      await api.post("/public/customer/change-password", { phone, current_password: current, new_password: next });
      toast.success("تم تغيير كلمة المرور");
      onDone && onDone(next);
      onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>تغيير كلمة المرور</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>كلمة المرور الحالية</Label><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required data-testid="cp-current"/></div>
        <div><Label>كلمة المرور الجديدة</Label><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required data-testid="cp-new"/></div>
        <div><Label>تأكيد كلمة المرور</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="cp-confirm"/></div>
        <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="cp-submit">{loading?"جاري...":"حفظ"}</Button>
      </form>
    </DialogContent>
  );
}
