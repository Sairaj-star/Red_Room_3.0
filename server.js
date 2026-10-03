const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const morgan = require("morgan");
const multer = require("multer");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "red-room.json");
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 25));
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: Math.max(2, MAX_UPLOAD_MB) * 1024 * 1024,
  cors: { origin: true, credentials: true }
});

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(ROOT, "public")));

const NAME_RE = /^[A-Za-z ]+$/;
const PHONE_RE = /^\d{10}$/;
const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const cleanName = v => String(v || "").trim().replace(/\s+/g, " ");
const validName = v => NAME_RE.test(v) && v.length >= 2 && v.length <= 60;
const validPhone = v => PHONE_RE.test(String(v || ""));
const validCapacity = v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 50;
const now = () => new Date().toISOString();
const makeId = p => p + "_" + crypto.randomBytes(12).toString("hex");
const roomNumber = v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 500 ? Number(v) : null;

function makeKey() {
  let key = "";
  while (key.length < 9) key += KEY_CHARS[crypto.randomInt(KEY_CHARS.length)];
  return key;
}
function initialDB() {
  const rooms = {};
  for (let i = 1; i <= 500; i++) rooms[i] = {
    number: i, booked: false, booking: null, key: null, capacity: 0,
    occupants: [], messages: [], audit: []
  };
  return { version: 1, rooms, createdAt: now() };
}
let db;
try {
  db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, "utf8")) : initialDB();
} catch { db = initialDB(); }
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(db), "utf8");

function persist() {
  try {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db), "utf8");
    fs.renameSync(tmp, DB_FILE);
  } catch (e) { console.error("Persistence error:", e.message); }
}
function audit(room, type, data = {}) {
  room.audit.push({ id: makeId("audit"), type, at: now(), ...data });
  if (room.audit.length > 2000) room.audit.splice(0, room.audit.length - 2000);
}
function roomPublic(room) {
  return {
    number: room.number,
    status: !room.booked ? "available" :
      room.occupants.length >= room.capacity ? "full" : "occupied",
    booked: room.booked,
    capacity: room.capacity,
    occupants: room.occupants.length
  };
}
function broadcastRoom(n) {
  io.emit("room:status", roomPublic(db.rooms[n]));
}
function broadcastState(n) {
  const room = db.rooms[n];
  io.to("room:" + n).emit("room:occupancy", {
    room: n, capacity: room.capacity, count: room.occupants.length,
    occupants: room.occupants.map(o => ({ id: o.id, label: o.label }))
  });
  broadcastRoom(n);
}
function sameSecret(a, b) {
  const aa = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function ownerToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifyOwnerToken(token) {
  try {
    const [p, sig] = String(token || "").split(".");
    if (!p || !sig) return false;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(p).digest("base64url");
    if (!sameSecret(sig, expected)) return false;
    return JSON.parse(Buffer.from(p, "base64url").toString("utf8")).exp > Date.now();
  } catch { return false; }
}
function requireOwner(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!verifyOwnerToken(token)) return res.status(401).json({ error: "Owner authentication required." });
  next();
}

app.get("/health", (req, res) => res.json({ ok: true, rooms: 500 }));
app.get("/api/rooms", (req, res) => res.json({ rooms: Object.values(db.rooms).map(roomPublic) }));

app.post("/api/owner/login", (req, res) => {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) return res.status(503).json({ error: "Owner credentials are not configured." });
  if (!sameSecret(String(req.body.email || "").trim().toLowerCase(), OWNER_EMAIL.trim().toLowerCase()) ||
      !sameSecret(req.body.password, OWNER_PASSWORD)) return res.status(401).json({ error: "Invalid owner credentials." });
  res.json({ token: ownerToken() });
});

app.get("/api/owner/rooms", requireOwner, (req, res) => {
  res.json({
    rooms: Object.values(db.rooms).map(r => ({
      ...roomPublic(r), booking: r.booking, key: r.key,
      occupants: r.occupants.map(o => ({ id: o.id, label: o.label, joinedAt: o.joinedAt })),
      audit: r.audit.slice(-300), messages: r.messages.slice(-1000)
    }))
  });
});

app.post("/api/rooms/:n/book", (req, res) => {
  const n = roomNumber(req.params.n);
  if (!n) return res.status(400).json({ error: "Invalid room." });
  const room = db.rooms[n];
  if (room.booked) return res.status(409).json({ error: "This room is already booked." });
  const name = cleanName(req.body.name), phone = String(req.body.phone || "").trim(), capacity = Number(req.body.capacity);
  if (!validName(name)) return res.status(400).json({ error: "Name must contain only letters and spaces." });
  if (!validPhone(phone)) return res.status(400).json({ error: "Phone number must contain exactly 10 digits." });
  if (!validCapacity(capacity)) return res.status(400).json({ error: "Capacity must be between 1 and 50." });
  room.booked = true; room.capacity = capacity; room.key = makeKey();
  room.booking = { name, phone, capacity, bookedAt: now() };
  room.messages = []; room.audit = [];
  audit(room, "room_booked", { name, phone, capacity });
  persist(); broadcastRoom(n);
  res.json({ room: roomPublic(room), key: room.key });
});

