import { Client } from "@colyseus/sdk";
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
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Search,
  HelpCircle,
  X,
  Play,
  Monitor,
  Settings,
  Trophy,
  AlertTriangle,
  Plus,
  Users,
  Crown,
  Copy,
  Check,
  RefreshCw,
  Radio,
  DoorOpen,
  Swords,
  CheckCircle2,
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
let availableRoomsList: RoomSummary[] = [];
let isCreateRoomModalOpen = false;
let roomSearchFilter = "";
let roomsPollingInterval: any = null;
let selectedMaxPlayers = 6;
let isGameStarted = false;
let currentChosenBalance = 50;

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

        <button class="btn-manage-account" id="btn-manage-account">
          Manage your Google Account
        </button>

        <div class="dropdown-status-box">
          <div class="status-box-title">
            ${renderLucideIcon(Trophy, { width: 15, height: 15, class: "lucide", style: "color: #f59e0b;" })}
            Alice Arena Level 14
          </div>
          <div class="status-box-tag">Active Player</div>
        </div>
      </div>

      <div class="dropdown-menu-list">
        <button class="dropdown-menu-item" id="menu-my-games">
          ${renderLucideIcon(Gamepad2, { width: 18, height: 18 })}
          <span>My Games & Library</span>
        </button>
        <button class="dropdown-menu-item" id="menu-arena-launch">
          ${renderLucideIcon(Play, { width: 18, height: 18 })}
          <span>Launch Taraju Arena</span>
        </button>
        <button class="dropdown-menu-item" id="menu-settings">
          ${renderLucideIcon(Settings, { width: 18, height: 18 })}
          <span>Settings & Preferences</span>
        </button>
      </div>

      <div class="dropdown-divider"></div>

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
    if (activeRoom) {
      try {
        activeRoom.leave();
      } catch (e) {}
      activeRoom = null;
    }
    clearNavigationState();
    clearStoredUser();
    renderLoginView();
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
// 1. ROOM BROWSER VIEW (Full Width & Clean Light Theme)
// ------------------------------------------
async function renderRoomBrowserView(user: UserProfile) {
  const app = document.getElementById("app");
  if (!app) return;

  const avatarMarkupSmall = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="avatar-img-circle" referrerpolicy="no-referrer" />`
    : `<div class="avatar-initials-circle">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  const avatarMarkupLarge = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="dropdown-avatar-large" referrerpolicy="no-referrer" />`
    : `<div class="dropdown-avatar-initials-large">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  app.innerHTML = `
    <div class="arena-fullscreen-wrapper">
      <!-- Alice Navigation Header -->
      <header class="playstore-header">
        <div class="header-left">
          <div class="navbar-brand" id="brand-to-store" title="Back to Games" style="cursor: pointer;">
            <div class="navbar-logo-icon">
              ${renderLucideIcon(Gamepad2, { width: 20, height: 20 })}
            </div>
            <div>
              <div class="navbar-title">Alice Multiplayer</div>
              <div class="navbar-subtitle">Arena v0.1</div>
            </div>
          </div>

          <nav class="playstore-nav-tabs">
            <div class="playstore-tab active" id="tab-to-store" data-tab="games" style="cursor: pointer;">Games</div>
          </nav>
        </div>

        <div class="header-right">
          <button class="icon-btn-round" title="Search games">
            ${renderLucideIcon(Search, { width: 19, height: 19 })}
          </button>
          <button class="icon-btn-round" title="Help & feedback">
            ${renderLucideIcon(HelpCircle, { width: 19, height: 19 })}
          </button>

          <!-- Profile Avatar Button -->
          <button id="btn-profile-toggle" class="playstore-profile-btn" title="Account: ${user.name}">
            ${avatarMarkupSmall}
          </button>

          <!-- Profile Dropdown Menu -->
          ${renderProfileDropdownHtml(user, avatarMarkupLarge)}
        </div>
      </header>

      <!-- Sub-Header Bar (Back to Games & Live Status) -->
      <div class="arena-fullscreen-subbanner">
        <div class="arena-nav-left">
          <button class="btn-arena-back" id="btn-back-to-store" title="Return to Google Play storefront">
            ${renderLucideIcon(ChevronLeft, { width: 16, height: 16 })}
            <span>Back to Games</span>
          </button>
        </div>

        <div class="arena-nav-right">
          <div class="arena-info-strip">
            <img src="/taraju-icon.jpg" alt="Taraju Icon" class="arena-icon-badge" />
            <div>
              <div class="arena-title-text">Taraju Multiplayer Arena</div>
              <div class="arena-status-badge">
                <span style="width:6px;height:6px;border-radius:50%;background:#059669;display:inline-block;"></span>
                Colyseus Live Room: 2567
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Matchmaking Hub Container (Full Width Light Mode) -->
      <main class="matchmaking-hub-content">
        <!-- Hero Header with Create Room Button -->
        <section class="matchmaking-hero-header">
          <div class="hero-header-text">
            <h1>
              ${renderLucideIcon(Swords, { width: 24, height: 24, style: "color: var(--play-green);" })}
              Live Matchmaking Arena
            </h1>
            <p>
              Host a room or join an open lobby with players. Guess closest to 0.7× the collective average in this psychological balance duel.
            </p>
          </div>

          <div class="hero-header-actions">
            <button class="btn-create-room-primary" id="btn-open-create-modal">
              ${renderLucideIcon(Plus, { width: 18, height: 18 })}
              <span>Create Room</span>
            </button>
          </div>
        </section>

        <!-- Search, Code Join, Refresh Toolbar -->
        <section class="matchmaking-toolbar">
          <div class="toolbar-left-tools">
            <div class="search-box-wrapper">
              <span class="search-icon">
                ${renderLucideIcon(Search, { width: 16, height: 16 })}
              </span>
              <input 
                type="text" 
                id="input-filter-rooms" 
                class="input-search-rooms" 
                placeholder="Search rooms or host name..." 
                value="${roomSearchFilter}"
              />
            </div>

            <div class="code-join-group">
              <input 
                type="text" 
                id="input-join-code" 
                class="input-room-code" 
                placeholder="TRJ-CODE" 
                maxlength="10"
              />
              <button class="btn-join-code" id="btn-join-by-code">
                Join Code
              </button>
            </div>
          </div>

          <button class="btn-refresh-rooms" id="btn-refresh-rooms" title="Refresh available rooms">
            ${renderLucideIcon(RefreshCw, { width: 14, height: 14 })}
            <span>Refresh</span>
          </button>
        </section>

        <!-- Rooms List Header -->
        <div class="rooms-section-header">
          <div class="rooms-section-title">
            <span>Available Open Rooms</span>
            <span class="rooms-count-pill" id="rooms-count-badge">Loading...</span>
          </div>
        </div>

        <!-- Rooms Grid Container -->
        <div class="rooms-grid" id="rooms-grid-container">
          <div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 40px;">
            Scanning for active rooms...
          </div>
        </div>
      </main>

      <!-- Create Room Modal Backdrop (Hidden by default) -->
      <div id="modal-create-room-backdrop" class="modal-backdrop" style="display: ${isCreateRoomModalOpen ? "flex" : "none"};">
        <div class="modal-content-card">
          <div class="modal-header">
            <div class="modal-title">Create Matchmaking Room</div>
            <button class="modal-close-btn" id="btn-close-create-modal" title="Close">
              ${renderLucideIcon(X, { width: 16, height: 16 })}
            </button>
          </div>

          <div class="form-field-group">
            <label class="form-field-label">Room Name</label>
            <input 
              type="text" 
              id="input-new-room-name" 
              class="modal-input-text" 
              value="${user.name}'s Arena" 
              maxlength="32" 
              placeholder="e.g. Diamond Duel" 
            />
          </div>

          <div class="form-field-group">
            <label class="form-field-label">Max Players (Slots)</label>
            <div class="max-players-options" id="max-players-selector">
              <button class="btn-player-pill ${selectedMaxPlayers === 2 ? "selected" : ""}" data-count="2">2 Players</button>
              <button class="btn-player-pill ${selectedMaxPlayers === 4 ? "selected" : ""}" data-count="4">4 Players</button>
              <button class="btn-player-pill ${selectedMaxPlayers === 6 ? "selected" : ""}" data-count="6">6 Players</button>
              <button class="btn-player-pill ${selectedMaxPlayers === 8 ? "selected" : ""}" data-count="8">8 Players</button>
            </div>
          </div>

          <div class="mode-info-card">
            ${renderLucideIcon(Sparkles, { width: 18, height: 18, style: "color: var(--play-green); flex-shrink: 0;" })}
            <div>
              <strong>Among Us style lobby:</strong> You will be the Room Host. You can invite friends with the room code and start the match when players are ready.
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-modal-cancel" id="btn-cancel-create">Cancel</button>
            <button class="btn-modal-submit" id="btn-submit-create-room">
              Create & Host Lobby
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach profile dropdown
  attachProfileDropdownEvents();

  // Navigation back to Games store
  const returnToStore = () => {
    stopRoomsAutoPolling();
    saveNavigationState("store");
    renderPlayStoreView(user);
  };
  document.getElementById("btn-back-to-store")?.addEventListener("click", returnToStore);
  document.getElementById("brand-to-store")?.addEventListener("click", returnToStore);
  document.getElementById("tab-to-store")?.addEventListener("click", returnToStore);
  document.getElementById("menu-my-games")?.addEventListener("click", returnToStore);

  // Search input handler
  const searchInput = document.getElementById("input-filter-rooms") as HTMLInputElement;
  searchInput?.addEventListener("input", (e) => {
    roomSearchFilter = (e.target as HTMLInputElement).value;
    updateRoomsGridUi(user);
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
    if (modalBackdrop) modalBackdrop.style.display = "flex";
  };

  const closeModal = () => {
    isCreateRoomModalOpen = false;
    if (modalBackdrop) modalBackdrop.style.display = "none";
  };

  openModalBtn?.addEventListener("click", openModal);
  closeModalBtn?.addEventListener("click", closeModal);
  cancelModalBtn?.addEventListener("click", closeModal);

  // Max players buttons
  const playerPills = document.querySelectorAll(".btn-player-pill");
  playerPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      playerPills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      selectedMaxPlayers = Number(pill.getAttribute("data-count")) || 6;
    });
  });

  // Create room submit
  document.getElementById("btn-submit-create-room")?.addEventListener("click", async () => {
    const roomNameInput = document.getElementById("input-new-room-name") as HTMLInputElement;
    const roomName = roomNameInput?.value?.trim() || `${user.name}'s Arena`;
    closeModal();
    await createRoomAndEnter(user, roomName, selectedMaxPlayers);
  });

  // Join by code submit
  document.getElementById("btn-join-by-code")?.addEventListener("click", async () => {
    const codeInput = document.getElementById("input-join-code") as HTMLInputElement;
    const code = codeInput?.value?.trim();
    if (!code) {
      alert("Please enter a room code (e.g. TRJ-1234)");
      return;
    }
    await joinRoomByCode(user, code);
  });

  // Initial rooms fetch and auto polling
  await fetchOpenRooms();
  updateRoomsGridUi(user);
  startRoomsAutoPolling(user);
}

