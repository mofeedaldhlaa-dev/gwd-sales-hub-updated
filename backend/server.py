from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import bcrypt
import jwt
import secrets
import string
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict

# ================= CONFIG =================
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
COMPANY_NAME = os.environ.get('COMPANY_NAME', 'شبكة جواد نت اللاسلكية')
COMPANY_PHONE = os.environ.get('COMPANY_PHONE', '784225716')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Jawad Net ERP")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jawad")


# ================= HELPERS =================
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str, username: str) -> str:
    payload = {"sub": user_id, "username": username, "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def random_password(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "JWD" + "".join(secrets.choice(alphabet) for _ in range(length - 3))

def clean_doc(doc: dict) -> dict:
    if not doc: return doc
    def _strip(v):
        if isinstance(v, dict):
            return {k: _strip(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_strip(x) for x in v]
        return v
    return _strip(dict(doc))

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="غير مصرح")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="المستخدم غير موجود")
        if user.get("status") == "disabled":
            raise HTTPException(status_code=403, detail="الحساب معطل")
        return clean_doc(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="انتهت صلاحية الجلسة")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="جلسة غير صالحة")

def require_perm(*perms: str):
    async def checker(user=Depends(get_current_user)):
        if user.get("role") == "admin":
            return user
        user_perms = set(user.get("permissions", []))
        if not any(p in user_perms for p in perms):
            raise HTTPException(status_code=403, detail="لا تملك الصلاحية")
        return user
    return checker

async def next_gwd_number() -> str:
    seq_doc = await db.settings.find_one_and_update(
        {"key": "gwd_sequence"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    val = seq_doc.get("value", 1)
    return f"GWD{val:04d}"

async def audit_log(user: dict, action: str, entity: str, entity_id: str = "", old: Any = None, new: Any = None):
    def _sanitize(v):
        if v is None: return None
        if isinstance(v, dict):
            return {k: _sanitize(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_sanitize(x) for x in v]
        try:
            import json
            json.dumps(v)
            return v
        except Exception:
            return str(v)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user.get("id"),
        "username": user.get("username"),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "old_value": _sanitize(old),
        "new_value": _sanitize(new),
        "created_at": now_iso(),
    })

async def notify(title: str, message: str, ntype: str = "info", user_id: Optional[str] = None):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "title": title,
        "message": message,
        "type": ntype,
        "user_id": user_id,
        "read": False,
        "created_at": now_iso(),
    })

# ================= MODELS =================
ALL_PERMS = [
    "dashboard","sales","purchases","customers","suppliers","stock","categories",
    "receipts","reports","print_reports","users","settings","card_orders",
    "delete_ops","edit_ops","cards","backup",
]

class LoginIn(BaseModel):
    username: str
    password: str

class UserIn(BaseModel):
    name: str
    username: str
    password: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "user"
    status: str = "active"
    permissions: List[str] = []

class CustomerIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    password: Optional[str] = None
    credit_limit: float = 0
    opening_balance: float = 0
    address: Optional[str] = ""
    notes: Optional[str] = ""
    status: str = "active"
    customer_type: str = "customer"  # customer / pos

class SupplierIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    credit_limit: float = 0
    opening_balance: float = 0
    address: Optional[str] = ""
    notes: Optional[str] = ""
    status: str = "active"

class CategoryIn(BaseModel):
    name: str
    value: float
    sale_price: float
    purchase_price: float
    validity_days: Optional[int] = 0
    data_size: Optional[str] = ""
    status: str = "active"
    notes: Optional[str] = ""
    low_stock_threshold: int = 20
    sale_price_customer: Optional[float] = None
    sale_price_pos: Optional[float] = None
    low_stock_numbered: Optional[int] = None
    low_stock_quantity: Optional[int] = None

class CardsAddNumbersIn(BaseModel):
    category_id: str
    numbers: List[str]

class CardsAddQtyIn(BaseModel):
    category_id: str
    quantity: int

class SaleItemIn(BaseModel):
    category_id: str
    category_name: Optional[str] = ""
    quantity: int
    price: float
    card_numbers: List[str] = []  # if selling numbered cards
    use_numbered: bool = False

class PurchaseItemIn(BaseModel):
    category_id: str
    category_name: Optional[str] = ""
    quantity: int
    price: float
    card_numbers: List[str] = []
    use_numbered: bool = False

class SaleIn(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = ""
    sale_type: str = ""  # cash / credit - required
    items: List[SaleItemIn]
    discount: float = 0
    paid: float = 0
    notes: Optional[str] = ""
    idempotency_key: Optional[str] = None
    local_id: Optional[str] = None
    device_id: Optional[str] = None

class PurchaseIn(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    items: List[SaleItemIn]
    discount: float = 0
    paid: float = 0
    notes: Optional[str] = ""
    idempotency_key: Optional[str] = None
    local_id: Optional[str] = None
    device_id: Optional[str] = None

class ReceiptIn(BaseModel):
    kind: str  # "receipt" (قبض) or "payment" (صرف)
    party_type: str  # customer / supplier
    party_id: str
    party_name: Optional[str] = ""
    amount: float
    description: Optional[str] = ""
    idempotency_key: Optional[str] = None

class CardOrderPublicLogin(BaseModel):
    phone: str
    password: str
    device_id: Optional[str] = None

class CardOrderRequest(BaseModel):
    phone: str
    password: str
    category_id: str
    quantity: int = 1

class CardOrderHistoryIn(BaseModel):
    phone: str
    password: str
    start: Optional[str] = None  # YYYY-MM-DD
    end: Optional[str] = None    # YYYY-MM-DD

class SettingsIn(BaseModel):
    low_stock_default: Optional[int] = None
    currency: Optional[str] = None
    logo_url: Optional[str] = None
    backup_email: Optional[str] = None
    backup_time: Optional[str] = None
    backup_auto: Optional[bool] = None


# ================= AUTH =================
@api.post("/auth/login")
async def login(data: LoginIn):
    user = await db.users.find_one({"username": data.username})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="بيانات الدخول غير صحيحة")
    if user.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    token = create_token(user["id"], user["username"])
    return {"token": token, "user": clean_doc({**user, "password_hash": None})}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    user.pop("password_hash", None)
    return user

@api.post("/auth/logout")
async def logout(user=Depends(get_current_user)):
    return {"ok": True}


# ================= USERS =================
@api.get("/users")
async def list_users(user=Depends(require_perm("users"))):
    users = await db.users.find({}, {"password_hash": 0}).to_list(1000)
    return [clean_doc(u) for u in users]

@api.post("/users")
async def create_user(data: UserIn, user=Depends(require_perm("users"))):
    if not data.password:
        raise HTTPException(status_code=400, detail="كلمة المرور مطلوبة")
    existing = await db.users.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="اسم المستخدم موجود مسبقاً")
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["password_hash"] = hash_password(data.password)
    doc.pop("password", None)
    doc["created_at"] = now_iso()
    doc["last_login"] = None
    await db.users.insert_one(doc)
    await audit_log(user, "create", "user", doc["id"], None, {"username": data.username})
    doc.pop("password_hash", None)
    return clean_doc(doc)

@api.put("/users/{uid}")
async def update_user(uid: str, data: UserIn, user=Depends(require_perm("users"))):
    update = data.model_dump()
    if data.password:
        update["password_hash"] = hash_password(data.password)
    update.pop("password", None)
    await db.users.update_one({"id": uid}, {"$set": update})
    await audit_log(user, "update", "user", uid, None, {"username": data.username})
    doc = await db.users.find_one({"id": uid}, {"password_hash": 0})
    return clean_doc(doc)

