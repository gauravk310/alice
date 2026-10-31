import { Client } from "@colyseus/sdk";
import Swal from "sweetalert2";
import "./style.css";
import {
  type UserProfile,
  getStoredUser,
  setStoredUser,
  clearStoredUser,
  decodeGoogleJwt,
  syncUserWithBackend,
} from "./auth.ts";
import {
  renderLucideIcon,
  ShieldCheck,
  LogOut,
  Gamepad2,
  ChevronLeft,
  X,
  Play,
  AlertTriangle,
  Plus,
  Users,
  Crown,
  Copy,
  Check,
  RefreshCw,
  Radio,
  DoorOpen,
  Unlock,
  MessageSquare,
  User,
} from "./icons.ts";

const serverUrl =
  import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567";
const googleClientId =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// ==========================================
// MATCHMAKING & LOBBY DATA TYPES
// ==========================================
export interface RoomSummary {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostName: string;
  hostAvatar: string;
  hostUserId: string;
  playerCount: number;
  maxPlayers: number;
  status: "waiting" | "in_progress";
  createdAt: number;
}

export interface JoinedPlayer {
  sessionId: string;
  userId: string;
  name: string;
  picture: string;
  isHost: boolean;
  isReady: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  text: string;
  isHost: boolean;
  timestamp: number;
}

// Global active session state
let colyseusClient: Client | null = null;
let activeRoom: any = null;
let currentRoomSummary: RoomSummary | null = null;
let roomPlayers: JoinedPlayer[] = [];
let roomChatHistory: ChatMessage[] = [];
let isLobbyChatOpen = false;
let unreadChatCount = 0;

function updateFloatingChatBadge() {
  const badge = document.getElementById("chat-unread-badge");
  const btn = document.getElementById("btn-floating-chat");
  if (badge) {
    if (unreadChatCount > 0 && !isLobbyChatOpen) {
      badge.textContent = unreadChatCount > 9 ? "9+" : String(unreadChatCount);
      badge.style.display = "flex";
      btn?.classList.add("has-unread");
    } else {
      badge.style.display = "none";
      btn?.classList.remove("has-unread");
    }
  }
}

function openLobbyChat() {
  isLobbyChatOpen = true;
  unreadChatCount = 0;
  updateFloatingChatBadge();
  const drawer = document.getElementById("lobby-chat-drawer");
  const btn = document.getElementById("btn-floating-chat");
  drawer?.classList.add("is-open");
  btn?.classList.add("is-hidden");
  const input = document.getElementById("input-chat") as HTMLInputElement;
  if (input) {
    setTimeout(() => input.focus(), 120);
  }
  const chatWrap = document.getElementById("chat-messages-wrap");
  if (chatWrap) {
    chatWrap.scrollTop = chatWrap.scrollHeight;
  }
}

function closeLobbyChat() {
  isLobbyChatOpen = false;
  const drawer = document.getElementById("lobby-chat-drawer");
  const btn = document.getElementById("btn-floating-chat");
  drawer?.classList.remove("is-open");
  btn?.classList.remove("is-hidden");
}

let availableRoomsList: RoomSummary[] = [];
let isCreateRoomModalOpen = false;
let roomSearchFilter = "";
let roomsPollingInterval: any = null;
let selectedMaxPlayers = 6;
let isGameStarted = false;
let currentChosenBalance: number | null = null;

function getColyseusClient(): Client {
  if (!colyseusClient) {
    colyseusClient = new Client(serverUrl);
  }
  return colyseusClient;
}

// ==========================================
// NAVIGATION & PERSISTENCE HELPERS
// ==========================================
const STORAGE_VIEW_KEY = "alice_current_view";
const STORAGE_ROOM_KEY = "alice_current_room_id";

function saveNavigationState(view: "store" | "arena" | "room", roomId?: string) {
  try {
    sessionStorage.setItem(STORAGE_VIEW_KEY, view);
    if (roomId) {
      sessionStorage.setItem(STORAGE_ROOM_KEY, roomId);
      window.location.hash = `#room=${roomId}`;
    } else if (view === "arena") {
      sessionStorage.removeItem(STORAGE_ROOM_KEY);
      window.location.hash = "#arena";
    } else {
      sessionStorage.removeItem(STORAGE_ROOM_KEY);
      window.location.hash = "";
    }
  } catch (e) {
    console.warn("Error saving navigation state:", e);
  }
}

function clearNavigationState() {
  try {
    sessionStorage.removeItem(STORAGE_VIEW_KEY);
    sessionStorage.removeItem(STORAGE_ROOM_KEY);
    window.location.hash = "";
  } catch (e) {
    console.warn("Error clearing navigation state:", e);
  }
}

function showToastNotification(message: string) {
  const existing = document.getElementById("alice-toast-notice");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "alice-toast-notice";
  toast.className = "alice-toast-notice";
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("show");
  }, 50);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ==========================================
// API & NETWORK HELPERS
// ==========================================
async function fetchOpenRooms(): Promise<RoomSummary[]> {
  try {
    const res = await fetch(`${serverUrl}/api/rooms`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data && data.success && Array.isArray(data.rooms)) {
      availableRoomsList = data.rooms;
      return data.rooms;
    }
    return [];
  } catch (err) {
    console.warn("Error fetching rooms list:", err);
    return [];
  }
}

function startRoomsAutoPolling(user: UserProfile) {
  stopRoomsAutoPolling();
  // Poll every 2 seconds to keep room list and player counts fresh
  roomsPollingInterval = setInterval(async () => {
    if (!activeRoom && document.getElementById("rooms-grid-container")) {
      await fetchOpenRooms();
      updateRoomsGridUi(user);
    }
  }, 2000);
}

function stopRoomsAutoPolling() {
  if (roomsPollingInterval) {
    clearInterval(roomsPollingInterval);
    roomsPollingInterval = null;
  }
}

// ==========================================
// PROFILE DROPDOWN
// ==========================================
function renderProfileDropdownHtml(user: UserProfile, avatarMarkupLarge: string): string {
  return `
    <div id="profile-menu-dropdown" class="profile-menu-dropdown">
      <div class="dropdown-header">
        <button id="btn-close-dropdown" class="dropdown-close-btn" title="Close">
          ${renderLucideIcon(X, { width: 16, height: 16 })}
        </button>

        <div class="dropdown-avatar-wrap">
          ${avatarMarkupLarge}
        </div>
        <div class="dropdown-user-name">${user.name}</div>
        <div class="dropdown-user-email">${user.email || "Verified Google Account"}</div>
      </div>

      <button id="btn-signout" class="btn-dropdown-signout" title="Sign out of Alice">
        ${renderLucideIcon(LogOut, { width: 16, height: 16 })}
        <span>Sign Out</span>
      </button>
    </div>
  `;
}

function attachProfileDropdownEvents() {
  const profileBtn = document.getElementById("btn-profile-toggle");
  const profileDropdown = document.getElementById("profile-menu-dropdown");
  const closeDropdownBtn = document.getElementById("btn-close-dropdown");

  const toggleDropdown = (e: MouseEvent) => {
    e.stopPropagation();
    const isShowing = profileDropdown?.classList.contains("show");
    if (isShowing) {
      profileDropdown?.classList.remove("show");
      profileBtn?.classList.remove("active");
    } else {
      profileDropdown?.classList.add("show");
      profileBtn?.classList.add("active");
    }
  };

  profileBtn?.addEventListener("click", toggleDropdown);
  closeDropdownBtn?.addEventListener("click", () => {
    profileDropdown?.classList.remove("show");
    profileBtn?.classList.remove("active");
  });

  document.addEventListener("click", (e) => {
    if (
      profileDropdown?.classList.contains("show") &&
      !profileDropdown.contains(e.target as Node) &&
      !profileBtn?.contains(e.target as Node)
    ) {
      profileDropdown.classList.remove("show");
      profileBtn?.classList.remove("active");
    }
  });

  document.getElementById("btn-signout")?.addEventListener("click", () => {
    profileDropdown?.classList.remove("show");
    profileBtn?.classList.remove("active");

    Swal.fire({
      title: "Sign Out?",
      text: "Are you sure you want to sign out of Alice?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Sign Out",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#334155",
      reverseButtons: true,
      focusCancel: true,
      customClass: {
        popup: "alice-swal-popup",
        title: "alice-swal-title",
        confirmButton: "alice-swal-confirm",
        cancelButton: "alice-swal-cancel",
      },
    }).then((result) => {
      if (result.isConfirmed) {
        if (activeRoom) {
          try {
            activeRoom.leave();
          } catch (e) {}
          activeRoom = null;
        }
        clearNavigationState();
        clearStoredUser();
        renderLoginView();
      }
    });
  });
}

// ==========================================
// TARAJU FULLSCREEN MATCHMAKING & LOBBY VIEW
// ==========================================
function renderArenaView(user: UserProfile) {
  if (activeRoom) {
    saveNavigationState("room", activeRoom.roomId);
    if (isGameStarted || isCountdownActive || tarajuGameState.phase !== "lobby") {
      renderGameActiveView(user);
    } else {
      renderRoomLobbyView(user);
    }
  } else {
    saveNavigationState("arena");
    renderRoomBrowserView(user);
  }
}

