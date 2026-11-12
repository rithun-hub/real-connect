# REAL CONNECT

> **Enterprise-Grade Real-Time Video Collaboration Platform**  
> *Prepared for Internship Evaluation & Submission*

---

## 1. Introduction

**REAL CONNECT** is a secure, high-performance, real-time video conferencing application designed to deliver peer-to-peer audio, video, and collaboration capabilities directly within the browser without requiring third-party plugins or external client installations.

Built on WebRTC mesh signaling with Socket.IO, REAL CONNECT enables low-latency communication, crisp video feeds, desktop screen presentation, rich in-meeting text and file sharing, and host moderation tools.

---

## 2. Project Objectives

- **Ultra Low-Latency Video & Audio**: Direct peer-to-peer media streaming using standard WebRTC APIs.
- **Robust Connection Negotiation**: Deterministic offer/answer signaling and queued ICE candidate processing over Socket.IO.
- **Integrated Collaboration**: Multi-participant video grid, high-definition screen sharing, live audio level detection, and in-call file transfers (up to 5MB).
- **Session & Role Moderation**: Host controls including meeting lock, participant mute, co-host assignment, screen share permissions, chat permissions, and remote participant removal.
- **Zero-Friction Access**: Intuitive guest access for rapid evaluation, alongside email/password account management and recent room history.

---

## 3. Technology Stack

### Frontend
- **Framework**: React 19 + TypeScript
- **Bundler & Tooling**: Vite 8
- **Real-Time Client**: Socket.IO Client
- **Signaling & Media**: Native WebRTC APIs (`RTCPeerConnection`, `MediaDevices`, `Web Audio API`)
- **Styling**: Pure CSS Design System with dark-mode slate theme and micro-animations

### Backend
- **Runtime**: Node.js
- **Server Framework**: Express.js
- **Real-Time Engine**: Socket.IO (Websocket & Polling fallback)
- **CORS & Middleware**: Express JSON parser and CORS handling

### Database & ORM
- **Database**: PostgreSQL
- **ORM**: Prisma ORM (Schema covers `User`, `Session`, `LoginHistory`, `OtpVerification`, `TrustedDevice`, `Meeting`, `Participant`, `ChatMessage`)

---

## 4. Implemented Features

### 🛡️ Authentication & User Flow
- **User Registration & Login**: Interactive authentication interface with email and password.
- **Demo Account Ready**: Pre-seeded demo credentials (`demo@realconnect.io` / `password123`) for instant testing.
- **Instant Guest Mode**: 1-click guest access generating session identifiers without mandatory registration.
- **Session Persistence**: User profile remembered across browser refreshes via `localStorage`.

### 📊 Dashboard & Meeting Management
- **Instant Meeting Creation**: One-click UUID meeting generation with automatic host designation.
- **Join by Room ID**: Join any active conference by entering or pasting a meeting room ID.
- **URL Parameter Quick-Join**: Supports direct URL links formatted as `?room=<ROOM_ID>`.
- **Recent Meetings History**: Tracks previously joined or created rooms with 1-click re-join capability.

### 🎥 High-Definition Video & Audio
- **Adaptive Participant Grid**: Responsive video grid dynamically adapting from 1 to 6 participants.
- **Camera & Microphone Controls**: Real-time track toggling, muting, and video enable/disable.
- **Mobile Camera Flip**: Quick front/back camera switching on mobile and touch devices.
- **Active Speaker Detection**: Real-time volume analysis via the Web Audio API with glowing visual borders.
- **Connection Quality Badges**: Continuous RTT and packet-loss monitoring reporting Excellent, Good, Fair, or Poor connection states.
- **Video Resolution Indicators**: Diagnostic stream resolution badges.
- **Autoplay Handling**: Automatic banner prompt allowing users to resume media playback if browser autoplay policies block remote audio.

### 🖥️ Screen Sharing & Presentations
- **Display Media Sharing**: 1080p desktop/tab screen capture with detail content hinting.
- **Seamless Track Replacement**: Seamlessly switches between webcam and screen feed across all active peer transceivers without renegotiation drops.
- **Host Permission Enforcement**: Host can enable or disable screen sharing for participants at any time.