@api.delete("/users/{uid}")
async def disable_user(uid: str, user=Depends(require_perm("users"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="لا يمكن تعطيل حسابك")
    await db.users.update_one({"id": uid}, {"$set": {"status": "disabled"}})
    await audit_log(user, "disable", "user", uid)
    return {"ok": True}

@api.get("/users/permissions/list")
async def perms_list(user=Depends(get_current_user)):
    return ALL_PERMS


# ================= CUSTOMERS =================
@api.get("/customers")
async def list_customers(user=Depends(require_perm("customers"))):
    items = await db.customers.find().to_list(5000)
    return [clean_doc(c) for c in items]

@api.post("/customers")
async def create_customer(data: CustomerIn, user=Depends(require_perm("customers"))):
    if (data.phone or "").strip():
        exists = await db.customers.find_one({"phone": data.phone.strip()}, {"_id": 1})
        if exists:
            raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["password"] = data.password or random_password()
    doc["balance"] = data.opening_balance or 0
    doc["created_at"] = now_iso()
    doc["created_by"] = user.get("username")
    await db.customers.insert_one(doc)
    # Opening balance ledger entry
    if doc["balance"] != 0:
        await db.ledger.insert_one({
            "id": str(uuid.uuid4()), "party_type": "customer", "party_id": doc["id"],
            "op_number": "", "description": "رصيد افتتاحي",
            "debit": doc["balance"] if doc["balance"] > 0 else 0,
            "credit": abs(doc["balance"]) if doc["balance"] < 0 else 0,
            "balance": doc["balance"], "created_at": now_iso(),
        })
    await audit_log(user, "create", "customer", doc["id"], None, {"name": data.name})
    return clean_doc(doc)

@api.put("/customers/{cid}")
async def update_customer(cid: str, data: CustomerIn, user=Depends(require_perm("customers"))):
    if (data.phone or "").strip():
        clash = await db.customers.find_one(
            {"phone": data.phone.strip(), "id": {"$ne": cid}}, {"_id": 1}
        )
        if clash:
            raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    update = data.model_dump()
    if not data.password:
        update.pop("password", None)
    await db.customers.update_one({"id": cid}, {"$set": update})
    await audit_log(user, "update", "customer", cid)
    doc = await db.customers.find_one({"id": cid})
    return clean_doc(doc)

@api.delete("/customers/{cid}")
async def disable_customer(cid: str, user=Depends(require_perm("customers"))):
    await db.customers.update_one({"id": cid}, {"$set": {"status": "disabled"}})
    return {"ok": True}

@api.get("/customers/{cid}/statement")
async def customer_statement(cid: str, user=Depends(require_perm("customers"))):
    customer = await db.customers.find_one({"id": cid})
    if not customer:
        raise HTTPException(status_code=404, detail="غير موجود")
    entries = await db.ledger.find({"party_type": "customer", "party_id": cid}).sort("created_at", 1).to_list(10000)
    return {"customer": clean_doc(customer), "entries": [clean_doc(e) for e in entries]}


# ================= SUPPLIERS =================
@api.get("/suppliers")
async def list_suppliers(user=Depends(require_perm("suppliers"))):
    items = await db.suppliers.find().to_list(5000)
    return [clean_doc(s) for s in items]

@api.post("/suppliers")
async def create_supplier(data: SupplierIn, user=Depends(require_perm("suppliers"))):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["balance"] = data.opening_balance or 0
    doc["created_at"] = now_iso()
    await db.suppliers.insert_one(doc)
    if doc["balance"] != 0:
        await db.ledger.insert_one({
            "id": str(uuid.uuid4()), "party_type": "supplier", "party_id": doc["id"],
            "op_number": "", "description": "رصيد افتتاحي",
            "debit": doc["balance"] if doc["balance"] > 0 else 0,
            "credit": abs(doc["balance"]) if doc["balance"] < 0 else 0,
            "balance": doc["balance"], "created_at": now_iso(),
        })
    await audit_log(user, "create", "supplier", doc["id"])
    return clean_doc(doc)

@api.put("/suppliers/{sid}")
async def update_supplier(sid: str, data: SupplierIn, user=Depends(require_perm("suppliers"))):
    await db.suppliers.update_one({"id": sid}, {"$set": data.model_dump()})
    doc = await db.suppliers.find_one({"id": sid})
    return clean_doc(doc)

@api.delete("/suppliers/{sid}")
async def disable_supplier(sid: str, user=Depends(require_perm("suppliers"))):
    await db.suppliers.update_one({"id": sid}, {"$set": {"status": "disabled"}})
    return {"ok": True}

@api.get("/suppliers/{sid}/statement")
async def supplier_statement(sid: str, user=Depends(require_perm("suppliers"))):
    supplier = await db.suppliers.find_one({"id": sid})
    if not supplier:
        raise HTTPException(status_code=404, detail="غير موجود")
    entries = await db.ledger.find({"party_type": "supplier", "party_id": sid}).sort("created_at", 1).to_list(10000)
    return {"supplier": clean_doc(supplier), "entries": [clean_doc(e) for e in entries]}


# ================= CATEGORIES =================
@api.get("/categories")
async def list_categories(user=Depends(get_current_user)):
    items = await db.card_categories.find().to_list(500)
    return [clean_doc(c) for c in items]

@api.post("/categories")
async def create_category(data: CategoryIn, user=Depends(require_perm("categories"))):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.card_categories.insert_one(doc)
    return clean_doc(doc)

@api.put("/categories/{cid}")
async def update_category(cid: str, data: CategoryIn, user=Depends(require_perm("categories"))):
    await db.card_categories.update_one({"id": cid}, {"$set": data.model_dump()})
    doc = await db.card_categories.find_one({"id": cid})
    return clean_doc(doc)

@api.delete("/categories/{cid}")
async def delete_category(cid: str, user=Depends(require_perm("categories"))):
    # FK safety: check usage
    cards_count = await db.cards.count_documents({"category_id": cid})
    stock_doc = await db.stock.find_one({"category_id": cid})
    sales_use = await db.sales.count_documents({"items.category_id": cid})
    if cards_count > 0 or (stock_doc and stock_doc.get("total", 0) > 0) or sales_use > 0:
        # Soft-disable
        await db.card_categories.update_one({"id": cid}, {"$set": {"status": "disabled"}})
        await audit_log(user, "disable", "category", cid)
        return {"ok": True, "action": "disabled", "reason": "الفئة مرتبطة ببيانات سابقة، تم تعطيلها بدلاً من الحذف"}
    await db.card_categories.delete_one({"id": cid})
    await audit_log(user, "delete", "category", cid)
    return {"ok": True, "action": "deleted"}


# ================= CARDS =================
@api.get("/cards")
async def list_cards(status_filter: Optional[str] = None, category_id: Optional[str] = None, q: Optional[str] = None, user=Depends(require_perm("cards","stock"))):
    query: Dict[str, Any] = {}
    if status_filter: query["status"] = status_filter
    if category_id: query["category_id"] = category_id
    if q: query["number"] = {"$regex": q, "$options": "i"}
    items = await db.cards.find(query).limit(2000).to_list(2000)
    return [clean_doc(c) for c in items]

@api.post("/cards/add-numbers")
async def add_cards_numbers(data: CardsAddNumbersIn, user=Depends(require_perm("cards"))):
    cat = await db.card_categories.find_one({"id": data.category_id})
    if not cat:
        raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    # normalize
    seen = set()
    valid = []
    duplicates = []
    invalid = []
    for raw in data.numbers:
        n = (raw or "").strip()
        if not n: continue
        if not n.replace("-", "").replace(" ", "").isdigit() or len(n) < 4:
            invalid.append(n); continue
        if n in seen:
            duplicates.append(n); continue
        seen.add(n)
        # check DB
        exists = await db.cards.find_one({"number": n})
        if exists:
            duplicates.append(n); continue
        valid.append(n)
    docs = []
    for n in valid:
        docs.append({
            "id": str(uuid.uuid4()),
            "number": n,
            "category_id": data.category_id,
            "category_name": cat.get("name"),
            "status": "available",
            "type": "numbered",
            "created_at": now_iso(),
            "created_by": user.get("username"),
        })
    if docs:
        await db.cards.insert_many(docs)
    await audit_log(user, "add_cards", "cards", data.category_id, None, {"added": len(docs)})
    return {"added": len(docs), "duplicates": duplicates, "invalid": invalid}

@api.post("/cards/add-quantity")
async def add_cards_qty(data: CardsAddQtyIn, user=Depends(require_perm("cards"))):
    cat = await db.card_categories.find_one({"id": data.category_id})
    if not cat:
        raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    doc = await db.stock.find_one({"category_id": data.category_id})
    if doc:
        await db.stock.update_one({"category_id": data.category_id}, {"$inc": {"total": data.quantity}})
    else:
        await db.stock.insert_one({
            "id": str(uuid.uuid4()),
            "category_id": data.category_id,
            "category_name": cat.get("name"),
            "total": data.quantity,
            "sold": 0,
            "used": 0,
            "created_at": now_iso(),
        })
    return {"ok": True, "added": data.quantity}

@api.get("/cards/search/{number}")
async def find_card(number: str, user=Depends(require_perm("cards"))):
    card = await db.cards.find_one({"number": number})
    if not card:
        raise HTTPException(status_code=404, detail="الكرت غير موجود")
    return clean_doc(card)

@api.put("/cards/{card_id}/status")
async def update_card_status(card_id: str, new_status: str, user=Depends(require_perm("cards"))):
    await db.cards.update_one({"id": card_id}, {"$set": {"status": new_status}})
    return {"ok": True}

class CardEditIn(BaseModel):
    number: Optional[str] = None
    category_id: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

@api.put("/cards/{card_id}")
async def edit_card(card_id: str, data: CardEditIn, user=Depends(require_perm("cards"))):
    card = await db.cards.find_one({"id": card_id})
    if not card:
        raise HTTPException(status_code=404, detail="غير موجود")
    if card.get("status") in ("sold", "used") and (data.number or data.category_id):
        raise HTTPException(status_code=400, detail="لا يمكن تعديل رقم/فئة كرت مباع")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if data.number and data.number != card.get("number"):
        exists = await db.cards.find_one({"number": data.number, "id": {"$ne": card_id}})
        if exists:
            raise HTTPException(status_code=400, detail="رقم الكرت مكرر")
    if data.category_id:
        cat = await db.card_categories.find_one({"id": data.category_id})
        if cat: update["category_name"] = cat.get("name")
    await db.cards.update_one({"id": card_id}, {"$set": update})
    await audit_log(user, "update", "card", card_id, card, update)
    return {"ok": True}

@api.delete("/cards/{card_id}")
async def delete_card(card_id: str, user=Depends(require_perm("cards"))):
    card = await db.cards.find_one({"id": card_id})
    if not card:
        raise HTTPException(status_code=404, detail="غير موجود")
    if card.get("status") == "sold":
        await db.cards.update_one({"id": card_id}, {"$set": {"status": "cancelled"}})
        await audit_log(user, "cancel", "card", card_id)
        return {"ok": True, "action": "cancelled"}
    await db.cards.delete_one({"id": card_id})
    await audit_log(user, "delete", "card", card_id)
    return {"ok": True, "action": "deleted"}


# Change customer password (admin)
class PasswordIn(BaseModel):
    password: str

@api.post("/customers/{cid}/password")
async def admin_set_customer_password(cid: str, data: PasswordIn, user=Depends(require_perm("customers"))):
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="كلمة المرور قصيرة جداً")
    r = await db.customers.update_one({"id": cid}, {"$set": {"password": data.password}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="غير موجود")
    await audit_log(user, "reset_password", "customer", cid)
    return {"ok": True}


# Customer self-service password change
class CustomerChangePwd(BaseModel):
    phone: str
    current_password: str
    new_password: str

@api.post("/public/customer/change-password")
async def customer_change_password(data: CustomerChangePwd):
    if len(data.new_password) < 4:
        raise HTTPException(status_code=400, detail="كلمة المرور الجديدة قصيرة جداً (4 أحرف على الأقل)")
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    if customer.get("password") != data.current_password:
        raise HTTPException(status_code=401, detail="كلمة المرور الحالية غير صحيحة")
    await db.customers.update_one({"id": customer["id"]}, {"$set": {"password": data.new_password}})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": customer["id"], "username": customer["name"],
        "action": "self_change_password", "entity": "customer", "entity_id": customer["id"],
        "created_at": now_iso(),
    })
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "تغيير كلمة المرور",
        "message": f"قام العميل {customer.get('name','')} بتغيير كلمة المرور الخاصة به. الهاتف: {customer.get('phone','')}",
        "type": "info", "read": False, "created_at": now_iso(),
    })
    return {"ok": True}


