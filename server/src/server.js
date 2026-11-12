const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = 5000;
const CLIENT_URL = "http://localhost:5173";
const MAX_PARTICIPANTS = 6;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
  cors({
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer(app);

// ============================================================
// SOCKET.IO
// ============================================================

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "REAL CONNECT server is running",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// AUTH & REST API ENDPOINTS
// ============================================================

const registeredUsers = new Map();

// Seeded user for quick testing
registeredUsers.set("demo@realconnect.io", {
  id: 1,
  name: "Demo User",
  email: "demo@realconnect.io",
  password: "password123",
  createdAt: new Date().toISOString(),
});

app.post("/api/auth/register", (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (registeredUsers.has(cleanEmail)) {
      return res.status(400).json({ error: "An account with this email already exists." });
    }
    const user = {
      id: registeredUsers.size + 1,
      name: String(name).trim().slice(0, 50),
      email: cleanEmail,
      password: password || "password123",
      createdAt: new Date().toISOString(),
    };
    registeredUsers.set(cleanEmail, user);
    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
      token: `token-${user.id}-${Date.now()}`,
    });
  } catch (err) {
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    let user = registeredUsers.get(cleanEmail);
    if (!user) {
      const defaultName = cleanEmail.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Participant";
      user = {
        id: registeredUsers.size + 1,
        name: defaultName,
        email: cleanEmail,
        password: password || "password123",
        createdAt: new Date().toISOString(),
      };
      registeredUsers.set(cleanEmail, user);
    }
    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
      token: `token-${user.id}-${Date.now()}`,
    });
  } catch (err) {
    res.status(500).json({ error: "Login failed." });
  }
});

app.get("/api/meetings/active", (req, res) => {
  const activeRooms = Array.from(rooms.values()).map((r) => ({
    roomId: r.roomId,
    participantCount: r.participants.size,
    locked: r.locked,
    startedAt: r.startedAt,
    maxParticipants: r.maxParticipants,
  }));
  res.json({ count: activeRooms.length, rooms: activeRooms });
});

app.get("/api/meetings/:roomId", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ exists: false, message: "Meeting not found." });
  }
  res.json({
    exists: true,
    roomId: room.roomId,
    participantCount: room.participants.size,
    locked: room.locked,
    maxParticipants: room.maxParticipants,
  });
});

// ============================================================
// ROOM STORAGE
// ============================================================

const rooms = new Map();

function createRoom(roomId, hostId, hostName) {
  const participants = new Map();

  participants.set(hostId, {
    socketId: hostId,
    name: hostName || "Host",
    joinedAt: Date.now(),
    handRaised: false,
    camera: true,
    screen: false,
    microphone: true,
  });

  const room = {
    roomId,
    hostId,
    coHosts: new Set(),
    locked: false,
    maxParticipants: MAX_PARTICIPANTS,
    screenSharingAllowed: true,
    chatAllowed: true,
    startedAt: Date.now(),
    participants,
  };

  rooms.set(roomId, room);

  console.log("========================================");
  console.log("ROOM CREATED:", roomId);
  console.log("Host:", hostId, "(Name:", hostName, ")");
  console.log("========================================");

  return room;
}

function getRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(String(roomId).trim()) || null;
}

function getParticipants(room) {
  if (!room) return [];
  return Array.from(room.participants.values());
}

function isHostOrCoHost(socket, room) {
  if (!room || !socket) return false;
  return room.hostId === socket.id || room.coHosts.has(socket.id);
}

function broadcastParticipants(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  const participants = getParticipants(room);

  io.to(roomId).emit("participants-updated", {
    participants,
    count: participants.length,
    hostId: room.hostId,
    coHosts: Array.from(room.coHosts),
    locked: room.locked,
    maxParticipants: room.maxParticipants,
    screenSharingAllowed: room.screenSharingAllowed,
    chatAllowed: room.chatAllowed,
    startedAt: room.startedAt,
  });
}