function updateRoomsGridUi(user: UserProfile) {
  const container = document.getElementById("rooms-grid-container");
  const countBadge = document.getElementById("rooms-count-badge");
  if (!container) return;

  const filtered = availableRoomsList.filter((r) => {
    if (!roomSearchFilter) return true;
    const q = roomSearchFilter.toLowerCase();
    return (
      r.roomName.toLowerCase().includes(q) ||
      r.hostName.toLowerCase().includes(q) ||
      r.roomCode.toLowerCase().includes(q)
    );
  });

  if (countBadge) {
    countBadge.innerText = `${filtered.length} Open`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="rooms-empty-card">
        <div class="empty-radar-circle">
          ${renderLucideIcon(Radio, { width: 34, height: 34 })}
        </div>
        <h3>No open rooms found</h3>
        <p>
          There are currently no open lobbies matching your query. Create your own arena room and invite friends to duel!
        </p>
        <button class="btn-create-room-primary" id="btn-empty-create-room">
          ${renderLucideIcon(Plus, { width: 16, height: 16 })}
          <span>Create the First Room</span>
        </button>
      </div>
    `;

    document.getElementById("btn-empty-create-room")?.addEventListener("click", () => {
      const modal = document.getElementById("modal-create-room-backdrop");
      if (modal) modal.style.display = "flex";
    });
    return;
  }

  container.innerHTML = filtered
    .map((room) => {
      const isFull = room.playerCount >= room.maxPlayers;
      const isStarted = room.status === "in_progress";

      // Visual slot dots
      const dotsHtml = Array.from({ length: room.maxPlayers })
        .map((_, i) => `<span class="slot-dot ${i < room.playerCount ? "filled" : ""}"></span>`)
        .join("");

      const hostAvatar = room.hostAvatar
        ? `<img src="${room.hostAvatar}" alt="${room.hostName}" class="host-avatar-img" referrerpolicy="no-referrer" />`
        : `<div class="host-avatar-initials">${(room.hostName || "H").charAt(0).toUpperCase()}</div>`;

      return `
        <div class="room-card" data-room-id="${room.roomId}">
          <div class="room-card-header">
            <div class="room-card-name-wrap">
              <div class="room-card-name">${room.roomName}</div>
              <div class="room-card-code">CODE: #${room.roomCode}</div>
            </div>

            <div class="room-card-status-badge ${isStarted ? "status-in-progress" : "status-waiting"}">
              <span class="pulse-dot" style="background:${isStarted ? "#d97706" : "#059669"}; box-shadow:none;"></span>
              <span>${isStarted ? "In Progress" : "Waiting"}</span>
            </div>
          </div>

          <div class="room-card-host-row">
            ${hostAvatar}
            <div class="host-name-label">
              <span>${room.hostName}</span>
              <span class="host-crown-icon" title="Room Host">
                ${renderLucideIcon(Crown, { width: 14, height: 14 })}
              </span>
            </div>
          </div>

          <div class="room-card-players-meta">
            <div class="players-meta-top">
              <span>Players Joined</span>
              <span><strong>${room.playerCount}</strong> / ${room.maxPlayers}</span>
            </div>
            <div class="players-slots-pills">
              ${dotsHtml}
            </div>
          </div>

          <div class="room-card-footer">
            <button 
              class="btn-join-room btn-card-join" 
              data-room-id="${room.roomId}" 
              ${isFull || isStarted ? "disabled" : ""}
            >
              ${
                isFull
                  ? "Room Full"
                  : isStarted
                  ? "Match In Progress"
                  : `Join Room ${renderLucideIcon(ChevronRight, { width: 14, height: 14 })}`
              }
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

          <div class="podium-status-tag ${
            player.isHost ? "tag-host" : player.isReady ? "tag-ready" : "tag-waiting"
          }">
            ${player.isHost ? "👑 Host" : player.isReady ? "✅ Ready" : "⏳ In Lobby"}
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
      : `
        <button class="btn-toggle-ready" id="btn-player-toggle-ready">
          ${renderLucideIcon(CheckCircle2, { width: 16, height: 16 })}
          <span>Toggle Ready</span>
        </button>
      `;

    document.getElementById("btn-host-start-room")?.addEventListener("click", () => {
      startRoomMatch(user);
    });
    document.getElementById("btn-player-toggle-ready")?.addEventListener("click", () => {
      if (activeRoom) {
        activeRoom.send("toggle_ready");
      }
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
            <div class="playstore-tab active" id="tab-to-store-lobby" data-tab="games" style="cursor: pointer;">Games</div>
          </nav>
        </div>

        <div class="header-right">
          <button class="icon-btn-round" title="Search games">
            ${renderLucideIcon(Search, { width: 19, height: 19 })}
          </button>
          <button class="icon-btn-round" title="Help & feedback">
            ${renderLucideIcon(HelpCircle, { width: 19, height: 19 })}
          </button>
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

          <!-- Right: Game Rules & Live Lobby Chat -->
          <aside class="lobby-sidebar-area">
            <div class="lobby-rules-card">
              <div class="sidebar-card-title">
                ${renderLucideIcon(Sparkles, { width: 15, height: 15, style: "color: var(--play-green);" })}
                Arena Game Rules
              </div>
              <div class="rules-list">
                <div class="rule-item">
                  <span class="rule-bullet">•</span>
                  <span>Every player secretly selects an integer from 0 to 100.</span>
                </div>
                <div class="rule-item">
                  <span class="rule-bullet">•</span>
                  <span>The system computes the average and multiplies by 0.7.</span>
                </div>
                <div class="rule-item">
                  <span class="rule-bullet">•</span>
                  <span>The player closest to the 0.7× target score wins the round!</span>
                </div>
              </div>
            </div>

            <!-- Live Chat Box (Light Mode) -->
            <div class="lobby-chat-card">
              <div class="chat-header">
                <span>Lobby Chat</span>
                <span style="font-size: 11px; color: var(--play-green); font-weight: 600;">Live Synced</span>
              </div>

              <div class="chat-messages-container" id="chat-messages-wrap">
                ${chatMessagesHtml || '<div style="color: #64748b; font-size: 12.5px; text-align: center; margin-top: 24px;">No messages yet. Say hi to the lobby!</div>'}
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
            </div>
          </aside>
        </main>

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
                : `
                  <button class="btn-toggle-ready" id="btn-player-toggle-ready">
                    ${renderLucideIcon(CheckCircle2, { width: 16, height: 16 })}
                    <span>Toggle Ready</span>
                  </button>
                `
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
  document.getElementById("menu-my-games")?.addEventListener("click", returnToStore);

  // Scroll chat to bottom
  const chatWrap = document.getElementById("chat-messages-wrap");
  if (chatWrap) chatWrap.scrollTop = chatWrap.scrollHeight;

  // Leave room event
  document.getElementById("btn-leave-room")?.addEventListener("click", () => {
    leaveCurrentRoom(user);
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

  // Player Toggle Ready event
  document.getElementById("btn-player-toggle-ready")?.addEventListener("click", () => {
    if (activeRoom) {
      activeRoom.send("toggle_ready");
    }
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

function playTarajuSound(type: "tick" | "final_tick" | "start" | "win" | "lose" | "fanfare") {
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
  isCountdownActive = false;
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
    nextRoundCountdown: 8,
  };

  isGameStarted = true;
  currentChosenBalance = 50;

  if (activeRoom) {
    saveNavigationState("room", activeRoom.roomId);
  }

  playTarajuSound("start");
  renderGameActiveView(user);
  startRoundTimer(user);
  scheduleAiGuesses(user);
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
      p.currentGuess = currentChosenBalance || 50;
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

  // Play sound
  const localPlayer = tarajuGameState.players.find(
    (p) =>
      p.sessionId === (activeRoom?.sessionId || "") ||
      p.userId === user.id ||
      (!p.isAi && !activeRoom)
  );

  if (localPlayer && winnerSessionIds.includes(localPlayer.sessionId)) {
    playTarajuSound("win");
  } else {
    playTarajuSound("lose");
  }

  renderGameActiveView(user);

  // 5. Check if only 1 player remains
  const survivingPlayers = tarajuGameState.players.filter((p) => p.points > 0);

  if (survivingPlayers.length <= 1) {
    tarajuGameState.phase = "victory";
    playTarajuSound("fanfare");
    renderGameActiveView(user);
  } else {
    // Start 8-second countdown to next round
    startNextRoundCountdown(user);
  }
}

function startNextRoundCountdown(user: UserProfile) {
  if (tarajuNextRoundInterval) clearInterval(tarajuNextRoundInterval);
  tarajuGameState.nextRoundCountdown = 8;

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

  playTarajuSound("start");
  renderGameActiveView(user);
  startRoundTimer(user);
  scheduleAiGuesses(user);
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
      tarajuGameState.lastResult = action.result;
      tarajuGameState.players = action.players;
      tarajuGameState.phase = "results";
      stopTarajuGameTimers();
      renderGameActiveView(user);

      const survivors = tarajuGameState.players.filter((p) => p.points > 0);
      if (survivors.length <= 1) {
        tarajuGameState.phase = "victory";
        playTarajuSound("fanfare");
        renderGameActiveView(user);
      } else {
        startNextRoundCountdown(user);
      }
    }
  } else if (action.type === "NEXT_ROUND") {
    tarajuGameState.roundNumber = action.roundNumber || tarajuGameState.roundNumber + 1;
    tarajuGameState.phase = "playing";
    tarajuGameState.timerSeconds = 180;
    tarajuGameState.lastResult = null;
    if (action.players) tarajuGameState.players = action.players;
    tarajuGameState.players.forEach((p) => {
      p.currentGuess = null;
      p.isSubmitted = false;
      p.lastRoundWon = false;
    });
    stopTarajuGameTimers();
    renderGameActiveView(user);
    startRoundTimer(user);
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

      <!-- Main Stage: Exact Replica of taraju-banner.png -->
      <main class="taraju-main-stage">
        <!-- Subtitle & Rules Status Strip -->
        <div class="taraju-stage-status-strip">
          <div class="taraju-rule-hint">
            👑 <strong>Rule:</strong> Choose 0-100. Target score is <strong>0.7 × average</strong>. Closest player wins, losers lose 1 point.
          </div>
          <div class="taraju-phase-pill ${
            tarajuGameState.phase === "playing"
              ? "phase-guess"
              : tarajuGameState.phase === "results"
              ? "phase-result"
              : "phase-over"
          }">
            ${
              tarajuGameState.phase === "playing"
                ? "Choice Phase • 3 Min"
                : tarajuGameState.phase === "results"
                ? "Round Evaluated"
                : "Arena Concluded"
            }
          </div>
        </div>

        <!-- The Taraju Scale Grid: Player Cards & Revealed Numbers (taraju-banner.png) -->
        <div class="taraju-scale-grid" id="taraju-scale-grid">
          ${tarajuGameState.players
            .map((p) => {
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
                  <!-- Winner Crown & Golden Label (Top of column, matching banner) -->
                  <div class="taraju-col-winner-label">
                    <span class="taraju-crown-icon">👑</span>
                    <span class="taraju-winner-text">WINNER</span>
                  </div>

                  <!-- Unified Card Frame (Frames Avatar + Number with glowing red/orange neon border when winning) -->
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

                    <!-- Glowing Number Box (Directly below avatar, exact match to mint box in taraju-banner.png) -->
                    <div class="taraju-number-box ${!isResultsPhase && !isLocal ? "is-secret" : ""}" id="num-box-${p.sessionId}">
                      ${displayedNumber}
                    </div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>

        <!-- TOTAL / Target Calculation Banner (Directly below cards row, matching taraju-banner.png) -->
        ${
          isResultsPhase && lastRes
            ? `
          <div class="taraju-total-container">
            <div class="taraju-total-row">
              <div class="taraju-total-label">TOTAL</div>
              <div class="taraju-total-pill">${lastRes.target.toFixed(2)}</div>
            </div>

            <div class="taraju-calculation-box">
              <div class="taraju-calc-line">
                Average of all guesses: <strong>${lastRes.average.toFixed(2)}</strong> • Target: ${lastRes.average.toFixed(2)} × 0.7 = <strong>${lastRes.target.toFixed(2)}</strong>
              </div>
              <div class="taraju-calc-winner-line">
                👑 Closest Guess: ${lastRes.guesses
                  .filter((g) => lastRes.winnerSessionIds.includes(g.sessionId))
                  .map((g) => `${escapeHtml(g.name)} (${g.guess})`)
                  .join(", ")}
              </div>
              <div style="font-size: 12px; color: #94a3b8;">
                All losing contenders lose 1 point. Contenders reaching 0 points are eliminated.
              </div>
            </div>

            <!-- Next round timer & action -->
            ${
              tarajuGameState.phase !== "victory"
                ? `
              <div class="taraju-next-round-strip">
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
              </div>
            `
                : ""
            }
          </div>
        `
            : `
          <!-- Placeholder during choice phase so layout stays rock-solid -->
          <div class="taraju-total-container" style="opacity: 0.5;">
            <div class="taraju-total-row">
              <div class="taraju-total-label">TOTAL</div>
              <div class="taraju-total-pill" style="color: #64748b;">--.--</div>
            </div>
          </div>
        `
        }

        <!-- Player Input Deck: Slider, Direct Input, Presets & Confirm Button -->
        <div class="taraju-player-controls">
          ${
            localPlayer?.isEliminated
              ? `
            <div class="taraju-eliminated-notice">
              <div class="taraju-eliminated-notice-title">💀 YOU HAVE BEEN ELIMINATED</div>
              <p>You reached 0 points and can no longer submit guesses. You are spectating the remaining contenders until the victor emerges.</p>
            </div>
          `
              : `
            <div class="taraju-control-title">
              Choose your balance number (0 - 100)
            </div>

            <div class="taraju-control-display-row">
              <button class="btn-taraju-step" id="btn-step-minus-10" ${localPlayer?.isSubmitted ? "disabled" : ""}>-10</button>
              <button class="btn-taraju-step" id="btn-step-minus-1" ${localPlayer?.isSubmitted ? "disabled" : ""}>-1</button>
              
              <input 
                type="number" 
                id="input-taraju-number" 
                class="taraju-number-input" 
                min="0" 
                max="100" 
                value="${currentChosenBalance}" 
                ${localPlayer?.isSubmitted ? "disabled" : ""}
              />

              <button class="btn-taraju-step" id="btn-step-plus-1" ${localPlayer?.isSubmitted ? "disabled" : ""}>+1</button>
              <button class="btn-taraju-step" id="btn-step-plus-10" ${localPlayer?.isSubmitted ? "disabled" : ""}>+10</button>
            </div>

            <div class="taraju-slider-row">
              <input 
                type="range" 
                id="slider-taraju-balance" 
                class="taraju-slider" 
                min="0" 
                max="100" 
                value="${currentChosenBalance}" 
                ${localPlayer?.isSubmitted ? "disabled" : ""}
              />
              <div class="taraju-slider-labels">
                <span>0</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
            </div>

            <!-- Quick Presets -->
            <div class="taraju-presets-row">
              ${[0, 15, 25, 35, 50, 70, 85, 100]
                .map(
                  (val) => `
                <button class="btn-taraju-preset" data-val="${val}" ${localPlayer?.isSubmitted ? "disabled" : ""}>
                  ${val}
                </button>
              `
                )
                .join("")}
            </div>

            <!-- Lock Choice Button -->
            <button class="btn-taraju-lock-choice ${localPlayer?.isSubmitted ? "is-locked" : ""}" id="btn-taraju-lock" ${localPlayer?.isSubmitted || isResultsPhase ? "disabled" : ""}>
              ${
                localPlayer?.isSubmitted
                  ? `✅ Guess Locked: ${localPlayer.currentGuess} (Waiting for others...)`
                  : `Lock in Guess (${currentChosenBalance})`
              }
            </button>
          `
          }
        </div>
      </main>

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
  const slider = document.getElementById("slider-taraju-balance") as HTMLInputElement;
  const numInput = document.getElementById("input-taraju-number") as HTMLInputElement;
  const lockBtn = document.getElementById("btn-taraju-lock");

  const syncNumber = (val: number) => {
    currentChosenBalance = Math.max(0, Math.min(100, Math.round(val)));
    if (slider) slider.value = String(currentChosenBalance);
    if (numInput) numInput.value = String(currentChosenBalance);
    if (lockBtn && !lockBtn.classList.contains("is-locked")) {
      lockBtn.innerText = `Lock in Guess (${currentChosenBalance})`;
    }
  };

  slider?.addEventListener("input", () => {
    syncNumber(Number(slider.value));
  });

  numInput?.addEventListener("input", () => {
    syncNumber(Number(numInput.value));
  });

  document.getElementById("btn-step-minus-10")?.addEventListener("click", () => syncNumber(currentChosenBalance - 10));
  document.getElementById("btn-step-minus-1")?.addEventListener("click", () => syncNumber(currentChosenBalance - 1));
  document.getElementById("btn-step-plus-1")?.addEventListener("click", () => syncNumber(currentChosenBalance + 1));
  document.getElementById("btn-step-plus-10")?.addEventListener("click", () => syncNumber(currentChosenBalance + 10));

  document.querySelectorAll(".btn-taraju-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = Number(btn.getAttribute("data-val"));
      if (!isNaN(v)) syncNumber(v);
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
    alert(`Could not create room: ${err.message || err}`);
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
    const formattedCode = code.trim().toUpperCase();
    const res = await fetch(`${serverUrl}/api/rooms/${formattedCode}`);
    if (!res.ok) {
      alert(`No active room found with code #${formattedCode}`);
      return;
    }
    const data = await res.json();
    if (data?.success && data?.room?.roomId) {
      await joinRoomById(user, data.room.roomId);
    } else {
      alert(`No active room found with code #${formattedCode}`);
    }
  } catch (err) {
    console.error("Error looking up room code:", err);
    alert("Error searching for room code. Please try again.");
  }
}

function setupRoomListeners(room: any, user: UserProfile, isHost: boolean) {
  activeRoom = room;
  stopRoomsAutoPolling();
  isGameStarted = false;
  roomChatHistory = [];

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

    playTarajuSound("start");
    renderGameActiveView(user);
    startRoundTimer(user);
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
      tarajuGameState.lastResult = {
        round: data.round,
        sum: data.sum,
        average: data.average,
        target: data.target,
        winnerSessionIds: data.winnerSessionIds || [],
        guesses: data.guesses || [],
      };
      tarajuGameState.phase = "results";
      stopTarajuGameTimers();

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

      const localPlayer = tarajuGameState.players.find(
        (p) => p.sessionId === (activeRoom?.sessionId || "") || p.userId === user.id
      );
      if (localPlayer && data.winnerSessionIds?.includes(localPlayer.sessionId)) {
        playTarajuSound("win");
      } else {
        playTarajuSound("lose");
      }

      renderGameActiveView(user);
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
            <div class="playstore-tab active" data-tab="games">Games</div>
          </nav>
        </div>

        <div class="header-right">
          <button class="icon-btn-round" title="Search games">
            ${renderLucideIcon(Search, { width: 19, height: 19 })}
          </button>
          <button class="icon-btn-round" title="Help & feedback">
            ${renderLucideIcon(HelpCircle, { width: 19, height: 19 })}
          </button>

          <!-- Profile Avatar Button -->
          <button id="btn-profile-toggle" class="playstore-profile-btn" title="Account: ${user.name}">
            ${avatarMarkupSmall}
          </button>

          <!-- Profile Dropdown Menu -->
          ${renderProfileDropdownHtml(user, avatarMarkupLarge)}
        </div>
      </header>

      <!-- Subheader Device Chips -->
      <div class="device-chips-bar">
        <div class="device-chip active">
          ${renderLucideIcon(Monitor, { width: 14, height: 14 })}
          <span>Windows PC</span>
        </div>
      </div>

      <!-- Main Store Content -->
      <main class="store-main-content">
        <!-- Hero Banner Carousel (Taraju Sliding Item) -->
        <div class="playstore-carousel-wrapper">
          <button class="carousel-nav-btn prev" id="carousel-prev" title="Previous item">
            ${renderLucideIcon(ChevronLeft, { width: 22, height: 22 })}
          </button>
          <button class="carousel-nav-btn next" id="carousel-next" title="Next item">
            ${renderLucideIcon(ChevronRight, { width: 22, height: 22 })}
          </button>

          <div class="carousel-track">
            <div class="featured-banner-card" id="taraju-hero-card">
              <div class="banner-visual-area">
                <img src="/taraju-banner.png" alt="Taraju Winner Arena Banner" class="banner-img" />
                <div class="banner-image-gradient"></div>
                
                <div class="banner-overlay-content">
                  <h2 class="banner-headline">Launch into the King of Diamonds with Taraju</h2>
                  <p class="banner-subtext">Pick your balance between 0 and 100 • Target 0.7× average in the psychological duel</p>
                </div>
              </div>

              <div class="banner-app-strip">
                <div class="app-meta-left">
                  <img src="/taraju-icon.jpg" alt="Taraju 100 App Icon" class="banner-app-icon" />
                  <div class="app-text-info">
                    <span class="app-name-title">Taraju Arena</span>
                    <span style="font-size: 12px; color: var(--play-green); font-weight: 600;">Matchmaking Online • Colyseus</span>
                  </div>
                </div>
                <button class="btn-playstore-action" id="btn-banner-enter">
                  Enter Matchmaking
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section: Recommended for you (Apps Row below banner) -->
        <section class="store-section">
          <div class="apps-grid-row">
            <!-- Taraju App Item -->
            <div class="app-store-card" id="app-card-taraju">
              <img src="/taraju-icon.jpg" alt="Taraju App Icon" class="app-card-icon" />
              <div class="app-card-info">
                <div class="app-card-title">Taraju</div>
                <div class="app-card-category">Alice Arena • Strategy & Matchmaking</div>
                <div class="app-card-rating">
                  <span class="star-rating">★ 4.9</span>
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

  document.getElementById("taraju-hero-card")?.addEventListener("click", navigateToArena);
  document.getElementById("btn-banner-enter")?.addEventListener("click", (e) => {
    e.stopPropagation();
    navigateToArena();
  });
  document.getElementById("app-card-taraju")?.addEventListener("click", navigateToArena);
  document.getElementById("btn-card-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    navigateToArena();
  });
  document.getElementById("menu-arena-launch")?.addEventListener("click", navigateToArena);

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