# Forgot password - lookup and return WhatsApp payload
class ForgotIn(BaseModel):
    phone: str

@api.post("/public/customer/forgot-password")
async def customer_forgot(data: ForgotIn):
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    return {
        "name": customer.get("name"), "phone": customer.get("phone"),
        "address": customer.get("address", ""),
    }


# Public account registration request - only creates a pending request record
class RegisterRequest(BaseModel):
    full_name: str
    phone: str
    address: Optional[str] = ""

@api.post("/public/customer/register-request")
async def register_request(data: RegisterRequest):
    if len(data.full_name.strip()) < 3:
        raise HTTPException(status_code=400, detail="الاسم غير صحيح")
    if len(data.phone.strip()) < 7:
        raise HTTPException(status_code=400, detail="رقم الهاتف غير صحيح")
    existing = await db.customers.find_one({"phone": data.phone.strip()}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    doc = {
        "id": str(uuid.uuid4()), "full_name": data.full_name, "phone": data.phone,
        "address": data.address, "status": "pending", "created_at": now_iso(),
    }
    await db.register_requests.insert_one(doc)
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "طلب حساب جديد",
        "message": f"{data.full_name} ({data.phone}) يطلب إنشاء حساب",
        "type": "info", "read": False, "created_at": now_iso(),
    })
    return {"ok": True}


# Card order attempts log
@api.get("/reports/card-order-log")
async def card_order_log(user=Depends(require_perm("reports"))):
    items = await db.card_order_attempts.find().sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(a) for a in items]

# Electronic sales report (public order source)
@api.get("/reports/electronic-sales")
async def electronic_sales(user=Depends(require_perm("reports"))):
    items = await db.sales.find({"source": "public_order", "status": "active"}).sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(s) for s in items]


# ================= STOCK =================
@api.get("/stock")
async def stock_report(user=Depends(require_perm("stock"))):
    cats = await db.card_categories.find().to_list(500)
    result = []
    for cat in cats:
        cat = clean_doc(cat)
        # numbered cards
        avail = await db.cards.count_documents({"category_id": cat["id"], "status": "available"})
        sold = await db.cards.count_documents({"category_id": cat["id"], "status": "sold"})
        used = await db.cards.count_documents({"category_id": cat["id"], "status": "used"})
        total_num = await db.cards.count_documents({"category_id": cat["id"]})
        # qty stock
        qs = await db.stock.find_one({"category_id": cat["id"]})
        qty_total = (qs or {}).get("total", 0)
        qty_sold = (qs or {}).get("sold", 0)
        threshold = cat.get("low_stock_threshold", 20)
        available_total = avail + max(0, qty_total - qty_sold)
        result.append({
            "category_id": cat["id"],
            "category_name": cat["name"],
            "sale_price": cat.get("sale_price", 0),
            "numbered": {"total": total_num, "available": avail, "sold": sold, "used": used},
            "quantity": {"total": qty_total, "sold": qty_sold, "available": max(0, qty_total - qty_sold)},
            "available_total": available_total,
            "low_stock": available_total <= threshold,
            "threshold": threshold,
        })
    return result


# ================= SALES =================
async def _adjust_party_balance(party_type: str, party_id: str, amount: float, op_number: str, description: str):
    """Positive amount = increase debt to us (sale). Negative = decrease debt (receipt)."""
    collection = db.customers if party_type == "customer" else db.suppliers
    doc = await collection.find_one({"id": party_id})
    if not doc: return None
    new_balance = doc.get("balance", 0) + amount
    await collection.update_one({"id": party_id}, {"$set": {"balance": new_balance}})
    await db.ledger.insert_one({
        "id": str(uuid.uuid4()),
        "party_type": party_type, "party_id": party_id,
        "op_number": op_number, "description": description,
        "debit": amount if amount > 0 else 0,
        "credit": abs(amount) if amount < 0 else 0,
        "balance": new_balance,
        "created_at": now_iso(),
    })
    return new_balance


