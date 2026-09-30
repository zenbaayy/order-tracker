const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ---------- In-memory data ----------
const catalog = [
  { id: 1, name: "Chicken Biryani", price: 450 },
  { id: 2, name: "Zinger Burger", price: 380 },
  { id: 3, name: "Margherita Pizza", price: 900 },
  { id: 4, name: "Cold Coffee", price: 250 },
];
let orders = [];
let nextOrderId = 1;
const STATUS_FLOW = ["Placed", "Preparing", "Out for Delivery", "Delivered"];

// ---------- SSE (Server-Sent Events) ----------
const sseClients = new Set();
function broadcastAlert(message, type = "info") {
  const payload = JSON.stringify({ message, type, time: new Date().toISOString() });
  for (const res of sseClients) res.write(`event: alert\ndata: ${payload}\n\n`);
}

app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`event: alert\ndata: ${JSON.stringify({ message: "Connected to live alerts", type: "info", time: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// Periodic system heartbeat alert
setInterval(() => {
  if (sseClients.size) broadcastAlert(`System OK. Active orders: ${orders.filter(o => o.status !== "Delivered" && o.status !== "Cancelled").length}`, "system");
}, 30000);

// ---------- REST ----------
app.get("/", (req, res) => res.json({ status: "ok", service: "Order Tracker API" }));

app.get("/api/v1/catalog", (req, res) => res.json(catalog));

app.get("/api/v1/orders", (req, res) => res.json(orders));

app.get("/api/v1/orders/:id", (req, res) => {
  const order = orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

app.post("/api/v1/orders", (req, res) => {
  const { customer, items } = req.body;
  if (!customer || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "customer and items[] are required" });
  const lines = items
    .map(i => ({ item: catalog.find(c => c.id === Number(i.id)), qty: Number(i.qty) || 1 }))
    .filter(l => l.item);
  if (!lines.length) return res.status(400).json({ error: "No valid catalog items" });
  const order = {
    id: nextOrderId++,
    customer,
    items: lines.map(l => ({ id: l.item.id, name: l.item.name, qty: l.qty })),
    total: lines.reduce((s, l) => s + l.item.price * l.qty, 0),
    status: "Placed",
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  io.emit("order:new", order);
  broadcastAlert(`New order #${order.id} placed by ${customer}`, "order");
  res.status(201).json(order);
});

app.patch("/api/v1/orders/:id/status", (req, res) => {
  const order = orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Order not found" });
  const { status } = req.body;
  if (![...STATUS_FLOW, "Cancelled"].includes(status))
    return res.status(400).json({ error: `status must be one of ${[...STATUS_FLOW, "Cancelled"].join(", ")}` });
  order.status = status;
  io.emit("order:status", { id: order.id, status });
  broadcastAlert(`Order #${order.id} is now: ${status}`, "order");
  res.json(order);
});

// ---------- JSON-RPC 2.0 ----------
const rpcMethods = {
  cancelOrder: ({ id }) => {
    const order = orders.find(o => o.id === Number(id));
    if (!order) throw { code: -32001, message: "Order not found" };
    if (order.status === "Delivered") throw { code: -32002, message: "Delivered orders cannot be cancelled" };
    order.status = "Cancelled";
    io.emit("order:status", { id: order.id, status: "Cancelled" });
    broadcastAlert(`Order #${order.id} was cancelled`, "warning");
    return order;
  },
  getOrderStatus: ({ id }) => {
    const order = orders.find(o => o.id === Number(id));
    if (!order) throw { code: -32001, message: "Order not found" };
    return { id: order.id, status: order.status };
  },
  advanceOrder: ({ id }) => {
    const order = orders.find(o => o.id === Number(id));
    if (!order) throw { code: -32001, message: "Order not found" };
    const idx = STATUS_FLOW.indexOf(order.status);
    if (idx === -1 || idx === STATUS_FLOW.length - 1) throw { code: -32002, message: "Order cannot be advanced" };
    order.status = STATUS_FLOW[idx + 1];
    io.emit("order:status", { id: order.id, status: order.status });
    broadcastAlert(`Order #${order.id} is now: ${order.status}`, "order");
    return order;
  },
};

app.post("/rpc", (req, res) => {
  const { jsonrpc, method, params, id } = req.body || {};
  if (jsonrpc !== "2.0" || typeof method !== "string")
    return res.json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: id ?? null });
  const fn = rpcMethods[method];
  if (!fn) return res.json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: id ?? null });
  try {
    res.json({ jsonrpc: "2.0", result: fn(params || {}), id: id ?? null });
  } catch (e) {
    res.json({ jsonrpc: "2.0", error: { code: e.code || -32603, message: e.message || "Internal error" }, id: id ?? null });
  }
});

// ---------- WebSockets (Socket.io) : 1-on-1 chat ----------
const agents = new Map(); // socket.id -> name
io.on("connection", socket => {
  // role: "customer" | "agent"
  socket.on("join", ({ name, role, room }) => {
    socket.data = { name, role, room };
    if (role === "agent") agents.set(socket.id, name);
    // customer's room = their name; agent picks a room to join
    const roomName = `chat:${room}`;
    socket.join(roomName);
    socket.to(roomName).emit("chat:system", `${name} (${role}) joined the chat`);
    socket.emit("chat:system", `You joined room "${room}" as ${role}`);
    if (role === "customer") io.emit("chat:rooms", roomsList());
  });

  socket.on("chat:message", ({ room, text }) => {
    if (!text || !room) return;
    io.to(`chat:${room}`).emit("chat:message", {
      from: socket.data?.name || "Unknown",
      role: socket.data?.role || "customer",
      text,
      time: new Date().toISOString(),
    });
  });

  socket.on("chat:typing", ({ room }) => socket.to(`chat:${room}`).emit("chat:typing", socket.data?.name));
  socket.on("chat:rooms", () => socket.emit("chat:rooms", roomsList()));

  socket.on("disconnect", () => {
    agents.delete(socket.id);
    io.emit("chat:rooms", roomsList());
  });
});

function roomsList() {
  const rooms = [];
  for (const [id, s] of io.sockets.sockets) {
    if (s.data?.role === "customer") rooms.push(s.data.room);
  }
  return [...new Set(rooms)];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
