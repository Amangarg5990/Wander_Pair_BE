# 🧭 WanderPair - Backend API & WebSocket Live Chat Engine

The backend engine for **WanderPair** — a solo traveler companion matching & group adventure booking platform. Built with **Node.js**, **Express**, **SQLite3**, and native **WebSockets (`ws`)**.

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

Copy `.env.example` to `.env` if using local environment files, or set these in your cloud hosting environment:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP & WebSocket server (assigned automatically by cloud hosts). |
| `FRONTEND_URL` | `*` | Comma-separated list of allowed frontend origins for CORS (e.g. `https://wanderpair.vercel.app`). |

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
- `GET /api/health` - Uptime and service status check.

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

The WebSocket server runs on the same port as the HTTP server (`server.listen(PORT)`):
- **Protocol**: Standard WebSocket (`ws://` or `wss://`).
- **Connection URL**: `ws://<your-backend-host>` or `wss://<your-backend-host>`.
- **Message Types**:
  - `join`: Join a specific trip or chat room (`{ type: 'join', room: 'trip-101', user: { name: 'Aarav' } }`).
  - `message`: Broadcast message to all active companions in room (`{ type: 'message', room: 'trip-101', text: 'Hey squad!' }`).
  - `history`: Server automatically emits the latest chat log upon joining a room.

---

## ☁️ Deployment Guide

### Option 1: Deploy on Render.com (Recommended)
1. Push this `backend/` folder to a new GitHub repository (e.g. `wanderpair-backend`).
2. Log in to [Render.com](https://render.com/) and click **New +** $\rightarrow$ **Web Service**.
3. Connect your `wanderpair-backend` repository.
4. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/api/health`
5. Under **Environment Variables**, set:
   - `FRONTEND_URL`: `https://your-frontend.vercel.app` (or `*`)
6. *(Optional for persistent SQLite)*: Add a **Disk** under `Disks` mounted to `/data`, and adjust `dbPath` if preserving data between server restarts.

### Option 2: Deploy on Railway.app
1. Push `backend/` to a GitHub repository.
2. Log in to [Railway.app](https://railway.app/) and create a **New Project from GitHub Repo**.
3. Railway automatically detects `package.json` and runs `npm start`.
4. Add environment variable `FRONTEND_URL` pointing to your frontend URL.

### Option 3: Deploy on Fly.io
1. Install Fly CLI: `flyctl auth login`.
2. In the `backend/` directory, run:
   ```bash
   fly launch
   ```
3. Deploy:
   ```bash
   fly deploy
   ```

---

## 📦 How to Push to GitHub as a Dedicated Repository

To push only this backend folder as a separate GitHub repository:

```bash
# Navigate into backend directory
cd backend

# Initialize Git
git init

# Add and commit files
git add .
git commit -m "feat: initial commit for WanderPair backend API & WebSocket server"

# Link to your new GitHub repository
git branch -M main
git remote add origin https://github.com/<your-username>/wanderpair-backend.git

# Push to GitHub
git push -u origin main
```