// ------------------------------------------
// 1. ROOM BROWSER VIEW (PUBG Tactical Custom Room Structure)
// ------------------------------------------
async function renderRoomBrowserView(user: UserProfile) {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <!-- Tactical Custom Room Viewport (Full Screen) -->
    <main class="pubg-room-wrapper">
      <div class="pubg-room-window">
        <!-- Top Header Bar: Enter Room ID + Enter Button & Close Button -->
          <div class="pubg-room-topbar">
            <div class="pubg-topbar-left">
              <div class="pubg-room-id-box">
                <input 
                  type="text" 
                  id="input-room-id-search" 
                  class="pubg-room-id-input" 
                  placeholder="Enter Room ID" 
                  value="${roomSearchFilter}"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button id="btn-room-id-enter" class="btn-pubg-enter">
                  Enter
                </button>
              </div>
            </div>

            <div class="pubg-topbar-right">
              <button id="btn-pubg-window-close" class="btn-pubg-close" title="Exit to Games">
                ${renderLucideIcon(X, { width: 20, height: 20 })}
              </button>
            </div>
          </div>

          <!-- Main Room List Container -->
          <div class="pubg-room-list" id="rooms-grid-container">
            <div class="pubg-room-loading">
              <div class="pubg-loading-spinner"></div>
              <span>Scanning for active custom rooms...</span>
            </div>
          </div>

          <!-- Bottom Footer Bar: Refresh & Create Room Buttons (Right-Aligned, No Chat) -->
          <div class="pubg-room-footer">
            <div class="pubg-footer-right">
              <button id="btn-refresh-rooms" class="btn-pubg-refresh" title="Refresh available rooms">
                ${renderLucideIcon(RefreshCw, { width: 15, height: 15 })}
                <span>Refresh</span>
              </button>
              <button id="btn-open-create-modal" class="btn-pubg-create-room">
                <span>Create Room</span>
              </button>
            </div>
          </div>
        </div>
      </main>

    <!-- Create Room Modal Backdrop (Fixed Viewport Overlay) -->
    <div id="modal-create-room-backdrop" class="modal-backdrop ${isCreateRoomModalOpen ? "show" : "hidden"}" style="display: ${isCreateRoomModalOpen ? "flex" : "none"};">
      <div class="modal-content-card pubg-modal-card">
        <div class="modal-header">
          <div class="modal-title">
            ${renderLucideIcon(Plus, { width: 18, height: 18, style: "color: #facc15;" })}
            Create Custom Room
          </div>
          <button class="modal-close-btn" id="btn-close-create-modal" title="Close">
            ${renderLucideIcon(X, { width: 16, height: 16 })}
          </button>
        </div>

        <!-- Room Name Input -->
        <div class="form-field-group">
          <label class="form-field-label">Room Name</label>
          <input 
            type="text" 
            id="input-new-room-name" 
            class="modal-input-text" 
            value="${user.name}'s Arena" 
            maxlength="32" 
            placeholder="e.g. Diamond Squad Duel" 
          />
        </div>

        <!-- Game Mode / Slots Selection -->
        <div class="form-field-group">
          <label class="form-field-label">Max Players (Slots)</label>
          <div class="pubg-modal-modes-grid" id="max-players-selector">
            <button class="pubg-modal-mode-card ${selectedMaxPlayers === 2 ? "selected" : ""}" data-count="2">
              <div class="pubg-diamond-badge small">
                <div class="pubg-diamond-inner">
                  ${renderLucideIcon(User, { width: 14, height: 14 })}
                </div>
              </div>
              <div class="modal-mode-info">
                <div class="modal-mode-title">Solo / Duo</div>
                <div class="modal-mode-sub">2 Players</div>
              </div>
            </button>

            <button class="pubg-modal-mode-card ${selectedMaxPlayers === 4 ? "selected" : ""}" data-count="4">
              <div class="pubg-diamond-badge small">
                <div class="pubg-diamond-inner">
                  ${renderLucideIcon(Users, { width: 14, height: 14 })}
                </div>
              </div>
              <div class="modal-mode-info">
                <div class="modal-mode-title">Squad 4</div>
                <div class="modal-mode-sub">4 Players</div>
              </div>
            </button>

            <button class="pubg-modal-mode-card ${selectedMaxPlayers === 6 ? "selected" : ""}" data-count="6">
              <div class="pubg-diamond-badge small">
                <div class="pubg-diamond-inner">
                  ${renderLucideIcon(Users, { width: 14, height: 14 })}
                </div>
              </div>
              <div class="modal-mode-info">
                <div class="modal-mode-title">Squad 6</div>
                <div class="modal-mode-sub">6 Players</div>
              </div>
            </button>

            <button class="pubg-modal-mode-card ${selectedMaxPlayers === 8 ? "selected" : ""}" data-count="8">
              <div class="pubg-diamond-badge small">
                <div class="pubg-diamond-inner">
                  ${renderLucideIcon(Users, { width: 14, height: 14 })}
                </div>
              </div>
              <div class="modal-mode-info">
                <div class="modal-mode-title">Battle 8</div>
                <div class="modal-mode-sub">8 Players</div>
              </div>
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-modal-cancel" id="btn-cancel-create">Cancel</button>
          <button class="btn-pubg-modal-submit" id="btn-submit-create-room">
            Create & Host Room
          </button>
        </div>
      </div>
    </div>
  `;

  // Navigation back to Games store
  const returnToStore = () => {
    stopRoomsAutoPolling();
    saveNavigationState("store");
    renderPlayStoreView(user);
  };
  document.getElementById("btn-pubg-window-close")?.addEventListener("click", returnToStore);

  // Search input & Enter ID handler
  const searchInput = document.getElementById("input-room-id-search") as HTMLInputElement;
  searchInput?.addEventListener("input", (e) => {
    roomSearchFilter = (e.target as HTMLInputElement).value;
    updateRoomsGridUi(user);
  });

  const handleEnterRoom = async () => {
    const query = searchInput?.value?.trim();
    if (!query) {
      showToastNotification("Please enter a Room ID or Code");
      return;
    }

    const exactMatch = availableRoomsList.find(
      (r) =>
        r.roomCode.toLowerCase() === query.toLowerCase() ||
        r.roomId.toLowerCase() === query.toLowerCase()
    );

    if (exactMatch) {
      await joinRoomById(user, exactMatch.roomId);
    } else {
      await joinRoomByCode(user, query);
    }
  };

  document.getElementById("btn-room-id-enter")?.addEventListener("click", handleEnterRoom);
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEnterRoom();
    }
  });

  // Refresh button
  const refreshBtn = document.getElementById("btn-refresh-rooms");
  refreshBtn?.addEventListener("click", async () => {
    refreshBtn.classList.add("spinning");
    await fetchOpenRooms();
    updateRoomsGridUi(user);
    setTimeout(() => {
      refreshBtn.classList.remove("spinning");
    }, 600);
  });

  // Modal open / close
  const modalBackdrop = document.getElementById("modal-create-room-backdrop");
  const openModalBtn = document.getElementById("btn-open-create-modal");
  const closeModalBtn = document.getElementById("btn-close-create-modal");
  const cancelModalBtn = document.getElementById("btn-cancel-create");

  const openModal = () => {
    isCreateRoomModalOpen = true;
    if (modalBackdrop) {
      modalBackdrop.style.display = "flex";
      modalBackdrop.classList.remove("hidden");
      modalBackdrop.classList.add("show");
    }
  };

  const closeModal = () => {
    isCreateRoomModalOpen = false;
    if (modalBackdrop) {
      modalBackdrop.style.display = "none";
      modalBackdrop.classList.remove("show");
      modalBackdrop.classList.add("hidden");
    }
  };

  openModalBtn?.addEventListener("click", openModal);
  closeModalBtn?.addEventListener("click", closeModal);
  cancelModalBtn?.addEventListener("click", closeModal);
  modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });

  // Mode selection buttons
  const modeCards = document.querySelectorAll(".pubg-modal-mode-card");
  modeCards.forEach((card) => {
    card.addEventListener("click", () => {
      modeCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedMaxPlayers = Number(card.getAttribute("data-count")) || 6;
    });
  });

  // Create room submit
  document.getElementById("btn-submit-create-room")?.addEventListener("click", async () => {
    const roomNameInput = document.getElementById("input-new-room-name") as HTMLInputElement;
    const roomName = roomNameInput?.value?.trim() || `${user.name}'s Arena`;
    closeModal();
    await createRoomAndEnter(user, roomName, selectedMaxPlayers);
  });

  // Initial rooms fetch and auto polling
  await fetchOpenRooms();
  updateRoomsGridUi(user);
  startRoomsAutoPolling(user);
}

function updateRoomsGridUi(user: UserProfile) {
  const container = document.getElementById("rooms-grid-container");
  if (!container) return;

  const filtered = availableRoomsList.filter((r) => {
    if (!roomSearchFilter) return true;
    const q = roomSearchFilter.toLowerCase();
    return (
      r.roomName.toLowerCase().includes(q) ||
      r.hostName.toLowerCase().includes(q) ||
      r.roomCode.toLowerCase().includes(q) ||
      r.roomId.toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="pubg-room-empty">
        <div class="pubg-empty-radar">
          ${renderLucideIcon(Radio, { width: 38, height: 38 })}
        </div>
        <div class="pubg-empty-title">No Active Custom Rooms</div>
        <div class="pubg-empty-desc">
          There are currently no open lobbies matching "${escapeHtml(roomSearchFilter || "your search")}". Create your own custom room and invite rivals to duel!
        </div>
        <button class="btn-pubg-create-room" id="btn-empty-create-room">
          <span>Create Room</span>
        </button>
      </div>
    `;

    document.getElementById("btn-empty-create-room")?.addEventListener("click", () => {
      isCreateRoomModalOpen = true;
      const modal = document.getElementById("modal-create-room-backdrop");
      if (modal) {
        modal.style.display = "flex";
        modal.classList.remove("hidden");
        modal.classList.add("show");
      }
    });
    return;
  }

  container.innerHTML = filtered
    .map((room) => {
      const isFull = room.playerCount >= room.maxPlayers;
      const isStarted = room.status === "in_progress";

      // Mode label & icon: Squad, Solo, Duo
      let modeName = "Squad";
      let modeIcon = Users;
      if (room.maxPlayers <= 1) {
        modeName = "Solo";
        modeIcon = User;
      } else if (room.maxPlayers === 2) {
        modeName = "Solo";
        modeIcon = User;
      } else if (room.maxPlayers <= 4) {
        modeName = "Squad";
        modeIcon = Users;
      } else {
        modeName = "Squad";
        modeIcon = Users;
      }

      return `
        <div class="pubg-room-row" data-room-id="${room.roomId}">
          <!-- 1. Room Title & Host Info -->
          <div class="pubg-room-info-wrap">
            <div class="pubg-room-title" title="${escapeHtml(room.roomName)}">
              ${escapeHtml(room.roomName)}
            </div>
            <div class="pubg-room-created-by">
              Created by: <span class="pubg-host-name">${escapeHtml(room.hostName)}</span>
              <span class="pubg-room-badge-id">#${room.roomCode}</span>
            </div>
          </div>

          <!-- 2. Mode Emblem & Label (Diamond Gold Badge) -->
          <div class="pubg-room-mode-wrap">
            <div class="pubg-diamond-badge">
              <div class="pubg-diamond-inner">
                ${renderLucideIcon(modeIcon, { width: 16, height: 16 })}
              </div>
            </div>
            <span class="pubg-mode-text">${modeName}</span>
          </div>

          <!-- 3. Lock Column -->
          <div class="pubg-room-lock-wrap" title="Public Open Room">
            ${renderLucideIcon(Unlock, { width: 18, height: 18, class: "pubg-lock-icon" })}
          </div>

          <!-- 4. Players Count (How many are present / How many max) -->
          <div class="pubg-room-stats-wrap">
            <div class="pubg-stats-line">
              <span class="pubg-stats-label">Joined:</span>
              <span class="pubg-stats-val stat-joined">${room.playerCount} / ${room.maxPlayers}</span>
            </div>
            <div class="pubg-stats-line">
              <span class="pubg-stats-label">Status:</span>
              <span class="pubg-stats-val ${isStarted ? "stat-spectate" : "stat-joined"}">${isStarted ? "In Progress" : "Waiting"}</span>
            </div>
          </div>

          <!-- 5. Join Action Button -->
          <div class="pubg-room-action-wrap">
            <button 
              class="btn-pubg-join btn-card-join ${isFull || isStarted ? "disabled" : ""}" 
              data-room-id="${room.roomId}"
              ${isFull || isStarted ? "disabled" : ""}
            >
              ${isFull ? "Full" : isStarted ? "Playing" : "Join"}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach join handlers
  container.querySelectorAll(".btn-card-join").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) {
        await joinRoomById(user, roomId);
      }
    });
  });
}

// ------------------------------------------
// 2. ROOM LOBBY VIEW (Among Us Style Waiting Room in Light Theme)
// ------------------------------------------
function buildPodiumsHtml(user: UserProfile, maxSlots: number): string {
  let podiumsHtml = "";
  for (let i = 0; i < maxSlots; i++) {
    const player = roomPlayers[i];
    if (player) {
      const isSelf = player.sessionId === activeRoom?.sessionId || player.userId === user.id;
      const avatarMarkup = player.picture
        ? `<img src="${player.picture}" alt="${player.name}" class="podium-avatar-img" referrerpolicy="no-referrer" />`
        : `<div class="podium-avatar-initials">${(player.name || "P").charAt(0).toUpperCase()}</div>`;

      podiumsHtml += `
        <div class="podium-card ${isSelf ? "is-current-user" : ""}">
          <div class="podium-avatar-wrapper">
            ${avatarMarkup}
            ${
              player.isHost
                ? `<div class="podium-crown-badge" title="Room Host">
                     ${renderLucideIcon(Crown, { width: 14, height: 14 })}
                   </div>`
                : ""
            }
          </div>

          <div class="podium-player-name">
            <span>${player.name}</span>
            ${isSelf ? `<span class="podium-you-tag">You</span>` : ""}
          </div>
        </div>
      `;
    } else {
      podiumsHtml += `
        <div class="podium-card empty-slot">
          <div class="empty-slot-icon">
            ${renderLucideIcon(Users, { width: 32, height: 32 })}
          </div>
          <div class="empty-slot-text">Waiting for player...</div>
        </div>
      `;
    }
  }
  return podiumsHtml;
}

function updateOrRenderLobby(user: UserProfile) {
  if (isGameStarted || isCountdownActive || tarajuGameState.phase !== "lobby") {
    return;
  }

  const podiumContainer = document.getElementById("podium-grid-container");
  if (!podiumContainer || !document.getElementById("btn-leave-room")) {
    renderRoomLobbyView(user);
    return;
  }

  const currentHost = roomPlayers.find((p) => p.isHost);
  const isHost = Boolean(
    currentHost &&
      (currentHost.sessionId === activeRoom?.sessionId || currentHost.userId === user.id)
  );
  const maxSlots = currentRoomSummary?.maxPlayers || 6;
  const roomName = currentRoomSummary?.roomName || activeRoom?.state?.roomName || "Taraju Arena";
  const roomCode = currentRoomSummary?.roomCode || activeRoom?.state?.roomCode || "TRJ-ROOM";

  const nameEl = document.getElementById("lobby-room-name-display");
  if (nameEl) nameEl.textContent = roomName;
  const codeEl = document.getElementById("lobby-code-mono-display");
  if (codeEl) codeEl.textContent = `#${roomCode}`;

  // 1. Update podium cards in real-time
  podiumContainer.innerHTML = buildPodiumsHtml(user, maxSlots);

  // 2. Update count pills
  const topCount = document.getElementById("lobby-players-top-count");
  if (topCount) {
    topCount.textContent = `${roomPlayers.length} / ${maxSlots} Players`;
  }
  const stageHeaderCount = document.getElementById("lobby-stage-crew-title");
  if (stageHeaderCount) {
    stageHeaderCount.textContent = `Lobby Crew (${roomPlayers.length} / ${maxSlots})`;
  }

  // 3. Update bottom action status & buttons
  const statusTextWrap = document.getElementById("lobby-action-status-text");
  if (statusTextWrap) {
    statusTextWrap.innerHTML = isHost
      ? `<span>👑 <strong>You are the Room Host.</strong> Click Start Room when players have joined!</span>`
      : `<span>⏳ Waiting for host <strong>(${currentHost?.name || "Host"})</strong> to start the match...</span>`;
  }

  const buttonsGroup = document.getElementById("lobby-action-buttons-group");
  if (buttonsGroup) {
    buttonsGroup.innerHTML = isHost
      ? `
        <button class="btn-start-room" id="btn-host-start-room">
          ${renderLucideIcon(Play, { width: 18, height: 18 })}
          <span>Start Room</span>
        </button>
      `
      : "";

    document.getElementById("btn-host-start-room")?.addEventListener("click", () => {
      startRoomMatch(user);
    });
  }
}