@api.post("/sales")
async def create_sale(data: SaleIn, user=Depends(require_perm("sales"))):
    # Idempotency
    if data.idempotency_key:
        existing = await db.sales.find_one({"idempotency_key": data.idempotency_key})
        if existing:
            return clean_doc(existing)
    # Mandatory validations
    if not data.customer_id:
        raise HTTPException(status_code=400, detail="يرجى اختيار العميل قبل حفظ الفاتورة.")
    if data.sale_type not in ("cash", "credit"):
        raise HTTPException(status_code=400, detail="يرجى اختيار نوع الفاتورة: نقد أو آجل.")

    # Compute totals & validate stock
    subtotal = 0.0
    items_final = []
    for item in data.items:
        line_total = item.quantity * item.price
        subtotal += line_total
        items_final.append({**item.model_dump(), "total": line_total})

    total = subtotal - (data.discount or 0)
    remaining = total - (data.paid or 0)

    # Customer limit check
    customer = None
    if data.customer_id:
        customer = await db.customers.find_one({"id": data.customer_id})
        if customer and remaining > 0:
            limit = customer.get("credit_limit", 0)
            new_balance = customer.get("balance", 0) + remaining
            if limit > 0 and new_balance > limit:
                raise HTTPException(status_code=400, detail=f"لا يمكن تنفيذ العملية لأنها تتجاوز سقف حساب العميل ({limit})")

    # Auto-pricing based on customer_type if price not set explicitly per item
    if customer:
        ctype = customer.get("customer_type", "customer")
        for i, item in enumerate(data.items):
            if item.price <= 0:
                cat = await db.card_categories.find_one({"id": item.category_id})
                if cat:
                    p = cat.get("sale_price_pos") if ctype == "pos" else cat.get("sale_price_customer")
                    if p is None: p = cat.get("sale_price", 0)
                    items_final[i]["price"] = p
                    items_final[i]["total"] = items_final[i]["quantity"] * p

    # Reserve/mark cards (numbered) and quantity stock
    for item in data.items:
        if item.use_numbered and item.card_numbers:
            # Ensure all requested cards are available
            for n in item.card_numbers:
                card = await db.cards.find_one({"number": n, "status": "available"})
                if not card:
                    raise HTTPException(status_code=400, detail=f"الكرت {n} غير متوفر")
            # Mark all as sold
            await db.cards.update_many(
                {"number": {"$in": item.card_numbers}, "status": "available"},
                {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": data.customer_id}},
            )
        else:
            # quantity stock decrement
            stock = await db.stock.find_one({"category_id": item.category_id})
            avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
            # try to also decrement numbered available if requested via qty but no numbers
            numbered_avail = await db.cards.count_documents({"category_id": item.category_id, "status": "available"})
            if avail + numbered_avail < item.quantity:
                raise HTTPException(status_code=400, detail=f"الكمية غير متوفرة للفئة")
            take_from_qty = min(item.quantity, avail)
            if take_from_qty > 0:
                await db.stock.update_one({"category_id": item.category_id}, {"$inc": {"sold": take_from_qty}})
            take_from_numbered = item.quantity - take_from_qty
            if take_from_numbered > 0:
                pending = await db.cards.find({"category_id": item.category_id, "status": "available"}).limit(take_from_numbered).to_list(take_from_numbered)
                ids = [c["id"] for c in pending]
                await db.cards.update_many({"id": {"$in": ids}}, {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": data.customer_id}})

    number = await next_gwd_number()
    doc = {
        "id": str(uuid.uuid4()),
        "number": number,
        "type": "sale",
        "customer_id": data.customer_id,
        "customer_name": data.customer_name,
        "sale_type": data.sale_type,
        "items": items_final,
        "subtotal": subtotal,
        "discount": data.discount or 0,
        "total": total,
        "paid": data.paid or 0,
        "remaining": remaining,
        "notes": data.notes,
        "user_id": user["id"],
        "username": user.get("username"),
        "status": "active",
        "idempotency_key": data.idempotency_key,
        "local_id": data.local_id,
        "device_id": data.device_id,
        "created_at": now_iso(),
    }
    await db.sales.insert_one(doc)

    balance_after = None
    if data.customer_id and remaining > 0:
        balance_after = await _adjust_party_balance("customer", data.customer_id, remaining, number, f"فاتورة مبيعات {number}")
    elif data.customer_id and data.paid and data.paid > 0:
        # cash sale for a customer - record as offset if desired (skipping to keep balance clean)
        pass

    await audit_log(user, "create", "sale", doc["id"], None, {"number": number, "total": total})
    await notify(f"فاتورة {number}", f"تم إنشاء فاتورة مبيعات بإجمالي {total}", "info")

    return clean_doc({**doc, "balance_after": balance_after})


@api.get("/sales")
async def list_sales(q: Optional[str] = None, user=Depends(require_perm("sales"))):
    query: Dict[str, Any] = {}
    if q: query["number"] = {"$regex": q, "$options": "i"}
    items = await db.sales.find(query).sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(s) for s in items]

@api.get("/sales/{sid}")
async def get_sale(sid: str, user=Depends(require_perm("sales"))):
    doc = await db.sales.find_one({"$or": [{"id": sid}, {"number": sid}]})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    return clean_doc(doc)

@api.post("/sales/{sid}/cancel")
async def cancel_sale(sid: str, user=Depends(require_perm("delete_ops"))):
    doc = await db.sales.find_one({"id": sid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") == "cancelled":
        return clean_doc(doc)
    await db.sales.update_one({"id": sid}, {"$set": {"status": "cancelled", "cancelled_at": now_iso()}})
    # reverse balance
    if doc.get("customer_id") and doc.get("remaining", 0) > 0:
        await _adjust_party_balance("customer", doc["customer_id"], -doc["remaining"], doc["number"], f"إلغاء فاتورة {doc['number']}")
    await audit_log(user, "cancel", "sale", sid)
    return {"ok": True}


class SaleEditIn(BaseModel):
    # legacy quick edit (still supported for partial updates)
    discount: Optional[float] = None
    paid: Optional[float] = None
    notes: Optional[str] = None
    # full edit (optional). When provided we reverse the old inventory/balance
    # effect and re-apply the new one atomically.
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    sale_type: Optional[str] = None
    items: Optional[List[SaleItemIn]] = None


async def _reverse_sale_inventory(items: list):
    for it in items or []:
        cards = it.get("card_numbers") or []
        if cards:
            await db.cards.update_many(
                {"number": {"$in": cards}},
                {"$set": {"status": "available", "sold_at": None, "sold_to": None}},
            )
        residual = int(it.get("quantity", 0)) - len(cards)
        if residual > 0:
            await db.stock.update_one(
                {"category_id": it.get("category_id")},
                {"$inc": {"sold": -residual}},
            )


@api.put("/sales/{sid}")
async def edit_sale(sid: str, data: SaleEditIn, user=Depends(require_perm("edit_ops"))):
    doc = await db.sales.find_one({"id": sid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "active":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل فاتورة ملغاة")

    # --------- FULL EDIT PATH (items provided) ---------
    if data.items is not None:
        new_customer_id = data.customer_id or doc.get("customer_id")
        new_sale_type = data.sale_type or doc.get("sale_type", "credit")
        if new_sale_type not in ("cash", "credit"):
            raise HTTPException(status_code=400, detail="نوع الفاتورة غير صحيح")
        # 1) reverse OLD inventory + balance
        await _reverse_sale_inventory(doc.get("items") or [])
        if doc.get("customer_id") and doc.get("remaining", 0):
            await _adjust_party_balance(
                "customer", doc["customer_id"], -float(doc.get("remaining") or 0),
                doc["number"], f"عكس تأثير الفاتورة {doc['number']} للتعديل",
            )
        # 2) compute new totals
        subtotal = 0.0
        items_final = []
        for it in data.items:
            line_total = it.quantity * it.price
            subtotal += line_total
            items_final.append({**it.model_dump(), "total": line_total})
        new_discount = float(data.discount if data.discount is not None else doc.get("discount", 0) or 0)
        new_paid = float(data.paid if data.paid is not None else doc.get("paid", 0) or 0)
        new_total = subtotal - new_discount
        new_remaining = new_total - new_paid
        # 3) credit limit check on new customer
        if new_customer_id and new_remaining > 0:
            cust = await db.customers.find_one({"id": new_customer_id})
            if cust:
                limit = cust.get("credit_limit", 0)
                if limit and cust.get("balance", 0) + new_remaining > limit:
                    # rollback the reversal we just did to keep DB consistent
                    if doc.get("customer_id") and doc.get("remaining", 0):
                        await _adjust_party_balance(
                            "customer", doc["customer_id"], float(doc.get("remaining") or 0),
                            doc["number"], f"استرجاع تأثير الفاتورة {doc['number']} بعد فشل التعديل",
                        )
                    # restore inventory
                    for it in doc.get("items") or []:
                        cards = it.get("card_numbers") or []
                        if cards:
                            await db.cards.update_many(
                                {"number": {"$in": cards}},
                                {"$set": {"status": "sold", "sold_to": doc.get("customer_id")}},
                            )
                        residual = int(it.get("quantity", 0)) - len(cards)
                        if residual > 0:
                            await db.stock.update_one({"category_id": it.get("category_id")}, {"$inc": {"sold": residual}})
                    raise HTTPException(status_code=400, detail=f"لا يمكن تنفيذ التعديل لأنه يتجاوز سقف حساب العميل ({limit})")
        # 4) apply NEW inventory (same rules as create_sale)
        for item in data.items:
            if item.use_numbered and item.card_numbers:
                for n in item.card_numbers:
                    card = await db.cards.find_one({"number": n, "status": "available"})
                    if not card:
                        raise HTTPException(status_code=400, detail=f"الكرت {n} غير متوفر")
                await db.cards.update_many(
                    {"number": {"$in": item.card_numbers}, "status": "available"},
                    {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": new_customer_id}},
                )
            else:
                stock = await db.stock.find_one({"category_id": item.category_id})
                avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
                numbered_avail = await db.cards.count_documents({"category_id": item.category_id, "status": "available"})
                if avail + numbered_avail < item.quantity:
                    raise HTTPException(status_code=400, detail=f"الكمية غير متوفرة للفئة")
                take_from_qty = min(item.quantity, avail)
                if take_from_qty > 0:
                    await db.stock.update_one({"category_id": item.category_id}, {"$inc": {"sold": take_from_qty}})
                take_from_numbered = item.quantity - take_from_qty
                if take_from_numbered > 0:
                    pending = await db.cards.find({"category_id": item.category_id, "status": "available"}).limit(take_from_numbered).to_list(take_from_numbered)
                    ids = [c["id"] for c in pending]
                    await db.cards.update_many({"id": {"$in": ids}}, {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": new_customer_id}})
        # 5) apply NEW balance
        balance_after = None
        if new_customer_id and new_remaining > 0:
            balance_after = await _adjust_party_balance(
                "customer", new_customer_id, new_remaining,
                doc["number"], f"تعديل فاتورة {doc['number']}",
            )
        # 6) update the doc, keep same id + number + created_at
        cust_name = data.customer_name
        if new_customer_id and not cust_name:
            _c = await db.customers.find_one({"id": new_customer_id})
            cust_name = (_c or {}).get("name", doc.get("customer_name") or "")
        update = {
            "customer_id": new_customer_id, "customer_name": cust_name or doc.get("customer_name"),
            "sale_type": new_sale_type, "items": items_final,
            "subtotal": subtotal, "discount": new_discount, "total": new_total,
            "paid": new_paid, "remaining": new_remaining,
            "notes": data.notes if data.notes is not None else doc.get("notes"),
            "edited_at": now_iso(), "edited_by": user.get("username"),
        }
        await db.sales.update_one({"id": sid}, {"$set": update})
        await audit_log(user, "edit", "sale", sid,
                        {"customer_id": doc.get("customer_id"), "total": doc.get("total"), "items": doc.get("items")},
                        {"customer_id": new_customer_id, "total": new_total, "items": items_final})
        return {"ok": True, "balance_after": balance_after, "number": doc.get("number")}

    # --------- LEGACY QUICK EDIT PATH (discount/paid/notes only) ---------
    subtotal = doc.get("subtotal", 0)
    new_discount = data.discount if data.discount is not None else doc.get("discount", 0)
    new_paid = data.paid if data.paid is not None else doc.get("paid", 0)
    new_total = subtotal - new_discount
    new_remaining = new_total - new_paid
    old_remaining = doc.get("remaining", 0)
    diff = new_remaining - old_remaining
    if doc.get("customer_id") and diff != 0:
        customer = await db.customers.find_one({"id": doc["customer_id"]})
        if customer:
            limit = customer.get("credit_limit", 0)
            if limit > 0 and customer.get("balance", 0) + diff > limit:
                raise HTTPException(status_code=400, detail="التعديل يتجاوز سقف حساب العميل")
        await _adjust_party_balance("customer", doc["customer_id"], diff, doc["number"], f"تعديل فاتورة {doc['number']}")
    update = {"discount": new_discount, "paid": new_paid, "total": new_total, "remaining": new_remaining,
              "notes": data.notes if data.notes is not None else doc.get("notes"),
              "edited_at": now_iso(), "edited_by": user.get("username")}
    await db.sales.update_one({"id": sid}, {"$set": update})
    await audit_log(user, "edit", "sale", sid, {"old": {"discount": doc.get("discount"), "paid": doc.get("paid")}}, update)
    return {"ok": True}


class ReceiptEditIn(BaseModel):
    amount: Optional[float] = None
    description: Optional[str] = None

@api.put("/receipts/{rid}")
async def edit_receipt(rid: str, data: ReceiptEditIn, user=Depends(require_perm("edit_ops"))):
    doc = await db.receipts.find_one({"id": rid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    old_amount = doc.get("amount", 0)
    new_amount = data.amount if data.amount is not None else old_amount
    diff = new_amount - old_amount
    if diff != 0:
        # receipts subtract from balance; increasing amount subtracts more (negative delta)
        sign = -1 if doc.get("kind") in ("receipt", "payment") else 1
        await _adjust_party_balance(doc["party_type"], doc["party_id"], sign * diff, doc["number"], f"تعديل سند {doc['number']}")
    update = {"amount": new_amount,
              "description": data.description if data.description is not None else doc.get("description"),
              "edited_at": now_iso(), "edited_by": user.get("username")}
    await db.receipts.update_one({"id": rid}, {"$set": update})
    await audit_log(user, "edit", "receipt", rid, {"old_amount": old_amount}, {"new_amount": new_amount})
    return {"ok": True}


# List customers with blocked info
@api.get("/customers/blocked/list")
async def blocked_customers(user=Depends(require_perm("customers"))):
    now = now_iso()
    blocks = await db.public_blocks.find({"blocked_until": {"$gt": now}}).to_list(1000)
    result = []
    for b in blocks:
        cust = await db.customers.find_one({"phone": b.get("phone")})
        result.append({
            "phone": b.get("phone"),
            "customer_name": (cust or {}).get("name", "غير معروف"),
            "customer_id": (cust or {}).get("id"),
            "failed_before_block": 5,
            "blocked_at": b.get("blocked_at"),
            "blocked_until": b.get("blocked_until"),
        })
    return result


# ================= PURCHASES =================
@api.post("/purchases")
async def create_purchase(data: PurchaseIn, user=Depends(require_perm("purchases"))):
    if data.idempotency_key:
        existing = await db.purchases.find_one({"idempotency_key": data.idempotency_key})
        if existing:
            return clean_doc(existing)

    subtotal = 0.0
    items_final = []
    for item in data.items:
        line_total = item.quantity * item.price
        subtotal += line_total
        items_final.append({**item.model_dump(), "total": line_total})
        cat = await db.card_categories.find_one({"id": item.category_id})
        if not cat: continue
        # If numbered cards provided, insert them into inventory
        if item.use_numbered and item.card_numbers:
            for n in item.card_numbers:
                n = (n or "").strip()
                if not n: continue
                exists = await db.cards.find_one({"number": n})
                if exists: continue  # skip duplicates silently
                await db.cards.insert_one({
                    "id": str(uuid.uuid4()), "number": n,
                    "category_id": item.category_id, "category_name": cat.get("name"),
                    "status": "available", "type": "numbered",
                    "purchase_price": item.price,
                    "supplier_id": data.supplier_id,
                    "created_at": now_iso(), "created_by": user.get("username"),
                })
        else:
            stock = await db.stock.find_one({"category_id": item.category_id})
            if stock:
                await db.stock.update_one({"category_id": item.category_id}, {"$inc": {"total": item.quantity}})
            else:
                await db.stock.insert_one({
                    "id": str(uuid.uuid4()), "category_id": item.category_id,
                    "category_name": cat.get("name"),
                    "total": item.quantity, "sold": 0, "used": 0, "created_at": now_iso(),
                })
    total = subtotal - (data.discount or 0)
    remaining = total - (data.paid or 0)
    number = await next_gwd_number()
    doc = {
        "id": str(uuid.uuid4()),
        "number": number, "type": "purchase",
        "supplier_id": data.supplier_id, "supplier_name": data.supplier_name,
        "items": items_final, "subtotal": subtotal, "discount": data.discount or 0,
        "total": total, "paid": data.paid or 0, "remaining": remaining,
        "notes": data.notes, "user_id": user["id"], "username": user.get("username"),
        "status": "active", "idempotency_key": data.idempotency_key,
        "local_id": data.local_id, "device_id": data.device_id,
        "created_at": now_iso(),
    }
    await db.purchases.insert_one(doc)
    balance_after = None
    if data.supplier_id and remaining > 0:
        balance_after = await _adjust_party_balance("supplier", data.supplier_id, remaining, number, f"فاتورة مشتريات {number}")
    await audit_log(user, "create", "purchase", doc["id"])
    await notify(f"مشتريات {number}", f"تم تسجيل فاتورة مشتريات بإجمالي {total}", "info")
    return clean_doc({**doc, "balance_after": balance_after})

class PurchaseEditIn(BaseModel):
    discount: Optional[float] = None
    paid: Optional[float] = None
    notes: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    items: Optional[List[SaleItemIn]] = None


async def _reverse_purchase_inventory(items: list, purchase_id: str):
    for it in items or []:
        cards = it.get("card_numbers") or []
        if it.get("use_numbered") and cards:
            # Delete cards that came from this purchase AND are still available
            await db.cards.delete_many({"number": {"$in": cards}, "status": "available"})
        else:
            # decrement stock.total by qty (but never below current sold)
            stock = await db.stock.find_one({"category_id": it.get("category_id")})
            if stock:
                new_total = max(stock.get("sold", 0), stock.get("total", 0) - int(it.get("quantity", 0)))
                await db.stock.update_one({"category_id": it.get("category_id")}, {"$set": {"total": new_total}})


@api.put("/purchases/{pid}")
async def edit_purchase(pid: str, data: PurchaseEditIn, user=Depends(require_perm("edit_ops"))):
    doc = await db.purchases.find_one({"id": pid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "active":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل فاتورة ملغاة")

    # --------- FULL EDIT PATH ---------
    if data.items is not None:
        new_supplier_id = data.supplier_id or doc.get("supplier_id")
        # 1) reverse OLD inventory + supplier balance
        await _reverse_purchase_inventory(doc.get("items") or [], pid)
        if doc.get("supplier_id") and doc.get("remaining", 0):
            await _adjust_party_balance(
                "supplier", doc["supplier_id"], -float(doc.get("remaining") or 0),
                doc["number"], f"عكس تأثير فاتورة المشتريات {doc['number']} للتعديل",
            )
        # 2) compute new totals + apply new inventory
        subtotal = 0.0
        items_final = []
        for it in data.items:
            line_total = it.quantity * it.price
            subtotal += line_total
            items_final.append({**it.model_dump(), "total": line_total})
            cat = await db.card_categories.find_one({"id": it.category_id})
            if not cat:
                continue
            if it.use_numbered and it.card_numbers:
                for n in it.card_numbers:
                    n = (n or "").strip()
                    if not n: continue
                    exists = await db.cards.find_one({"number": n})
                    if exists: continue
                    await db.cards.insert_one({
                        "id": str(uuid.uuid4()), "number": n,
                        "category_id": it.category_id, "category_name": cat.get("name"),
                        "status": "available", "type": "numbered",
                        "purchase_price": it.price,
                        "supplier_id": new_supplier_id,
                        "source_purchase_id": pid,
                        "created_at": now_iso(), "created_by": user.get("username"),
                    })
            else:
                stock = await db.stock.find_one({"category_id": it.category_id})
                if stock:
                    await db.stock.update_one({"category_id": it.category_id}, {"$inc": {"total": it.quantity}})
                else:
                    await db.stock.insert_one({
                        "id": str(uuid.uuid4()), "category_id": it.category_id,
                        "category_name": cat.get("name"),
                        "total": it.quantity, "sold": 0, "used": 0, "created_at": now_iso(),
                    })
        new_discount = float(data.discount if data.discount is not None else doc.get("discount", 0) or 0)
        new_paid = float(data.paid if data.paid is not None else doc.get("paid", 0) or 0)
        new_total = subtotal - new_discount
        new_remaining = new_total - new_paid
        # 3) apply new supplier balance
        balance_after = None
        if new_supplier_id and new_remaining > 0:
            balance_after = await _adjust_party_balance(
                "supplier", new_supplier_id, new_remaining,
                doc["number"], f"تعديل فاتورة مشتريات {doc['number']}",
            )
        # 4) update the doc
        sup_name = data.supplier_name
        if new_supplier_id and not sup_name:
            _s = await db.suppliers.find_one({"id": new_supplier_id})
            sup_name = (_s or {}).get("name", doc.get("supplier_name") or "")
        update = {
            "supplier_id": new_supplier_id, "supplier_name": sup_name or doc.get("supplier_name"),
            "items": items_final,
            "subtotal": subtotal, "discount": new_discount, "total": new_total,
            "paid": new_paid, "remaining": new_remaining,
            "notes": data.notes if data.notes is not None else doc.get("notes"),
            "edited_at": now_iso(), "edited_by": user.get("username"),
        }
        await db.purchases.update_one({"id": pid}, {"$set": update})
        await audit_log(user, "edit", "purchase", pid,
                        {"supplier_id": doc.get("supplier_id"), "total": doc.get("total"), "items": doc.get("items")},
                        {"supplier_id": new_supplier_id, "total": new_total, "items": items_final})
        return {"ok": True, "balance_after": balance_after, "number": doc.get("number")}

    # --------- LEGACY QUICK EDIT ---------
    subtotal = doc.get("subtotal", 0)
    new_discount = data.discount if data.discount is not None else doc.get("discount", 0)
    new_paid = data.paid if data.paid is not None else doc.get("paid", 0)
    new_total = subtotal - new_discount
    new_remaining = new_total - new_paid
    old_remaining = doc.get("remaining", 0)
    diff = new_remaining - old_remaining
    if doc.get("supplier_id") and diff != 0:
        await _adjust_party_balance("supplier", doc["supplier_id"], diff, doc["number"], f"تعديل فاتورة مشتريات {doc['number']}")
    update = {"discount": new_discount, "paid": new_paid, "total": new_total, "remaining": new_remaining,
              "notes": data.notes if data.notes is not None else doc.get("notes"),
              "edited_at": now_iso(), "edited_by": user.get("username")}
    await db.purchases.update_one({"id": pid}, {"$set": update})
    await audit_log(user, "edit", "purchase", pid, {"old_total": doc.get("total")}, {"new_total": new_total})
    return {"ok": True}


@api.get("/purchases")
async def list_purchases(user=Depends(require_perm("purchases"))):
    items = await db.purchases.find().sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(p) for p in items]

@api.get("/purchases/{pid}")
async def get_purchase(pid: str, user=Depends(require_perm("purchases"))):
    doc = await db.purchases.find_one({"$or": [{"id": pid}, {"number": pid}]})
    if not doc: raise HTTPException(status_code=404)
    return clean_doc(doc)


# ================= RECEIPTS =================
@api.post("/receipts")
async def create_receipt(data: ReceiptIn, user=Depends(require_perm("receipts"))):
    if data.idempotency_key:
        existing = await db.receipts.find_one({"idempotency_key": data.idempotency_key})
        if existing: return clean_doc(existing)
    number = await next_gwd_number()
    # kind=receipt (قبض): reduce customer debt (-) or supplier balance
    # kind=payment (صرف): reduce supplier debt / customer prepay
    if data.kind == "receipt":
        amount_sign = -data.amount  # from customer, decreases their debt to us
    else:
        amount_sign = -data.amount  # payment to supplier, decreases what we owe them
    balance_after = await _adjust_party_balance(data.party_type, data.party_id, amount_sign, number, data.description or ("سند قبض" if data.kind=="receipt" else "سند صرف"))
    doc = {
        "id": str(uuid.uuid4()), "number": number,
        "type": "receipt_voucher" if data.kind == "receipt" else "payment_voucher",
        "kind": data.kind,
        "party_type": data.party_type, "party_id": data.party_id, "party_name": data.party_name,
        "amount": data.amount, "description": data.description,
        "user_id": user["id"], "username": user.get("username"),
        "status": "active", "idempotency_key": data.idempotency_key,
        "balance_after": balance_after,
        "created_at": now_iso(),
    }
    await db.receipts.insert_one(doc)
    await audit_log(user, "create", "receipt", doc["id"])
    return clean_doc(doc)

@api.get("/receipts")
async def list_receipts(user=Depends(require_perm("receipts"))):
    items = await db.receipts.find().sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(r) for r in items]


# ================= CARD ORDERS (PUBLIC) =================
@api.post("/public/card-order/login")
async def public_login(data: CardOrderPublicLogin):
    # Rate limit: 5 failed in 24h => block
    blocks = await db.public_blocks.find_one({"phone": data.phone})
    if blocks and blocks.get("blocked_until") and blocks["blocked_until"] > now_iso():
        raise HTTPException(status_code=429, detail=f"تم حظر الإدخال بسبب تجاوز عدد المحاولات الفاشلة. مدة الحظر: 24 ساعة")
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "phone": data.phone, "status": "rejected_not_found",
            "reason": "العميل غير موجود", "created_at": now_iso(),
        })
        # Count non-existent-phone attempts toward the same rate limit
        cur = await db.public_blocks.find_one({"phone": data.phone}) or {}
        failed = cur.get("failed", 0) + 1
        update = {"phone": data.phone, "failed": failed, "last_failed_at": now_iso()}
        if failed >= 5:
            block_until = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
            update["blocked_until"] = block_until
            update["blocked_at"] = now_iso()
            update["failed"] = 0
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "title": "تم حظر رقم غير مسجل",
                "message": f"تم حظر الرقم {data.phone} بسبب تجاوز عدد المحاولات الفاشلة (رقم غير مسجل). مدة الحظر: 24 ساعة.",
                "type": "warning", "read": False, "created_at": now_iso(),
            })
        await db.public_blocks.update_one({"phone": data.phone}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    if customer.get("password") != data.password:
        # increment failed counter
        cur = await db.public_blocks.find_one({"phone": data.phone}) or {}
        failed = cur.get("failed", 0) + 1
        update = {"phone": data.phone, "failed": failed, "last_failed_at": now_iso()}
        if failed >= 5:
            block_until = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
            update["blocked_until"] = block_until
            update["blocked_at"] = now_iso()
            update["failed"] = 0
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "title": "تم حظر عميل",
                "message": f"تم حظر العميل {customer.get('name','')} ({data.phone}) بسبب تجاوز عدد المحاولات الفاشلة. مدة الحظر: 24 ساعة.",
                "type": "warning", "read": False, "created_at": now_iso(),
            })
        await db.public_blocks.update_one({"phone": data.phone}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")
    # Device binding check (single field, no extra query). First-time binds silently.
    bound = customer.get("bound_device")
    incoming = (data.device_id or "").strip()
    if bound and incoming and bound != incoming:
        # Do NOT count as a password-failed attempt; the password was correct.
        raise HTTPException(
            status_code=403,
            detail="الهاتف غير مرتبط بالحساب. إذا قمت باستبدال هاتفك القديم، يرجى التواصل مع خدمة العملاء لطلب كلمة المرور.",
        )
    if not bound and incoming:
        await db.customers.update_one(
            {"id": customer["id"]},
            {"$set": {"bound_device": incoming, "bound_device_at": now_iso()}},
        )
    # reset failed counter on success
    await db.public_blocks.update_one({"phone": data.phone}, {"$set": {"failed": 0}}, upsert=True)
    return {
        "id": customer["id"], "name": customer["name"], "phone": customer["phone"],
        "credit_limit": customer.get("credit_limit", 0), "balance": customer.get("balance", 0),
        "customer_type": customer.get("customer_type", "customer"),
        "available": max(0, customer.get("credit_limit", 0) - customer.get("balance", 0)),
    }

@api.post("/public/card-order/request")
async def public_order(data: CardOrderRequest):
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "phone": data.phone, "status": "rejected_not_found",
            "reason": "العميل غير موجود", "created_at": now_iso(),
        })
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    if customer.get("password") != data.password:
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    cat = await db.card_categories.find_one({"id": data.category_id})
    if not cat: raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    # Pick price according to customer type (POS vs regular customer)
    ctype = customer.get("customer_type", "customer")
    unit_price = cat.get("sale_price_pos") if ctype == "pos" else cat.get("sale_price_customer")
    if unit_price is None:
        unit_price = cat.get("sale_price", 0)
    total = unit_price * data.quantity
    limit = customer.get("credit_limit", 0)
    balance = customer.get("balance", 0)
    if limit > 0 and balance + total > limit:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
            "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
            "quantity": data.quantity, "total": total, "status": "rejected_over_limit",
            "reason": "تجاوز السقف المسموح", "created_at": now_iso(),
        })
        raise HTTPException(status_code=400, detail="عذراً، لا يمكن تنفيذ الطلب تم تجاوز السقف المسموح الرجى سرعة سداد المبلغ الذي عليكم لتتمكن من الطلب مجدداً.")
    # Reserve NUMBERED cards ONLY. This endpoint never falls back to quantity stock.
    numbered_avail = await db.cards.count_documents({"category_id": data.category_id, "status": "available"})
    if numbered_avail < data.quantity:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
            "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
            "quantity": data.quantity, "total": total, "status": "rejected_no_stock",
            "reason": "لا تتوفر كمية الكروت المطلوبة", "created_at": now_iso(),
        })
        raise HTTPException(status_code=400, detail="لا تتوفر كمية الكروت المطلوبة")

    cards_reserved = []
    numbered = await db.cards.find({"category_id": data.category_id, "status": "available"}).limit(data.quantity).to_list(data.quantity)
    for c in numbered:
        r = await db.cards.update_one({"id": c["id"], "status": "available"}, {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": customer["id"]}})
        if r.modified_count == 1:
            cards_reserved.append(c["number"])
    if len(cards_reserved) < data.quantity:
        # Race condition — someone else consumed cards concurrently. Rollback and reject.
        if cards_reserved:
            await db.cards.update_many({"number": {"$in": cards_reserved}}, {"$set": {"status": "available", "sold_at": None, "sold_to": None}})
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
            "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
            "quantity": data.quantity, "total": total, "status": "rejected_no_stock",
            "reason": "لا تتوفر كمية الكروت المطلوبة", "created_at": now_iso(),
        })
        raise HTTPException(status_code=400, detail="لا تتوفر كمية الكروت المطلوبة")

    number = await next_gwd_number()
    # Create sale invoice
    sale_doc = {
        "id": str(uuid.uuid4()), "number": number, "type": "sale",
        "customer_id": customer["id"], "customer_name": customer["name"],
        "sale_type": "credit", "source": "public_order",
        "items": [{"category_id": data.category_id, "category_name": cat.get("name"),
                   "quantity": data.quantity, "price": unit_price,
                   "total": total, "card_numbers": cards_reserved, "use_numbered": True}],
        "subtotal": total, "discount": 0, "total": total, "paid": 0, "remaining": total,
        "notes": "طلب عبر رابط طلب الكرت", "status": "active", "created_at": now_iso(),
    }
    await db.sales.insert_one(sale_doc)
    balance_after = await _adjust_party_balance("customer", customer["id"], total, number, f"مبيعات إلكترونية - طلب كرت {number}")

    # Log attempt as success
    await db.card_order_attempts.insert_one({
        "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
        "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
        "quantity": data.quantity, "total": total, "cards": cards_reserved,
        "invoice_number": number, "status": "success", "reason": "",
        "created_at": now_iso(),
    })

    # Create order record
    order_doc = {
        "id": str(uuid.uuid4()), "number": number, "customer_id": customer["id"],
        "customer_name": customer["name"], "phone": customer["phone"],
        "category_id": data.category_id, "category_name": cat.get("name"),
        "quantity": data.quantity, "total": total, "cards": cards_reserved,
        "quantity_stock_taken": 0,
        "status": "delivered", "created_at": now_iso(),
    }
    await db.orders.insert_one(order_doc)
    await notify(f"طلب كرت {number}", f"طلب كرت جديد من {customer['name']}", "success")
    return {
        "success": True, "cards": cards_reserved,
        "quantity_from_stock": 0, "total": total,
        "balance_after": balance_after, "message": "تم تنفيذ طلبك بنجاح",
    }

@api.get("/public/card-order/categories")
async def public_categories():
    items = await db.card_categories.find({"status": "active"}).to_list(500)
    result = []
    for c in items:
        numbered_avail = await db.cards.count_documents({"category_id": c["id"], "status": "available"})
        result.append({
            "id": c["id"], "name": c["name"],
            "sale_price": c.get("sale_price", 0),
            "sale_price_customer": c.get("sale_price_customer", c.get("sale_price", 0)),
            "sale_price_pos": c.get("sale_price_pos", c.get("sale_price", 0)),
            "available_numbered": numbered_avail,
        })
    return result


@api.post("/public/card-order/my-orders")
async def public_my_orders(data: CardOrderHistoryIn):
    """Return the authenticated customer's past card orders, optionally within a date range.
    Auth is done via phone+password (same credentials used to place orders)."""
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم")
    if customer.get("password") != data.password:
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")

    query: Dict[str, Any] = {"customer_id": customer["id"]}
    if data.start or data.end:
        rng: Dict[str, Any] = {}
        if data.start:
            rng["$gte"] = f"{data.start}T00:00:00+00:00"
        if data.end:
            rng["$lte"] = f"{data.end}T23:59:59+00:00"
        query["created_at"] = rng
    docs = await db.orders.find(query).sort("created_at", -1).limit(500).to_list(500)
    return [clean_doc(o) for o in docs]

@api.get("/orders")
async def list_orders(user=Depends(require_perm("card_orders"))):
    items = await db.orders.find().sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(o) for o in items]


