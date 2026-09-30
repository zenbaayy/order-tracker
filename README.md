# CSC337 - Lab Assignment 04: Real-Time Order Tracker & Live Support System

A full-stack app demonstrating four communication protocols in one project:
REST, WebSockets (Socket.io), JSON-RPC 2.0, and Server-Sent Events (SSE).

- Live frontend: <ADD_VERCEL_OR_NETLIFY_URL>
- Live backend: <ADD_RENDER_OR_RAILWAY_URL>

## Project structure
```
backend/   Node.js + Express + Socket.io server
frontend/  Static client: index.html (customer), agent.html (support agent), config.js (backend URL)
```

## Local setup
```bash
cd backend
npm install
npm start          # runs on http://localhost:3000
```
Open `frontend/index.html` in a browser (or serve it with `npx serve frontend`).
In `frontend/config.js`, set the `API` constant to your backend URL.

## Endpoints

### 1. REST (resource management)
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/catalog` | List menu items |
| GET | `/api/v1/orders` | List all orders |
| GET | `/api/v1/orders/:id` | Get one order |
| POST | `/api/v1/orders` | Create order `{customer, items:[{id, qty}]}` |
| PATCH | `/api/v1/orders/:id/status` | Update status |

### 2. WebSocket events (Socket.io)
Client -> Server:
| Event | Payload | Description |
|---|---|---|
| `join` | `{name, role, room}` | Join a 1-on-1 chat room (role: customer or agent) |
| `chat:message` | `{room, text}` | Send a message to the room |
| `chat:typing` | `{room}` | Typing indicator |
| `chat:rooms` | none | Request list of open customer rooms |

Server -> Client:
| Event | Payload | Description |
|---|---|---|
| `order:new` | order object | A new order was placed |
| `order:status` | `{id, status}` | Real-time order status update |
| `chat:message` | `{from, role, text, time}` | Chat message |
| `chat:system` | string | Join/leave notices |
| `chat:typing` | name | Someone is typing |
| `chat:rooms` | string[] | Open customer rooms |

### 3. JSON-RPC 2.0 (`POST /rpc`)
Methods: `cancelOrder`, `getOrderStatus`, `advanceOrder`
```json
{ "jsonrpc": "2.0", "method": "cancelOrder", "params": { "id": 1 }, "id": 1 }
```

### 4. Server-Sent Events (`GET /events`)
Event name: `alert`. Pushes order updates, cancellations, and a 30s system heartbeat.

## Deployment
- Backend: Render or Railway. Root directory `backend`, build `npm install`, start `npm start`.
- Frontend: Vercel or Netlify. Publish directory `frontend`, no build command.
- Set `API` in `frontend/config.js` to the deployed backend URL before deploying.

## Pages
- `/` (index.html): customer page — menu, place/cancel orders, live order status, chat with support, live alerts
- `/agent` (agent.html): support agent page — customer chat rooms, all orders with status buttons, live alerts, JSON-RPC console