function renderRoomLobbyView(user: UserProfile) {
  if (isGameStarted || isCountdownActive || tarajuGameState.phase !== "lobby") {
    renderGameActiveView(user);
    return;
  }

  const app = document.getElementById("app");
  if (!app || !activeRoom) return;

  const currentHost = roomPlayers.find((p) => p.isHost);
  const isHost = Boolean(currentHost && (currentHost.sessionId === activeRoom.sessionId || currentHost.userId === user.id));
  const maxSlots = currentRoomSummary?.maxPlayers || 6;
  const roomName = currentRoomSummary?.roomName || activeRoom.state?.roomName || "Taraju Arena";
  const roomCode = currentRoomSummary?.roomCode || activeRoom.state?.roomCode || "TRJ-ROOM";

  const avatarMarkupSmall = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="avatar-img-circle" referrerpolicy="no-referrer" />`
    : `<div class="avatar-initials-circle">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  const avatarMarkupLarge = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="dropdown-avatar-large" referrerpolicy="no-referrer" />`
    : `<div class="dropdown-avatar-initials-large">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  const podiumsHtml = buildPodiumsHtml(user, maxSlots);

  // Build chat history messages
  const chatMessagesHtml = roomChatHistory
    .map(
      (msg) => `
      <div class="chat-message-bubble">
        <div class="chat-msg-sender ${msg.isHost ? "is-host" : ""}">
          ${msg.isHost ? "👑" : ""} ${msg.senderName}
        </div>
        <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
      </div>
    `
    )
    .join("");

  app.innerHTML = `
    <div class="arena-fullscreen-wrapper">
      <!-- Alice Navigation Header -->
      <header class="playstore-header">
        <div class="header-left">
          <div class="navbar-brand" id="brand-to-store-lobby" title="Back to Games" style="cursor: pointer;">
            <div class="navbar-logo-icon">
              ${renderLucideIcon(Gamepad2, { width: 20, height: 20 })}
            </div>
            <div>
              <div class="navbar-title">Alice Multiplayer</div>
              <div class="navbar-subtitle">Arena v0.1</div>
            </div>
          </div>

          <nav class="playstore-nav-tabs">
            <div class="playstore-tab active" id="tab-to-store-lobby" data-tab="home" style="cursor: pointer;">Games</div>
          </nav>
        </div>

        <div class="header-right">
          <button id="btn-profile-toggle" class="playstore-profile-btn" title="Account: ${user.name}">
            ${avatarMarkupSmall}
          </button>
          ${renderProfileDropdownHtml(user, avatarMarkupLarge)}
        </div>
      </header>

      <div class="room-lobby-fullscreen">
        <!-- Room Lobby Top Sub-Header -->
        <header class="room-lobby-topbar">
          <div class="lobby-topbar-left">
            <button class="btn-leave-lobby" id="btn-leave-room" title="Leave room and return to lobby browser">
              ${renderLucideIcon(DoorOpen, { width: 16, height: 16 })}
              <span>Leave Room</span>
            </button>

            <div class="lobby-room-info-group">
              <div class="lobby-room-name" id="lobby-room-name-display">${roomName}</div>
              <div class="lobby-code-badge" id="btn-copy-code" title="Click to copy room code">
                <span class="code-mono" id="lobby-code-mono-display">#${roomCode}</span>
                <span id="copy-icon-wrap">${renderLucideIcon(Copy, { width: 13, height: 13 })}</span>
              </div>
            </div>
          </div>

          <div class="lobby-topbar-right">
            <div class="lobby-players-count-pill">
              ${renderLucideIcon(Users, { width: 15, height: 15 })}
              <span id="lobby-players-top-count">${roomPlayers.length} / ${maxSlots} Players</span>
            </div>
          </div>
        </header>

        <!-- Room Lobby Main Floor: Podiums & Sidebar -->
        <main class="room-lobby-main">
          <!-- Left: Player Character Podiums (Among Us layout) -->
          <section class="lobby-stage-area">
            <div class="stage-header-title" id="lobby-stage-crew-title">
              Lobby Crew (${roomPlayers.length} / ${maxSlots})
            </div>
            <div class="podium-grid" id="podium-grid-container">
              ${podiumsHtml}
            </div>
          </section>

        </main>

        <!-- Floating Chat Icon (Bottom Right) -->
        <button id="btn-floating-chat" class="floating-chat-btn ${isLobbyChatOpen ? 'is-hidden' : ''}" title="Open Lobby Chat" aria-label="Open Lobby Chat">
          ${renderLucideIcon(MessageSquare, { width: 22, height: 22 })}
          <span class="chat-unread-badge" id="chat-unread-badge" style="display: ${unreadChatCount > 0 && !isLobbyChatOpen ? 'flex' : 'none'};">
            ${unreadChatCount > 9 ? '9+' : unreadChatCount}
          </span>
        </button>

        <!-- Right Side Chat Drawer -->
        <aside class="lobby-chat-drawer ${isLobbyChatOpen ? 'is-open' : ''}" id="lobby-chat-drawer" aria-label="Lobby Chat">
          <div class="chat-header">
            <div class="chat-header-title-group">
              ${renderLucideIcon(MessageSquare, { width: 16, height: 16, style: "color: #38bdf8;" })}
              <span>Lobby Chat</span>
              <span class="chat-live-badge">
                <span class="chat-live-dot"></span>
                Live Synced
              </span>
            </div>
            <button class="btn-chat-close" id="btn-close-chat" title="Close Chat" aria-label="Close Chat">
              ${renderLucideIcon(X, { width: 16, height: 16 })}
            </button>
          </div>

          <div class="chat-messages-container" id="chat-messages-wrap">
            ${chatMessagesHtml || '<div class="chat-empty-hint">No messages yet. Say hi to the lobby!</div>'}
          </div>

          <form class="chat-input-bar" id="chat-form">
            <input 
              type="text" 
              id="input-chat" 
              class="input-chat-text" 
              placeholder="Type message..." 
              maxlength="150" 
              autocomplete="off"
            />
            <button type="submit" class="btn-send-chat">Send</button>
          </form>
        </aside>

        <!-- Sticky Bottom Control Bar (Light Mode) -->
        <footer class="lobby-bottom-action-bar">
          <div class="lobby-action-status-text" id="lobby-action-status-text">
            ${
              isHost
                ? `<span>👑 <strong>You are the Room Host.</strong> Click Start Room when players have joined!</span>`
                : `<span>⏳ Waiting for host <strong>(${currentHost?.name || "Host"})</strong> to start the match...</span>`
            }
          </div>

          <div class="lobby-action-buttons-group" id="lobby-action-buttons-group">
            ${
              isHost
                ? `
                  <button class="btn-start-room" id="btn-host-start-room">
                    ${renderLucideIcon(Play, { width: 18, height: 18 })}
                    <span>Start Room</span>
                  </button>
                `
                : ""
            }
          </div>
        </footer>
      </div>
    </div>
  `;

  // Attach profile dropdown
  attachProfileDropdownEvents();

  // Navigation handlers
  const returnToStore = () => {
    leaveCurrentRoom(user);
    saveNavigationState("store");
    renderPlayStoreView(user);
  };
  document.getElementById("brand-to-store-lobby")?.addEventListener("click", returnToStore);
  document.getElementById("tab-to-store-lobby")?.addEventListener("click", returnToStore);

  // Scroll chat to bottom
  const chatWrap = document.getElementById("chat-messages-wrap");
  if (chatWrap) chatWrap.scrollTop = chatWrap.scrollHeight;

  // Leave room event with SweetAlert confirmation
  document.getElementById("btn-leave-room")?.addEventListener("click", () => {
    Swal.fire({
      title: "Leave Room?",
      text: isHost
        ? "Are you sure you want to leave? As the host, leaving will close the lobby for other players."
        : "Are you sure you want to leave this room and return to the arena lobby?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Leave",
      cancelButtonText: "Stay in Room",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#334155",
      reverseButtons: true,
      focusCancel: true,
      customClass: {
        popup: "alice-swal-popup",
        title: "alice-swal-title",
        confirmButton: "alice-swal-confirm",
        cancelButton: "alice-swal-cancel",
      },
    }).then((result) => {
      if (result.isConfirmed) {
        leaveCurrentRoom(user);
      }
    });
  });

  // Copy code event
  document.getElementById("btn-copy-code")?.addEventListener("click", () => {
    navigator.clipboard.writeText(roomCode);
    const wrap = document.getElementById("copy-icon-wrap");
    if (wrap) {
      wrap.innerHTML = renderLucideIcon(Check, { width: 13, height: 13, style: "color: var(--play-green);" });
      setTimeout(() => {
        wrap.innerHTML = renderLucideIcon(Copy, { width: 13, height: 13 });
      }, 1500);
    }
  });

  // Host Start Room event
  document.getElementById("btn-host-start-room")?.addEventListener("click", () => {
    startRoomMatch(user);
  });

  // Chat message submit
  document.getElementById("chat-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const chatInput = document.getElementById("input-chat") as HTMLInputElement;
    const text = chatInput?.value?.trim();
    if (text && activeRoom) {
      activeRoom.send("chat", { text });
      chatInput.value = "";
    }
  });

  // Floating chat toggle & close events
  document.getElementById("btn-floating-chat")?.addEventListener("click", () => {
    openLobbyChat();
  });

  document.getElementById("btn-close-chat")?.addEventListener("click", () => {
    closeLobbyChat();
  });
}

// ==========================================
// TARAJU GAME ENGINE & STATE TYPES
// Replicating King of Diamonds / Beauty Contest from taraju-banner.png
// ==========================================

export interface TarajuPlayer {
  sessionId: string;
  userId: string;
  name: string;
  picture: string;
  isHost: boolean;
  points: number;              // Starts at 10
  currentGuess: number | null; // 0 - 100
  isSubmitted: boolean;        // Locked in
  isEliminated: boolean;       // points <= 0
  lastRoundWon: boolean;
  pointsLostLastRound: number; // 0 or 1
  diff?: number;
  isAi?: boolean;
}

export interface TarajuRoundResult {
  round: number;
  guesses: { sessionId: string; name: string; guess: number; diff: number }[];
  sum: number;
  average: number;
  target: number; // average * 0.7
  winnerSessionIds: string[];
}

export interface TarajuGameState {
  phase: "lobby" | "countdown" | "playing" | "results" | "victory";
  countdownSeconds: number;
  roundNumber: number;
  timerSeconds: number; // 180 seconds (3 min)
  players: TarajuPlayer[];
  lastResult: TarajuRoundResult | null;
  nextRoundCountdown: number;
}

function createInitialTarajuGameState(): TarajuGameState {
  return {
    phase: "lobby",
    countdownSeconds: 10,
    roundNumber: 1,
    timerSeconds: 180,
    players: [],
    lastResult: null,
    nextRoundCountdown: 8,
  };
}

let tarajuGameState: TarajuGameState = createInitialTarajuGameState();
let tarajuRoundTimerInterval: any = null;
let tarajuCountdownInterval: any = null;
let tarajuNextRoundInterval: any = null;
let isCountdownActive = false;
let roundIntroTimeout: any = null;
let resultsStepTimeouts: any[] = [];
let currentResultsStep = 1; // 1: users & selections, 2: calculation, 3: winner decision, 4: next round text

function clearResultsTimeouts() {
  resultsStepTimeouts.forEach((t) => clearTimeout(t));
  resultsStepTimeouts = [];
}

// Cross-tab synchronization channel
const tarajuSyncChannel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("alice_taraju_sync")
    : null;

if (tarajuSyncChannel) {
  tarajuSyncChannel.onmessage = (event) => {
    if (event.data && typeof event.data === "object") {
      const stored = getStoredUser();
      if (stored) {
        handleTarajuSyncAction(event.data, stored);
      }
    }
  };
}

function broadcastTarajuAction(action: any) {
  try {
    tarajuSyncChannel?.postMessage(action);
  } catch (e) {}

  if (activeRoom) {
    try {
      activeRoom.send("chat", { text: "__TAR_SYNC__:" + JSON.stringify(action) });
    } catch (e) {}
  }
}