# ================= NOTIFICATIONS =================
@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find().sort("created_at", -1).limit(100).to_list(100)
    return [clean_doc(n) for n in items]

@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"id": nid}, {"$set": {"read": True}})
    return {"ok": True}


# ================= AUDIT =================
@api.get("/audit")
async def list_audit(user=Depends(require_perm("users"))):
    items = await db.audit_logs.find().sort("created_at", -1).limit(500).to_list(500)
    return [clean_doc(a) for a in items]


# ================= REPORTS =================
@api.get("/reports/dashboard")
async def dashboard_stats(user=Depends(get_current_user)):
    today = datetime.now(timezone.utc).date().isoformat()
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    # Sales today/month
    sales_all = await db.sales.find({"status": "active"}).to_list(10000)
    sales_today = sum(s["total"] for s in sales_all if s["created_at"][:10] == today)
    sales_month = sum(s["total"] for s in sales_all if s["created_at"][:7] == month)
    purchases_all = await db.purchases.find({"status": "active"}).to_list(10000)
    purchases_total = sum(p["total"] for p in purchases_all)
    customers = await db.customers.find().to_list(10000)
    suppliers = await db.suppliers.find().to_list(10000)
    customer_debts = sum(max(0, c.get("balance", 0)) for c in customers)
    supplier_debts = sum(max(0, s.get("balance", 0)) for s in suppliers)
    cards_available = await db.cards.count_documents({"status": "available"})
    cards_sold = await db.cards.count_documents({"status": "sold"})
    cards_used = await db.cards.count_documents({"status": "used"})
    users_count = await db.users.count_documents({})
    # inventory value + low-stock alerts (reuse same loop, zero extra queries).
    # Numbered vs quantity are tracked INDEPENDENTLY using per-category thresholds
    # `low_stock_numbered` and `low_stock_quantity`. Falls back to
    # `low_stock_threshold` when either specific threshold is unset.
    cats = await db.card_categories.find().to_list(500)
    inventory_value = 0
    low_stock_alerts = []
    for c in cats:
        avail = await db.cards.count_documents({"category_id": c["id"], "status": "available"})
        stock = await db.stock.find_one({"category_id": c["id"]})
        qty_avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
        inventory_value += (avail + max(0, qty_avail)) * c.get("purchase_price", 0)
        combined = c.get("low_stock_threshold", 20) or 0
        thr_num = c.get("low_stock_numbered")
        thr_qty = c.get("low_stock_quantity")
        if thr_num is None: thr_num = combined
        if thr_qty is None: thr_qty = combined
        if thr_num and thr_num > 0 and avail <= thr_num:
            low_stock_alerts.append({
                "type": "numbered",
                "category_id": c["id"], "category_name": c.get("name", ""),
                "available": avail, "threshold": thr_num,
            })
        if thr_qty and thr_qty > 0 and max(0, qty_avail) <= thr_qty:
            low_stock_alerts.append({
                "type": "quantity",
                "category_id": c["id"], "category_name": c.get("name", ""),
                "available": max(0, qty_avail), "threshold": thr_qty,
            })
    low_stock_alerts.sort(key=lambda x: (x["available"], x["type"]))
    # recent
    recent_sales = await db.sales.find().sort("created_at", -1).limit(5).to_list(5)
    recent_receipts = await db.receipts.find().sort("created_at", -1).limit(5).to_list(5)
    recent_orders = await db.orders.find().sort("created_at", -1).limit(5).to_list(5)
    # daily chart last 7 days
    daily = {}
    for s in sales_all:
        d = s["created_at"][:10]
        daily[d] = daily.get(d, 0) + s["total"]
    chart = sorted([{"date": k, "value": v} for k, v in daily.items()], key=lambda x: x["date"])[-14:]
    return {
        "sales_today": sales_today,
        "sales_month": sales_month,
        "purchases_total": purchases_total,
        "customer_debts": customer_debts,
        "supplier_debts": supplier_debts,
        "inventory_value": inventory_value,
        "cards_available": cards_available,
        "cards_sold": cards_sold,
        "cards_used": cards_used,
        "low_stock_alerts": low_stock_alerts,
        "customers_count": len(customers),
        "suppliers_count": len(suppliers),
        "users_count": users_count,
        "recent_sales": [clean_doc(s) for s in recent_sales],
        "recent_receipts": [clean_doc(r) for r in recent_receipts],
        "recent_orders": [clean_doc(o) for o in recent_orders],
        "pending_register_requests": await db.register_requests.count_documents({"status": "pending"}),
        "chart": chart,
    }

