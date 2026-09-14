# 🧭 WanderPair - Backend API & WebSocket Live Chat Engine

The backend engine for **WanderPair** — a solo traveler companion matching & group adventure booking platform. Built with **Node.js**, **Express**, **SQLite3**, and native **WebSockets (`ws`)**.

---

## 🌐 Live Deployment Links

- **Live Backend API**: [https://wanderpair-backend.onrender.com](https://wanderpair-backend.onrender.com)
- **Health Check Endpoint**: [https://wanderpair-backend.onrender.com/api/health](https://wanderpair-backend.onrender.com/api/health)
- **Live Frontend App**: [https://wander-pair-fe.vercel.app](https://wander-pair-fe.vercel.app)
- **Backend GitHub Repo**: [https://github.com/Amangarg5990/Wander_Pair_BE](https://github.com/Amangarg5990/Wander_Pair_BE)
- **Frontend GitHub Repo**: [https://github.com/Amangarg5990/Wander_Pair_FE](https://github.com/Amangarg5990/Wander_Pair_FE)

---

## 📁 Repository Structure

```
backend/
├── server.js              # Express REST API, SQLite driver & WebSocket Live Chat server
├── wanderpair.db          # Active SQLite database (pre-seeded with travelers, trips, outings)
├── package.json           # Node.js dependencies & scripts
├── .env.example           # Environment variables template
├── .gitignore             # Ignored files (node_modules, logs, env)
└── README.md              # Backend documentation & deployment guide
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` if using local environment files, or set these in your cloud hosting environment (e.g. Render Dashboard):

| Variable | Recommended Production Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for HTTP & WebSocket server (assigned automatically by Render). |
| `FRONTEND_URL` | `https://wander-pair-fe.vercel.app` | Allowed frontend origin for CORS security. |

---

## 🚀 Quickstart (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will start listening at `http://localhost:3000`.

---

## 📡 REST API Reference

### Health & Monitoring
- `GET /api/health` - Uptime and service status check (`https://wanderpair-backend.onrender.com/api/health`).

### Authentication
- `POST /api/auth/login` - Authenticate user (`{ email, password }`). Returns session user.
- `POST /api/auth/register` - Create a new traveler profile.
- `POST /api/auth/logout` - Invalidate current session.

### Users & Travelers
- `GET /api/users/me` - Get the currently authenticated traveler session.
- `GET /api/users/:id` - Retrieve public profile for traveler `:id`.
- `GET /api/explorers` - List verified companion travelers available for matching.

### Trips & Expeditions
- `GET /api/trips` - List upcoming trips and companion squads.
- `POST /api/trips` - Create and host a new expedition trip.
- `GET /api/trips/:id` - Detailed trip view with joined travelers.
- `GET /api/outings` - Local city outings and activities.

### Bookings & Companion Requests
- `GET /api/bookings` - Retrieve traveler's squad reservations.
- `POST /api/bookings` - Request to join a trip squad.
- `PATCH /api/bookings/:id` - Accept/reject companion booking requests.

### Admin & KYC Verification Portal
- `GET /api/admin/users` - Moderator table of all travelers, roles, and Aadhaar KYC statuses.
- `PATCH /api/admin/users/:id/verify` - Toggle KYC verification status (`{ verified: 1 | 0 }`).
- `GET /api/stats` - Platform stats (total travelers, trips, matched pairs, outings).

---

## 💬 Real-Time WebSocket Live Chat

The WebSocket server runs attached to the HTTP server:
- **Protocol**: Standard WebSocket (`wss://`).
- **Live Endpoint**: `wss://wanderpair-backend.onrender.com`
- **Message Types**:
  - `join`: Join a trip room (`{ type: 'join', room: 'trip-101', user: { name: 'Aarav' } }`).
  - `message`: Broadcast message to companions (`{ type: 'message', room: 'trip-101', text: 'Hey squad!' }`).
  - `history`: Automatically delivers latest chat log upon joining.

---

## ☁️ Deployment Reference (Render.com)

This backend is actively deployed on **Render**:
1. Repository: [https://github.com/Amangarg5990/Wander_Pair_BE](https://github.com/Amangarg5990/Wander_Pair_BE)
2. Build Command: `npm install`
3. Start Command: `node server.js`
4. Health Check Path: `/api/health`
5. Environment Variable:
   - `FRONTEND_URL`: `https://wander-pair-fe.vercel.app`

---

## 🔗 Related Repositories

- **Frontend Client Application**: [Amangarg5990/Wander_Pair_FE](https://github.com/Amangarg5990/Wander_Pair_FE)