// Web Audio API Synthesizer for dramatic Alice in Borderland sound effects
let tarajuAudioCtx: AudioContext | null = null;
function getTarajuAudioContext(): AudioContext | null {
  try {
    if (!tarajuAudioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        tarajuAudioCtx = new AudioCtxClass();
      }
    }
    if (tarajuAudioCtx && tarajuAudioCtx.state === "suspended") {
      tarajuAudioCtx.resume();
    }
    return tarajuAudioCtx;
  } catch (e) {
    return null;
  }
}

function playTarajuSound(
  type: "tick" | "final_tick" | "start" | "win" | "lose" | "fanfare" | "card_reveal" | "calculate"
) {
  const ctx = getTarajuAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (type === "tick") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === "final_tick") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1320, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === "card_reveal") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.16); // D6
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === "calculate") {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);
        gain.gain.setValueAtTime(0.14, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.12);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.12);
      });
    } else if (type === "start") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(960, now + 0.35);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === "win") {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = "sine";
        o.frequency.setValueAtTime(freq, now + idx * 0.1);
        g.gain.setValueAtTime(0.15, now + idx * 0.1);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
        o.start(now + idx * 0.1);
        o.stop(now + idx * 0.1 + 0.35);
      });
    } else if (type === "lose") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.45);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === "fanfare") {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = "sine";
        o.frequency.setValueAtTime(freq, now + i * 0.12);
        g.gain.setValueAtTime(0.18, now + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.45);
        o.start(now + i * 0.12);
        o.stop(now + i * 0.12 + 0.45);
      });
    }
  } catch (e) {}
}

function stopTarajuGameTimers() {
  if (tarajuRoundTimerInterval) {
    clearInterval(tarajuRoundTimerInterval);
    tarajuRoundTimerInterval = null;
  }
  if (tarajuCountdownInterval) {
    clearInterval(tarajuCountdownInterval);
    tarajuCountdownInterval = null;
  }
  if (tarajuNextRoundInterval) {
    clearInterval(tarajuNextRoundInterval);
    tarajuNextRoundInterval = null;
  }
  if (roundIntroTimeout) {
    clearTimeout(roundIntroTimeout);
    roundIntroTimeout = null;
  }
  clearResultsTimeouts();
  isCountdownActive = false;
  removeRoundIntroOverlay();
}

function removeRoundIntroOverlay() {
  const overlay = document.getElementById("taraju-round-intro-overlay");
  if (overlay) {
    overlay.remove();
  }
}