app.post("/api/rooms/:n/reset", requireOwner, (req, res) => {
  const n = roomNumber(req.params.n);
  if (!n) return res.status(400).json({ error: "Invalid room." });
  const room = db.rooms[n];
  room.booked = false; room.booking = null; room.key = null; room.capacity = 0;
  room.occupants = []; room.messages = []; room.audit = [];
  persist();
  io.to("room:" + n).emit("room:closed", { reason: "The room was closed by the owner." });
  broadcastRoom(n); res.json({ ok: true });
});

const allowedMime = new Set([
  "image/jpeg","image/png","image/gif","image/webp",
  "video/mp4","video/webm","video/quicktime",
  "audio/webm","audio/ogg","audio/mpeg","audio/wav"
]);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, makeId("media") + path.extname(file.originalname || "").toLowerCase().slice(0, 10))
});
const upload = multer({
  storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, allowedMime.has(file.mimetype))
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  const n = roomNumber(req.body.roomNumber), key = String(req.body.key || ""), label = cleanName(req.body.label) || "Guest";
  if (!n || !req.file) return res.status(400).json({ error: "Invalid upload." });
  const room = db.rooms[n];
  if (!room.booked || key !== room.key) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(403).json({ error: "Invalid room key." });
  }
  const type = req.file.mimetype.startsWith("image/") ? "image" :
    req.file.mimetype.startsWith("video/") ? "video" : "audio";
  const msg = {
    id: makeId("msg"), room: n, senderId: null, senderLabel: label,
    type, url: "/media/" + path.basename(req.file.path), name: req.file.originalname,
    mime: req.file.mimetype, size: req.file.size, at: now(), edited: false
  };
  room.messages.push(msg);
  audit(room, "media_sent", { messageId: msg.id, senderLabel: label, type, name: msg.name });
  persist(); io.to("room:" + n).emit("message:new", msg);
  res.json({ message: msg });
});
app.use("/media", express.static(UPLOAD_DIR, { maxAge: "1h" }));

io.on("connection", socket => {
  socket.on("room:join", ({ roomNumber: rn, key }) => {
    const n = roomNumber(rn);
    if (!n) return socket.emit("room:error", "Invalid room.");
    const room = db.rooms[n];
    if (!room.booked || String(key || "") !== room.key) return socket.emit("room:error", "Invalid room key.");
    if (room.occupants.length >= room.capacity) return socket.emit("room:error", "This room is full.");
    const occupant = { id: socket.id, label: "Guest " + (room.occupants.length + 1), joinedAt: now() };
    room.occupants.push(occupant);
    socket.data.roomNumber = n; socket.data.label = occupant.label; socket.join("room:" + n);
    audit(room, "entered", { socketId: socket.id, label: occupant.label }); persist();
    socket.emit("room:joined", { room: roomPublic(room), occupant, messages: room.messages.slice(-500) });
    broadcastState(n);
  });

  socket.on("message:send", ({ text }) => {
    const n = socket.data.roomNumber, room = n && db.rooms[n];
    const value = String(text || "").trim();
    if (!room || !value || value.length > 4000) return;
    const recent = room.messages.filter(m => m.senderId === socket.id && Date.now() - Date.parse(m.at) < 3000);
    if (recent.length >= 8) return socket.emit("room:error", "Please slow down for a moment.");
    const msg = { id: makeId("msg"), room: n, senderId: socket.id, senderLabel: socket.data.label, type: "text", text: value, at: now(), edited: false };
    room.messages.push(msg); audit(room, "message_sent", { messageId: msg.id, senderLabel: socket.data.label, text: value });
    persist(); io.to("room:" + n).emit("message:new", msg);
  });

  socket.on("message:edit", ({ id, text }) => {
    const n = socket.data.roomNumber, room = n && db.rooms[n], msg = room?.messages.find(m => m.id === id);
    const value = String(text || "").trim();
    if (!msg || msg.senderId !== socket.id || msg.type !== "text" || !value || value.length > 4000) return;
    const previous = msg.text; msg.text = value; msg.edited = true; msg.editedAt = now();
    audit(room, "message_edited", { messageId: id, senderLabel: socket.data.label, previousText: previous, newText: value });
    persist(); io.to("room:" + n).emit("message:updated", msg);
  });

  socket.on("message:delete", ({ id }) => {
    const n = socket.data.roomNumber, room = n && db.rooms[n], msg = room?.messages.find(m => m.id === id);
    if (!msg || msg.senderId !== socket.id) return;
    const original = { ...msg }; msg.deleted = true; delete msg.text; delete msg.url; delete msg.name;
    audit(room, "message_deleted", { messageId: id, senderLabel: socket.data.label, original });
    persist(); io.to("room:" + n).emit("message:updated", msg);
  });

  socket.on("room:exit", () => leave());
  socket.on("disconnect", reason => leave(reason));

  function leave(reason = "exit") {
    const n = socket.data.roomNumber, room = n && db.rooms[n];
    if (!room) return;
    const i = room.occupants.findIndex(o => o.id === socket.id);
    if (i !== -1) {
      const person = room.occupants[i];
      room.occupants.splice(i, 1);
      audit(room, "exited", { socketId: socket.id, label: person.label, reason });
      persist(); broadcastState(n);
    }
    socket.data.roomNumber = null;
  }
});

app.get("*", (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));
server.listen(PORT, "0.0.0.0", () => console.log(`RED ROOM running on port ${PORT}`));