@api.get("/reports/sales")
async def report_sales(start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_perm("reports"))):
    q: Dict[str, Any] = {"status": "active"}
    if start and end:
        q["created_at"] = {"$gte": start, "$lte": end + "T23:59:59"}
    items = await db.sales.find(q).sort("created_at", -1).to_list(5000)
    return [clean_doc(s) for s in items]

@api.get("/reports/purchases")
async def report_purchases(start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_perm("reports"))):
    q: Dict[str, Any] = {"status": "active"}
    if start and end:
        q["created_at"] = {"$gte": start, "$lte": end + "T23:59:59"}
    items = await db.purchases.find(q).sort("created_at", -1).to_list(5000)
    return [clean_doc(p) for p in items]

@api.get("/reports/customer-debts")
async def report_customer_debts(user=Depends(require_perm("reports"))):
    items = await db.customers.find().to_list(10000)
    return [clean_doc(c) for c in items if c.get("balance", 0) > 0]

@api.get("/reports/supplier-debts")
async def report_supplier_debts(user=Depends(require_perm("reports"))):
    items = await db.suppliers.find().to_list(10000)
    return [clean_doc(s) for s in items if s.get("balance", 0) > 0]


# ================= REGISTER REQUESTS =================
@api.get("/register-requests")
async def list_register_requests(user=Depends(require_perm("customers"))):
    items = await db.register_requests.find().sort("created_at", -1).to_list(1000)
    return [clean_doc(r) for r in items]