function showRoundIntro(roundNumber: number, _user: UserProfile, onComplete: () => void) {
  removeRoundIntroOverlay();
  if (roundIntroTimeout) {
    clearTimeout(roundIntroTimeout);
    roundIntroTimeout = null;
  }

  const overlay = document.createElement("div");
  overlay.id = "taraju-round-intro-overlay";
  overlay.className = "taraju-round-intro-overlay";
  overlay.innerHTML = `
    <div class="taraju-round-intro-box">
      <div class="taraju-round-intro-badge">
        <span class="intro-diamond">♦</span> KING OF DIAMONDS <span class="intro-diamond">♦</span>
      </div>
      <h1 class="taraju-round-intro-title">ROUND ${roundNumber}</h1>
      <div class="taraju-round-intro-jp">BEAUTY CONTEST • NUMBER SCALE 0 - 100</div>
      <p class="taraju-round-intro-desc">
        Select a number from 0 to 100. Target is group average × 0.7. Closest guess survives.
      </p>
      <div class="taraju-round-intro-timer-bar">
        <div class="taraju-round-intro-progress"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  playTarajuSound("start");

  roundIntroTimeout = setTimeout(() => {
    overlay.classList.add("fade-out");
    setTimeout(() => {
      removeRoundIntroOverlay();
      roundIntroTimeout = null;
      onComplete();
    }, 280);
  }, 3000);
}

// ------------------------------------------
// 1. MATCHMAKING COUNTDOWN OVERLAY (10 -> 0)
// ------------------------------------------
function renderCountdownOverlay(count: number, user: UserProfile) {
  let overlay = document.getElementById("taraju-countdown-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "taraju-countdown-overlay";
    overlay.className = "taraju-countdown-overlay";
    document.body.appendChild(overlay);
  }

  const contenders = (roomPlayers.length > 0 ? roomPlayers : [
    {
      sessionId: activeRoom?.sessionId || "local-host",
      userId: user.id,
      name: user.name,
      picture: user.picture,
      isHost: true,
      isReady: true,
      joinedAt: Date.now(),
    },
  ]);

  overlay.innerHTML = `
    <div class="taraju-countdown-modal">
      <div class="taraju-countdown-badge">
        <span>👑 ARENA INITIALIZING</span>
      </div>

      <h2 class="taraju-countdown-title">King of Diamonds • Taraju</h2>

      <div class="taraju-countdown-number-ring">
        <div class="taraju-countdown-digit" id="taraju-countdown-digit">${count}</div>
      </div>

      <p class="taraju-countdown-subtitle">
        Matchmaking complete. Entering arena in <strong>${count}s</strong>. Every player begins with <strong>10 Points</strong>. Target 0.7× group average.
      </p>

      <div class="taraju-countdown-players-list">
        ${contenders
          .map(
            (p) => `
          <div class="taraju-countdown-player-pill">
            <span>${p.isHost ? "👑" : "👤"} ${escapeHtml(p.name)}</span>
            <span class="taraju-countdown-player-points">10 PTS</span>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function updateCountdownOverlay(count: number) {
  const digitEl = document.getElementById("taraju-countdown-digit");
  if (digitEl) {
    digitEl.innerText = String(count);
    digitEl.style.animation = "none";
    void digitEl.offsetWidth;
    digitEl.style.animation = "tarajuDigitTick 1s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  }
}

function removeCountdownOverlay() {
  const overlay = document.getElementById("taraju-countdown-overlay");
  if (overlay) {
    overlay.remove();
  }
}

function startMatchmakingCountdown(user: UserProfile) {
  if (isCountdownActive) return;
  isCountdownActive = true;
  isGameStarted = true;
  tarajuGameState.phase = "countdown";
  tarajuGameState.countdownSeconds = 10;

  renderCountdownOverlay(tarajuGameState.countdownSeconds, user);
  playTarajuSound("tick");

  if (tarajuCountdownInterval) clearInterval(tarajuCountdownInterval);

  tarajuCountdownInterval = setInterval(() => {
    tarajuGameState.countdownSeconds -= 1;
    if (tarajuGameState.countdownSeconds > 0) {
      updateCountdownOverlay(tarajuGameState.countdownSeconds);
      playTarajuSound("tick");
    } else {
      clearInterval(tarajuCountdownInterval);
      tarajuCountdownInterval = null;
      isCountdownActive = false;
      playTarajuSound("final_tick");
      removeCountdownOverlay();
      initializeTarajuGame(user);
    }
  }, 1000);
}

// ------------------------------------------
// 2. INITIALIZE GAME WITH 10 POINTS PER PLAYER
// ------------------------------------------
function initializeTarajuGame(user: UserProfile) {
  stopTarajuGameTimers();

  // Create initial players roster, each starting with 10 points
  let initialPlayers: TarajuPlayer[] = [];

  if (roomPlayers.length > 0) {
    initialPlayers = roomPlayers.map((p) => ({
      sessionId: p.sessionId,
      userId: p.userId,
      name: p.name,
      picture: p.picture,
      isHost: p.isHost,
      points: 10, // EVERY PLAYER STARTS WITH 10 POINTS!
      currentGuess: null,
      isSubmitted: false,
      isEliminated: false,
      lastRoundWon: false,
      pointsLostLastRound: 0,
      isAi: false,
    }));
  } else {
    initialPlayers = [
      {
        sessionId: activeRoom?.sessionId || "local-player",
        userId: user.id,
        name: user.name,
        picture: user.picture,
        isHost: true,
        points: 10,
        currentGuess: null,
        isSubmitted: false,
        isEliminated: false,
        lastRoundWon: false,
        pointsLostLastRound: 0,
        isAi: false,
      },
    ];
  }

  // If testing solo with 1 player, add AI contenders for authentic Taraju duel
  if (initialPlayers.length === 1) {
    initialPlayers.push(
      {
        sessionId: "bot-chishiya",
        userId: "bot-1",
        name: "Chishiya",
        picture: "",
        isHost: false,
        points: 10,
        currentGuess: null,
        isSubmitted: false,
        isEliminated: false,
        lastRoundWon: false,
        pointsLostLastRound: 0,
        isAi: true,
      },
      {
        sessionId: "bot-kuina",
        userId: "bot-2",
        name: "Kuina",
        picture: "",
        isHost: false,
        points: 10,
        currentGuess: null,
        isSubmitted: false,
        isEliminated: false,
        lastRoundWon: false,
        pointsLostLastRound: 0,
        isAi: true,
      }
    );
  }

  tarajuGameState = {
    phase: "playing",
    countdownSeconds: 0,
    roundNumber: 1,
    timerSeconds: 180, // 3 minutes = 180 seconds
    players: initialPlayers,
    lastResult: null,
    nextRoundCountdown: 5,
  };

  isGameStarted = true;
  currentChosenBalance = null;

  if (activeRoom) {
    saveNavigationState("room", activeRoom.roomId);
  }

  // Pre-render base view so layout is ready underneath
  renderGameActiveView(user);

  // Show "ROUND 1" announcement in center for 3 seconds, then reveal game UI and start timer
  showRoundIntro(1, user, () => {
    tarajuGameState.phase = "playing";
    renderGameActiveView(user);
    startRoundTimer(user);
    scheduleAiGuesses(user);
  });
}

// Schedule AI guesses if playing solo with AI
function scheduleAiGuesses(user: UserProfile) {
  const activeBots = tarajuGameState.players.filter((p) => p.isAi && !p.isEliminated);
  if (activeBots.length === 0) return;

  activeBots.forEach((bot, idx) => {
    const delay = 2500 + idx * 1500;
    setTimeout(() => {
      if (tarajuGameState.phase !== "playing" || bot.isEliminated) return;
      // Smart guess strategy targeting 0.7x avg (typically 12 - 42)
      const baseGuess = Math.floor(Math.random() * 32) + 12;
      bot.currentGuess = baseGuess;
      bot.isSubmitted = true;
      renderGameActiveView(user);
      checkIfAllSubmittedAndEvaluate(user);
    }, delay);
  });
}

// ------------------------------------------
// 3. ROUND TIMER (3 Minutes = 180 Seconds)
// ------------------------------------------
function formatTimerDisplay(seconds: number): string {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.max(0, seconds) % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startRoundTimer(user: UserProfile) {
  if (tarajuRoundTimerInterval) clearInterval(tarajuRoundTimerInterval);

  tarajuRoundTimerInterval = setInterval(() => {
    if (tarajuGameState.phase !== "playing") return;

    tarajuGameState.timerSeconds -= 1;
    const timerBox = document.getElementById("taraju-top-timer-box");
    const timerDigits = document.getElementById("taraju-top-timer-digits");

    if (timerDigits) {
      timerDigits.innerText = formatTimerDisplay(tarajuGameState.timerSeconds);
    }

    if (timerBox) {
      if (tarajuGameState.timerSeconds <= 30) {
        timerBox.classList.add("timer-warning");
        if (tarajuGameState.timerSeconds % 2 === 0 && tarajuGameState.timerSeconds > 0) {
          playTarajuSound("tick");
        }
      } else {
        timerBox.classList.remove("timer-warning");
      }
    }

    // Time expired: Evaluate immediately!
    if (tarajuGameState.timerSeconds <= 0) {
      clearInterval(tarajuRoundTimerInterval);
      tarajuRoundTimerInterval = null;
      evaluateRound(user);
    }
  }, 1000);
}

// ------------------------------------------
// 4. PLAYER SUBMISSION & ROUND EVALUATION
// ------------------------------------------
function handlePlayerSubmitChoice(user: UserProfile) {
  const localPlayer = tarajuGameState.players.find(
    (p) =>
      p.sessionId === (activeRoom?.sessionId || "") ||
      p.userId === user.id ||
      (!p.isAi && !activeRoom)
  );

  if (!localPlayer || localPlayer.isEliminated || localPlayer.isSubmitted) return;
  if (currentChosenBalance === null || currentChosenBalance === undefined) return;

  localPlayer.currentGuess = currentChosenBalance;
  localPlayer.isSubmitted = true;

  if (activeRoom) {
    try {
      activeRoom.send("submit_guess", { guess: currentChosenBalance });
    } catch (e) {}
  }

  broadcastTarajuAction({
    type: "PLAYER_GUESS",
    sessionId: localPlayer.sessionId,
    guess: currentChosenBalance,
  });

  renderGameActiveView(user);
  checkIfAllSubmittedAndEvaluate(user);
}

function checkIfAllSubmittedAndEvaluate(user: UserProfile) {
  const activePlayers = tarajuGameState.players.filter((p) => !p.isEliminated);
  if (activePlayers.length === 0) return;

  const allSubmitted = activePlayers.every((p) => p.isSubmitted);
  if (allSubmitted && tarajuGameState.phase === "playing") {
    // Only room host (or solo coordinator) evaluates
    const currentHost = tarajuGameState.players.find((p) => p.isHost) || tarajuGameState.players[0];
    const isHost =
      !activeRoom ||
      currentHost?.sessionId === activeRoom.sessionId ||
      currentHost?.userId === user.id;

    if (isHost) {
      evaluateRound(user);
    }
  }
}

function evaluateRound(user: UserProfile) {
  if (tarajuGameState.phase !== "playing") return;
  stopTarajuGameTimers();

  const activePlayers = tarajuGameState.players.filter((p) => !p.isEliminated);
  if (activePlayers.length === 0) return;

  // Ensure every active player has a guess (fallback to 50 if timeout)
  activePlayers.forEach((p) => {
    if (p.currentGuess === null || p.currentGuess === undefined) {
      p.currentGuess = typeof currentChosenBalance === "number" ? currentChosenBalance : 50;
      p.isSubmitted = true;
    }
  });

  // 1. Calculate Average
  const sum = activePlayers.reduce((acc, p) => acc + (p.currentGuess ?? 50), 0);
  const average = sum / activePlayers.length;

  // 2. Multiply Average by 0.7
  const target = average * 0.7;

  // 3. Find player whose guess is closest to target
  let minDiff = Infinity;
  const guessesWithDiff = activePlayers.map((p) => {
    const diff = Math.abs((p.currentGuess ?? 50) - target);
    if (diff < minDiff) minDiff = diff;
    return {
      sessionId: p.sessionId,
      name: p.name,
      guess: p.currentGuess ?? 50,
      diff,
    };
  });

  // Identify winners (closest to target)
  const winnerSessionIds: string[] = [];
  guessesWithDiff.forEach((g) => {
    if (Math.abs(g.diff - minDiff) < 0.0001) {
      winnerSessionIds.push(g.sessionId);
    }
  });

  // 4. Update points:
  // Winners survive and don't lose points.
  // All losers lose 1 point! When any player reaches 0 points, they are eliminated.
  activePlayers.forEach((p) => {
    if (winnerSessionIds.includes(p.sessionId)) {
      p.lastRoundWon = true;
      p.pointsLostLastRound = 0;
    } else {
      p.lastRoundWon = false;
      p.pointsLostLastRound = 1;
      p.points -= 1;
      if (p.points <= 0) {
        p.points = 0;
        p.isEliminated = true;
      }
    }
  });

  const roundResult: TarajuRoundResult = {
    round: tarajuGameState.roundNumber,
    guesses: guessesWithDiff,
    sum,
    average,
    target,
    winnerSessionIds,
  };

  tarajuGameState.lastResult = roundResult;
  tarajuGameState.phase = "results";

  // Broadcast authoritative result to all clients
  broadcastTarajuAction({
    type: "ROUND_EVALUATED",
    result: roundResult,
    players: tarajuGameState.players,
  });

  // Start step-by-step results reveal: 1) users & values -> 2) calc -> 3) winner decision -> 4) next round text
  startStepByStepResults(roundResult, user);
}

function startStepByStepResults(roundResult: TarajuRoundResult, user: UserProfile) {
  stopTarajuGameTimers();
  tarajuGameState.lastResult = roundResult;
  tarajuGameState.phase = "results";
  tarajuGameState.nextRoundCountdown = 5;
  currentChosenBalance = null;

  // Step 1: Immediately reveal all players and their chosen numbers in boxes (Image 2 & 3)
  currentResultsStep = 1;
  playTarajuSound("card_reveal");
  renderGameActiveView(user);

  // Step 2: After 3 seconds, show Calculation Section (Average formula + Multiplication by 0.7)
  resultsStepTimeouts.push(
    setTimeout(() => {
      if (tarajuGameState.phase !== "results") return;
      currentResultsStep = 2;
      playTarajuSound("calculate");
      renderGameActiveView(user);
    }, 3000)
  );

  // Step 3: After 6 seconds, show Winner Decision banner and point outcomes (-1P, safe, eliminated)
  resultsStepTimeouts.push(
    setTimeout(() => {
      if (tarajuGameState.phase !== "results") return;
      currentResultsStep = 3;

      const localPlayer = tarajuGameState.players.find(
        (p) =>
          p.sessionId === (activeRoom?.sessionId || "") ||
          p.userId === user.id ||
          (!p.isAi && !activeRoom)
      );
      if (localPlayer && roundResult.winnerSessionIds.includes(localPlayer.sessionId)) {
        playTarajuSound("win");
      } else {
        playTarajuSound("lose");
      }
      renderGameActiveView(user);
    }, 6000)
  );

  // Step 4: After 9.5 seconds, show Next Round countdown or Victory
  resultsStepTimeouts.push(
    setTimeout(() => {
      if (tarajuGameState.phase !== "results") return;
      currentResultsStep = 4;
      renderGameActiveView(user);

      const survivors = tarajuGameState.players.filter((p) => p.points > 0);
      if (survivors.length <= 1) {
        resultsStepTimeouts.push(
          setTimeout(() => {
            tarajuGameState.phase = "victory";
            playTarajuSound("fanfare");
            renderGameActiveView(user);
          }, 3500)
        );
      } else {
        startNextRoundCountdown(user);
      }
    }, 9500)
  );
}

function startNextRoundCountdown(user: UserProfile) {
  if (tarajuNextRoundInterval) clearInterval(tarajuNextRoundInterval);
  tarajuGameState.nextRoundCountdown = 5;

  tarajuNextRoundInterval = setInterval(() => {
    tarajuGameState.nextRoundCountdown -= 1;
    const badge = document.getElementById("taraju-next-countdown-badge");
    if (badge) {
      badge.innerText = `Next round starts in ${tarajuGameState.nextRoundCountdown}s...`;
    }

    if (tarajuGameState.nextRoundCountdown <= 0) {
      clearInterval(tarajuNextRoundInterval);
      tarajuNextRoundInterval = null;
      advanceToNextRound(user);
    }
  }, 1000);
}

function advanceToNextRound(user: UserProfile) {
  stopTarajuGameTimers();

  if (activeRoom) {
    try {
      activeRoom.send("start_next_round");
    } catch (e) {}
  }

  tarajuGameState.roundNumber += 1;
  tarajuGameState.phase = "playing";
  tarajuGameState.timerSeconds = 180; // Reset to 3 minutes
  tarajuGameState.lastResult = null;
  currentChosenBalance = null;

  // Reset active players' guess state
  tarajuGameState.players.forEach((p) => {
    p.currentGuess = null;
    p.isSubmitted = false;
    p.lastRoundWon = false;
    p.pointsLostLastRound = 0;
  });

  broadcastTarajuAction({
    type: "NEXT_ROUND",
    roundNumber: tarajuGameState.roundNumber,
    players: tarajuGameState.players,
  });

  renderGameActiveView(user);

  // Show "ROUND X" text in center for 3 sec, then reveal game UI and start timer
  showRoundIntro(tarajuGameState.roundNumber, user, () => {
    tarajuGameState.phase = "playing";
    renderGameActiveView(user);
    startRoundTimer(user);
    scheduleAiGuesses(user);
  });
}

function restartTarajuMatch(user: UserProfile) {
  stopTarajuGameTimers();
  if (activeRoom) {
    try {
      activeRoom.send("restart_game");
    } catch (e) {}
  }
  initializeTarajuGame(user);
}

function handleTarajuSyncAction(action: any, user: UserProfile) {
  if (!action || !action.type) return;

  if (action.type === "START_COUNTDOWN") {
    startMatchmakingCountdown(user);
  } else if (action.type === "PLAYER_GUESS") {
    const target = tarajuGameState.players.find((p) => p.sessionId === action.sessionId);
    if (target && !target.isEliminated) {
      target.isSubmitted = true;
      target.currentGuess = action.guess;
      renderGameActiveView(user);
      checkIfAllSubmittedAndEvaluate(user);
    }
  } else if (action.type === "ROUND_EVALUATED") {
    if (action.result && action.players) {
      tarajuGameState.players = action.players;
      startStepByStepResults(action.result, user);
    }
  } else if (action.type === "NEXT_ROUND") {
    tarajuGameState.roundNumber = action.roundNumber || tarajuGameState.roundNumber + 1;
    tarajuGameState.phase = "playing";
    tarajuGameState.timerSeconds = 180;
    tarajuGameState.lastResult = null;
    currentChosenBalance = null;
    if (action.players) tarajuGameState.players = action.players;
    tarajuGameState.players.forEach((p) => {
      p.currentGuess = null;
      p.isSubmitted = false;
      p.lastRoundWon = false;
      p.pointsLostLastRound = 0;
    });
    stopTarajuGameTimers();
    renderGameActiveView(user);
    showRoundIntro(tarajuGameState.roundNumber, user, () => {
      tarajuGameState.phase = "playing";
      renderGameActiveView(user);
      startRoundTimer(user);
    });
  } else if (action.type === "RESTART_MATCH") {
    initializeTarajuGame(user);
  }
}

// ------------------------------------------
// 5. RENDER GAME ACTIVE VIEW (Exact Replica of taraju-banner.png)
// ------------------------------------------
function renderGameActiveView(user: UserProfile) {
  const app = document.getElementById("app");
  if (!app) return;

  const currentHost = tarajuGameState.players.find((p) => p.isHost) || tarajuGameState.players[0];
  const isHost =
    !activeRoom ||
    currentHost?.sessionId === activeRoom.sessionId ||
    currentHost?.userId === user.id;

  const localPlayer = tarajuGameState.players.find(
    (p) =>
      p.sessionId === (activeRoom?.sessionId || "") ||
      p.userId === user.id ||
      (!p.isAi && !activeRoom)
  ) || tarajuGameState.players[0];

  const activeCount = tarajuGameState.players.filter((p) => !p.isEliminated).length;
  const isResultsPhase = tarajuGameState.phase === "results" || tarajuGameState.phase === "victory";
  const lastRes = tarajuGameState.lastResult;

  // Survivor calculation for game over
  const survivors = tarajuGameState.players.filter((p) => p.points > 0);
  const ultimateWinner = survivors.length === 1 ? survivors[0] : null;

  // Partition players into left and right wings
  const players = tarajuGameState.players;
  let leftPlayers: TarajuPlayer[] = [];
  let rightPlayers: TarajuPlayer[] = [];

  if (players.length <= 1) {
    leftPlayers = players;
  } else if (players.length === 2) {
    leftPlayers = [players[0]];
    rightPlayers = [players[1]];
  } else {
    const half = Math.ceil(players.length / 2);
    leftPlayers = players.slice(0, half);
    rightPlayers = players.slice(half);
  }

  const renderPlayerCol = (p: TarajuPlayer) => {
    const isWinner = isResultsPhase && lastRes?.winnerSessionIds.includes(p.sessionId);
    const isLocal = p.sessionId === localPlayer?.sessionId;
    
    // Guess display under avatar
    let displayedNumber = "??";
    if (isResultsPhase) {
      displayedNumber = String(p.currentGuess ?? 50);
    } else if (isLocal && p.currentGuess !== null) {
      displayedNumber = String(p.currentGuess);
    } else if (p.isSubmitted) {
      displayedNumber = "✓";
    }

    return `
      <div class="taraju-player-col ${isWinner ? "is-winner" : ""} ${p.isEliminated ? "is-eliminated" : ""}" id="player-col-${p.sessionId}">
        <!-- Winner Crown & Golden Label -->
        <div class="taraju-col-winner-label">
          <span class="taraju-crown-icon">👑</span>
          <span class="taraju-winner-text">WINNER</span>
        </div>

        <!-- Unified Card Frame -->
        <div class="taraju-card-frame">
          <!-- Avatar Box -->
          <div class="taraju-avatar-box">
            <!-- Submission indicator pill -->
            ${
              p.isSubmitted && !isResultsPhase
                ? `<div class="taraju-status-pill ready">LOCKED ✓</div>`
                : !p.isSubmitted && !isResultsPhase && !p.isEliminated
                ? `<div class="taraju-status-pill">THINKING...</div>`
                : ""
            }

            <!-- Eliminated badge -->
            ${p.isEliminated ? `<div class="taraju-eliminated-badge">ELIMINATED</div>` : ""}

            <!-- Avatar circle -->
            <div class="taraju-avatar-circle-wrap">
              ${
                p.picture
                  ? `<img src="${p.picture}" alt="${p.name}" class="taraju-avatar-img" referrerpolicy="no-referrer" />`
                  : `<div class="taraju-avatar-initials">${(p.name || "U").charAt(0).toUpperCase()}</div>`
              }
            </div>

            <div class="taraju-player-name" title="${escapeHtml(p.name)}">
              ${p.isHost ? "👑 " : ""}${escapeHtml(p.name)}${isLocal ? " (YOU)" : ""}
            </div>

            <!-- Points Tag (10 PTS initially, shows -1 on loss) -->
            <div class="taraju-player-points-tag ${
              isResultsPhase && isWinner
                ? "points-safe"
                : isResultsPhase && p.pointsLostLastRound > 0
                ? "points-lost"
                : ""
            }">
              ${p.points} PTS ${
                isResultsPhase && p.pointsLostLastRound > 0
                  ? "(-1)"
                  : isResultsPhase && isWinner
                  ? "(SAFE)"
                  : ""
              }
            </div>
          </div>

          <!-- Glowing Number Box -->
          <div class="taraju-number-box ${!isResultsPhase && !isLocal ? "is-secret" : ""}" id="num-box-${p.sessionId}">
            ${displayedNumber}
          </div>
        </div>
      </div>
    `;
  };

  app.innerHTML = `
    <div class="taraju-arena-screen">
      <!-- High-Tech Arena Header Bar -->
      <header class="taraju-arena-header">
        <div class="taraju-header-left">
          <button class="btn-taraju-back" id="btn-taraju-leave">
            ${renderLucideIcon(ChevronLeft, { width: 16, height: 16 })}
            <span>Lobby</span>
          </button>
          <div class="taraju-room-badge">
            ${escapeHtml(currentRoomSummary?.roomCode || activeRoom?.roomId ? `#${currentRoomSummary?.roomCode || "TRJ-ARENA"}` : "SOLO ARENA")}
          </div>
        </div>

        <!-- Central High-Tech Countdown Timer (03:00) -->
        <div class="taraju-header-center">
          <div class="taraju-round-badge">
            ROUND ${tarajuGameState.roundNumber}
          </div>

          <div class="taraju-top-timer-box ${tarajuGameState.timerSeconds <= 30 && tarajuGameState.phase === "playing" ? "timer-warning" : ""}" id="taraju-top-timer-box" title="3-Minute Round Timer">
            <div class="taraju-top-timer-icon">
              ⏱️
            </div>
            <div class="taraju-top-timer-digits" id="taraju-top-timer-digits">
              ${formatTimerDisplay(tarajuGameState.timerSeconds)}
            </div>
          </div>
        </div>

        <div class="taraju-header-right">
          <div class="taraju-active-counter">
            Active: <strong>${activeCount} / ${tarajuGameState.players.length}</strong>
          </div>
        </div>
      </header>

      <!-- Stage: Step-by-Step Results Page (Images 2 & 3) OR Playing Calculator (Image 1) -->
      ${
        isResultsPhase && lastRes
          ? `
        <main class="taraju-results-stage">
          <!-- Background Blueprint Scales of Justice Watermark -->
          <div class="taraju-scales-bg-watermark" aria-hidden="true">
            <svg viewBox="0 0 900 480" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M450 40 L450 440 M360 440 L540 440 M400 410 L500 410" stroke="rgba(56, 189, 248, 0.18)" stroke-width="3" stroke-linecap="round"/>
              <path d="M180 120 L720 120" stroke="rgba(56, 189, 248, 0.25)" stroke-width="4" stroke-linecap="round"/>
              <circle cx="450" cy="120" r="18" stroke="rgba(56, 189, 248, 0.35)" stroke-width="3" fill="none"/>
              <circle cx="450" cy="70" r="10" stroke="rgba(56, 189, 248, 0.28)" stroke-width="2" fill="none"/>
              <!-- Left Pan Chains & Plate -->
              <path d="M210 120 L130 280 M210 120 L290 280" stroke="rgba(56, 189, 248, 0.2)" stroke-width="2"/>
              <path d="M110 280 Q210 350 310 280 Z" stroke="rgba(56, 189, 248, 0.25)" stroke-width="3" fill="rgba(56, 189, 248, 0.04)"/>
              <!-- Right Pan Chains & Plate -->
              <path d="M690 120 L610 280 M690 120 L770 280" stroke="rgba(56, 189, 248, 0.2)" stroke-width="2"/>
              <path d="M590 280 Q690 350 790 280 Z" stroke="rgba(56, 189, 248, 0.25)" stroke-width="3" fill="rgba(56, 189, 248, 0.04)"/>
              <!-- Blueprint Grid Axis Line -->
              <line x1="30" y1="230" x2="870" y2="230" stroke="rgba(56, 189, 248, 0.12)" stroke-width="1.5" stroke-dasharray="6 6"/>
            </svg>
          </div>

          <div class="taraju-results-container">
            <!-- Header Banner (English Only) -->
            <div class="taraju-results-rule-header">
              <span class="taraju-rule-japanese-tag">RULE</span>
              <div class="taraju-rule-japanese-title">
                Multiply the <span class="highlight-cyan">Average</span> of all chosen numbers by <span class="highlight-red">0.7</span>
              </div>
            </div>

            <!-- STEP 1: Row of User Selected Numbers in Cream/White Boxes (Image 2 & 3) -->
            <div class="taraju-results-users-row">
              ${tarajuGameState.players.map((p) => {
                const guessItem = lastRes.guesses.find((g) => g.sessionId === p.sessionId);
                const guessVal = guessItem ? guessItem.guess : (p.currentGuess ?? 50);
                const isWinner = lastRes.winnerSessionIds.includes(p.sessionId);
                const diffVal = guessItem ? guessItem.diff : 0;
                const isLocal = p.sessionId === localPlayer?.sessionId;

                return `
                  <div class="taraju-results-player-card ${currentResultsStep >= 3 && isWinner ? "is-winner-card" : ""} ${p.isEliminated ? "is-eliminated" : ""}">
                    <!-- Avatar & User Info -->
                    <div class="taraju-results-user-head">
                      <div class="taraju-results-avatar-wrap">
                        ${
                          p.picture
                            ? `<img src="${p.picture}" alt="${p.name}" class="taraju-results-avatar-img" referrerpolicy="no-referrer" />`
                            : `<div class="taraju-results-avatar-initials">${(p.name || "U").charAt(0).toUpperCase()}</div>`
                        }
                      </div>
                      <div class="taraju-results-player-name" title="${escapeHtml(p.name)}">
                        ${p.isHost ? "👑 " : ""}${escapeHtml(p.name)}${isLocal ? " (YOU)" : ""}
                      </div>
                    </div>

                    <!-- Distinct Number Box (Exact replica of Image 2 & 3: [ 46 ] [ 83 ] [ 37 ]) -->
                    <div class="taraju-results-number-box">
                      <span class="taraju-results-digit">${guessVal}</span>
                    </div>

                    <!-- STEP 3 Outcomes: Winner Burst or -1P Penalty (Manga Image 3) -->
                    ${
                      currentResultsStep >= 3
                        ? `
                      <div class="taraju-results-outcome-box">
                        ${
                          isWinner
                            ? `
                          <div class="taraju-manga-burst-winner" title="Closest Guess Winner">
                            <span class="manga-burst-text">WINNER</span>
                          </div>
                          <div class="taraju-outcome-pill safe">±0P (SAFE)</div>
                          <div class="taraju-outcome-pts">${p.points} PTS</div>
                        `
                            : `
                          <div class="taraju-outcome-pill lost">-1P</div>
                          <div class="taraju-outcome-diff">diff: ${diffVal.toFixed(2)}</div>
                          <div class="taraju-outcome-pts">${p.points} PTS</div>
                          ${p.isEliminated ? `<div class="taraju-outcome-elim">💀 ELIMINATED</div>` : ""}
                        `
                        }
                      </div>
                    `
                        : `
                      <div class="taraju-results-outcome-placeholder">
                        <span class="taraju-placeholder-pts">${p.points} PTS</span>
                      </div>
                    `
                    }
                  </div>
                `;
              }).join("")}
            </div>

            <!-- STEP 2: Calculation Part (Fraction Average + Multiplication by 0.7, Image 2 & 3) -->
            ${
              currentResultsStep >= 2
                ? `
              <div class="taraju-calculation-stage">
                <!-- Average Fraction Calculation -->
                <div class="taraju-calc-avg-block">
                  <div class="taraju-fraction-wrap">
                    <div class="taraju-fraction-numerator">
                      ${lastRes.guesses.map((g) => g.guess).join(" + ")}
                    </div>
                    <div class="taraju-fraction-denominator">
                      ${lastRes.guesses.length}
                    </div>
                  </div>
                  <div class="taraju-calc-equal-sign">=</div>
                  <div class="taraju-calc-avg-result-box">
                    <span class="calc-avg-number">${lastRes.average.toFixed(2)}</span>
                    <span class="calc-avg-label">AVERAGE</span>
                  </div>
                </div>

                <!-- Multiplication by 0.7 Formula (Exact replica of Image 2) -->
                <div class="taraju-calc-multiplication-block">
                  <div class="taraju-calc-formula-col">
                    <div class="taraju-calc-big-box avg-val-box">${lastRes.average.toFixed(2)}</div>
                    <div class="taraju-calc-column-sublabel">Average</div>
                  </div>

                  <div class="taraju-calc-operator">×</div>

                  <div class="taraju-calc-formula-col">
                    <div class="taraju-calc-big-box constant-val-box">0.7</div>
                    <div class="taraju-calc-column-sublabel">Multiplier</div>
                  </div>

                  <div class="taraju-calc-operator">=</div>

                  <div class="taraju-calc-formula-col">
                    <div class="taraju-calc-big-box target-val-box">${lastRes.target.toFixed(2)}</div>
                    <div class="taraju-calc-column-sublabel">Target</div>
                  </div>
                </div>
              </div>
            `
                : `
              <div class="taraju-calculation-stage is-waiting">
                <div class="taraju-waiting-pill">
                  <span class="waiting-spin"></span> All user numbers locked in. Computing average × 0.7...
                </div>
              </div>
            `
            }

            <!-- STEP 3: Winner Decision Announcement Banner -->
            ${
              currentResultsStep >= 3
                ? `
              <div class="taraju-decision-banner">
                <div class="taraju-closest-oval-bubble">
                  CLOSEST TO ${lastRes.target.toFixed(2)}
                </div>
                <div class="taraju-winner-lead-headline">
                  👑 ${lastRes.guesses
                    .filter((g) => lastRes.winnerSessionIds.includes(g.sessionId))
                    .map((g) => `${escapeHtml(g.name)} (${g.guess})`)
                    .join(" & ")} ${lastRes.winnerSessionIds.length > 1 ? "SURVIVE UNTOUCHED" : "SURVIVES UNTOUCHED"}!
                </div>
              </div>
            `
                : ""
            }

            <!-- STEP 4: Next Round Strip & Action Button -->
            ${
              currentResultsStep >= 4
                ? `
              <div class="taraju-next-round-strip">
                ${
                  tarajuGameState.phase !== "victory"
                    ? `
                  <span class="taraju-next-countdown-badge" id="taraju-next-countdown-badge">
                    Next round starts in ${tarajuGameState.nextRoundCountdown}s...
                  </span>
                  ${
                    isHost
                      ? `
                    <button class="btn-taraju-skip-next" id="btn-taraju-skip-next">
                      Start Next Round Now
                    </button>
                  `
                      : ""
                  }
                `
                    : `<span class="taraju-next-countdown-badge">Arena battle concluded! Sole survivor stands.</span>`
                }
              </div>
            `
                : ""
            }
          </div>
        </main>
      `
          : `
        <!-- Main Stage: Left Players, Center Calculator, Right Players -->
        <main class="taraju-main-stage">
          <!-- Left Players Column -->
          <div class="taraju-players-col taraju-players-left">
            ${leftPlayers.map(renderPlayerCol).join("")}
          </div>

          <!-- Center Column: Calculator / Tablet & Results -->
          <div class="taraju-center-col">
            <!-- Wide Calculator-like Number Matrix -->
            <div class="taraju-calc-container">
              ${
                localPlayer?.isEliminated
                  ? `
                <div class="taraju-eliminated-notice">
                  <div class="taraju-eliminated-notice-title">💀 YOU HAVE BEEN ELIMINATED</div>
                  <p>You reached 0 points and can no longer submit guesses. You are spectating the remaining contenders until the victor emerges.</p>
                </div>
              `
                  : `
                <div class="taraju-calc-matrix">
                  <!-- Top Row: LCD display spanning 9 cols + '0' button at 10th col -->
                  <div class="taraju-calc-lcd" id="taraju-calc-lcd">
                    <div class="taraju-calc-lcd-screen">
                      <span class="taraju-calc-lcd-number" id="taraju-calc-lcd-val">${currentChosenBalance !== null ? currentChosenBalance : ""}</span>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    class="taraju-calc-key taraju-calc-key-zero ${currentChosenBalance === 0 ? "is-selected" : ""}" 
                    data-num="0" 
                    ${localPlayer?.isSubmitted || isResultsPhase ? "disabled" : ""}
                  >
                    0
                  </button>

                  <!-- Numbers 1 to 100 in a 10x10 matrix -->
                  ${Array.from({ length: 100 }, (_, i) => i + 1)
                    .map(
                      (n) => `
                    <button 
                      type="button" 
                      class="taraju-calc-key ${currentChosenBalance !== null && n === currentChosenBalance ? "is-selected" : ""}" 
                      data-num="${n}" 
                      ${localPlayer?.isSubmitted || isResultsPhase ? "disabled" : ""}
                    >
                      ${n}
                    </button>
                  `
                    )
                    .join("")}
                </div>

                <!-- Lock Choice Button -->
                <button 
                  class="btn-taraju-lock-choice ${localPlayer?.isSubmitted ? "is-locked" : ""}" 
                  id="btn-taraju-lock" 
                  ${localPlayer?.isSubmitted || isResultsPhase || currentChosenBalance === null ? "disabled" : ""}
                >
                  ${
                    localPlayer?.isSubmitted
                      ? `✅ Guess Locked: ${localPlayer.currentGuess} (Waiting for others...)`
                      : currentChosenBalance !== null
                      ? `Lock in Guess (${currentChosenBalance})`
                      : `Select a Number (0 - 100)`
                  }
                </button>
              `
              }
            </div>
          </div>

          <!-- Right Players Column -->
          <div class="taraju-players-col taraju-players-right">
            ${rightPlayers.map(renderPlayerCol).join("")}
          </div>
        </main>
      `
      }

      <!-- Ultimate Victory Modal (When only 1 survivor remains) -->
      ${
        tarajuGameState.phase === "victory" && ultimateWinner
          ? `
        <div class="taraju-victory-overlay">
          <div class="taraju-victory-card">
            <div class="taraju-victory-crown">👑</div>
            <h2 class="taraju-victory-title">KING OF DIAMONDS CHAMPION</h2>
            <div class="taraju-victory-survivor-name">
              ${escapeHtml(ultimateWinner.name)} WINS THE ARENA!
            </div>
            <div class="taraju-victory-stats">
              Sole survivor with <strong>${ultimateWinner.points} Points</strong> remaining across <strong>${tarajuGameState.roundNumber} Rounds</strong>.
            </div>
            <div class="taraju-victory-actions">
              <button class="btn-taraju-play-again" id="btn-taraju-play-again">
                Play Again (Reset to 10 Pts)
              </button>
              <button class="btn-taraju-exit-lobby" id="btn-taraju-victory-exit">
                Return to Lobby
              </button>
            </div>
          </div>
        </div>
      `
          : ""
      }
    </div>
  `;

  // Attach interactive events
  attachGameActiveEvents(user);
}

function attachGameActiveEvents(user: UserProfile) {
  const lockBtn = document.getElementById("btn-taraju-lock") as HTMLButtonElement | null;
  const lcdVal = document.getElementById("taraju-calc-lcd-val");

  const syncNumber = (val: number) => {
    currentChosenBalance = Math.max(0, Math.min(100, Math.round(val)));
    if (lcdVal) lcdVal.innerText = String(currentChosenBalance);

    // Highlight active key in grid
    document.querySelectorAll(".taraju-calc-key").forEach((keyEl) => {
      const n = Number(keyEl.getAttribute("data-num"));
      if (n === currentChosenBalance) {
        keyEl.classList.add("is-selected");
      } else {
        keyEl.classList.remove("is-selected");
      }
    });

    if (lockBtn && !lockBtn.classList.contains("is-locked")) {
      lockBtn.removeAttribute("disabled");
      lockBtn.disabled = false;
      lockBtn.innerText = `Lock in Guess (${currentChosenBalance})`;
    }
  };

  // Attach click listener to each calculator key
  document.querySelectorAll(".taraju-calc-key").forEach((keyEl) => {
    keyEl.addEventListener("click", () => {
      const n = Number(keyEl.getAttribute("data-num"));
      if (!isNaN(n)) {
        syncNumber(n);
        playTarajuSound("tick");
      }
    });
  });

  lockBtn?.addEventListener("click", () => {
    handlePlayerSubmitChoice(user);
  });

  document.getElementById("btn-taraju-skip-next")?.addEventListener("click", () => {
    advanceToNextRound(user);
  });

  document.getElementById("btn-taraju-play-again")?.addEventListener("click", () => {
    restartTarajuMatch(user);
  });

  document.getElementById("btn-taraju-victory-exit")?.addEventListener("click", () => {
    stopTarajuGameTimers();
    tarajuGameState = createInitialTarajuGameState();
    isGameStarted = false;
    renderRoomLobbyView(user);
  });

  document.getElementById("btn-taraju-leave")?.addEventListener("click", () => {
    stopTarajuGameTimers();
    tarajuGameState = createInitialTarajuGameState();
    isGameStarted = false;
    renderRoomLobbyView(user);
  });
}


// ==========================================
// ROOM CONNECTION & LIFECYCLE HANDLERS
// ==========================================
async function createRoomAndEnter(user: UserProfile, roomName: string, maxPlayers: number) {
  try {
    const client = getColyseusClient();

    if (activeRoom) {
      try {
        activeRoom.leave();
      } catch (e) {}
      activeRoom = null;
    }

    const room = await client.create("my_room", {
      roomName,
      maxPlayers,
      hostName: user.name,
      hostAvatar: user.picture,
      isHost: true,
      token: user.token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
      },
    });

    saveNavigationState("room", room.roomId);
    setupRoomListeners(room, user, true);
  } catch (err: any) {
    console.error("Failed to create room:", err);
    Swal.fire({
      icon: "error",
      title: "Creation Failed",
      text: `Could not create room: ${err.message || err}`,
      confirmButtonText: "OK",
      confirmButtonColor: "#dc2626",
      customClass: {
        popup: "alice-swal-popup",
        title: "alice-swal-title",
        confirmButton: "alice-swal-confirm",
      },
    });
  }
}

async function joinRoomById(user: UserProfile, roomId: string) {
  try {
    const client = getColyseusClient();

    if (activeRoom) {
      try {
        activeRoom.leave();
      } catch (e) {}
      activeRoom = null;
    }

    const room = await client.joinById(roomId, {
      isHost: false,
      token: user.token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
      },
    });

    saveNavigationState("room", room.roomId);
    setupRoomListeners(room, user, false);
    return room;
  } catch (err: any) {
    console.warn("Failed to join room:", err);
    saveNavigationState("arena");
    renderArenaView(user);
    showToastNotification("Room is no longer active or was closed.");
    return null;
  }
}

async function joinRoomByCode(user: UserProfile, code: string) {
  try {
    const formattedCode = code.trim().replace(/^#/, "").toUpperCase();
    const res = await fetch(`${serverUrl}/api/rooms/${formattedCode}`);
    if (!res.ok) {
      Swal.fire({
        icon: "error",
        title: "Room Not Found",
        text: `No active room found with code #${formattedCode}`,
        confirmButtonText: "OK",
        confirmButtonColor: "#38bdf8",
        customClass: {
          popup: "alice-swal-popup",
          title: "alice-swal-title",
          confirmButton: "alice-swal-primary",
        },
      });
      return;
    }
    const data = await res.json();
    if (data?.success && data?.room?.roomId) {
      await joinRoomById(user, data.room.roomId);
    } else {
      Swal.fire({
        icon: "error",
        title: "Room Not Found",
        text: `No active room found with code #${formattedCode}`,
        confirmButtonText: "OK",
        confirmButtonColor: "#38bdf8",
        customClass: {
          popup: "alice-swal-popup",
          title: "alice-swal-title",
          confirmButton: "alice-swal-primary",
        },
      });
    }
  } catch (err) {
    console.error("Error looking up room code:", err);
    Swal.fire({
      icon: "error",
      title: "Lookup Failed",
      text: "Error searching for room code. Please try again.",
      confirmButtonText: "OK",
      confirmButtonColor: "#38bdf8",
      customClass: {
        popup: "alice-swal-popup",
        title: "alice-swal-title",
        confirmButton: "alice-swal-primary",
      },
    });
  }
}