### 💬 In-Call Collaboration & Moderation
- **Real-Time Chat**: Integrated slide-out chat drawer with message history and timestamps.
- **File Sharing (up to 5MB)**: Send attachments with name, size preview, and one-click download buttons.
- **Emoji Reactions**: Floating animated reactions (👍, ❤️, 😂, 👏, 🎉, 🔥, 🚀) overlaid on participant cards.
- **Hand Raising**: Raise or lower hand with visible status tags.
- **Meeting Lock**: Prevents new participants from entering locked sessions.
- **Remote Moderation**: Primary hosts and co-hosts can mute participants, assign co-host privileges, or kick participants.
- **End Meeting for All**: Primary hosts can conclude the call and automatically disconnect all peers.

---

## 5. User Interface & Screenshots

### 1. Authentication View
A clean authentication card with tab toggles between Sign In and Create Account, demo account hints, and 1-click Guest Access.

### 2. Dashboard View
Displays the user profile, server connectivity status, Quick Action Cards ("Start Instant Meeting", "Join with Code", "Recent Rooms"), and architecture highlights.

### 3. In-Meeting View
Full-viewport meeting interface with top status bar (Room ID, 1-click Copy Link, call duration timer, participant count, and host badges), adaptive video grid with active-speaker borders, floating bottom control dock, and slide-out drawers for Chat and Participants.

---

## 6. Installation & Setup Instructions

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Git**: Installed and configured

### Step 1: Clone Repository
```bash
git clone https://github.com/your-username/REAL-CONNECT.git
cd REAL-CONNECT
```

### Step 2: Install Dependencies

Install backend dependencies:
```bash
cd server
npm install
cd ..
```

Install frontend dependencies:
```bash
cd client
npm install
cd ..
```

---

## 7. Starting the Applications

### Starting the Backend Server
From the root directory:
```bash
cd server
node src/server.js
```
The server will start on **`http://localhost:5000`**.  
Health check endpoint: **`http://localhost:5000/api/health`**.

### Starting the Frontend Client
In a second terminal window from the root directory:
```bash
cd client
npm run dev
```
The client application will start on **`http://localhost:5173`**.

Open your browser and navigate to:
```
http://localhost:5173
```

---

## 8. Environment Variables

Templates are provided in `.env.example` in both root, `client`, and `server` directories.

### Backend (`server/.env`)
```ini
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
DATABASE_URL=postgresql://username:password@localhost:5432/real_connect?schema=public
```

### Frontend (`client/.env`)
```ini
VITE_SERVER_URL=http://localhost:5000
```

> **Security Note**: Environment files containing sensitive credentials, database passwords, and private keys are excluded from git tracking via `.gitignore`.

---

## 9. Verification & Build Commands

### Frontend Production Build
```bash
cd client
npm run build
```
*Compiles TypeScript with zero errors and produces the production bundle in `client/dist`.*

### Backend Syntax Check
```bash
node -c server/src/server.js
```
*Validates the Express + Socket.IO server syntax.*

---

## 10. Known Limitations & Future Roadmap

- **Mesh Architecture (P2P)**: WebRTC mesh signaling is optimized for up to 6 participants per room. Larger groups would benefit from an SFU (Selective Forwarding Unit) such as Mediasoup or LiveKit in future versions.
- **Database Persistence**: While the Prisma schema is fully modeled with PostgreSQL migrations for enterprise audit trails and OTP verification, real-time conference rooms and signaling currently operate in high-speed server memory for instant zero-dependency execution.
- **Browser Autoplay Policies**: Modern browsers may require initial user interaction (such as clicking the "Enable Audio" prompt) before playing remote audio tracks.

---

## 11. Project Structure

```
REAL-CONNECT/
├── .env.example              # Environment variables template
├── .gitignore                # Comprehensive Git exclusions
├── README.md                 # Project documentation
├── client/                   # Frontend React + TypeScript application
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx           # Main application component (Auth, Dashboard, Meeting)
│   │   ├── index.css         # Global design system & theme
│   │   └── main.tsx          # React application entry point
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   └── vite.config.ts
└── server/                   # Backend Node.js + Express + Socket.IO service
    ├── .env.example
    ├── package.json
    ├── prisma/
    │   └── schema.prisma     # Prisma database schema
    └── src/
        └── server.js         # REST endpoints & Socket.IO WebRTC signaling
```

---

## 12. License & Author

- **Project**: REAL CONNECT
- **License**: ISC
- **Submission**: Internship Submission