function removeEmptyRoom(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  if (room.participants.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (empty).`);
  }
}

// ============================================================
// SOCKET CONNECTION
// ============================================================

io.on("connection", (socket) => {
  console.log("[SOCKET CONNECTED]", socket.id);

  socket.data.roomId = null;
  socket.data.isHost = false;
  socket.data.userName = "";

  // ==========================================================
  // JOIN ROOM
  // ==========================================================

  socket.on("join-room", ({ roomId, name } = {}) => {
    try {
      const cleanRoomId = typeof roomId === "string" ? roomId.trim() : "";
      const cleanName = typeof name === "string" ? name.trim().slice(0, 40) : "";

      if (!cleanRoomId || cleanRoomId.length > 100) {
        socket.emit("room-error", { message: "Valid Room ID is required." });
        return;
      }

      if (!cleanName) {
        socket.emit("room-error", { message: "Your name is required." });
        return;
      }

      if (socket.data.roomId && socket.data.roomId !== cleanRoomId) {
        leaveRoom(socket, socket.data.roomId);
      }

      let room = getRoom(cleanRoomId);

      // Create new room
      if (!room) {
        room = createRoom(cleanRoomId, socket.id, cleanName);

        socket.data.roomId = cleanRoomId;
        socket.data.isHost = true;
        socket.data.userName = cleanName;

        socket.join(cleanRoomId);

        socket.emit("room-joined", {
          roomId: cleanRoomId,
          isHost: true,
          hostId: socket.id,
          coHosts: [],
          locked: false,
          maxParticipants: room.maxParticipants,
          screenSharingAllowed: room.screenSharingAllowed,
          chatAllowed: room.chatAllowed,
          startedAt: room.startedAt,
        });

        socket.emit("room-users", {
          participants: [],
          hostId: room.hostId,
          coHosts: [],
          locked: room.locked,
          maxParticipants: room.maxParticipants,
          screenSharingAllowed: room.screenSharingAllowed,
          chatAllowed: room.chatAllowed,
          startedAt: room.startedAt,
        });

        broadcastParticipants(cleanRoomId);
        return;
      }

      // Existing room validation
      if (room.locked) {
        socket.emit("room-error", { message: "This meeting is locked by the host." });
        return;
      }

      if (room.participants.size >= room.maxParticipants) {
        socket.emit("room-error", {
          message: `Meeting is full. Maximum ${room.maxParticipants} participants allowed.`,
        });
        return;
      }

      if (room.participants.has(socket.id)) {
        socket.emit("room-error", { message: "You are already in this meeting." });
        return;
      }

      const existingParticipants = getParticipants(room).filter(
        (p) => p.socketId !== socket.id
      );

      const participant = {
        socketId: socket.id,
        name: cleanName || `Participant ${room.participants.size + 1}`,
        joinedAt: Date.now(),
        handRaised: false,
        camera: true,
        screen: false,
        microphone: true,
      };

      room.participants.set(socket.id, participant);

      socket.data.roomId = cleanRoomId;
      socket.data.isHost = false;
      socket.data.userName = cleanName;

      socket.join(cleanRoomId);

      socket.emit("room-joined", {
        roomId: cleanRoomId,
        isHost: false,
        hostId: room.hostId,
        coHosts: Array.from(room.coHosts),
        locked: room.locked,
        maxParticipants: room.maxParticipants,
        screenSharingAllowed: room.screenSharingAllowed,
        chatAllowed: room.chatAllowed,
        startedAt: room.startedAt,
      });

      socket.emit("room-users", {
        participants: existingParticipants,
        hostId: room.hostId,
        coHosts: Array.from(room.coHosts),
        locked: room.locked,
        maxParticipants: room.maxParticipants,
        screenSharingAllowed: room.screenSharingAllowed,
        chatAllowed: room.chatAllowed,
        startedAt: room.startedAt,
      });

      socket.to(cleanRoomId).emit("user-joined", {
        socketId: socket.id,
        name: participant.name,
        joinedAt: participant.joinedAt,
        camera: true,
        screen: false,
        microphone: true,
      });

      broadcastParticipants(cleanRoomId);
    } catch (error) {
      console.error("JOIN ROOM ERROR:", error);
      socket.emit("room-error", { message: "An error occurred while joining the meeting." });
    }
  });

  // ==========================================================
  // WEBRTC SIGNALING
  // ==========================================================

  socket.on("offer", ({ target, offer } = {}) => {
    if (!target || !offer) return;
    const room = getRoom(socket.data.roomId);
    if (!room || !room.participants.has(target)) return;
    console.log(`[SIGNAL] OFFER from ${socket.id} -> ${target} room=${socket.data.roomId}`);
    io.to(target).emit("offer", { sender: socket.id, offer });
  });

  socket.on("answer", ({ target, answer } = {}) => {
    if (!target || !answer) return;
    const room = getRoom(socket.data.roomId);
    if (!room || !room.participants.has(target)) return;
    console.log(`[SIGNAL] ANSWER from ${socket.id} -> ${target} room=${socket.data.roomId}`);
    io.to(target).emit("answer", { sender: socket.id, answer });
  });

  socket.on("ice-candidate", ({ target, candidate } = {}) => {
    if (!target || !candidate) return;
    const room = getRoom(socket.data.roomId);
    if (!room || !room.participants.has(target)) return;
    console.log(`[SIGNAL] ICE from ${socket.id} -> ${target} room=${socket.data.roomId}`);
    io.to(target).emit("ice-candidate", { sender: socket.id, candidate });
  });

  socket.on("media-state", ({ roomId, camera, screen, microphone } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    if (!cleanRoomId) return;

    const room = getRoom(cleanRoomId);
    if (!room || !room.participants.has(socket.id)) return;

    const participant = room.participants.get(socket.id);
    if (participant) {
      if (typeof camera === "boolean") participant.camera = camera;
      if (typeof screen === "boolean") participant.screen = screen;
      if (typeof microphone === "boolean") participant.microphone = microphone;
    }

    console.log(`[SIGNAL] event=media-state from=${socket.id} room=${cleanRoomId} camera=${camera} screen=${screen} microphone=${microphone}`);

    socket.to(cleanRoomId).emit("media-state", {
      sender: socket.id,
      camera: Boolean(camera),
      screen: Boolean(screen),
      microphone: Boolean(microphone),
    });
  });

  // ==========================================================
  // CHAT & FILE SHARING
  // ==========================================================

  socket.on("chat-message", ({ roomId, message, name, file } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    if (!cleanRoomId) return;

    const room = getRoom(cleanRoomId);
    if (!room || !room.participants.has(socket.id)) return;

    if (!room.chatAllowed && !isHostOrCoHost(socket, room)) {
      socket.emit("room-error", { message: "Chat is currently disabled by the host." });
      return;
    }

    if (!message && !file) return;

    let validatedFile = null;
    if (file && typeof file === "object") {
      const fileSize = Number(file.size) || 0;
      if (fileSize > 5 * 1024 * 1024) {
        socket.emit("room-error", { message: "File size exceeds 5MB limit." });
        return;
      }
      validatedFile = {
        name: String(file.name || "attachment").slice(0, 100),
        size: fileSize,
        type: String(file.type || "application/octet-stream").slice(0, 50),
        data: String(file.data || ""),
      };
    }

    const payload = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      sender: socket.id,
      name: name || room.participants.get(socket.id)?.name || "Participant",
      message: message ? String(message).trim().slice(0, 2000) : "",
      file: validatedFile,
      timestamp: Date.now(),
    };

    io.to(cleanRoomId).emit("chat-message", payload);
  });

  // ==========================================================
  // RAISE HAND
  // ==========================================================

  socket.on("raise-hand", ({ roomId, raised } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    if (!cleanRoomId) return;

    const room = getRoom(cleanRoomId);
    if (!room || !room.participants.has(socket.id)) return;

    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.handRaised = Boolean(raised);
    }

    io.to(cleanRoomId).emit("raise-hand", {
      sender: socket.id,
      raised: Boolean(raised),
    });

    broadcastParticipants(cleanRoomId);
  });

  // ==========================================================
  // REACTIONS
  // ==========================================================

  socket.on("reaction", ({ roomId, emoji } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    if (!cleanRoomId) return;

    const room = getRoom(cleanRoomId);
    if (!room || !room.participants.has(socket.id)) return;

    if (!emoji || typeof emoji !== "string") return;

    io.to(cleanRoomId).emit("reaction", {
      sender: socket.id,
      emoji: emoji.slice(0, 10),
      timestamp: Date.now(),
    });
  });

  // ==========================================================
  // HOST MODERATION: FORCE MUTE PARTICIPANT
  // ==========================================================

  socket.on("mute-participant", ({ roomId, participantId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (!isHostOrCoHost(socket, room)) {
      socket.emit("room-error", { message: "Only host/co-hosts can mute participants." });
      return;
    }

    if (!participantId || !room.participants.has(participantId)) {
      socket.emit("room-error", { message: "Participant not found." });
      return;
    }

    const targetSocket = io.sockets.sockets.get(participantId);
    if (targetSocket) {
      targetSocket.emit("force-mute", {
        message: "The host has muted your microphone.",
      });
    }
  });

  // ==========================================================
  // HOST MODERATION: REMOVE PARTICIPANT
  // ==========================================================

  const handleRemoveParticipant = ({ roomId, participantId, target } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const targetId = participantId || target;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (!isHostOrCoHost(socket, room)) {
      socket.emit("room-error", { message: "Only host/co-hosts can remove participants." });
      return;
    }

    if (!targetId || !room.participants.has(targetId)) {
      socket.emit("room-error", { message: "Participant is no longer in the meeting." });
      return;
    }

    if (targetId === room.hostId) {
      socket.emit("room-error", { message: "Cannot remove the primary host." });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetId);
    room.participants.delete(targetId);
    room.coHosts.delete(targetId);

    if (targetSocket) {
      targetSocket.leave(cleanRoomId);
      targetSocket.data.roomId = null;
      targetSocket.data.isHost = false;

      targetSocket.emit("participant-removed", {
        message: "You were removed from the meeting by the host.",
        roomId: cleanRoomId,
      });
    }

    io.to(cleanRoomId).emit("user-left", {
      socketId: targetId,
      hostId: room.hostId,
      participants: getParticipants(room),
    });

    broadcastParticipants(cleanRoomId);
  };

  socket.on("remove-participant", handleRemoveParticipant);
  socket.on("host-remove-participant", handleRemoveParticipant);

  // ==========================================================
  // HOST MODERATION: ASSIGN CO-HOST
  // ==========================================================

  socket.on("assign-co-host", ({ roomId, participantId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit("room-error", { message: "Only the primary host can assign co-hosts." });
      return;
    }

    if (!participantId || !room.participants.has(participantId)) {
      socket.emit("room-error", { message: "Participant not found." });
      return;
    }

    if (participantId === room.hostId) return;

    if (room.coHosts.has(participantId)) {
      room.coHosts.delete(participantId);
    } else {
      room.coHosts.add(participantId);
    }

    io.to(cleanRoomId).emit("co-host-updated", {
      coHosts: Array.from(room.coHosts),
    });

    broadcastParticipants(cleanRoomId);
  });

  // ==========================================================
  // HOST MODERATION: TOGGLE SCREEN SHARING PERMISSION
  // ==========================================================

  socket.on("toggle-screen-share-permission", ({ roomId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (!isHostOrCoHost(socket, room)) {
      socket.emit("room-error", { message: "Only host/co-hosts can change permissions." });
      return;
    }

    room.screenSharingAllowed = !room.screenSharingAllowed;

    io.to(cleanRoomId).emit("room-permissions-updated", {
      screenSharingAllowed: room.screenSharingAllowed,
      chatAllowed: room.chatAllowed,
    });

    broadcastParticipants(cleanRoomId);
  });

  // ==========================================================
  // HOST MODERATION: TOGGLE CHAT PERMISSION
  // ==========================================================

  socket.on("toggle-chat-permission", ({ roomId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (!isHostOrCoHost(socket, room)) {
      socket.emit("room-error", { message: "Only host/co-hosts can change permissions." });
      return;
    }

    room.chatAllowed = !room.chatAllowed;

    io.to(cleanRoomId).emit("room-permissions-updated", {
      screenSharingAllowed: room.screenSharingAllowed,
      chatAllowed: room.chatAllowed,
    });

    broadcastParticipants(cleanRoomId);
  });

  // ==========================================================
  // HOST MODERATION: TOGGLE MEETING LOCK
  // ==========================================================

  const handleMeetingLock = ({ roomId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (!isHostOrCoHost(socket, room)) {
      socket.emit("room-error", { message: "Only host/co-hosts can lock or unlock meeting." });
      return;
    }

    room.locked = !room.locked;

    io.to(cleanRoomId).emit("meeting-lock-changed", { locked: room.locked });
    broadcastParticipants(cleanRoomId);
  };

  socket.on("toggle-meeting-lock", handleMeetingLock);
  socket.on("lock-room", handleMeetingLock);

  // ==========================================================
  // HOST MODERATION: END MEETING
  // ==========================================================

  socket.on("end-meeting", ({ roomId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    const room = getRoom(cleanRoomId);

    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit("room-error", { message: "Only the primary host can end the meeting." });
      return;
    }

    const participantIds = Array.from(room.participants.keys());

    io.to(cleanRoomId).emit("meeting-ended", {
      message: "The host has ended the meeting.",
    });

    for (const participantId of participantIds) {
      const participantSocket = io.sockets.sockets.get(participantId);
      if (participantSocket) {
        participantSocket.leave(cleanRoomId);
        participantSocket.data.roomId = null;
        participantSocket.data.isHost = false;
      }
    }

    rooms.delete(cleanRoomId);
    console.log(`Meeting ${cleanRoomId} completely ended.`);
  });

  // ==========================================================
  // LEAVE ROOM & DISCONNECT
  // ==========================================================

  socket.on("leave-room", ({ roomId } = {}) => {
    const cleanRoomId = typeof roomId === "string" ? roomId.trim() : socket.data.roomId;
    leaveRoom(socket, cleanRoomId);
  });

  socket.on("disconnect", (reason) => {
    const roomId = socket.data.roomId;
    if (roomId) {
      leaveRoom(socket, roomId);
    }
  });
});

function leaveRoom(socket, roomId) {
  if (!socket || !roomId) return;
  const room = getRoom(roomId);

  if (!room) {
    socket.data.roomId = null;
    socket.data.isHost = false;
    return;
  }

  const wasHost = room.hostId === socket.id;
  room.participants.delete(socket.id);
  room.coHosts.delete(socket.id);

  socket.to(roomId).emit("user-left", {
    socketId: socket.id,
    participants: getParticipants(room),
    hostId: room.hostId,
  });

  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.isHost = false;

  if (wasHost) {
    const remainingParticipants = getParticipants(room);
    if (remainingParticipants.length > 0) {
      const newHost = remainingParticipants.sort((a, b) => a.joinedAt - b.joinedAt)[0];
      room.hostId = newHost.socketId;

      const newHostSocket = io.sockets.sockets.get(newHost.socketId);
      if (newHostSocket) {
        newHostSocket.data.isHost = true;
        newHostSocket.emit("host-changed", { hostId: newHost.socketId });
      }

      io.to(roomId).emit("host-changed", { hostId: newHost.socketId });
    }
  }

  if (rooms.has(roomId)) {
    broadcastParticipants(roomId);
  }

  removeEmptyRoom(roomId);
}

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log("");
  console.log("========================================");
  console.log("       REAL CONNECT BACKEND SERVER");
  console.log("========================================");
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Client: ${CLIENT_URL}`);
  console.log(`Max Participants: ${MAX_PARTICIPANTS}`);
  console.log("========================================");
  console.log("");
});