function setupRoomListeners(room: any, user: UserProfile, isHost: boolean) {
  activeRoom = room;
  stopRoomsAutoPolling();
  isGameStarted = false;
  roomChatHistory = [];
  isLobbyChatOpen = false;
  unreadChatCount = 0;

  // Local player entry
  if (roomPlayers.length === 0) {
    roomPlayers = [
      {
        sessionId: room.sessionId,
        userId: user.id,
        name: user.name,
        picture: user.picture,
        isHost: isHost,
        isReady: isHost,
        joinedAt: Date.now(),
      },
    ];
  }

  currentRoomSummary = {
    roomId: room.roomId,
    roomCode: "TRJ-LOBBY",
    roomName: `${user.name}'s Arena`,
    hostName: user.name,
    hostAvatar: user.picture,
    hostUserId: user.id,
    playerCount: roomPlayers.length,
    maxPlayers: selectedMaxPlayers,
    status: "waiting",
    createdAt: Date.now(),
  };

  room.onMessage("welcome", (data: any) => {
    if (data?.roomCode && currentRoomSummary) {
      currentRoomSummary.roomCode = data.roomCode;
      if (data.roomName) currentRoomSummary.roomName = data.roomName;
      if (data.maxPlayers) currentRoomSummary.maxPlayers = data.maxPlayers;
    }
    if (data?.players && Array.isArray(data.players) && data.players.length > 0) {
      roomPlayers = data.players;
    }
    if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
      updateOrRenderLobby(user);
    }
  });

  room.onMessage("room_roster", (data: any) => {
    if (data && Array.isArray(data.players)) {
      roomPlayers = data.players;
      if (data.roomCode && currentRoomSummary) {
        currentRoomSummary.roomCode = data.roomCode;
      }
      if (data.roomName && currentRoomSummary) {
        currentRoomSummary.roomName = data.roomName;
      }
      if (data.maxPlayers && currentRoomSummary) {
        currentRoomSummary.maxPlayers = data.maxPlayers;
      }
      if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
        updateOrRenderLobby(user);
      }
    }
  });

  room.onMessage("player_joined", () => {
    syncPlayersFromRoomState(room, user);
    if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
      updateOrRenderLobby(user);
    }
  });

  room.onMessage("player_left", () => {
    syncPlayersFromRoomState(room, user);
    if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
      updateOrRenderLobby(user);
    }
  });

  room.onMessage("host_changed", () => {
    syncPlayersFromRoomState(room, user);
    if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
      updateOrRenderLobby(user);
    }
  });

  room.onMessage("player_ready_changed", (data: any) => {
    const target = roomPlayers.find((p) => p.sessionId === data?.sessionId);
    if (target) {
      target.isReady = Boolean(data?.isReady);
      if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
        updateOrRenderLobby(user);
      }
    }
  });

  room.onMessage("game_started", () => {
    startMatchmakingCountdown(user);
  });

  room.onMessage("countdown_tick", (data: any) => {
    if (typeof data?.count === "number") {
      tarajuGameState.countdownSeconds = data.count;
      updateCountdownOverlay(data.count);
      if (data.count > 0) playTarajuSound("tick");
    }
  });

  room.onMessage("round_started", (data: any) => {
    stopTarajuGameTimers();
    removeCountdownOverlay();
    tarajuGameState.roundNumber = data?.round || tarajuGameState.roundNumber;
    tarajuGameState.phase = "playing";
    tarajuGameState.timerSeconds = data?.timer || 180;
    tarajuGameState.lastResult = null;
    isGameStarted = true;

    if (data?.players && Array.isArray(data.players) && data.players.length > 0) {
      tarajuGameState.players = data.players.map((p: any) => ({
        sessionId: p.sessionId,
        userId: p.userId,
        name: p.name,
        picture: p.picture,
        isHost: Boolean(p.isHost),
        points: p.points ?? 10,
        currentGuess: null,
        isSubmitted: false,
        isEliminated: Boolean(p.isEliminated),
        lastRoundWon: false,
        pointsLostLastRound: 0,
        isAi: false,
      }));
    }

    renderGameActiveView(user);
    showRoundIntro(tarajuGameState.roundNumber, user, () => {
      tarajuGameState.phase = "playing";
      renderGameActiveView(user);
      startRoundTimer(user);
    });
  });

  room.onMessage("round_timer_tick", (data: any) => {
    if (typeof data?.timer === "number") {
      tarajuGameState.timerSeconds = data.timer;
      const timerDigits = document.getElementById("taraju-top-timer-digits");
      if (timerDigits) {
        timerDigits.innerText = formatTimerDisplay(data.timer);
      }
      const timerBox = document.getElementById("taraju-top-timer-box");
      if (timerBox) {
        if (data.timer <= 30) {
          timerBox.classList.add("timer-warning");
        } else {
          timerBox.classList.remove("timer-warning");
        }
      }
    }
  });

  room.onMessage("player_guess_submitted", (data: any) => {
    const target = tarajuGameState.players.find((p) => p.sessionId === data?.sessionId);
    if (target) {
      target.isSubmitted = true;
      renderGameActiveView(user);
    }
  });

  room.onMessage("round_evaluated", (data: any) => {
    if (data) {
      if (data.players && Array.isArray(data.players)) {
        data.players.forEach((sp: any) => {
          const lp = tarajuGameState.players.find((p) => p.sessionId === sp.sessionId);
          if (lp) {
            lp.points = sp.points;
            lp.isEliminated = sp.isEliminated;
            lp.lastRoundWon = sp.lastRoundWon;
            lp.pointsLostLastRound = sp.lastRoundWon ? 0 : 1;
            lp.currentGuess = sp.currentGuess;
          }
        });
      }

      const res: TarajuRoundResult = {
        round: data.round,
        sum: data.sum,
        average: data.average,
        target: data.target,
        winnerSessionIds: data.winnerSessionIds || [],
        guesses: data.guesses || [],
      };

      startStepByStepResults(res, user);
    }
  });

  room.onMessage("next_round_countdown", (data: any) => {
    if (typeof data?.seconds === "number") {
      tarajuGameState.nextRoundCountdown = data.seconds;
      const badge = document.getElementById("taraju-next-countdown-badge");
      if (badge) {
        badge.innerText = `Next round starts in ${data.seconds}s...`;
      }
    }
  });

  room.onMessage("game_over", (_data: any) => {
    tarajuGameState.phase = "victory";
    playTarajuSound("fanfare");
    renderGameActiveView(user);
  });

  room.onMessage("chat_message", (msg: ChatMessage) => {
    if (msg.text && msg.text.startsWith("__TAR_SYNC__:")) {
      try {
        const action = JSON.parse(msg.text.slice("__TAR_SYNC__:".length));
        handleTarajuSyncAction(action, user);
      } catch (e) {
        console.warn("Failed to parse game sync message:", e);
      }
      return;
    }

    roomChatHistory.push(msg);
    const chatWrap = document.getElementById("chat-messages-wrap");
    if (chatWrap) {
      const bubble = document.createElement("div");
      bubble.className = "chat-message-bubble";
      bubble.innerHTML = `
        <div class="chat-msg-sender ${msg.isHost ? "is-host" : ""}">
          ${msg.isHost ? "👑" : ""} ${escapeHtml(msg.senderName)}
        </div>
        <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
      `;
      chatWrap.appendChild(bubble);
      chatWrap.scrollTop = chatWrap.scrollHeight;
    }

    if (!isLobbyChatOpen) {
      unreadChatCount++;
      updateFloatingChatBadge();
    }
  });

  room.onStateChange(() => {
    syncPlayersFromRoomState(room, user);
    if (!isGameStarted && !isCountdownActive && tarajuGameState.phase === "lobby") {
      updateOrRenderLobby(user);
    }
  });

  room.onLeave(() => {
    stopTarajuGameTimers();
    removeCountdownOverlay();
    activeRoom = null;
    isGameStarted = false;
    isLobbyChatOpen = false;
    unreadChatCount = 0;
    roomPlayers = [];
    saveNavigationState("arena");
    renderRoomBrowserView(user);
  });

  // Request authoritative roster right away
  try {
    room.send("get_roster");
  } catch (e) {}

  renderRoomLobbyView(user);
}