class ApproveRegisterIn(BaseModel):
    credit_limit: float = 0
    customer_type: str = "customer"
    password: Optional[str] = None

@api.post("/register-requests/{rid}/approve")
async def approve_register(rid: str, data: ApproveRegisterIn, user=Depends(require_perm("customers"))):
    req = await db.register_requests.find_one({"id": rid})
    if not req: raise HTTPException(status_code=404, detail="غير موجود")
    if req.get("status") == "approved":
        raise HTTPException(status_code=400, detail="تمت الموافقة مسبقاً")
    # Check if phone already exists
    exists = await db.customers.find_one({"phone": req["phone"]}, {"_id": 1})
    if exists:
        await db.register_requests.update_one({"id": rid}, {"$set": {"status": "duplicate", "approved_at": now_iso()}})
        raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    doc = {
        "id": str(uuid.uuid4()), "name": req["full_name"], "phone": req["phone"],
        "address": req.get("address", ""), "password": data.password or random_password(),
        "credit_limit": data.credit_limit, "opening_balance": 0, "balance": 0,
        "notes": f"تمت الموافقة على طلب #{rid[:8]}", "status": "active",
        "customer_type": data.customer_type,
        "created_at": now_iso(), "created_by": user.get("username"),
    }
    await db.customers.insert_one(doc)
    await db.register_requests.update_one({"id": rid}, {"$set": {"status": "approved", "approved_at": now_iso(), "customer_id": doc["id"]}})
    await audit_log(user, "approve", "register_request", rid)
    return {"ok": True, "customer": clean_doc(doc)}

