import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Send,
  Image as ImageIcon,
  Smile,
  Copy,
  Check,
  Trash2,
  Download,
  LogOut,
  ArrowLeftRight,
  Sparkles,
  X,
  ExternalLink,
  CheckCheck,
  MoreVertical,
  Maximize2,
  Hash,
  User,
} from "lucide-react";

// Supabase Configuration
// The publishable key is safe for browser use when Row Level Security is enabled.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "chat imgs";
const MESSAGE_PAGE_SIZE = 50;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1600;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NAME_LENGTH = 32;
const MAX_ROOM_LENGTH = 64;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const previewUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(previewUrl);
      const scale = Math.min(1, MAX_IMAGE_WIDTH / image.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Could not compress image"));
            return;
          }
          resolve(new File([blob], "photo.webp", { type: "image/webp" }));
        },
        "image/webp",
        0.82,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("Could not read image"));
    };
    image.src = previewUrl;
  });
}

function getStoragePath(imageUrl) {
  const marker = `/object/public/${encodeURIComponent(STORAGE_BUCKET)}/`;
  const markerIndex = imageUrl?.indexOf(marker);
  return markerIndex === -1
    ? null
    : decodeURIComponent(imageUrl.slice(markerIndex + marker.length));
}

// Deterministic vibrant avatar gradient based on username
function getAvatarGradient(name = "") {
  const gradients = [
    "from-blue-500 via-indigo-500 to-violet-600",
    "from-fuchsia-500 via-purple-600 to-indigo-600",
    "from-emerald-400 via-teal-500 to-cyan-600",
    "from-amber-400 via-orange-500 to-rose-500",
    "from-rose-500 via-pink-600 to-purple-600",
    "from-cyan-400 via-sky-500 to-blue-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

const QUICK_ROOMS = ["lounge", "dev-team", "photos", "general"];
const POPULAR_EMOJIS = [
  "👍",
  "❤️",
  "🔥",
  "😂",
  "🎉",
  "🚀",
  "✨",
  "💯",
  "🙌",
  "👀",
];

export default function App() {
  const [isConnected, setIsConnected] = useState(null);
  const [username, setUsername] = useState(
    localStorage.getItem("chat_username") || "",
  );
  const [roomCode, setRoomCode] = useState(
    localStorage.getItem("chat_room") || "",
  );
  const [tempName, setTempName] = useState("");
  const [tempRoom, setTempRoom] = useState("");

  const [messages, setMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pendingImage, setPendingImage] = useState(null); // { file, previewUrl }
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeImagePreview, setActiveImagePreview] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Context menu message target (opens bottom action sheet)
  const [actionMenuMessage, setActionMenuMessage] = useState(null);

  const messagesEndRef = useRef(null);
  const messagesFeedRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputFieldRef = useRef(null);

  // Show visual toast notification
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleDocumentClick = (e) => {
      if (!e.target.closest(".emoji-picker-container")) {
        setShowEmojiPicker(false);
      }
    };
    window.addEventListener("click", handleDocumentClick);
    return () => window.removeEventListener("click", handleDocumentClick);
  }, []);

  // Check Supabase connectivity on mount
  useEffect(() => {
    async function checkConnection() {
      try {
        const { error } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true });
        setIsConnected(!error);
      } catch {
        setIsConnected(false);
      }
    }
    checkConnection();
  }, []);

  // Fetch messages and subscribe to Realtime channel (INSERT, DELETE)
  useEffect(() => {
    if (!username || !roomCode) return;

    fetchMessages({ reset: true });

    const cleanRoom = roomCode.toLowerCase().trim().replace(/^#+/, "");
    const channelName = `chat_room_${cleanRoom}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room=eq.${cleanRoom}`,
        },
        (payload) => {
          if (payload?.new) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          if (payload?.old?.id) {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
        },
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [username, roomCode]);

  // Auto-scroll when messages update or image is picked
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, uploading, pendingImage]);

  const fetchMessages = async ({ reset = false } = {}) => {
    const cleanRoom = roomCode.toLowerCase().trim().replace(/^#+/, "");
    const query = supabase.from("messages").select("*").eq("room", cleanRoom);

    const oldestMessage = messages[0];
    const { data, error } = await (reset || !oldestMessage
      ? query.order("created_at", { ascending: false }).limit(MESSAGE_PAGE_SIZE)
      : query
          .lt("created_at", oldestMessage.created_at)
          .order("created_at", { ascending: false })
          .limit(MESSAGE_PAGE_SIZE));

    if (!error && data) {
      const orderedMessages = [...data].reverse();
      setHasMoreMessages(data.length === MESSAGE_PAGE_SIZE);
      setMessages((current) =>
        reset ? orderedMessages : [...orderedMessages, ...current],
      );
    }
  };

  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreMessages) return;
    setLoadingOlder(true);
    const previousHeight = messagesFeedRef.current?.scrollHeight || 0;
    await fetchMessages();
    requestAnimationFrame(() => {
      const feed = messagesFeedRef.current;
      if (feed) feed.scrollTop += feed.scrollHeight - previousHeight;
    });
    setLoadingOlder(false);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (!tempName.trim() || !tempRoom.trim()) return;

    const cleanName = tempName.trim().slice(0, MAX_NAME_LENGTH);
    const cleanRoom = tempRoom
      .trim()
      .toLowerCase()
      .replace(/^#+/, "")
      .slice(0, MAX_ROOM_LENGTH);

    localStorage.setItem("chat_username", cleanName);
    localStorage.setItem("chat_room", cleanRoom);

    setUsername(cleanName);
    setRoomCode(cleanRoom);
  };

  const handleLeaveRoom = () => {
    localStorage.removeItem("chat_room");
    setRoomCode("");
    setMessages([]);
  };

  const handleSwitchUser = () => {
    localStorage.removeItem("chat_username");
    localStorage.removeItem("chat_room");
    setUsername("");
    setRoomCode("");
    setMessages([]);
  };

  // Select file and show instant preview before sending
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      showToast("Please choose a JPG, PNG, or WebP image");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      showToast("Photo size exceeds 10MB limit");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ file, previewUrl });
    inputFieldRef.current?.focus();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const cancelPendingImage = () => {
    if (pendingImage?.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
  };

  // Unified send handler for text and attached images
  const handleSend = async (e) => {
    e?.preventDefault();
    const textToSend = newMessage.trim();

    if (!textToSend && !pendingImage) return;
    if (textToSend.length > MAX_MESSAGE_LENGTH) {
      showToast(`Message limit is ${MAX_MESSAGE_LENGTH} characters`);
      return;
    }

    const cleanRoom = roomCode.toLowerCase().trim().replace(/^#+/, "");

    // If an image is attached, upload it first
    if (pendingImage) {
      setUploading(true);
      setUploadProgress("Uploading photo...");

      const file = await compressImage(pendingImage.file);
      const uniqueFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.webp`;
      const filePath = uniqueFileName;

      try {
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, file, { cacheControl: "3600", upsert: false });

        if (uploadError) {
          alert("Upload failed: " + uploadError.message);
          setUploading(false);
          setUploadProgress(null);
          return;
        }

        const { data } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(filePath);

        const caption = textToSend || "📷 Photo";
        setNewMessage("");
        cancelPendingImage();

        const { error: messageError } = await supabase.from("messages").insert([
          {
            room: cleanRoom,
            sender: username,
            content: caption,
            image_url: data.publicUrl,
          },
        ]);

        if (messageError) {
          await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
          showToast("Photo message could not be saved");
        }
      } catch (err) {
        showToast(err.message || "Upload error");
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
      return;
    }

    // Text-only message
    setNewMessage("");
    const { error } = await supabase.from("messages").insert([
      {
        room: cleanRoom,
        sender: username,
        content: textToSend,
      },
    ]);

    if (error) {
      setNewMessage(textToSend);
      showToast("Error sending message");
    }
  };

  // Direct blob download
  const handleDownloadImage = async (
    imageUrl,
    defaultName = "shared-photo.jpg",
  ) => {
    showToast("Downloading photo...");
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = defaultName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      showToast("Saved to device 📥");
    } catch {
      const link = document.createElement("a");
      link.href = imageUrl;
      link.target = "_blank";
      link.download = defaultName;
      link.click();
    }
  };

  // Instant direct delete from Supabase database - NO POPUP, press delete delete
  const executeDelete = async (msg) => {
    setActionMenuMessage(null);

    // Optimistically remove from view immediately
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));

    try {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("id", msg.id);

      if (error) {
        console.error("Delete error:", error);
        fetchMessages();
      } else {
        const imagePath = getStoragePath(msg.image_url);
        if (imagePath) {
          await supabase.storage.from(STORAGE_BUCKET).remove([imagePath]);
        }
      }
    } catch (err) {
      console.error("Delete exception:", err);
      fetchMessages();
    }
  };

  // Copy text to clipboard
  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    setActionMenuMessage(null);
    showToast("Copied to clipboard 📋");
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopiedLink(true);
    showToast(`Room #${roomCode} copied!`);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const addEmoji = (emoji) => {
    setNewMessage((prev) => prev + emoji);
    inputFieldRef.current?.focus();
  };

  // ====================================================
  // 1. SLEEK LOGIN / ROOM SELECTION SCREEN
  // ====================================================
  if (!username || !roomCode) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#070A10] text-slate-100 p-4 overflow-y-auto">
        {/* Ambient Glows */}
        <div className="absolute -top-32 -left-32 w-80 h-80 bg-indigo-600/20 rounded-full blur-[110px] pointer-events-none"></div>
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-cyan-500/15 rounded-full blur-[110px] pointer-events-none"></div>

        <div className="w-full max-w-md relative z-10 my-auto">
          <form
            onSubmit={handleLogin}
            className="bg-slate-900/90 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/80 space-y-5"
          >
            {/* Top Brand Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/25">
                  <div className="w-full h-full bg-slate-950 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-cyan-400" />
                  </div>
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-white">
                    QuickChat
                  </h1>
                  <p className="text-xs text-slate-400">
                    Real-time room messenger
                  </p>
                </div>
              </div>

              {/* Live Connection Badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-[11px] font-medium">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isConnected === true
                      ? "bg-emerald-400 animate-pulse"
                      : isConnected === false
                        ? "bg-red-400"
                        : "bg-amber-400 animate-pulse"
                  }`}
                ></span>
                <span className="text-slate-300">
                  {isConnected === true
                    ? "Live"
                    : isConnected === false
                      ? "Offline"
                      : "Checking"}
                </span>
              </div>
            </div>

            {/* Inputs */}
            <div className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Your Nickname
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="Enter nickname..."
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-white placeholder-slate-500 transition"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Room Name
                </label>
                <div className="relative">
                  <Hash className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 font-bold" />
                  <input
                    type="text"
                    value={tempRoom}
                    onChange={(e) => setTempRoom(e.target.value)}
                    maxLength={MAX_ROOM_LENGTH}
                    placeholder="e.g. general, secret99..."
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-white placeholder-slate-500 transition"
                    required
                  />
                </div>

                {/* Quick Join Tags */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-medium">
                    Popular:
                  </span>
                  {QUICK_ROOMS.map((room) => (
                    <button
                      key={room}
                      type="button"
                      onClick={() => setTempRoom(room)}
                      className="text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/60 font-mono"
                    >
                      #{room}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 py-3.5 rounded-xl font-bold text-sm tracking-wide transition text-white shadow-lg shadow-indigo-600/30 active:scale-[0.99] flex items-center justify-center gap-2"
            >
              <span>Join Chat Room</span>
              <span>🚀</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ====================================================
  // 2. MAIN CHAT INTERFACE
  // ====================================================
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#070A10] text-slate-100 overflow-hidden">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-800/95 backdrop-blur-md border border-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-2xl shadow-black/70 animate-in fade-in duration-150 pointer-events-none">
          {toastMessage}
        </div>
      )}

      {/* Responsive Chat Container */}
      <div className="flex flex-col h-full w-full max-w-4xl bg-slate-900/95 sm:border-x border-slate-800/80 overflow-hidden relative">
        {/* FIXED TOP NAVBAR */}
        <header className="shrink-0 z-20 sticky top-0 w-full px-3.5 sm:px-5 py-3 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-400 p-[1px] shadow-sm shrink-0">
              <div className="w-full h-full bg-slate-950 rounded-xl flex items-center justify-center text-base">
                ⚡
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyRoomCode}
                  title="Click to copy room code"
                  className="flex items-center gap-1 font-bold text-sm sm:text-base text-white hover:text-indigo-300 transition truncate group"
                >
                  <span className="truncate">#{roomCode}</span>
                  <span className="p-0.5 rounded text-slate-400 group-hover:text-indigo-400 transition shrink-0">
                    {copiedLink ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </span>
                </button>

                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                    isConnected === true
                      ? "bg-emerald-950/80 text-emerald-400 border-emerald-800/50"
                      : "bg-red-950/80 text-red-400 border-red-800/50"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isConnected === true
                        ? "bg-emerald-400 animate-pulse"
                        : "bg-red-400"
                    }`}
                  ></span>
                  <span>{isConnected === true ? "Live" : "Offline"}</span>
                </span>
              </div>

              <p className="text-[11px] text-slate-400 truncate">
                User:{" "}
                <span className="font-semibold text-emerald-400">
                  {username}
                </span>
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleLeaveRoom}
              title="Switch to another room"
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/60 flex items-center gap-1"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Room</span>
            </button>

            <button
              onClick={handleSwitchUser}
              title="Logout"
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-medium bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 transition border border-rose-800/40 flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* SCROLLABLE CHAT MESSAGES FEED */}
        <main
          ref={messagesFeedRef}
          onScroll={(event) => {
            if (event.currentTarget.scrollTop < 80) loadOlderMessages();
          }}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 sm:p-5 space-y-3 bg-gradient-to-b from-[#090D16] to-[#06080E]"
        >
          {hasMoreMessages && (
            <div className="flex justify-center pb-1">
              <button
                type="button"
                onClick={loadOlderMessages}
                disabled={loadingOlder}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-700/70 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-60 transition"
              >
                {loadingOlder ? "Loading..." : "Load older messages"}
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center h-full text-center py-12 px-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center text-2xl mb-3 shadow-lg shadow-indigo-500/5">
                💬
              </div>
              <h2 className="text-base font-bold text-slate-100">
                Welcome to #{roomCode}!
              </h2>
              <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
                Send a message or attach a photo to start chatting in real time!
              </p>

              <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
                {["👋 Hey there!", "📸 Photo time", "🚀 Ready to chat"].map(
                  (quickText) => (
                    <button
                      key={quickText}
                      onClick={() => {
                        setNewMessage(quickText);
                        inputFieldRef.current?.focus();
                      }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition"
                    >
                      {quickText}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            /* Messages List */
            messages.map((msg) => {
              const isMe = msg.sender === username;
              const avatarGrad = getAvatarGradient(msg.sender || "User");
              const initial = (msg.sender?.[0] || "?").toUpperCase();
              const hasImage = Boolean(msg.image_url);
              const hasText = msg.content && msg.content !== "📷 Photo";

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 group ${isMe ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Sender Avatar */}
                  <div
                    className={`w-7 h-7 rounded-full bg-gradient-to-tr ${avatarGrad} text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-md ring-1 ring-slate-800`}
                    title={msg.sender}
                  >
                    {initial}
                  </div>

                  {/* Message Bubble + Action Button */}
                  <div
                    className={`flex flex-col max-w-[85%] sm:max-w-[70%] ${isMe ? "items-end" : "items-start"}`}
                  >
                    {/* Sender Name */}
                    {!isMe && (
                      <span className="text-[11px] text-slate-400 mb-0.5 px-1 font-medium">
                        {msg.sender}
                      </span>
                    )}

                    <div
                      className={`relative flex items-center gap-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {/* Bubble Body */}
                      <div
                        className={`p-3 rounded-2xl text-sm leading-relaxed shadow-md ${
                          isMe
                            ? "bg-gradient-to-br from-blue-600 via-indigo-600 to-indigo-700 text-white rounded-br-none border border-indigo-400/20 shadow-indigo-600/10"
                            : "bg-slate-800/95 text-slate-100 rounded-bl-none border border-slate-700/80 shadow-black/40"
                        }`}
                      >
                        {/* Text Content */}
                        {hasText && (
                          <p className="break-words font-normal select-text">
                            {msg.content}
                          </p>
                        )}

                        {/* Image Card */}
                        {hasImage && (
                          <div className="mt-1 relative group/img rounded-xl overflow-hidden border border-black/30 bg-black/40 max-w-sm">
                            <img
                              src={msg.image_url}
                              alt="Attached photo"
                              onClick={() =>
                                setActiveImagePreview(msg.image_url)
                              }
                              className="max-h-64 sm:max-h-80 w-full object-cover cursor-zoom-in hover:opacity-95 transition"
                              loading="lazy"
                            />

                            {/* Floating Overlay Buttons on Image */}
                            <div className="absolute top-2 right-2 flex items-center gap-1 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-700/70 shadow-lg">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownloadImage(
                                    msg.image_url,
                                    `photo_${msg.sender}_${msg.id.slice(0, 6)}.jpg`,
                                  );
                                }}
                                title="Download photo"
                                className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-white font-semibold transition"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Save</span>
                              </button>

                              <button
                                onClick={() =>
                                  setActiveImagePreview(msg.image_url)
                                }
                                title="Enlarge"
                                className="text-slate-400 hover:text-white p-0.5 transition"
                              >
                                <Maximize2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Timestamp & Status */}
                        <div
                          className={`flex items-center justify-end gap-1 text-[10px] mt-1 font-mono ${
                            isMe ? "text-indigo-200/80" : "text-slate-400"
                          }`}
                        >
                          <span>
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {isMe && (
                            <CheckCheck className="w-3.5 h-3.5 text-indigo-300" />
                          )}
                        </div>
                      </div>

                      {/* 3-Dot Options Trigger (Opens Action Menu) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionMenuMessage(msg);
                        }}
                        title="Options"
                        className="w-7 h-7 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition shrink-0 opacity-70 hover:opacity-100"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </main>

        {/* FIXED BOTTOM CONTROLS & INPUT DOCK */}
        <div className="shrink-0 z-20 sticky bottom-0 w-full bg-slate-950/95 backdrop-blur-md border-t border-slate-800">
          {/* PENDING IMAGE PREVIEW BAR */}
          {pendingImage && (
            <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="relative rounded-lg overflow-hidden border border-indigo-500/50 w-10 h-10 shrink-0">
                  <img
                    src={pendingImage.previewUrl}
                    alt="Pending preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-slate-200">Photo attached</p>
                  <p className="text-slate-400 text-[11px]">
                    Type caption or tap Send
                  </p>
                </div>
              </div>

              <button
                onClick={cancelPendingImage}
                className="p-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                title="Remove photo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* UPLOADING PROGRESS BAR */}
          {uploading && (
            <div className="px-4 py-1.5 bg-indigo-950/80 border-b border-indigo-900/60 flex items-center justify-between text-xs text-indigo-200">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span>
                {uploadProgress || "Uploading photo to Supabase..."}
              </span>
            </div>
          )}

          {/* EMOJI DRAWER */}
          {showEmojiPicker && (
            <div className="emoji-picker-container px-3 py-2 border-b border-slate-800/80 flex items-center gap-1.5 overflow-x-auto">
              <span className="text-[10px] text-slate-500 font-bold uppercase mr-1 shrink-0">
                Emojis:
              </span>
              {POPULAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => addEmoji(emoji)}
                  className="text-lg hover:scale-125 transition-transform p-1 shrink-0"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* INPUT FORM */}
          <footer className="p-2.5 sm:p-3.5">
            <form onSubmit={handleSend} className="flex items-center gap-2">
              {/* Hidden File Input */}
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                id="chat-photo-input"
              />

              {/* Photo Picker Trigger */}
              <label
                htmlFor="chat-photo-input"
                title="Attach photo"
                className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white p-2.5 sm:p-3 rounded-xl transition flex items-center justify-center shrink-0 border border-slate-700/60 active:scale-95 shadow-sm"
              >
                <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
              </label>

              {/* Emoji Trigger */}
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="Add emoji"
                className={`p-2.5 sm:p-3 rounded-xl transition border shrink-0 flex items-center justify-center ${
                  showEmojiPicker
                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-400"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700/60"
                }`}
              >
                <Smile className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Text Input */}
              <input
                ref={inputFieldRef}
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={
                  pendingImage
                    ? "Add caption to photo..."
                    : `Message #${roomCode}...`
                }
                disabled={uploading}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-white placeholder-slate-500 transition"
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={(!newMessage.trim() && !pendingImage) || uploading}
                className={`p-2.5 sm:px-4 sm:py-3 rounded-xl font-bold text-sm transition shrink-0 flex items-center gap-1.5 shadow-md ${
                  (newMessage.trim() || pendingImage) && !uploading
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-indigo-600/25 active:scale-95"
                    : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800"
                }`}
              >
                <span className="hidden sm:inline">Send</span>
                <Send className="w-4 h-4" />
              </button>
            </form>
          </footer>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. MESSAGE ACTION MENU (Direct delete from DB with NO popup) */}
      {/* ==================================================== */}
      {actionMenuMessage && (
        <div
          onClick={() => setActionMenuMessage(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 animate-in fade-in duration-100"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-3 shadow-2xl space-y-1 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-150"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 flex justify-between items-center">
              <span>Message Options</span>
              <button
                onClick={() => setActionMenuMessage(null)}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Download Image option */}
            {actionMenuMessage.image_url && (
              <button
                onClick={() => {
                  const target = actionMenuMessage;
                  setActionMenuMessage(null);
                  handleDownloadImage(
                    target.image_url,
                    `photo_${target.sender}_${target.id.slice(0, 6)}.jpg`,
                  );
                }}
                className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-800 text-slate-200 rounded-xl text-xs transition"
              >
                <Download className="w-4 h-4 text-indigo-400" />
                <span className="font-medium">Download Photo</span>
              </button>
            )}

            {/* Copy Text option */}
            {actionMenuMessage.content &&
              actionMenuMessage.content !== "📷 Photo" && (
                <button
                  onClick={() => handleCopyText(actionMenuMessage.content)}
                  className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-800 text-slate-200 rounded-xl text-xs transition"
                >
                  <Copy className="w-4 h-4 text-slate-400" />
                  <span className="font-medium">Copy Text</span>
                </button>
              )}

            {/* Direct Instant Delete from Database - NO POPUP */}
            {actionMenuMessage.sender === username && (
              <button
                onClick={() => executeDelete(actionMenuMessage)}
                className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-rose-950/60 text-rose-400 hover:text-rose-300 font-medium rounded-xl text-xs transition border-t border-slate-800/80 mt-1"
              >
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span>Delete from Database</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* 4. FULLSCREEN IMAGE LIGHTBOX MODAL */}
      {/* ==================================================== */}
      {activeImagePreview && (
        <div
          onClick={() => setActiveImagePreview(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-zoom-out"
        >
          <div className="relative max-w-4xl max-h-[85vh] flex flex-col items-center">
            <img
              src={activeImagePreview}
              alt="Enlarged preview"
              className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl border border-slate-800"
            />
            <div className="mt-3 flex justify-between items-center text-xs text-slate-400 gap-3 w-full px-1">
              <span>Click outside to close</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadImage(
                      activeImagePreview,
                      `photo_${Date.now()}.jpg`,
                    );
                  }}
                  className="bg-slate-800 text-white px-3.5 py-1.5 rounded-xl hover:bg-slate-700 transition font-semibold flex items-center gap-1.5 border border-slate-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <a
                  href={activeImagePreview}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="bg-indigo-600 text-white px-3.5 py-1.5 rounded-xl hover:bg-indigo-500 transition font-semibold flex items-center gap-1"
                >
                  <span>Open Full</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
