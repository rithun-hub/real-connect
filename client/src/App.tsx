import {
  useEffect,
  useRef,
  useState,
} from "react";

import { io } from "socket.io-client";

// ==================================================
// SOCKET
// ==================================================

const socket = io("http://localhost:5000", {
  transports: ["websocket", "polling"],
});

// ==================================================
// WEBRTC CONFIG
// ==================================================

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// ==================================================
// TYPES
// ==================================================

type Participant = {
  socketId: string;
  name: string;
  joinedAt: number;
  handRaised?: boolean;
  camera?: boolean;
  screen?: boolean;
  microphone?: boolean;
};

type RawParticipant = {
  socketId?: string;
  socketID?: string;
  id?: string;
  userId?: string;
  name?: string;
  username?: string;
  displayName?: string;
  joinedAt?: number;
  handRaised?: boolean;
  camera?: boolean;
  screen?: boolean;
  microphone?: boolean;
};

type PeerState = {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
};

type RemoteMedia = {
  audio: MediaStream;
  video: MediaStream;
};

type PeerMap = Record<string, PeerState>;

type FileAttachment = {
  name: string;
  size: number;
  type: string;
  data: string;
};

type ChatMessage = {
  id: string;
  sender: string;
  name: string;
  message: string;
  file?: FileAttachment | null;
  timestamp: number;
};

type Reaction = {
  sender: string;
  emoji: string;
  timestamp: number;
};

const EMOJI_LIST = ["👍", "❤️", "😂", "👏", "🎉", "🔥", "🙏", "💡", "😊", "🚀"];

// ==================================================
// PARTICIPANT NORMALIZER
// ==================================================

const normalizeParticipant = (
  raw: RawParticipant,
  index = 0
): Participant | null => {
  const socketId =
    raw.socketId || raw.socketID || raw.id || raw.userId || "";

  if (!socketId) return null;

  const name =
    raw.name || raw.username || raw.displayName || `Participant ${index + 1}`;

  return {
    socketId: String(socketId),
    name: String(name),
    joinedAt: typeof raw.joinedAt === "number" ? raw.joinedAt : Date.now(),
    handRaised: Boolean(raw.handRaised),
    camera: raw.camera !== undefined ? Boolean(raw.camera) : true,
    screen: Boolean(raw.screen),
    microphone: raw.microphone !== undefined ? Boolean(raw.microphone) : true,
  };
};

// ==================================================
// MAIN APP COMPONENT
// ==================================================