@api.post("/register-requests/{rid}/reject")
async def reject_register(rid: str, user=Depends(require_perm("customers"))):
    await db.register_requests.update_one({"id": rid}, {"$set": {"status": "rejected", "rejected_at": now_iso()}})
    return {"ok": True}


# ================= BLOCK MGMT =================
@api.get("/public-blocks")
async def list_blocks(user=Depends(require_perm("customers"))):
    items = await db.public_blocks.find().to_list(1000)
    return [clean_doc(b) for b in items]

@api.post("/public-blocks/{phone}/unblock")
async def unblock(phone: str, user=Depends(require_perm("customers"))):
    await db.public_blocks.update_one({"phone": phone}, {"$set": {"failed": 0, "blocked_until": None, "unblocked_at": now_iso(), "unblocked_by": user.get("username")}})
    await audit_log(user, "unblock", "customer", phone)
    return {"ok": True}


# ================= RESET DATA =================
class ResetDataIn(BaseModel):
    username: str
    password: str
    confirm: bool = False

@api.post("/settings/reset-data")
async def reset_data(data: ResetDataIn, user=Depends(require_perm("settings"))):
    if not data.confirm:
        raise HTTPException(status_code=400, detail="يجب التأكيد")
    verify = await db.users.find_one({"username": data.username})
    if not verify or not verify_password(data.password, verify.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="بيانات الاعتماد غير صحيحة")
    if verify.get("role") != "admin":
        raise HTTPException(status_code=403, detail="يتطلب صلاحية المدير")
    # Wipe everything except users, settings, invoice_sequences
    collections_to_wipe = [
        "customers", "suppliers", "card_categories", "cards", "stock",
        "sales", "purchases", "receipts", "ledger", "orders", "notifications",
        "audit_logs", "register_requests", "card_order_attempts", "public_blocks",
    ]
    for c in collections_to_wipe:
        await db[c].delete_many({})
    # Reset GWD counter
    await db.settings.update_one({"key": "gwd_sequence"}, {"$set": {"value": 0}}, upsert=True)
    await audit_log(user, "reset_all_data", "system", "", None, {"by": data.username})
    return {"ok": True, "message": "تم مسح جميع البيانات"}


# ================= BACKUP =================
@api.get("/backup/export")
async def backup_export(user=Depends(require_perm("backup"))):
    from fastapi.encoders import jsonable_encoder
    collections = ["customers","suppliers","card_categories","cards","stock","sales","purchases","receipts","ledger","orders","notifications","audit_logs","register_requests","card_order_attempts","public_blocks","users","settings"]
    def _deep(v):
        if isinstance(v, dict):
            return {k: _deep(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_deep(x) for x in v]
        return v
    dump = {}
    for c in collections:
        docs = await db[c].find().to_list(50000)
        dump[c] = [_deep(clean_doc(d)) for d in docs]
    dump["_exported_at"] = now_iso()
    return jsonable_encoder(dump, custom_encoder={bytes: lambda b: b.decode(errors="replace")})

class BackupRestoreIn(BaseModel):
    data: Dict[str, Any]

@api.post("/backup/restore")
async def backup_restore(payload: BackupRestoreIn, user=Depends(require_perm("backup"))):
    # Snapshot current before restore
    snapshot_id = str(uuid.uuid4())
    snapshot = {}
    collections = ["customers","suppliers","card_categories","cards","stock","sales","purchases","receipts","ledger","orders","notifications","audit_logs"]
    for c in collections:
        docs = await db[c].find().to_list(50000)
        snapshot[c] = [clean_doc(d) for d in docs]
    await db.backup_snapshots.insert_one({"id": snapshot_id, "data": snapshot, "created_at": now_iso(), "reason": "pre_restore"})
    # Wipe & restore
    data = payload.data
    for c in collections:
        if c in data:
            await db[c].delete_many({})
            if data[c]:
                await db[c].insert_many(data[c])
    await audit_log(user, "restore_backup", "system", snapshot_id)
    return {"ok": True, "snapshot_id": snapshot_id}


# ================= CUSTOMER PASSWORD REVEAL =================
@api.post("/customers/{cid}/unbind-device")
async def unbind_customer_device(cid: str, user=Depends(require_perm("customers"))):
    """Clear the customer's bound device so the next successful login (with the
    new/reset password) binds the new phone automatically."""
    doc = await db.customers.find_one({"id": cid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    old_device = doc.get("bound_device")
    await db.customers.update_one(
        {"id": cid},
        {"$set": {"bound_device": None, "bound_device_at": None},
         "$push": {"device_history": {"unbound_at": now_iso(), "unbound_by": user.get("username"), "was": old_device}}},
    )
    await audit_log(user, "unbind_device", "customer", cid, {"bound_device": old_device}, {"bound_device": None})
    return {"ok": True}


@api.get("/customers/{cid}/password")
async def get_customer_password(cid: str, user=Depends(require_perm("customers"))):
    c = await db.customers.find_one({"id": cid})
    if not c: raise HTTPException(status_code=404)
    return {"password": c.get("password", "")}


# ================= SEARCH =================
@api.get("/search")
async def global_search(q: str, user=Depends(get_current_user)):
    result = {}
    result["sales"] = [clean_doc(s) for s in await db.sales.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    result["purchases"] = [clean_doc(s) for s in await db.purchases.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    result["receipts"] = [clean_doc(s) for s in await db.receipts.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    result["customers"] = [clean_doc(c) for c in await db.customers.find({"$or": [{"name": {"$regex": q, "$options": "i"}}, {"phone": {"$regex": q, "$options": "i"}}]}).limit(10).to_list(10)]
    result["cards"] = [clean_doc(c) for c in await db.cards.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    return result


# ================= SETTINGS =================
@api.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    doc = await db.settings.find_one({"key": "app_settings"}) or {}
    return {
        "company_name": COMPANY_NAME,
        "company_phone": COMPANY_PHONE,
        "currency": doc.get("currency", "ريال"),
        "logo_url": doc.get("logo_url", ""),
        "low_stock_default": doc.get("low_stock_default", 20),
        "backup_email": doc.get("backup_email", ""),
        "backup_time": doc.get("backup_time", "02:00"),
        "backup_auto": bool(doc.get("backup_auto", False)),
    }

@api.post("/settings")
async def update_settings(data: SettingsIn, user=Depends(require_perm("settings"))):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    # Validate backup_email format at the API boundary
    if "backup_email" in update:
        v = (update["backup_email"] or "").strip()
        if v:
            import re
            if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", v):
                raise HTTPException(status_code=400, detail="البريد الإلكتروني غير صحيح")
        update["backup_email"] = v
    await db.settings.update_one({"key": "app_settings"}, {"$set": update}, upsert=True)
    return {"ok": True}


# ================= STARTUP =================
@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index("username", unique=True)
    await db.customers.create_index("phone")
    await db.cards.create_index("number", unique=True)
    await db.sales.create_index("number", unique=True)
    await db.sales.create_index("idempotency_key")
    await db.purchases.create_index("number", unique=True)
    await db.purchases.create_index("idempotency_key")
    await db.receipts.create_index("number", unique=True)
    await db.receipts.create_index("idempotency_key")
    # Seed admin
    existing = await db.users.find_one({"username": ADMIN_USERNAME})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "مدير النظام",
            "username": ADMIN_USERNAME,
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "status": "active",
            "permissions": ALL_PERMS,
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin: {ADMIN_USERNAME}")
    else:
        await db.users.update_one({"username": ADMIN_USERNAME}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD), "role": "admin", "permissions": ALL_PERMS, "status": "active"}})
    # Seed default categories if empty
    cats_count = await db.card_categories.count_documents({})
    if cats_count == 0:
        defaults = [
            {"name": "200 ريال", "value": 200, "sale_price": 200, "purchase_price": 180, "validity_days": 30, "data_size": "5GB"},
            {"name": "300 ريال", "value": 300, "sale_price": 300, "purchase_price": 270, "validity_days": 30, "data_size": "10GB"},
            {"name": "500 ريال", "value": 500, "sale_price": 500, "purchase_price": 450, "validity_days": 30, "data_size": "20GB"},
            {"name": "1000 ريال", "value": 1000, "sale_price": 1000, "purchase_price": 900, "validity_days": 30, "data_size": "50GB"},
            {"name": "3000 ريال", "value": 3000, "sale_price": 3000, "purchase_price": 2700, "validity_days": 90, "data_size": "200GB"},
            {"name": "5000 ريال", "value": 5000, "sale_price": 5000, "purchase_price": 4500, "validity_days": 180, "data_size": "unlimited"},
        ]
        for d in defaults:
            await db.card_categories.insert_one({
                **d, "id": str(uuid.uuid4()), "status": "active",
                "notes": "", "low_stock_threshold": 20, "created_at": now_iso(),
            })

@app.on_event("shutdown")
async def shutdown():
    client.close()

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)