function syncPlayersFromRoomState(room: any, _currentUser?: UserProfile) {
  if (!room || !room.state || !room.state.players) return;

  const list: JoinedPlayer[] = [];
  room.state.players.forEach((p: any, sId: string) => {
    list.push({
      sessionId: p.sessionId || sId,
      userId: p.userId || "",
      name: p.name || "Player",
      picture: p.picture || "",
      isHost: Boolean(p.isHost),
      isReady: Boolean(p.isReady),
      joinedAt: p.joinedAt || Date.now(),
    });
  });

  if (list.length > 0) {
    roomPlayers = list;
  }
}

function leaveCurrentRoom(user: UserProfile) {
  stopTarajuGameTimers();
  removeCountdownOverlay();
  tarajuGameState = createInitialTarajuGameState();
  if (activeRoom) {
    try {
      activeRoom.leave();
    } catch (e) {
      console.warn("Error leaving room:", e);
    }
    activeRoom = null;
  }
  isGameStarted = false;
  isLobbyChatOpen = false;
  unreadChatCount = 0;
  roomPlayers = [];
  currentRoomSummary = null;
  saveNavigationState("arena");
  renderRoomBrowserView(user);
}

function startRoomMatch(user: UserProfile) {
  if (activeRoom) {
    try {
      activeRoom.send("start_game");
    } catch (e) {}
  }
  broadcastTarajuAction({ type: "START_COUNTDOWN" });
  startMatchmakingCountdown(user);
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// ==========================================
// GOOGLE PLAYSTORE STOREFRONT VIEW
// ==========================================
function renderPlayStoreView(user: UserProfile) {
  stopRoomsAutoPolling();
  const app = document.getElementById("app");
  if (!app) return;

  const avatarMarkupSmall = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="avatar-img-circle" referrerpolicy="no-referrer" />`
    : `<div class="avatar-initials-circle">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  const avatarMarkupLarge = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="dropdown-avatar-large" referrerpolicy="no-referrer" />`
    : `<div class="dropdown-avatar-initials-large">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  app.innerHTML = `
    <div class="playstore-container">
      <!-- Navigation Header -->
      <header class="playstore-header">
        <div class="header-left">
          <div class="navbar-brand" id="logo-refresh" title="Alice Multiplayer">
            <div class="navbar-logo-icon">
              ${renderLucideIcon(Gamepad2, { width: 20, height: 20 })}
            </div>
            <div>
              <div class="navbar-title">Alice Multiplayer</div>
              <div class="navbar-subtitle">Arena v0.1</div>
            </div>
          </div>

          <nav class="playstore-nav-tabs">
            <div class="playstore-tab active" data-tab="home">Home</div>
          </nav>
        </div>

        <div class="header-right">
          <!-- Profile Avatar Button -->
          <button id="btn-profile-toggle" class="playstore-profile-btn" title="Account: ${user.name}">
            ${avatarMarkupSmall}
          </button>

          <!-- Profile Dropdown Menu -->
          ${renderProfileDropdownHtml(user, avatarMarkupLarge)}
        </div>
      </header>

      <!-- Main Store Content -->
      <main class="store-main-content">
        <!-- Section: Apps (Taraju) -->
        <section class="store-section">
          <div class="apps-grid-row">
            <!-- Taraju App Item -->
            <div class="app-store-card" id="app-card-taraju">
              <img src="/taraju-icon.jpg" alt="Taraju App Icon" class="app-card-icon" />
              <div class="app-card-info">
                <div class="app-card-title">Taraju</div>
                <div class="app-card-category">Alice Arena • Strategy & Matchmaking</div>
                <div class="app-card-rating">
                  <span>• Multiplayer</span>
                </div>
              </div>
              <button class="app-card-play-btn" id="btn-card-play">
                Enter
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;

  // Profile dropdown events
  attachProfileDropdownEvents();

  // Navigation to Arena Matchmaking (Direct on page, NO MODAL)
  const navigateToArena = () => {
    saveNavigationState("arena");
    renderArenaView(user);
  };

  document.getElementById("app-card-taraju")?.addEventListener("click", navigateToArena);
  document.getElementById("btn-card-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    navigateToArena();
  });

  // Logo refresh
  document.getElementById("logo-refresh")?.addEventListener("click", () => {
    renderPlayStoreView(user);
  });
}

// ==========================================
// GOOGLE AUTH / LOGIN VIEW
// ==========================================
function renderLoginView() {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="ambient-bg">
      <div class="ambient-orb ambient-orb-1"></div>
      <div class="ambient-orb ambient-orb-2"></div>
      <div class="ambient-orb ambient-orb-3"></div>
    </div>

    <div class="login-container">
      <div class="login-card">
        <h1 class="login-title">Welcome Back</h1>
        <p class="login-subtitle">Sign in with your Google account to access Google Play & the Alice Arena.</p>

        <!-- Official Google Sign-In Button Container -->
        <div id="google-btn-container" class="google-button-wrapper">
          <div style="color: #64748b; font-size: 13px;">Loading Google Sign-In...</div>
        </div>

        <div class="login-badges">
          <div class="badge-item">
            ${renderLucideIcon(ShieldCheck, { width: 15, height: 15 })}
            Google OAuth 2.0
          </div>
        </div>
      </div>
    </div>
  `;

  initGoogleAuth();
}

function initGoogleAuth() {
  const container = document.getElementById("google-btn-container");
  if (!container) return;

  if (!googleClientId) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #d97706; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); padding: 8px 12px; border-radius: 8px;">
        ${renderLucideIcon(AlertTriangle, { width: 16, height: 16 })}
        Add VITE_GOOGLE_CLIENT_ID to alice/.env
      </div>
    `;
    return;
  }

  const checkGisInterval = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(checkGisInterval);
      setupGisButton(container);
    }
  }, 100);

  setTimeout(() => {
    clearInterval(checkGisInterval);
    if (!window.google?.accounts?.id && container) {
      container.innerHTML = `
        <div style="font-size: 12px; color: #64748b;">
          Unable to load Google Sign-In. Please check your network connection or disable adblockers.
        </div>
      `;
    }
  }, 5000);
}

function setupGisButton(container: HTMLElement) {
  try {
    container.innerHTML = "";
    window.google!.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        const credential = response.credential;
        if (!credential) return;

        const payload = decodeGoogleJwt(credential);
        const user: UserProfile = {
          id: payload?.sub || "google-" + Date.now(),
          name: payload?.name || payload?.email?.split("@")[0] || "Google Player",
          email: payload?.email || "",
          picture: payload?.picture || "",
          token: credential,
          isVerified: payload?.email_verified || true,
        };

        setStoredUser(user);
        await syncUserWithBackend(serverUrl, credential);
        initApp();
      },
    });

    window.google!.accounts.id.renderButton(container, {
      type: "standard",
      theme: "filled_blue",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: 280,
    });
  } catch (err) {
    console.error("Error setting up Google button:", err);
  }
}

function renderReconnectingView(_user: UserProfile) {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    <div class="arena-fullscreen-wrapper" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;">
      <div style="background:white;padding:36px 44px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.06);text-align:center;border:1px solid #e2e8f0;max-width:400px;width:90%;">
        <div style="width:44px;height:44px;margin:0 auto 16px;border:3px solid #e2e8f0;border-top-color:#01875f;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <h3 style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:6px;">Reconnecting to Arena...</h3>
        <p style="font-size:13.5px;color:#64748b;">Syncing joined players and matchmaking state.</p>
      </div>
    </div>
  `;
}

// App Initialization with Refresh Persistence
async function initApp() {
  const activeUser = getStoredUser();
  if (activeUser && (activeUser.id.startsWith("guest-") || activeUser.token.startsWith("mock-"))) {
    clearStoredUser();
    clearNavigationState();
    renderLoginView();
    return;
  }

  if (!activeUser) {
    clearNavigationState();
    renderLoginView();
    return;
  }

  // Check saved view / room from URL hash or sessionStorage
  const hash = window.location.hash;
  const savedView = sessionStorage.getItem(STORAGE_VIEW_KEY);
  const savedRoomId = sessionStorage.getItem(STORAGE_ROOM_KEY);

  let targetRoomId: string | null = null;
  if (hash.startsWith("#room=")) {
    targetRoomId = hash.replace("#room=", "").trim();
  } else if (savedRoomId && savedView === "room") {
    targetRoomId = savedRoomId;
  }

  if (targetRoomId) {
    renderReconnectingView(activeUser);
    const joined = await joinRoomById(activeUser, targetRoomId);
    if (!joined) {
      saveNavigationState("arena");
      renderArenaView(activeUser);
    }
    return;
  }

  if (hash === "#arena" || savedView === "arena") {
    saveNavigationState("arena");
    renderArenaView(activeUser);
    return;
  }

  // Default to Google Play storefront
  saveNavigationState("store");
  renderPlayStoreView(activeUser);
}

// Start
initApp();