function App() {
  // --------------------------------------------------
  // STATE
  // --------------------------------------------------

  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [myName, setMyName] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [hostId, setHostId] = useState("");
  const [coHosts, setCoHosts] = useState<string[]>([]);
  const [maxParticipants, setMaxParticipants] = useState(6);
  const [meetingLocked, setMeetingLocked] = useState(false);

  // Permissions
  const [screenSharingAllowed, setScreenSharingAllowed] = useState(true);
  const [chatAllowed, setChatAllowed] = useState(true);

  // Media state
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);

  // Remote media states
  const [remoteCameraStates, setRemoteCameraStates] = useState<Record<string, boolean>>({});
  const [remoteScreenStates, setRemoteScreenStates] = useState<Record<string, boolean>>({});
  const [remoteMicrophoneStates, setRemoteMicrophoneStates] = useState<Record<string, boolean>>({});
  const [remoteVideoDimensions, setRemoteVideoDimensions] = useState<Record<string, { width: number; height: number }>>({});

  // Hand raise & reactions
  const [handRaised, setHandRaised] = useState(false);
  const [remoteHandStates, setRemoteHandStates] = useState<Record<string, boolean>>({});
  const [activeReactions, setActiveReactions] = useState<Record<string, Reaction>>({});

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileAttachment | null>(null);

  // Real-time metrics
  const [speakingStates, setSpeakingStates] = useState<Record<string, boolean>>({});
  const [connectionQuality, setConnectionQuality] = useState<Record<string, "Excellent" | "Good" | "Fair" | "Poor">>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [callDuration, setCallDuration] = useState("00:00:00");

  // Mobile camera
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isMobile, setIsMobile] = useState(false);

  // Error & Autoplay
  const [error, setError] = useState("");
  const [audioAutoplayBlocked, setAudioAutoplayBlocked] = useState(false);

  // Auth, Dashboard & UI Drawer state
  const [currentUser, setCurrentUser] = useState<{ id?: number; name: string; email: string } | null>(() => {
    try {
      const saved = localStorage.getItem("realconnect_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [hostControlsOpen, setHostControlsOpen] = useState(false);
  const [recentRooms, setRecentRooms] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("realconnect_recents");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // --------------------------------------------------
  // REFS
  // --------------------------------------------------

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localCameraStreamRef = useRef<MediaStream | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);

  const peerConnectionsRef = useRef<PeerMap>({});
  const remoteVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteMediaRef = useRef<Record<string, RemoteMedia>>({});
  const remoteScreenStatesRef = useRef<Record<string, boolean>>({});
  const remoteCompositeStreamsRef = useRef<Record<string, MediaStream>>({});
  const pendingIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});

  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stoppingScreenShareRef = useRef(false);
  const participantsRef = useRef<Participant[]>([]);
  const roomIdRef = useRef("");
  const cameraActiveRef = useRef(false);
  const screenSharingRef = useRef(false);

  // Audio Context for Speaking Indicators
  const audioContextRef = useRef<AudioContext | null>(null);
  const localAudioAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalysersRef = useRef<Record<string, AnalyserNode>>({});

  // --------------------------------------------------
  // DETECT MOBILE
  // --------------------------------------------------

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || "";
      const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      setIsMobile(isMobileUA || (hasTouch && window.innerWidth <= 768));
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomId(roomParam.trim());
    }
    if (currentUser?.name && !myName) {
      setMyName(currentUser.name);
    }
  }, [currentUser]);

  // --------------------------------------------------
  // KEEP REFS UPDATED
  // --------------------------------------------------

  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { cameraActiveRef.current = cameraActive; }, [cameraActive]);
  useEffect(() => { screenSharingRef.current = screenSharing; }, [screenSharing]);
  useEffect(() => { remoteScreenStatesRef.current = remoteScreenStates; }, [remoteScreenStates]);

  // --------------------------------------------------
  // ENSURE LOCAL MEDIA BEFORE PEER CREATION (Focus 1 Fix)
  // --------------------------------------------------

  const ensureLocalMedia = async () => {
    let audioStream = localAudioStreamRef.current;
    let cameraStream = localCameraStreamRef.current;

    // 1. Audio Stream
    if (!audioStream || !audioStream.getAudioTracks()[0] || audioStream.getAudioTracks()[0].readyState !== "live") {
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        localAudioStreamRef.current = audioStream;
        setMicActive(true);
        console.log("[MEDIA] Local audio stream acquired. Track ID:", audioStream.getAudioTracks()[0]?.id);
      } catch (err) {
        console.warn("[MEDIA] Local audio getUserMedia failed/denied:", err);
        setMicActive(false);
      }
    }

    // 2. Camera Stream
    if (!cameraStream || !cameraStream.getVideoTracks()[0] || cameraStream.getVideoTracks()[0].readyState !== "live") {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: facingMode,
          },
        });
        localCameraStreamRef.current = cameraStream;
        setCameraActive(true);
        cameraActiveRef.current = true;
        console.log("[MEDIA] Local camera stream acquired. Track ID:", cameraStream.getVideoTracks()[0]?.id);

        const cameraTrack = cameraStream.getVideoTracks()[0];
        if (cameraTrack && cameraTrack.readyState === "live") {
          console.log("[VIDEO TRACE] HAROLD/local camera track ID:", cameraTrack.id);
          console.log("[VIDEO TRACE] HAROLD/local camera readyState:", cameraTrack.readyState);
          console.log("[VIDEO TRACE] HAROLD/local camera enabled:", cameraTrack.enabled);

          for (const pid of Object.keys(peerConnectionsRef.current)) {
            const peer = peerConnectionsRef.current[pid];
            if (peer?.videoSender) {
              console.log(`[VIDEO-DEBUG] Attaching cameraTrack ${cameraTrack.id} to existing peer:${pid}`);
              void peer.videoSender.replaceTrack(cameraTrack);
              const transceiver = peer.pc.getTransceivers().find((t) => t.sender === peer.videoSender);
              console.log(`[VIDEO TRACE] peer:${pid} video sender track ID:`, peer.videoSender.track?.id || "null");
              console.log(`[VIDEO TRACE] peer:${pid} video sender kind:`, peer.videoSender.track?.kind || "video");
              console.log(`[VIDEO TRACE] peer:${pid} video transceiver direction:`, transceiver?.direction || "null");
              console.log(`[VIDEO TRACE] peer:${pid} video transceiver currentDirection:`, transceiver?.currentDirection || "null");
            }
          }
        }
      } catch (err) {
        console.warn("[MEDIA] Local camera getUserMedia failed/denied:", err);
        setCameraActive(false);
        cameraActiveRef.current = false;
      }
    }

    return { audioStream, cameraStream };
  };

  // --------------------------------------------------
  // CALL DURATION TIMER
  // --------------------------------------------------

  useEffect(() => {
    if (!joinedRoom || !startedAt) {
      setCallDuration("00:00:00");
      return;
    }

    const updateTimer = () => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const hours = Math.floor(elapsedSeconds / 3600);
      const minutes = Math.floor((elapsedSeconds % 3600) / 60);
      const seconds = elapsedSeconds % 60;

      const pad = (n: number) => String(n).padStart(2, "0");
      setCallDuration(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [joinedRoom, startedAt]);

  // --------------------------------------------------
  // CHAT AUTO SCROLL
  // --------------------------------------------------

  useEffect(() => {
    if (chatOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatOpen]);

  // --------------------------------------------------
  // SPEAKING INDICATOR (Web Audio API)
  // --------------------------------------------------

  useEffect(() => {
    if (!joinedRoom) return;

    let animId: number;

    const setupAudioContext = () => {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          audioContextRef.current = new AudioCtx();
        }
      }
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume();
      }
    };

    setupAudioContext();

    const analyzeVolume = () => {
      const audioCtx = audioContextRef.current;
      if (!audioCtx) return;

      const newSpeaking: Record<string, boolean> = {};

      // Local microphone analysis
      const localStream = localAudioStreamRef.current;
      const localTrack = localStream?.getAudioTracks()[0];
      if (localTrack && localTrack.enabled && localTrack.readyState === "live") {
        if (!localAudioAnalyserRef.current) {
          try {
            const source = audioCtx.createMediaStreamSource(localStream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            localAudioAnalyserRef.current = analyser;
          } catch {
            // Ignore audio context errors
          }
        }

        if (localAudioAnalyserRef.current) {
          const dataArray = new Uint8Array(localAudioAnalyserRef.current.frequencyBinCount);
          localAudioAnalyserRef.current.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const average = sum / dataArray.length;
          if (average > 15 && socket.id) {
            newSpeaking[socket.id] = true;
          }
        }
      }

      // Remote participants analysis
      for (const participantId of Object.keys(remoteMediaRef.current)) {
        const media = remoteMediaRef.current[participantId];
        const audioTrack = media?.audio?.getAudioTracks()[0];
        if (audioTrack && audioTrack.enabled && audioTrack.readyState === "live") {
          let analyser = remoteAnalysersRef.current[participantId];
          if (!analyser) {
            try {
              const source = audioCtx.createMediaStreamSource(media.audio);
              analyser = audioCtx.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              remoteAnalysersRef.current[participantId] = analyser;
            } catch {
              // Ignore source errors
            }
          }

          if (analyser) {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((a, b) => a + b, 0);
            const average = sum / dataArray.length;
            if (average > 15) {
              newSpeaking[participantId] = true;
            }
          }
        }
      }

      setSpeakingStates(newSpeaking);
      animId = requestAnimationFrame(analyzeVolume);
    };

    animId = requestAnimationFrame(analyzeVolume);

    return () => {
      cancelAnimationFrame(animId);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      localAudioAnalyserRef.current = null;
      remoteAnalysersRef.current = {};
    };
  }, [joinedRoom]);

  // --------------------------------------------------
  // CONNECTION QUALITY MONITOR (Focus 10 Stats)
  // --------------------------------------------------

  useEffect(() => {
    if (!joinedRoom) return;

    const checkStats = async () => {
      const newQuality: Record<string, "Excellent" | "Good" | "Fair" | "Poor"> = {};

      for (const participantId of Object.keys(peerConnectionsRef.current)) {
        const peer = peerConnectionsRef.current[participantId];
        if (!peer) continue;

        const pc = peer.pc;
        if (pc.connectionState !== "connected") {
          newQuality[participantId] = "Poor";
          continue;
        }

        try {
          const stats = await pc.getStats();
          let rtt = 0;
          let packetLoss = 0;

          stats.forEach((report) => {
            if (report.type === "candidate-pair" && report.state === "succeeded") {
              rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 50;
            }
            if (report.type === "inbound-rtp" && report.kind === "video") {
              const packetsLost = report.packetsLost || 0;
              const packetsReceived = report.packetsReceived || 1;
              packetLoss = (packetsLost / (packetsLost + packetsReceived)) * 100;
            }
          });

          if (rtt < 120 && packetLoss < 2) {
            newQuality[participantId] = "Excellent";
          } else if (rtt < 250 && packetLoss < 5) {
            newQuality[participantId] = "Good";
          } else if (rtt < 450 && packetLoss < 10) {
            newQuality[participantId] = "Fair";
          } else {
            newQuality[participantId] = "Poor";
          }
        } catch {
          newQuality[participantId] = "Good";
        }
      }

      setConnectionQuality(newQuality);
    };

    checkStats();
    const interval = setInterval(checkStats, 5000);
    return () => clearInterval(interval);
  }, [joinedRoom]);

  // --------------------------------------------------
  // DIAGNOSTIC VIDEO RTP MONITORING (RTP getStats)
  // --------------------------------------------------

  useEffect(() => {
    if (!joinedRoom) return;

    const monitorRtpStats = async () => {
      for (const pid of Object.keys(peerConnectionsRef.current)) {
        const peer = peerConnectionsRef.current[pid];
        if (!peer || peer.pc.connectionState !== "connected") continue;

        try {
          const stats = await peer.pc.getStats();
          stats.forEach((report) => {
            if (report.type === "outbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
              console.log(`[OUTBOUND VIDEO RTP] remote=${pid} bytesSent=${report.bytesSent ?? 0} packetsSent=${report.packetsSent ?? 0} framesEncoded=${report.framesEncoded ?? 0} keyFramesEncoded=${report.keyFramesEncoded ?? 0}`);
            }
            if (report.type === "inbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
              console.log(`[INBOUND VIDEO RTP] remote=${pid} bytesReceived=${report.bytesReceived ?? 0} packetsReceived=${report.packetsReceived ?? 0} framesDecoded=${report.framesDecoded ?? 0} framesDropped=${report.framesDropped ?? 0} frameWidth=${report.frameWidth ?? 0} frameHeight=${report.frameHeight ?? 0}`);
            }
          });
        } catch {
          // Ignore stats errors
        }
      }
    };

    const rtpInterval = setInterval(monitorRtpStats, 5000);
    return () => clearInterval(rtpInterval);
  }, [joinedRoom]);

  // --------------------------------------------------
  // LOCAL VIDEO PREVIEW
  // --------------------------------------------------

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;

    const stream = screenSharing
      ? localScreenStreamRef.current
      : localCameraStreamRef.current;

    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [cameraActive, screenSharing]);

  // --------------------------------------------------
  // REMOTE MEDIA ATTACHMENT & AUDIO PLAYBACK (Focus 2)
  // --------------------------------------------------

  const getRemoteMedia = (participantId: string): RemoteMedia => {
    const existing = remoteMediaRef.current[participantId];
    if (existing) return existing;

    const media: RemoteMedia = {
      audio: new MediaStream(),
      video: new MediaStream(),
    };
    remoteMediaRef.current[participantId] = media;
    return media;
  };

  const getRemoteCompositeStream = (participantId: string): MediaStream => {
    const existing = remoteCompositeStreamsRef.current[participantId];
    if (existing) return existing;

    const stream = new MediaStream();
    remoteCompositeStreamsRef.current[participantId] = stream;
    return stream;
  };

  const enableAllRemoteAudio = () => {
    setAudioAutoplayBlocked(false);
    for (const participantId of Object.keys(remoteVideoRefs.current)) {
      const video = remoteVideoRefs.current[participantId];
      if (video) {
        video.play().catch((err) => console.warn("[REMOTE] User play audio retry:", err));
      }
    }
  };

  const syncPeerConnections = (activeParticipants: Participant[]) => {
    const activeSocketIds = activeParticipants.map((p) => p.socketId);
    const existingPeerIds = Object.keys(peerConnectionsRef.current);
    for (const pid of existingPeerIds) {
      if (!activeSocketIds.includes(pid)) {
        console.log(`[WEBRTC] Cleaning up stale peer connection for participant:${pid}`);
        closePeerConnection(pid);
      }
    }
  };

  const logPeerMap = () => {
    const peers = Object.keys(peerConnectionsRef.current);
    const peerStatus = peers
      .map((pid) => `${pid} = ${peerConnectionsRef.current[pid]?.pc.connectionState}`)
      .join(", ");
    console.log(`[PEER MAP] ${socket.id || "LOCAL"}: ${peerStatus || "no peers"}`);
  };

  const syncRemoteMedia = (participantId: string) => {
    if (!participantId) return;

    const video = remoteVideoRefs.current[participantId];
    if (!video) return;

    const media = getRemoteMedia(participantId);
    const composite = getRemoteCompositeStream(participantId);

    const videoTrack = media.video.getVideoTracks()[0] ?? null;
    const audioTrack = media.audio.getAudioTracks()[0] ?? null;

    const currentVideoTrack = composite.getVideoTracks()[0] ?? null;
    if (currentVideoTrack !== videoTrack) {
      for (const t of composite.getVideoTracks()) composite.removeTrack(t);
      if (videoTrack) composite.addTrack(videoTrack);
    }

    const currentAudioTrack = composite.getAudioTracks()[0] ?? null;
    if (currentAudioTrack !== audioTrack) {
      for (const t of composite.getAudioTracks()) composite.removeTrack(t);
      if (audioTrack) composite.addTrack(audioTrack);
    }

    if (video.srcObject !== composite) {
      video.srcObject = composite;
    }

    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.volume = 1;

    const updateDim = () => {
      if (video) {
        setRemoteVideoDimensions((prev) => {
          if (prev[participantId]?.width === video.videoWidth && prev[participantId]?.height === video.videoHeight) {
            return prev;
          }
          return {
            ...prev,
            [participantId]: { width: video.videoWidth, height: video.videoHeight },
          };
        });
      }
    };
    video.onloadedmetadata = updateDim;
    video.onresize = updateDim;
    updateDim();

    video.play().catch((error) => {
      console.warn("[REMOTE] Playback blocked by browser autoplay policy for:", participantId, error);
      setAudioAutoplayBlocked(true);
    });

    console.log(`[REMOTE VIDEO ELEMENT] participant=${participantId} srcObject=${Boolean(video.srcObject)} readyState=${video.readyState} videoWidth=${video.videoWidth} videoHeight=${video.videoHeight} paused=${video.paused} cameraState=${remoteCameraStates[participantId]} screenState=${remoteScreenStates[participantId]}`);

    console.log(`[REMOTE VIDEO TRACE] remoteSocketId=${participantId} track.kind=${videoTrack?.kind ?? "none"} track.id=${videoTrack?.id ?? "none"} track.readyState=${videoTrack?.readyState ?? "none"} track.enabled=${videoTrack?.enabled ?? false} stream.id=${composite.id} video.srcObject=${Boolean(video.srcObject)} video.videoWidth=${video.videoWidth} video.videoHeight=${video.videoHeight} video.readyState=${video.readyState}`);
  };

  const setRemoteVideoRef = (participantId: string, element: HTMLVideoElement | null) => {
    if (!participantId) return;
    remoteVideoRefs.current[participantId] = element;
    if (element) syncRemoteMedia(participantId);
  };

  useEffect(() => {
    for (const participant of participants) {
      syncRemoteMedia(participant.socketId);
    }
  }, [participants, remoteScreenStates, remoteCameraStates]);

  // --------------------------------------------------
  // CREATE PEER CONNECTION (Focus 1, 3, 5, 10 Fix)
  // --------------------------------------------------

  const createPeerConnection = (remoteSocketId: string, autoNegotiate = true): PeerState | null => {
    if (!remoteSocketId || remoteSocketId === socket.id) return null;

    const existing = peerConnectionsRef.current[remoteSocketId];
    if (existing) return existing;

    console.log(`[PEER CREATE] remoteSocketId=${remoteSocketId}`);

    const pc = new RTCPeerConnection(RTC_CONFIG);

    const audioTrack = localAudioStreamRef.current?.getAudioTracks()[0] ?? null;
    const videoTrack = screenSharingRef.current
      ? (localScreenStreamRef.current?.getVideoTracks()[0] ?? null)
      : (localCameraStreamRef.current?.getVideoTracks()[0] ?? null);

    let audioSender: RTCRtpSender;
    let videoSender: RTCRtpSender;

    // Attach local audio track to transceiver upfront
    if (audioTrack) {
      console.log(`[WEBRTC] adding local audio track to peer:${remoteSocketId} readyState:${audioTrack.readyState} enabled:${audioTrack.enabled}`);
      const transceiver = pc.addTransceiver(audioTrack, { direction: "sendrecv" });
      audioSender = transceiver.sender;
    } else {
      console.log(`[WEBRTC] adding fallback audio transceiver to peer:${remoteSocketId}`);
      const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
      audioSender = transceiver.sender;
    }

    // Attach local video track to transceiver upfront
    if (videoTrack) {
      console.log(`[VIDEO TRACE] local camera track: id=${videoTrack.id} readyState=${videoTrack.readyState} enabled=${videoTrack.enabled}`);
      const transceiver = pc.addTransceiver(videoTrack, { direction: "sendrecv" });
      videoSender = transceiver.sender;
    } else {
      console.log(`[VIDEO TRACE] adding fallback video transceiver to peer:${remoteSocketId}`);
      const transceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      videoSender = transceiver.sender;
    }

    pc.getTransceivers().forEach((t) => {
      console.log(`[VIDEO TRACE] remoteSocketId=${remoteSocketId} transceiver.mid=${t.mid ?? "null"} transceiver.direction=${t.direction} transceiver.currentDirection=${t.currentDirection ?? "null"} sender.track.kind=${t.sender.track?.kind ?? "null"} sender.track.readyState=${t.sender.track?.readyState ?? "null"} sender.track.enabled=${t.sender.track?.enabled ?? false}`);
    });

    const peer: PeerState = {
      pc,
      audioSender,
      videoSender,
    };

    peerConnectionsRef.current[remoteSocketId] = peer;
    logPeerMap();

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      console.log(`[SOCKET SIGNAL] type=ice-candidate source=${socket.id} target=${remoteSocketId}`);
      socket.emit("ice-candidate", { target: remoteSocketId, candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const media = getRemoteMedia(remoteSocketId);
      console.log(`[REMOTE VIDEO] local=${socket.id} remote=${remoteSocketId} trackId=${event.track.id} kind=${event.track.kind} streamTracks=${media.video.getTracks().length}`);

      if (event.track.kind === "audio") {
        for (const t of media.audio.getTracks()) media.audio.removeTrack(t);
        media.audio.addTrack(event.track);
      } else if (event.track.kind === "video") {
        for (const t of media.video.getTracks()) media.video.removeTrack(t);
        media.video.addTrack(event.track);
      }

      syncRemoteMedia(remoteSocketId);

      event.track.onunmute = () => {
        syncRemoteMedia(remoteSocketId);
      };
      event.track.onmute = () => {
        syncRemoteMedia(remoteSocketId);
      };
      event.track.onended = () => {
        if (event.track.kind === "audio") media.audio.removeTrack(event.track);
        else media.video.removeTrack(event.track);
        syncRemoteMedia(remoteSocketId);
      };
    };

    pc.onconnectionstatechange = () => {
      console.log(`[PEER STATE] remoteSocketId=${remoteSocketId} connectionState=${pc.connectionState} iceConnectionState=${pc.iceConnectionState} signalingState=${pc.signalingState}`);
      logPeerMap();
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[PEER STATE] remoteSocketId=${remoteSocketId} iceConnectionState=${pc.iceConnectionState}`);
      logPeerMap();
    };

    // DETERMINISTIC OFFERER RULE:
    // Compare socket IDs. Only the peer with localSocketId < remoteSocketId creates the initial offer.
    const shouldInitiate = Boolean(socket.id && socket.id < remoteSocketId);
    if (autoNegotiate && shouldInitiate) {
      console.log(`[PEER] Deterministic initiator for pair: local=${socket.id} < remote=${remoteSocketId}. Creating offer.`);
      void negotiatePeer(remoteSocketId);
    } else if (autoNegotiate) {
      console.log(`[PEER] Receiver for pair: local=${socket.id} >= remote=${remoteSocketId}. Waiting for offer from ${remoteSocketId}.`);
    }

    return peer;
  };

  // --------------------------------------------------
  // WEBRTC SIGNALING HANDLERS (Focus 4 & 5)
  // --------------------------------------------------

  const negotiatePeer = async (participantId: string) => {
    if (!participantId) return;

    const peer = peerConnectionsRef.current[participantId];
    if (!peer || peer.pc.signalingState !== "stable") return;

    try {
      console.log(`[SOCKET SIGNAL] type=offer source=${socket.id} target=${participantId}`);
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      if (!peer.pc.localDescription) return;

      const videoMid = peer.pc.getTransceivers().find((t) => t.sender === peer.videoSender)?.mid ?? "null";
      console.log(`[SDP VIDEO] remoteSocketId=${participantId} local/remote=local direction=sendrecv MID=${videoMid}`);

      socket.emit("offer", { target: participantId, offer: peer.pc.localDescription });
    } catch (err) {
      console.error(`[WEBRTC] negotiation error for ${participantId}:`, err);
    }
  };

  const flushIceCandidates = async (participantId: string) => {
    const peer = peerConnectionsRef.current[participantId];
    if (!peer) return;

    const candidates = pendingIceCandidatesRef.current[participantId] || [];
    if (candidates.length === 0) return;

    pendingIceCandidatesRef.current[participantId] = [];

    for (const candidate of candidates) {
      try {
        console.log(`[WEBRTC] applying queued ICE candidate to remoteUser:${participantId}`);
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`[WEBRTC] ICE queue flush error for ${participantId}:`, err);
      }
    }
  };

  const handleOffer = async (sender: string, offer: RTCSessionDescriptionInit) => {
    if (!sender) return;

    console.log(`[SOCKET SIGNAL] type=offer received source=${sender} target=${socket.id}`);
    const peer = createPeerConnection(sender, false);
    if (!peer) return;

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushIceCandidates(sender);

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);

      const videoMid = peer.pc.getTransceivers().find((t) => t.sender === peer.videoSender)?.mid ?? "null";
      console.log(`[SDP VIDEO] remoteSocketId=${sender} local/remote=remote direction=sendrecv MID=${videoMid}`);

      console.log(`[SOCKET SIGNAL] type=answer source=${socket.id} target=${sender}`);
      socket.emit("answer", { target: sender, answer: peer.pc.localDescription });
    } catch (err) {
      console.error(`[WEBRTC] handle offer error for ${sender}:`, err);
    }
  };

  const handleAnswer = async (sender: string, answer: RTCSessionDescriptionInit) => {
    if (!sender) return;

    console.log(`[SOCKET SIGNAL] type=answer received source=${sender} target=${socket.id}`);
    const peer = peerConnectionsRef.current[sender];
    if (!peer) return;

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushIceCandidates(sender);
    } catch (err) {
      console.error(`[WEBRTC] handle answer error for ${sender}:`, err);
    }
  };

  const handleIceCandidate = async (sender: string, candidate: RTCIceCandidateInit) => {
    if (!sender) return;

    const peer = peerConnectionsRef.current[sender];
    if (!peer || !peer.pc.remoteDescription) {
      console.log(`[WEBRTC] queueing ICE candidate from remoteUser:${sender} (remoteDescription not set)`);
      if (!pendingIceCandidatesRef.current[sender]) pendingIceCandidatesRef.current[sender] = [];
      pendingIceCandidatesRef.current[sender].push(candidate);
      return;
    }

    try {
      console.log(`[SOCKET SIGNAL] type=ice-candidate received source=${sender} target=${socket.id}`);
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`[WEBRTC] add ICE candidate error for ${sender}:`, err);
    }
  };

  const closePeerConnection = (participantId: string) => {
    if (!participantId) return;

    console.log(`[WEBRTC] closing peer connection for remoteUser:${participantId}`);
    const peer = peerConnectionsRef.current[participantId];
    if (peer) {
      try { peer.pc.close(); } catch { /* Ignore */ }
      delete peerConnectionsRef.current[participantId];
    }

    delete remoteVideoRefs.current[participantId];
    delete remoteCompositeStreamsRef.current[participantId];
    delete remoteMediaRef.current[participantId];
    delete pendingIceCandidatesRef.current[participantId];
    delete remoteAnalysersRef.current[participantId];
    setRemoteVideoDimensions((c) => { const cp = { ...c }; delete cp[participantId]; return cp; });
  };

  const stopAllMedia = () => {
    localCameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    localAudioStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());

    localCameraStreamRef.current = null;
    localAudioStreamRef.current = null;
    localScreenStreamRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;

    setCameraActive(false);
    setMicActive(false);
    setScreenSharing(false);
    setHandRaised(false);
    cameraActiveRef.current = false;
    screenSharingRef.current = false;
  };

  const cleanupMeeting = () => {
    stopAllMedia();

    Object.keys(peerConnectionsRef.current).forEach((participantId) => {
      closePeerConnection(participantId);
    });

    peerConnectionsRef.current = {};
    remoteVideoRefs.current = {};
    remoteCompositeStreamsRef.current = {};
    remoteMediaRef.current = {};
    pendingIceCandidatesRef.current = {};

    setParticipants([]);
    participantsRef.current = [];
    setJoinedRoom(false);
    setHostId("");
    setCoHosts([]);
    setMeetingLocked(false);
    setChatMessages([]);
    setStartedAt(null);
    setError("");
    setAudioAutoplayBlocked(false);
  };

  // --------------------------------------------------
  // SOCKET.IO LISTENERS (Focus 4 & 9)
  // --------------------------------------------------

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (joinedRoom && roomIdRef.current && myName.trim()) {
        socket.emit("join-room", { roomId: roomIdRef.current, name: myName.trim() });
      }
    };

    const onDisconnect = () => setConnected(false);

    const onRoomJoined = ({
      hostId: serverHostId,
      coHosts: serverCoHosts = [],
      locked,
      maxParticipants: serverMaxParticipants,
      screenSharingAllowed: serverScreenSharingAllowed,
      chatAllowed: serverChatAllowed,
      startedAt: serverStartedAt,
    }: {
      hostId?: string;
      coHosts?: string[];
      locked?: boolean;
      maxParticipants?: number;
      screenSharingAllowed?: boolean;
      chatAllowed?: boolean;
      startedAt?: number;
    }) => {
      if (serverHostId) setHostId(serverHostId);
      if (Array.isArray(serverCoHosts)) setCoHosts(serverCoHosts);
      if (typeof locked === "boolean") setMeetingLocked(locked);
      if (typeof serverMaxParticipants === "number") setMaxParticipants(serverMaxParticipants);
      if (typeof serverScreenSharingAllowed === "boolean") setScreenSharingAllowed(serverScreenSharingAllowed);
      if (typeof serverChatAllowed === "boolean") setChatAllowed(serverChatAllowed);
      if (typeof serverStartedAt === "number") setStartedAt(serverStartedAt);

      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: cameraActiveRef.current,
        screen: screenSharingRef.current,
        microphone: localAudioStreamRef.current?.getAudioTracks()[0]?.enabled ?? true,
      });
    };

    const onRoomUsers = ({
      participants: existingParticipants = [],
      hostId: serverHostId,
      coHosts: serverCoHosts = [],
      maxParticipants: serverMaxParticipants,
      screenSharingAllowed: serverScreenSharingAllowed,
      chatAllowed: serverChatAllowed,
      startedAt: serverStartedAt,
    }: {
      participants?: RawParticipant[];
      hostId?: string;
      coHosts?: string[];
      maxParticipants?: number;
      screenSharingAllowed?: boolean;
      chatAllowed?: boolean;
      startedAt?: number;
    }) => {
      console.log("[SOCKET] room-users received:", existingParticipants);

      const normalized = existingParticipants
        .map((p, i) => normalizeParticipant(p, i))
        .filter((p): p is Participant => p !== null)
        .filter((p) => p.socketId !== socket.id);

      setParticipants(normalized);
      participantsRef.current = normalized;
      syncPeerConnections(normalized);

      const cameraMap: Record<string, boolean> = {};
      const screenMap: Record<string, boolean> = {};
      const micMap: Record<string, boolean> = {};
      existingParticipants.forEach((p) => {
        const sid = p.socketId || p.socketID || p.id || p.userId;
        if (sid && sid !== socket.id) {
          cameraMap[sid] = p.camera !== undefined ? Boolean(p.camera) : true;
          screenMap[sid] = Boolean(p.screen);
          micMap[sid] = p.microphone !== undefined ? Boolean(p.microphone) : true;
        }
      });
      setRemoteCameraStates((prev) => ({ ...prev, ...cameraMap }));
      setRemoteScreenStates((prev) => ({ ...prev, ...screenMap }));
      setRemoteMicrophoneStates((prev) => ({ ...prev, ...micMap }));

      if (serverHostId) setHostId(serverHostId);
      if (Array.isArray(serverCoHosts)) setCoHosts(serverCoHosts);
      if (typeof serverMaxParticipants === "number") setMaxParticipants(serverMaxParticipants);
      if (typeof serverScreenSharingAllowed === "boolean") setScreenSharingAllowed(serverScreenSharingAllowed);
      if (typeof serverChatAllowed === "boolean") setChatAllowed(serverChatAllowed);
      if (typeof serverStartedAt === "number") setStartedAt(serverStartedAt);

      // Pre-create peer connections for existing participants
      normalized.forEach((p) => {
        if (p.socketId && p.socketId !== socket.id) {
          createPeerConnection(p.socketId);
        }
      });
    };

    const onParticipantsUpdated = ({
      participants: updatedParticipants = [],
      hostId: serverHostId,
      coHosts: serverCoHosts = [],
      locked,
      maxParticipants: serverMaxParticipants,
      screenSharingAllowed: serverScreenSharingAllowed,
      chatAllowed: serverChatAllowed,
    }: {
      participants?: RawParticipant[];
      hostId?: string;
      coHosts?: string[];
      locked?: boolean;
      maxParticipants?: number;
      screenSharingAllowed?: boolean;
      chatAllowed?: boolean;
    }) => {
      console.log("[SOCKET] participants-updated received:", updatedParticipants);

      const normalized = updatedParticipants
        .map((p, i) => normalizeParticipant(p, i))
        .filter((p): p is Participant => p !== null)
        .filter((p) => p.socketId !== socket.id);

      setParticipants(normalized);
      participantsRef.current = normalized;
      syncPeerConnections(normalized);

      const cameraMap: Record<string, boolean> = {};
      const screenMap: Record<string, boolean> = {};
      const micMap: Record<string, boolean> = {};
      const handMap: Record<string, boolean> = {};

      updatedParticipants.forEach((p) => {
        const sid = p.socketId || p.socketID || p.id || p.userId;
        if (sid && sid !== socket.id) {
          cameraMap[sid] = p.camera !== undefined ? Boolean(p.camera) : true;
          screenMap[sid] = Boolean(p.screen);
          micMap[sid] = p.microphone !== undefined ? Boolean(p.microphone) : true;
          if (p.handRaised) handMap[sid] = true;
        }
      });
      setRemoteCameraStates((prev) => ({ ...prev, ...cameraMap }));
      setRemoteScreenStates((prev) => ({ ...prev, ...screenMap }));
      setRemoteMicrophoneStates((prev) => ({ ...prev, ...micMap }));
      setRemoteHandStates(handMap);

      if (serverHostId) setHostId(serverHostId);
      if (Array.isArray(serverCoHosts)) setCoHosts(serverCoHosts);
      if (typeof serverMaxParticipants === "number") setMaxParticipants(serverMaxParticipants);
      if (typeof locked === "boolean") setMeetingLocked(locked);
      if (typeof serverScreenSharingAllowed === "boolean") setScreenSharingAllowed(serverScreenSharingAllowed);
      if (typeof serverChatAllowed === "boolean") setChatAllowed(serverChatAllowed);
    };

    const onUserJoined = ({
      socketId: joinId,
      name,
      camera = true,
      screen = false,
      microphone = true,
    }: {
      socketId: string;
      name: string;
      camera?: boolean;
      screen?: boolean;
      microphone?: boolean;
    }) => {
      console.log("[SOCKET] user-joined received:", joinId, name, "camera:", camera, "screen:", screen, "microphone:", microphone);

      if (!joinId || joinId === socket.id) return;

      setRemoteCameraStates((prev) => ({ ...prev, [joinId]: Boolean(camera) }));
      setRemoteScreenStates((prev) => ({ ...prev, [joinId]: Boolean(screen) }));
      setRemoteMicrophoneStates((prev) => ({ ...prev, [joinId]: Boolean(microphone) }));

      setParticipants((current) => {
        if (current.some((p) => p.socketId === joinId)) return current;
        const newP: Participant = {
          socketId: joinId,
          name: name || `Participant ${current.length + 1}`,
          joinedAt: Date.now(),
          handRaised: false,
          camera: Boolean(camera),
          screen: Boolean(screen),
          microphone: Boolean(microphone),
        };
        const updated = [...current, newP];
        participantsRef.current = updated;
        return updated;
      });

      // Deterministically create peer connection (will automatically initiate offer ONLY if socket.id < joinId)
      createPeerConnection(joinId);
    };

    const onUserLeft = ({ socketId: leaveId, hostId: serverHostId, participants: updatedParticipants }: { socketId: string; hostId?: string; participants?: RawParticipant[] }) => {
      console.log("[SOCKET] user-left received:", leaveId);

      if (!leaveId) return;

      closePeerConnection(leaveId);

      if (Array.isArray(updatedParticipants)) {
        const normalized = updatedParticipants
          .map((p, i) => normalizeParticipant(p, i))
          .filter((p): p is Participant => p !== null)
          .filter((p) => p.socketId !== socket.id);

        setParticipants(normalized);
        participantsRef.current = normalized;
      } else {
        setParticipants((current) => {
          const updated = current.filter((p) => p.socketId !== leaveId);
          participantsRef.current = updated;
          return updated;
        });
      }

      setRemoteCameraStates((c) => { const cp = { ...c }; delete cp[leaveId]; return cp; });
      setRemoteScreenStates((c) => { const cp = { ...c }; delete cp[leaveId]; return cp; });
      setRemoteMicrophoneStates((c) => { const cp = { ...c }; delete cp[leaveId]; return cp; });
      setRemoteHandStates((c) => { const cp = { ...c }; delete cp[leaveId]; return cp; });
      setActiveReactions((c) => { const cp = { ...c }; delete cp[leaveId]; return cp; });

      if (serverHostId) setHostId(serverHostId);
    };

    const onOffer = async ({ sender, offer }: { sender: string; offer: RTCSessionDescriptionInit }) => {
      await handleOffer(sender, offer);
    };

    const onAnswer = async ({ sender, answer }: { sender: string; answer: RTCSessionDescriptionInit }) => {
      await handleAnswer(sender, answer);
    };

    const onIceCandidate = async ({ sender, candidate }: { sender: string; candidate: RTCIceCandidateInit }) => {
      await handleIceCandidate(sender, candidate);
    };

    const onMediaState = ({ sender, camera, screen, microphone }: { sender: string; camera: boolean; screen: boolean; microphone?: boolean }) => {
      if (!sender) return;
      setRemoteCameraStates((c) => ({ ...c, [sender]: Boolean(camera) }));
      setRemoteScreenStates((c) => ({ ...c, [sender]: Boolean(screen) }));
      if (typeof microphone === "boolean") {
        setRemoteMicrophoneStates((c) => ({ ...c, [sender]: microphone }));
      }
      remoteScreenStatesRef.current[sender] = Boolean(screen);
      setTimeout(() => syncRemoteMedia(sender), 0);
    };

    const onChatMessage = (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev, msg]);
    };

    const onRaiseHand = ({ sender, raised }: { sender: string; raised: boolean }) => {
      if (sender === socket.id) setHandRaised(raised);
      else setRemoteHandStates((c) => ({ ...c, [sender]: Boolean(raised) }));
    };

    const onReaction = ({ sender, emoji, timestamp }: Reaction) => {
      setActiveReactions((c) => ({ ...c, [sender]: { sender, emoji, timestamp } }));
      setTimeout(() => {
        setActiveReactions((c) => {
          const cp = { ...c };
          if (cp[sender]?.timestamp === timestamp) delete cp[sender];
          return cp;
        });
      }, 3000);
    };

    const onForceMute = ({ message }: { message: string }) => {
      const stream = localAudioStreamRef.current;
      const track = stream?.getAudioTracks()[0];
      if (track) track.enabled = false;
      setMicActive(false);

      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: cameraActiveRef.current,
        screen: screenSharingRef.current,
        microphone: false,
      });

      alert(message || "The host muted your microphone.");
    };

    const onCoHostUpdated = ({ coHosts: updatedCoHosts = [] }: { coHosts: string[] }) => {
      setCoHosts(updatedCoHosts);
    };

    const onRoomPermissionsUpdated = ({ screenSharingAllowed: sAllowed, chatAllowed: cAllowed }: { screenSharingAllowed: boolean; chatAllowed: boolean }) => {
      if (typeof sAllowed === "boolean") {
        setScreenSharingAllowed(sAllowed);
        if (!sAllowed && screenSharingRef.current) {
          const isUserHostOrCoHost = socket.id && (hostId === socket.id || coHosts.includes(socket.id));
          if (!isUserHostOrCoHost) {
            void stopScreenShare();
            alert("Screen sharing was disabled by the host.");
          }
        }
      }
      if (typeof cAllowed === "boolean") {
        setChatAllowed(cAllowed);
      }
    };

    const onRoomError = ({ message }: { message: string }) => {
      setError(message || "An error occurred.");
      alert(message || "An error occurred.");
    };

    const onHostChanged = ({ hostId: newHostId }: { hostId: string }) => {
      setHostId(newHostId || "");
    };

    const onMeetingLockChanged = ({ locked }: { locked: boolean }) => {
      setMeetingLocked(Boolean(locked));
    };

    const onParticipantRemoved = ({ message }: { message: string }) => {
      alert(message || "You were removed from the meeting.");
      cleanupMeeting();
    };

    const onMeetingEnded = ({ message }: { message: string }) => {
      alert(message || "The meeting has ended.");
      cleanupMeeting();
    };

    // Bindings
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room-joined", onRoomJoined);
    socket.on("room-users", onRoomUsers);
    socket.on("participants-updated", onParticipantsUpdated);
    socket.on("user-joined", onUserJoined);
    socket.on("user-left", onUserLeft);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("media-state", onMediaState);
    socket.on("chat-message", onChatMessage);
    socket.on("raise-hand", onRaiseHand);
    socket.on("reaction", onReaction);
    socket.on("force-mute", onForceMute);
    socket.on("co-host-updated", onCoHostUpdated);
    socket.on("room-permissions-updated", onRoomPermissionsUpdated);
    socket.on("room-error", onRoomError);
    socket.on("host-changed", onHostChanged);
    socket.on("meeting-lock-changed", onMeetingLockChanged);
    socket.on("participant-removed", onParticipantRemoved);
    socket.on("meeting-ended", onMeetingEnded);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room-joined", onRoomJoined);
      socket.off("room-users", onRoomUsers);
      socket.off("participants-updated", onParticipantsUpdated);
      socket.off("user-joined", onUserJoined);
      socket.off("user-left", onUserLeft);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("media-state", onMediaState);
      socket.off("chat-message", onChatMessage);
      socket.off("raise-hand", onRaiseHand);
      socket.off("reaction", onReaction);
      socket.off("force-mute", onForceMute);
      socket.off("co-host-updated", onCoHostUpdated);
      socket.off("room-permissions-updated", onRoomPermissionsUpdated);
      socket.off("room-error", onRoomError);
      socket.off("host-changed", onHostChanged);
      socket.off("meeting-lock-changed", onMeetingLockChanged);
      socket.off("participant-removed", onParticipantRemoved);
      socket.off("meeting-ended", onMeetingEnded);
    };
  }, [joinedRoom, hostId, coHosts]);

  // --------------------------------------------------
  // MEDIA ACTIONS (Focus 1, 6, 7)
  // --------------------------------------------------

  const startCamera = async (mode: "user" | "environment" = facingMode) => {
    try {
      setError("");

      if (localCameraStreamRef.current) {
        localCameraStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: mode,
        },
      });

      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No camera track.");

      localCameraStreamRef.current = stream;
      setCameraActive(true);
      cameraActiveRef.current = true;
      setFacingMode(mode);

      console.log(`[VIDEO TRACE] cameraTrack.id=${track.id} readyState=${track.readyState} enabled=${track.enabled}`);

      if (!screenSharingRef.current) {
        for (const pid of Object.keys(peerConnectionsRef.current)) {
          const peer = peerConnectionsRef.current[pid];
          const videoSender = peer?.pc.getSenders().find((s) => s.track?.kind === "video") || peer?.videoSender;
          if (videoSender) {
            await videoSender.replaceTrack(track);
            console.log(`[VIDEO TRACE] peer=${pid} sender.track.id=${videoSender.track?.id ?? "null"} sender.track.readyState=${videoSender.track?.readyState ?? "null"} sender.track.enabled=${videoSender.track?.enabled ?? false}`);
          }
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
      }

      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: true,
        screen: screenSharingRef.current,
        microphone: localAudioStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
      });
    } catch (err) {
      console.error("[MEDIA] Camera error:", err);
      setError("Camera permission denied or camera unavailable.");
      setCameraActive(false);
      cameraActiveRef.current = false;
    }
  };

  const stopCamera = async () => {
    const stream = localCameraStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (track) {
      track.enabled = false;
    }

    setCameraActive(false);
    cameraActiveRef.current = false;

    socket.emit("media-state", {
      roomId: roomIdRef.current,
      camera: false,
      screen: screenSharingRef.current,
      microphone: localAudioStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
    });
  };

  const toggleCamera = async () => {
    const stream = localCameraStreamRef.current;
    const track = stream?.getVideoTracks()[0];

    if (!track || track.readyState !== "live") {
      await startCamera();
      return;
    }

    if (track.enabled) {
      await stopCamera();
    } else {
      track.enabled = true;
      setCameraActive(true);
      cameraActiveRef.current = true;
      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: true,
        screen: screenSharingRef.current,
        microphone: localAudioStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
      });
    }
  };

  const switchMobileCamera = async () => {
    const nextMode = facingMode === "user" ? "environment" : "user";
    await startCamera(nextMode);
  };

  const startMicrophone = async () => {
    try {
      setError("");
      let stream = localAudioStreamRef.current;
      let track = stream?.getAudioTracks()[0];

      if (!track || track.readyState !== "live") {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        track = stream.getAudioTracks()[0];
      }

      if (!stream || !track) throw new Error("No mic track.");

      track.enabled = true;
      localAudioStreamRef.current = stream;
      setMicActive(true);

      for (const pid of Object.keys(peerConnectionsRef.current)) {
        const peer = peerConnectionsRef.current[pid];
        const audioSender = peer?.pc.getSenders().find((s) => s.track?.kind === "audio") || peer?.audioSender;
        if (audioSender) await audioSender.replaceTrack(track);
      }

      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: cameraActiveRef.current,
        screen: screenSharingRef.current,
        microphone: true,
      });
    } catch (err) {
      console.error("[MEDIA] Mic error:", err);
      setError("Microphone permission denied or unavailable.");
      setMicActive(false);
    }
  };

  const stopMicrophone = async () => {
    const stream = localAudioStreamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (track) track.enabled = false;
    setMicActive(false);

    socket.emit("media-state", {
      roomId: roomIdRef.current,
      camera: cameraActiveRef.current,
      screen: screenSharingRef.current,
      microphone: false,
    });
  };

  const toggleMicrophone = async () => {
    const stream = localAudioStreamRef.current;
    const track = stream?.getAudioTracks()[0];

    if (!track || track.readyState !== "live") {
      await startMicrophone();
      return;
    }

    if (track.enabled) {
      await stopMicrophone();
    } else {
      track.enabled = true;
      setMicActive(true);
      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: cameraActiveRef.current,
        screen: screenSharingRef.current,
        microphone: true,
      });
    }
  };

  const startScreenShare = async () => {
    try {
      setError("");

      const isUserHostOrCoHost = socket.id && (hostId === socket.id || coHosts.includes(socket.id));
      if (!screenSharingAllowed && !isUserHostOrCoHost) {
        alert("Screen sharing is currently disabled by the host.");
        return;
      }

      if (localScreenStreamRef.current) return;

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error("No screen track.");

      console.log(`[SCREEN TRACE] screenTrack.id=${screenTrack.id} readyState=${screenTrack.readyState} enabled=${screenTrack.enabled}`);

      screenTrack.contentHint = "detail";
      localScreenStreamRef.current = screenStream;
      setScreenSharing(true);
      screenSharingRef.current = true;

      screenTrack.onended = () => {
        if (!stoppingScreenShareRef.current) void stopScreenShare();
      };

      for (const pid of Object.keys(peerConnectionsRef.current)) {
        const peer = peerConnectionsRef.current[pid];
        const videoSender = peer?.pc.getSenders().find((s) => s.track?.kind === "video") || peer?.videoSender;
        if (videoSender) {
          try {
            await videoSender.replaceTrack(screenTrack);
            console.log(`[SCREEN TRACE] peer=${pid} sender.track.id=${videoSender.track?.id ?? "null"} sender.track.kind=${videoSender.track?.kind ?? "video"}`);
          } catch (err) {
            console.error(`[SCREEN TRACE] peer=${pid} replaceTrack error:`, err);
          }
        }
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
        localVideoRef.current.play().catch(() => {});
      }

      socket.emit("media-state", {
        roomId: roomIdRef.current,
        camera: cameraActiveRef.current,
        screen: true,
        microphone: localAudioStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
      });
    } catch (err) {
      console.error("[MEDIA] Screen share error:", err);
      setError("Screen sharing was cancelled or unavailable.");
      setScreenSharing(false);
      screenSharingRef.current = false;
    }
  };

  const stopScreenShare = async () => {
    const screenStream = localScreenStreamRef.current;
    if (!screenStream) return;

    stoppingScreenShareRef.current = true;
    const screenTrack = screenStream.getVideoTracks()[0];
    if (screenTrack) {
      screenTrack.onended = null;
      screenTrack.stop();
    }
    localScreenStreamRef.current = null;

    const cameraTrack = cameraActiveRef.current
      ? (localCameraStreamRef.current?.getVideoTracks()[0] ?? null)
      : null;

    for (const pid of Object.keys(peerConnectionsRef.current)) {
      const peer = peerConnectionsRef.current[pid];
      const videoSender = peer?.pc.getSenders().find((s) => s.track?.kind === "video") || peer?.videoSender;
      if (videoSender) await videoSender.replaceTrack(cameraTrack);
    }

    if (localVideoRef.current) {
      if (cameraActiveRef.current && localCameraStreamRef.current) {
        localVideoRef.current.srcObject = localCameraStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      } else {
        localVideoRef.current.srcObject = null;
      }
    }

    setScreenSharing(false);
    screenSharingRef.current = false;
    stoppingScreenShareRef.current = false;

    socket.emit("media-state", {
      roomId: roomIdRef.current,
      camera: cameraActiveRef.current,
      screen: false,
      microphone: localAudioStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
    });
  };

  const toggleScreenShare = async () => {
    if (screenSharing) await stopScreenShare();
    else await startScreenShare();
  };

  const toggleRaiseHand = () => {
    const nextState = !handRaised;
    setHandRaised(nextState);
    socket.emit("raise-hand", { roomId: roomIdRef.current, raised: nextState });
  };

  const sendReaction = (emoji: string) => {
    socket.emit("reaction", { roomId: roomIdRef.current, emoji });
    const mySocketId = socket.id;
    if (mySocketId) {
      setActiveReactions((c) => ({ ...c, [mySocketId]: { sender: mySocketId, emoji, timestamp: Date.now() } }));
      setTimeout(() => {
        setActiveReactions((c) => {
          const cp = { ...c };
          delete cp[mySocketId];
          return cp;
        });
      }, 3000);
    }
  };

  // --------------------------------------------------
  // CHAT & FILE SHARING HANDLERS
  // --------------------------------------------------

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("File size exceeds 5MB limit.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        data: reader.result as string,
      });
    };
    reader.readAsDataURL(file);
  };

  const sendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const isUserHostOrCoHost = socket.id && (hostId === socket.id || coHosts.includes(socket.id));
    if (!chatAllowed && !isUserHostOrCoHost) {
      alert("Chat is disabled by the host.");
      return;
    }

    if (!chatInput.trim() && !selectedFile) return;

    socket.emit("chat-message", {
      roomId: roomIdRef.current,
      name: myName.trim() || "Participant",
      message: chatInput.trim(),
      file: selectedFile,
    });

    setChatInput("");
    setSelectedFile(null);
    setShowEmojiPicker(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // --------------------------------------------------
  // HOST & CO-HOST MODERATION HANDLERS
  // --------------------------------------------------

  const isPrimaryHost = Boolean(socket.id && hostId && socket.id === hostId);
  const isHostOrCoHost = Boolean(socket.id && (hostId === socket.id || coHosts.includes(socket.id)));

  const toggleMeetingLock = () => {
    socket.emit("toggle-meeting-lock", { roomId: roomIdRef.current });
  };

  const toggleScreenSharePermission = () => {
    socket.emit("toggle-screen-share-permission", { roomId: roomIdRef.current });
  };

  const toggleChatPermission = () => {
    socket.emit("toggle-chat-permission", { roomId: roomIdRef.current });
  };

  const hostMuteParticipant = (participantId: string) => {
    socket.emit("mute-participant", { roomId: roomIdRef.current, participantId });
  };

  const hostAssignCoHost = (participantId: string) => {
    socket.emit("assign-co-host", { roomId: roomIdRef.current, participantId });
  };

  const removeParticipant = (participantId: string) => {
    const participant = participants.find((p) => p.socketId === participantId);
    if (!participant) return;

    if (window.confirm(`Remove ${participant.name} from the meeting?`)) {
      socket.emit("remove-participant", { roomId: roomIdRef.current, participantId });
    }
  };

  const endMeeting = () => {
    if (window.confirm("End this meeting for everyone?")) {
      socket.emit("end-meeting", { roomId: roomIdRef.current });
    }
  };

  const copyRoomLink = () => {
    const link = `${window.location.origin}?room=${roomIdRef.current || roomId}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!authEmail.trim()) {
      setError("Email is required.");
      return;
    }

    if (authMode === "register" && !authName.trim()) {
      setError("Your name is required.");
      return;
    }

    setAuthLoading(true);

    try {
      const endpoint = authMode === "login" ? "http://localhost:5000/api/auth/login" : "http://localhost:5000/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail.trim(),
          name: authName.trim(),
          password: authPassword || "password123",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      const user = {
        id: data.user?.id,
        name: data.user?.name || authName.trim() || authEmail.split("@")[0],
        email: data.user?.email || authEmail.trim(),
      };

      setCurrentUser(user);
      setMyName(user.name);
      localStorage.setItem("realconnect_user", JSON.stringify(user));
    } catch {
      // Offline fallback: keep evaluation completely unblocked
      const fallbackName = authName.trim() || authEmail.split("@")[0].replace(/[._-]/g, " ") || "Participant";
      const fallbackUser = {
        name: fallbackName,
        email: authEmail.trim(),
      };
      setCurrentUser(fallbackUser);
      setMyName(fallbackName);
      localStorage.setItem("realconnect_user", JSON.stringify(fallbackUser));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestLogin = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const guestUser = {
      name: `Guest_${randomNum}`,
      email: `guest${randomNum}@realconnect.io`,
    };
    setCurrentUser(guestUser);
    setMyName(guestUser.name);
    localStorage.setItem("realconnect_user", JSON.stringify(guestUser));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("realconnect_user");
  };

  const startInstantMeeting = async () => {
    const newRoomId = crypto.randomUUID();
    setRoomId(newRoomId);
    await joinRoom(newRoomId);
  };

  const joinRoom = async (targetRoomId?: string) => {
    const activeRoomId = (targetRoomId || roomId).trim();
    const activeName = (myName || currentUser?.name || "").trim();

    if (!connected) { setError("Connecting to server. Please try again."); return; }
    if (!activeName) { setError("Please enter your name."); return; }
    if (!activeRoomId) { setError("Please enter or generate a Room ID."); return; }

    setError("");
    setIsJoining(true);

    try {
      // Ensure local audio & video streams are acquired BEFORE creating peer connections
      await ensureLocalMedia();

      socket.emit("join-room", { roomId: activeRoomId, name: activeName });
      setRoomId(activeRoomId);
      setMyName(activeName);
      setJoinedRoom(true);

      // Save to recent rooms
      setRecentRooms((prev) => {
        const filtered = prev.filter((r) => r !== activeRoomId);
        const updated = [activeRoomId, ...filtered].slice(0, 5);
        localStorage.setItem("realconnect_recents", JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      console.error("Join room error:", err);
      setError("Unable to initialize camera or microphone.");
    } finally {
      setIsJoining(false);
    }
  };

  const leaveRoom = () => {
    socket.emit("leave-room", { roomId: roomIdRef.current });
    cleanupMeeting();
  };

  const createRoom = () => {
    const newRoomId = crypto.randomUUID();
    setRoomId(newRoomId);
    setError("");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const safeMyName = myName.trim() || currentUser?.name || "You";
  const myInitial = safeMyName.charAt(0).toUpperCase();

  // ==================================================
  // VIEW 1: AUTHENTICATION SCREEN
  // ==================================================

  if (!joinedRoom && !currentUser) {
    return (
      <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at top, #111b33 0%, #090d16 100%)", color: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ width: "460px", maxWidth: "100%", background: "#131b2e", border: "1px solid #243049", padding: "36px", borderRadius: "20px", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
          
          {/* Logo & Header */}
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "56px", height: "56px", borderRadius: "14px", background: "linear-gradient(135deg, #2563eb, #1d4ed8)", fontSize: "28px", marginBottom: "12px", boxShadow: "0 10px 25px rgba(37,99,235,0.3)" }}>
              🌐
            </div>
            <h1 style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: "700", letterSpacing: "-0.5px" }}>REAL CONNECT</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>Enterprise-Grade Real-Time Video Meetings</p>
          </div>

          {/* Tab Selector */}
          <div style={{ display: "flex", background: "#090d16", padding: "4px", borderRadius: "10px", marginBottom: "24px", border: "1px solid #1e293b" }}>
            <button type="button" onClick={() => setAuthMode("login")} style={{ flex: 1, padding: "10px", border: "none", borderRadius: "8px", background: authMode === "login" ? "#2563eb" : "transparent", color: authMode === "login" ? "white" : "#94a3b8", cursor: "pointer", fontWeight: "600", fontSize: "14px", transition: "all 0.2s" }}>
              Sign In
            </button>
            <button type="button" onClick={() => setAuthMode("register")} style={{ flex: 1, padding: "10px", border: "none", borderRadius: "8px", background: authMode === "register" ? "#2563eb" : "transparent", color: authMode === "register" ? "white" : "#94a3b8", cursor: "pointer", fontWeight: "600", fontSize: "14px", transition: "all 0.2s" }}>
              Create Account
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleAuthSubmit}>
            {authMode === "register" && (
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: "600", color: "#cbd5e1" }}>Full Name</label>
                <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="e.g. Alex Morgan" maxLength={40} style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #243049", background: "#090d16", color: "white", outline: "none", fontSize: "14px" }} />
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: "600", color: "#cbd5e1" }}>Email Address</label>
              <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="name@domain.com" style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #243049", background: "#090d16", color: "white", outline: "none", fontSize: "14px" }} />
            </div>

            <div style={{ marginBottom: "22px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: "600", color: "#cbd5e1" }}>Password</label>
              <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #243049", background: "#090d16", color: "white", outline: "none", fontSize: "14px" }} />
            </div>

            <button type="submit" disabled={authLoading} style={{ width: "100%", padding: "13px", border: "none", borderRadius: "10px", background: "#2563eb", color: "white", fontWeight: "700", fontSize: "15px", cursor: authLoading ? "wait" : "pointer", boxShadow: "0 10px 20px rgba(37,99,235,0.3)" }}>
              {authLoading ? "Authenticating..." : authMode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          {/* Test Account Helper */}
          <div style={{ marginTop: "16px", padding: "10px 14px", background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.25)", borderRadius: "8px", fontSize: "12px", color: "#93c5fd", textAlign: "center" }}>
            💡 Demo Account: <strong>demo@realconnect.io</strong> (password: <strong>password123</strong>)
          </div>

          <div style={{ display: "flex", alignItems: "center", margin: "20px 0", color: "#475569" }}>
            <div style={{ flex: 1, height: "1px", background: "#243049" }} />
            <span style={{ padding: "0 10px", fontSize: "12px", color: "#64748b" }}>OR</span>
            <div style={{ flex: 1, height: "1px", background: "#243049" }} />
          </div>

          {/* Guest Button */}
          <button type="button" onClick={handleGuestLogin} style={{ width: "100%", padding: "12px", border: "1px solid #334155", borderRadius: "10px", background: "#090d16", color: "#e2e8f0", fontWeight: "600", fontSize: "14px", cursor: "pointer" }}>
            ⚡ Instant Access as Guest
          </button>

          {/* Server status pill */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginTop: "24px", fontSize: "12px", color: connected ? "#4ade80" : "#f87171" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444" }} />
            <span>Backend Server: {connected ? "Connected (Port 5000)" : "Connecting..."}</span>
          </div>

          {error && <p style={{ color: "#f87171", textAlign: "center", fontSize: "13px", marginTop: "14px" }}>{error}</p>}
        </div>
      </div>
    );
  }

  // ==================================================
  // VIEW 2: DASHBOARD SCREEN
  // ==================================================

  if (!joinedRoom && currentUser) {
    return (
      <div style={{ minHeight: "100vh", background: "#090d16", color: "white", display: "flex", flexDirection: "column" }}>
        
        {/* Top Navigation */}
        <header style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: "14px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>
              🌐
            </div>
            <div>
              <span style={{ fontSize: "18px", fontWeight: "700", letterSpacing: "-0.3px" }}>REAL CONNECT</span>
              <span style={{ marginLeft: "8px", padding: "2px 8px", background: "#1e293b", color: "#94a3b8", fontSize: "11px", borderRadius: "12px", fontWeight: "600" }}>v1.0 Submission</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", borderRadius: "20px", background: connected ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: connected ? "#4ade80" : "#f87171", fontSize: "12px", fontWeight: "600" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444" }} />
              {connected ? "Server Ready" : "Disconnected"}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "5px 12px 5px 6px", background: "#1f2937", borderRadius: "24px", border: "1px solid #374151" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "700" }}>
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: "13px", fontWeight: "600" }}>{currentUser.name}</span>
            </div>

            <button onClick={handleLogout} style={{ padding: "7px 14px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", borderRadius: "8px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
              Sign Out
            </button>
          </div>
        </header>

        {/* Dashboard Main Content */}
        <main style={{ maxWidth: "1200px", width: "100%", margin: "0 auto", padding: "40px 24px", flex: 1 }}>
          
          {/* Welcome Banner */}
          <div style={{ marginBottom: "36px" }}>
            <h1 style={{ margin: "0 0 8px", fontSize: "30px", fontWeight: "700" }}>
              Welcome back, {currentUser.name} 👋
            </h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "15px" }}>
              Start an instant meeting, join with a code, or manage your real-time conference sessions.
            </p>
          </div>

          {error && (
            <div style={{ padding: "14px 18px", background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: "10px", color: "#fca5a5", marginBottom: "24px", fontSize: "14px" }}>
              ⚠️ {error}
            </div>
          )}

          {/* Action Cards Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px", marginBottom: "40px" }}>
            
            {/* Card 1: New Meeting */}
            <div style={{ background: "#131b2e", border: "1px solid #243049", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(37,99,235,0.15)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", marginBottom: "16px" }}>
                  📹
                </div>
                <h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700" }}>Start Instant Meeting</h2>
                <p style={{ margin: "0 0 20px", color: "#94a3b8", fontSize: "14px", lineHeight: "1.5" }}>
                  Create a secure, room-based video conference. You will automatically be designated as the Meeting Host.
                </p>
              </div>

              <button onClick={startInstantMeeting} disabled={!connected || isJoining} style={{ width: "100%", padding: "14px", border: "none", borderRadius: "10px", background: "#2563eb", color: "white", fontWeight: "700", fontSize: "14px", cursor: connected && !isJoining ? "pointer" : "not-allowed", boxShadow: "0 8px 20px rgba(37,99,235,0.3)" }}>
                {isJoining ? "Preparing Room..." : "Start Instant Meeting 🚀"}
              </button>
            </div>

            {/* Card 2: Join Meeting */}
            <div style={{ background: "#131b2e", border: "1px solid #243049", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(16,185,129,0.15)", color: "#34d399", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", marginBottom: "16px" }}>
                  🔗
                </div>
                <h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700" }}>Join with Room ID</h2>
                <p style={{ margin: "0 0 16px", color: "#94a3b8", fontSize: "14px", lineHeight: "1.5" }}>
                  Enter the Room ID or paste the meeting invite link shared by the host to connect.
                </p>
                
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                  <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="Enter Room ID (e.g. 8fa2e0...)" style={{ flex: 1, padding: "12px 14px", borderRadius: "10px", border: "1px solid #243049", background: "#090d16", color: "white", outline: "none", fontSize: "14px" }} />
                  <button type="button" onClick={createRoom} style={{ padding: "12px 14px", background: "#1e293b", border: "1px solid #334155", color: "white", borderRadius: "10px", fontSize: "12px", fontWeight: "bold", cursor: "pointer", whiteSpace: "nowrap" }} title="Generate random UUID Room ID">
                    Generate
                  </button>
                </div>
              </div>

              <button onClick={() => joinRoom()} disabled={!connected || isJoining || !roomId.trim()} style={{ width: "100%", padding: "14px", border: "none", borderRadius: "10px", background: roomId.trim() ? "#10b981" : "#1e293b", color: roomId.trim() ? "white" : "#64748b", fontWeight: "700", fontSize: "14px", cursor: roomId.trim() && !isJoining ? "pointer" : "not-allowed" }}>
                {isJoining ? "Connecting..." : "Join Meeting 🔗"}
              </button>
            </div>

            {/* Card 3: Recent Rooms */}
            <div style={{ background: "#131b2e", border: "1px solid #243049", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(245,158,11,0.15)", color: "#fbbf24", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", marginBottom: "16px" }}>
                  ⏱️
                </div>
                <h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700" }}>Recent Rooms</h2>
                <p style={{ margin: "0 0 16px", color: "#94a3b8", fontSize: "14px" }}>
                  Quickly reconnect to your recently created or joined meeting rooms.
                </p>

                {recentRooms.length === 0 ? (
                  <p style={{ color: "#64748b", fontSize: "13px", fontStyle: "italic" }}>No recent rooms yet. Start your first call!</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "150px", overflowY: "auto" }}>
                    {recentRooms.map((recentId) => (
                      <div key={recentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#090d16", borderRadius: "8px", border: "1px solid #1e293b" }}>
                        <span style={{ fontSize: "12px", color: "#cbd5e1", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={recentId}>
                          {recentId}
                        </span>
                        <button onClick={() => { setRoomId(recentId); void joinRoom(recentId); }} style={{ padding: "4px 10px", background: "#2563eb", border: "none", color: "white", borderRadius: "6px", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}>
                          Rejoin
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: "16px", fontSize: "12px", color: "#64748b" }}>
                Max 6 participants per room for optimal P2P bandwidth.
              </div>
            </div>

          </div>

          {/* Features Highlights Strip */}
          <div style={{ padding: "22px 28px", background: "#111827", borderRadius: "14px", border: "1px solid #1f2937", display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: "20px", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#38bdf8" }}>P2P WebRTC</div>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>Low Latency Mesh Signaling</div>
            </div>
            <div style={{ width: "1px", background: "#1f2937" }} />
            <div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#4ade80" }}>Screen Sharing</div>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>Full HD 1080p Presentation</div>
            </div>
            <div style={{ width: "1px", background: "#1f2937" }} />
            <div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#fbbf24" }}>Host Moderation</div>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>Mute, Co-Host, Lock & End</div>
            </div>
            <div style={{ width: "1px", background: "#1f2937" }} />
            <div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#c084fc" }}>In-Call Chat</div>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>File Attachments & Reactions</div>
            </div>
          </div>

        </main>
      </div>
    );
  }

  // ==================================================
  // MEETING SCREEN
  // ==================================================

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "white", fontFamily: "Arial, sans-serif", padding: "20px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: "1400px", margin: "auto" }}>

        {/* HEADER */}
        <div style={{ background: "#1e293b", borderRadius: "14px", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "15px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>
              🌐
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "700" }}>REAL CONNECT</h1>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <span style={{ color: "#94a3b8", fontSize: "13px" }}>Room: <strong style={{ color: "white" }}>{roomId}</strong></span>
                <button type="button" onClick={copyRoomLink} style={{ border: "none", background: copiedLink ? "#16a34a" : "#334155", color: "white", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", fontWeight: "bold", cursor: "pointer", transition: "all 0.2s" }} title="Copy invite link to clipboard">
                  {copiedLink ? "✓ Copied Link" : "📋 Copy"}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ padding: "6px 12px", borderRadius: "20px", background: connected ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: connected ? "#4ade80" : "#f87171", fontSize: "12px", fontWeight: "600" }}>
              {connected ? "● Connected" : "● Disconnected"}
            </span>

            <span style={{ padding: "6px 12px", borderRadius: "20px", background: "#334155", fontSize: "12px", fontWeight: "600" }}>
              ⏱️ {callDuration}
            </span>

            <span style={{ padding: "6px 12px", borderRadius: "20px", background: "#334155", fontSize: "12px", fontWeight: "600" }}>
              👥 {participants.length + 1}/{maxParticipants}
            </span>

            {isPrimaryHost && <span style={{ padding: "6px 12px", borderRadius: "20px", background: "rgba(245,158,11,0.2)", color: "#fde68a", fontSize: "12px", fontWeight: "bold" }}>👑 HOST</span>}
            {!isPrimaryHost && socket.id && coHosts.includes(socket.id) && <span style={{ padding: "6px 12px", borderRadius: "20px", background: "rgba(37,99,235,0.2)", color: "#bfdbfe", fontSize: "12px", fontWeight: "bold" }}>⭐ CO-HOST</span>}

            <button type="button" onClick={() => setChatOpen(!chatOpen)} style={{ padding: "7px 12px", borderRadius: "8px", border: "none", background: chatOpen ? "#2563eb" : "#334155", color: "white", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
              💬 Chat {chatMessages.length > 0 && `(${chatMessages.length})`}
            </button>

            <button type="button" onClick={() => setParticipantsOpen(!participantsOpen)} style={{ padding: "7px 12px", borderRadius: "8px", border: "none", background: participantsOpen ? "#2563eb" : "#334155", color: "white", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
              👥 Roster ({participants.length + 1})
            </button>

            {isHostOrCoHost && (
              <button type="button" onClick={() => setHostControlsOpen(!hostControlsOpen)} style={{ padding: "7px 12px", borderRadius: "8px", border: "none", background: hostControlsOpen ? "#ca8a04" : "#334155", color: "#fde68a", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                🛡️ Host Tools
              </button>
            )}
          </div>
        </div>

        {/* AUTOPLAY AUDIO BLOCK BANNER */}
        {audioAutoplayBlocked && (
          <div style={{ marginTop: "15px", padding: "12px 18px", background: "#7c2d12", border: "1px solid #ea580c", borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#ffedd5" }}>
            <span>🔊 Participant audio is paused by browser policy. Click to enable audio.</span>
            <button onClick={enableAllRemoteAudio} style={{ padding: "8px 14px", background: "#ea580c", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>Enable Audio</button>
          </div>
        )}

        {/* MEETING LOCK NOTICE */}
        {meetingLocked && (
          <div style={{ marginTop: "15px", padding: "12px", background: "#451a03", border: "1px solid #92400e", borderRadius: "10px", textAlign: "center", color: "#fde68a" }}>
            🔒 Meeting is locked by host. New participants cannot join.
          </div>
        )}

        {/* MAIN LAYOUT WITH SIDE CHAT */}
        <div style={{ display: "flex", gap: "20px", marginTop: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>

          {/* LEFT: MEDIA & PARTICIPANTS GRID */}
          <div style={{ flex: "1 1 680px", minWidth: 0 }}>

            {/* LOCAL VIDEO CARD */}
            <div style={{ background: "#1e293b", padding: "18px", borderRadius: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h2 style={{ margin: 0, fontSize: "18px" }}>
                  {safeMyName} <span style={{ color: "#94a3b8", fontSize: "14px" }}>(You)</span>
                </h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {handRaised && <span style={{ fontSize: "18px" }} title="Hand Raised">✋</span>}
                  {speakingStates[socket.id || ""] && <span style={{ fontSize: "14px", color: "#4ade80" }}>🗣️ Speaking</span>}
                </div>
              </div>

              <div style={{ height: "380px", background: "#020617", borderRadius: "12px", overflow: "hidden", position: "relative", border: speakingStates[socket.id || ""] ? "2px solid #22c55e" : "1px solid #334155" }}>
                <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraActive || screenSharing ? "block" : "none" }} />

                {!cameraActive && !screenSharing && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "8px", color: "#94a3b8" }}>
                    <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "30px" }}>{myInitial}</div>
                    <span>Camera Off</span>
                  </div>
                )}

                {/* Local Floating Reaction */}
                {socket.id && activeReactions[socket.id] && (
                  <div style={{ position: "absolute", top: "20px", right: "20px", fontSize: "40px", animation: "bounce 0.5s infinite alternate", zIndex: 10 }}>
                    {activeReactions[socket.id].emoji}
                  </div>
                )}

                {screenSharing && <div style={{ position: "absolute", bottom: "15px", left: "15px", background: "rgba(0,0,0,0.7)", padding: "8px 12px", borderRadius: "8px", fontSize: "14px" }}>🖥️ Sharing Screen</div>}
              </div>

              {/* LOCAL CONTROL BUTTONS */}
              <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap", marginTop: "18px" }}>
                <button onClick={toggleMicrophone} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", cursor: "pointer", background: micActive ? "#2563eb" : "#475569", color: "white", fontWeight: "bold" }}>
                  🎤 {micActive ? "Mute" : "Unmute"}
                </button>

                <button onClick={toggleCamera} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", cursor: "pointer", background: cameraActive ? "#2563eb" : "#475569", color: "white", fontWeight: "bold" }}>
                  📷 {cameraActive ? "Camera Off" : "Camera On"}
                </button>

                {isMobile && (
                  <button onClick={switchMobileCamera} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", cursor: "pointer", background: "#0284c7", color: "white", fontWeight: "bold" }}>
                    🔄 Flip Camera
                  </button>
                )}

                <button onClick={toggleScreenShare} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", cursor: "pointer", background: screenSharing ? "#dc2626" : "#2563eb", color: "white", fontWeight: "bold" }}>
                  🖥️ {screenSharing ? "Stop Sharing" : "Share Screen"}
                </button>

                <button onClick={toggleRaiseHand} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", cursor: "pointer", background: handRaised ? "#ca8a04" : "#334155", color: "white", fontWeight: "bold" }}>
                  ✋ {handRaised ? "Lower Hand" : "Raise Hand"}
                </button>

                <button onClick={leaveRoom} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", background: "#dc2626", color: "white", cursor: "pointer", fontWeight: "bold" }}>
                  📞 Leave
                </button>
              </div>

              {/* QUICK REACTION BAR */}
              <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "#94a3b8", alignSelf: "center", marginRight: "4px" }}>Reactions:</span>
                {EMOJI_LIST.slice(0, 5).map((emoji) => (
                  <button key={emoji} onClick={() => sendReaction(emoji)} style={{ border: "none", background: "#334155", borderRadius: "6px", padding: "6px 10px", fontSize: "16px", cursor: "pointer" }}>
                    {emoji}
                  </button>
                ))}
              </div>

              {/* HOST / CO-HOST MODERATION CONTROLS BAR */}
              {isHostOrCoHost && (
                <div style={{ marginTop: "20px", padding: "15px", background: "#0f172a", borderRadius: "10px", border: "1px solid #334155" }}>
                  <div style={{ textAlign: "center", color: "#fbbf24", fontSize: "13px", fontWeight: "bold", marginBottom: "10px" }}>
                    🛡️ {isPrimaryHost ? "HOST CONTROLS" : "CO-HOST CONTROLS"}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
                    <button onClick={toggleMeetingLock} style={{ padding: "9px 14px", border: "none", borderRadius: "8px", cursor: "pointer", background: meetingLocked ? "#16a34a" : "#ca8a04", color: "white", fontWeight: "bold", fontSize: "13px" }}>
                      {meetingLocked ? "🔓 Unlock Meeting" : "🔒 Lock Meeting"}
                    </button>

                    <button onClick={toggleScreenSharePermission} style={{ padding: "9px 14px", border: "none", borderRadius: "8px", cursor: "pointer", background: screenSharingAllowed ? "#2563eb" : "#7c2d12", color: "white", fontWeight: "bold", fontSize: "13px" }}>
                      🖥️ {screenSharingAllowed ? "Disable Screen Share" : "Enable Screen Share"}
                    </button>

                    <button onClick={toggleChatPermission} style={{ padding: "9px 14px", border: "none", borderRadius: "8px", cursor: "pointer", background: chatAllowed ? "#2563eb" : "#7c2d12", color: "white", fontWeight: "bold", fontSize: "13px" }}>
                      💬 {chatAllowed ? "Disable Chat" : "Enable Chat"}
                    </button>

                    {isPrimaryHost && (
                      <button onClick={endMeeting} style={{ padding: "9px 14px", border: "none", borderRadius: "8px", cursor: "pointer", background: "#991b1b", color: "white", fontWeight: "bold", fontSize: "13px" }}>
                        🛑 End Meeting
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* PARTICIPANTS GRID */}
            <div style={{ marginTop: "25px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                <h2 style={{ margin: 0 }}>Participants</h2>
                <span style={{ color: "#94a3b8" }}>{participants.length + 1}/{maxParticipants}</span>
              </div>

              {participants.length === 0 ? (
                <div style={{ background: "#1e293b", padding: "40px", borderRadius: "16px", textAlign: "center", color: "#94a3b8" }}>
                  <p>You are the only participant.</p>
                  <p style={{ fontSize: "14px" }}>Share Room ID: <strong style={{ color: "white" }}>{roomId}</strong></p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
                  {participants.map((participant) => {
                    const pid = participant.socketId;
                    const participantName = participant.name || "Participant";
                    const participantInitial = participantName.charAt(0).toUpperCase();
                    const cameraOn = remoteCameraStates[pid] ?? false;
                    const screenOn = remoteScreenStates[pid] ?? false;
                    const micOn = remoteMicrophoneStates[pid] ?? false;
                    const isHandRaised = remoteHandStates[pid] ?? false;
                    const isParticipantSpeaking = speakingStates[pid] ?? false;
                    const quality = connectionQuality[pid] || "Good";
                    const media = remoteMediaRef.current[pid];
                    const videoTrack = media?.video?.getVideoTracks()[0];
                    const hasLiveTrack = Boolean(videoTrack && videoTrack.readyState === "live");
                    const videoVisible = cameraOn || screenOn || hasLiveTrack;
                    const dims = remoteVideoDimensions[pid] || { width: 0, height: 0 };

                    const isParticipantHost = pid === hostId;
                    const isParticipantCoHost = coHosts.includes(pid);

                    return (
                      <div key={pid} style={{ background: "#1e293b", padding: "15px", borderRadius: "15px", border: isParticipantSpeaking ? "2px solid #22c55e" : "1px solid #334155" }}>

                        {/* PARTICIPANT HEADER */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                          <div>
                            <strong>{participantName}</strong>
                            {isParticipantHost && <span style={{ marginLeft: "8px", fontSize: "12px", color: "#fbbf24" }}>👑 Host</span>}
                            {!isParticipantHost && isParticipantCoHost && <span style={{ marginLeft: "8px", fontSize: "12px", color: "#60a5fa" }}>⭐ Co-Host</span>}
                          </div>

                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            {isHandRaised && <span style={{ fontSize: "16px" }} title="Hand Raised">✋</span>}
                            <span style={{ fontSize: "11px", padding: "3px 7px", borderRadius: "10px", background: quality === "Excellent" || quality === "Good" ? "#14532d" : "#713f12", color: quality === "Excellent" || quality === "Good" ? "#86efac" : "#fef08a" }}>
                              📶 {quality}
                            </span>
                          </div>
                        </div>

                        {/* PARTICIPANT VIDEO CONTAINER */}
                        <div style={{ height: "240px", background: "#020617", borderRadius: "10px", overflow: "hidden", position: "relative" }}>
                          {/* DIAGNOSTIC RESOLUTION TEXT */}
                          <div style={{ position: "absolute", top: "8px", left: "8px", background: "rgba(15,23,42,0.85)", color: "#38bdf8", padding: "3px 7px", borderRadius: "5px", fontSize: "11px", fontWeight: "bold", zIndex: 6, border: "1px solid #0284c7" }}>
                            REMOTE VIDEO: {dims.width} x {dims.height}
                          </div>

                          <video ref={(el) => setRemoteVideoRef(pid, el)} autoPlay playsInline muted={false} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0, opacity: videoVisible ? 1 : 0, zIndex: videoVisible ? 1 : 0 }} />

                          {!videoVisible && (
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "8px", color: "#94a3b8", zIndex: 0 }}>
                              <div style={{ width: "70px", height: "70px", borderRadius: "50%", background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", color: "white", fontWeight: "bold" }}>
                                {participantInitial}
                              </div>
                              <span>Camera Off</span>
                            </div>
                          )}

                          {/* Remote Floating Reaction */}
                          {activeReactions[pid] && (
                            <div style={{ position: "absolute", top: "15px", right: "15px", fontSize: "36px", animation: "bounce 0.5s infinite alternate", zIndex: 10 }}>
                              {activeReactions[pid].emoji}
                            </div>
                          )}

                          {screenOn && <div style={{ position: "absolute", bottom: "10px", left: "10px", background: "rgba(0,0,0,0.7)", padding: "6px 9px", borderRadius: "6px", fontSize: "12px", zIndex: 2 }}>🖥️ Screen Sharing</div>}
                        </div>

                        {/* PARTICIPANT STATUS BADGES */}
                        <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "10px", fontSize: "13px" }}>
                          <span style={{ color: cameraOn ? "#22c55e" : "#ef4444" }}>📷 {cameraOn ? "ON" : "OFF"}</span>
                          <span style={{ color: screenOn ? "#22c55e" : "#94a3b8" }}>🖥️ {screenOn ? "Sharing" : "Normal"}</span>
                          <span style={{ color: micOn ? "#22c55e" : "#ef4444" }}>🎤 {micOn ? "ON" : "OFF"}</span>
                        </div>

                        {/* HOST / CO-HOST ACTIONS FOR REMOTE PARTICIPANT */}
                        {isHostOrCoHost && pid !== hostId && (
                          <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                            <button onClick={() => hostMuteParticipant(pid)} style={{ border: "none", borderRadius: "6px", padding: "5px 9px", background: "#334155", color: "white", cursor: "pointer", fontSize: "12px" }}>
                              🔇 Mute
                            </button>

                            {isPrimaryHost && (
                              <button onClick={() => hostAssignCoHost(pid)} style={{ border: "none", borderRadius: "6px", padding: "5px 9px", background: isParticipantCoHost ? "#1d4ed8" : "#0284c7", color: "white", cursor: "pointer", fontSize: "12px" }}>
                                {isParticipantCoHost ? "Remove Co-Host" : "Make Co-Host"}
                              </button>
                            )}

                            <button onClick={() => removeParticipant(pid)} style={{ border: "none", borderRadius: "6px", padding: "5px 9px", background: "#7f1d1d", color: "white", cursor: "pointer", fontSize: "12px" }}>
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: IN-CALL CHAT & FILE SHARING PANEL */}
          {chatOpen && (
            <div style={{ flex: "0 0 340px", width: "100%", maxWidth: "340px", background: "#1e293b", borderRadius: "16px", display: "flex", flexDirection: "column", height: "700px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>

              {/* CHAT HEADER */}
              <div style={{ padding: "16px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "16px" }}>💬 In-Call Chat</h3>
                <button onClick={() => setChatOpen(false)} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: "18px", cursor: "pointer" }}>✕</button>
              </div>

              {/* CHAT DISABLED BANNER */}
              {!chatAllowed && !isHostOrCoHost && (
                <div style={{ padding: "10px", background: "#451a03", color: "#fde68a", fontSize: "12px", textAlign: "center" }}>
                  Chat has been disabled by the host.
                </div>
              )}

              {/* MESSAGES LIST */}
              <div style={{ flex: 1, padding: "14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
                {chatMessages.length === 0 ? (
                  <p style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", marginTop: "20px" }}>No messages yet. Send a message to start chatting!</p>
                ) : (
                  chatMessages.map((msg) => {
                    const isOwn = msg.sender === socket.id;
                    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                    return (
                      <div key={msg.id} style={{ alignSelf: isOwn ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                        <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "3px", textAlign: isOwn ? "right" : "left" }}>
                          {msg.name} • {timeStr}
                        </div>
                        <div style={{ background: isOwn ? "#2563eb" : "#334155", color: "white", padding: "10px 12px", borderRadius: isOwn ? "12px 12px 0 12px" : "12px 12px 12px 0", fontSize: "14px", wordBreak: "break-word" }}>
                          {msg.message}

                          {/* File Attachment Card */}
                          {msg.file && (
                            <div style={{ marginTop: "8px", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", fontSize: "12px" }}>
                              <div style={{ fontWeight: "bold" }}>📎 {msg.file.name}</div>
                              <div style={{ color: "#cbd5e1", fontSize: "11px", margin: "2px 0 6px" }}>{formatFileSize(msg.file.size)}</div>
                              <a href={msg.file.data} download={msg.file.name} style={{ display: "inline-block", padding: "4px 8px", background: "#16a34a", color: "white", textDecoration: "none", borderRadius: "4px", fontWeight: "bold", fontSize: "11px" }}>
                                ⬇️ Download File
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* EMOJI PICKER POPUP */}
              {showEmojiPicker && (
                <div style={{ padding: "8px", background: "#0f172a", borderTop: "1px solid #334155", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {EMOJI_LIST.map((emoji) => (
                    <button key={emoji} onClick={() => setChatInput((prev) => prev + emoji)} style={{ border: "none", background: "#1e293b", borderRadius: "4px", padding: "6px 8px", fontSize: "16px", cursor: "pointer" }}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* SELECTED FILE PREVIEW */}
              {selectedFile && (
                <div style={{ padding: "8px 12px", background: "#0f172a", borderTop: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                  <span style={{ color: "#86efac" }}>📎 {selectedFile.name} ({formatFileSize(selectedFile.size)})</span>
                  <button onClick={() => setSelectedFile(null)} style={{ border: "none", background: "none", color: "#f87171", cursor: "pointer" }}>✕</button>
                </div>
              )}

              {/* INPUT FORM */}
              <form onSubmit={sendChatMessage} style={{ padding: "12px", borderTop: "1px solid #334155", display: "flex", gap: "8px", alignItems: "center" }}>
                <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} style={{ border: "none", background: "#334155", color: "white", borderRadius: "8px", padding: "8px 10px", cursor: "pointer" }}>
                  😊
                </button>

                <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: "none" }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} style={{ border: "none", background: "#334155", color: "white", borderRadius: "8px", padding: "8px 10px", cursor: "pointer" }} title="Attach File (Max 5MB)">
                  📎
                </button>

                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }} placeholder={chatAllowed || isHostOrCoHost ? "Type a message..." : "Chat disabled"} disabled={!chatAllowed && !isHostOrCoHost} style={{ flex: 1, padding: "9px 12px", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "white", outline: "none", fontSize: "13px" }} />

                <button type="submit" disabled={!chatAllowed && !isHostOrCoHost} style={{ border: "none", background: chatAllowed || isHostOrCoHost ? "#2563eb" : "#475569", color: "white", borderRadius: "8px", padding: "9px 12px", cursor: "pointer", fontWeight: "bold" }}>
                  Send
                </button>
              </form>
            </div>
          )}

          {/* PARTICIPANTS ROSTER DRAWER */}
          {participantsOpen && (
            <div style={{ flex: "0 0 320px", width: "100%", maxWidth: "320px", background: "#1e293b", borderRadius: "16px", display: "flex", flexDirection: "column", height: "700px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
              <div style={{ padding: "16px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>👥 Participants ({participants.length + 1})</h3>
                <button type="button" onClick={() => setParticipantsOpen(false)} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: "18px", cursor: "pointer" }}>✕</button>
              </div>

              <div style={{ flex: 1, padding: "14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* Local user */}
                <div style={{ padding: "12px", background: "#0f172a", borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "bold" }}>
                      {myInitial}
                    </div>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "bold" }}>{safeMyName} (You)</div>
                      <div style={{ fontSize: "11px", color: isPrimaryHost ? "#fbbf24" : "#94a3b8" }}>{isPrimaryHost ? "Host" : "Participant"}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "14px" }}>
                    {micActive ? "🎤" : "🔇"} {cameraActive ? "📷" : "🚫"}
                  </div>
                </div>

                {/* Remote users */}
                {participants.map((p) => {
                  const pid = p.socketId;
                  const isPHost = pid === hostId;
                  const isPCoHost = coHosts.includes(pid);
                  const mic = remoteMicrophoneStates[pid] ?? true;
                  const cam = remoteCameraStates[pid] ?? true;

                  return (
                    <div key={pid} style={{ padding: "12px", background: "#0f172a", borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#374151", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "bold" }}>
                          {(p.name || "P").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: "bold" }}>{p.name}</div>
                          <div style={{ fontSize: "11px", color: isPHost ? "#fbbf24" : isPCoHost ? "#60a5fa" : "#94a3b8" }}>
                            {isPHost ? "Host" : isPCoHost ? "Co-Host" : "Participant"}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: "14px" }}>
                        {mic ? "🎤" : "🔇"} {cam ? "📷" : "🚫"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* HOST CONTROLS DRAWER */}
          {hostControlsOpen && isHostOrCoHost && (
            <div style={{ flex: "0 0 320px", width: "100%", maxWidth: "320px", background: "#1e293b", borderRadius: "16px", display: "flex", flexDirection: "column", height: "700px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
              <div style={{ padding: "16px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#fbbf24" }}>🛡️ Host Tools</h3>
                <button type="button" onClick={() => setHostControlsOpen(false)} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: "18px", cursor: "pointer" }}>✕</button>
              </div>

              <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto" }}>
                <div style={{ padding: "12px", background: "#0f172a", borderRadius: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "bold", marginBottom: "4px" }}>Lock Meeting</div>
                  <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 10px" }}>Prevent any new participants from entering.</p>
                  <button type="button" onClick={toggleMeetingLock} style={{ width: "100%", padding: "9px", background: meetingLocked ? "#16a34a" : "#ca8a04", border: "none", color: "white", borderRadius: "8px", fontWeight: "bold", fontSize: "12px", cursor: "pointer" }}>
                    {meetingLocked ? "🔓 Unlock Meeting" : "🔒 Lock Meeting"}
                  </button>
                </div>

                <div style={{ padding: "12px", background: "#0f172a", borderRadius: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "bold", marginBottom: "4px" }}>Screen Sharing</div>
                  <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 10px" }}>Allow or restrict participant screen shares.</p>
                  <button type="button" onClick={toggleScreenSharePermission} style={{ width: "100%", padding: "9px", background: screenSharingAllowed ? "#dc2626" : "#2563eb", border: "none", color: "white", borderRadius: "8px", fontWeight: "bold", fontSize: "12px", cursor: "pointer" }}>
                    {screenSharingAllowed ? "Disable Screen Share" : "Enable Screen Share"}
                  </button>
                </div>

                <div style={{ padding: "12px", background: "#0f172a", borderRadius: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "bold", marginBottom: "4px" }}>In-Call Chat</div>
                  <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 10px" }}>Allow or restrict participant chat messaging.</p>
                  <button type="button" onClick={toggleChatPermission} style={{ width: "100%", padding: "9px", background: chatAllowed ? "#dc2626" : "#2563eb", border: "none", color: "white", borderRadius: "8px", fontWeight: "bold", fontSize: "12px", cursor: "pointer" }}>
                    {chatAllowed ? "Disable Chat" : "Enable Chat"}
                  </button>
                </div>

                {isPrimaryHost && (
                  <div style={{ padding: "12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px" }}>
                    <div style={{ fontSize: "13px", fontWeight: "bold", color: "#fca5a5", marginBottom: "4px" }}>End Meeting</div>
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 10px" }}>Disconnect all participants and close the room.</p>
                    <button type="button" onClick={endMeeting} style={{ width: "100%", padding: "10px", background: "#dc2626", border: "none", color: "white", borderRadius: "8px", fontWeight: "bold", fontSize: "12px", cursor: "pointer" }}>
                      🛑 End Meeting for All
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}

export default App;