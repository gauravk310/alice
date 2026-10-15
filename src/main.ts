import Phaser from "phaser";
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
  Database,
  LogOut,
  Gamepad2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Search,
  HelpCircle,
  X,
  Star,
  Play,
  Monitor,
  Smartphone,
  Tablet,
  Tv,
  Watch,
  Settings,
  Trophy,
  ExternalLink,
  AlertTriangle,
} from "./icons.ts";

const serverUrl =
  import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567";
const googleClientId =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

let currentGame: Phaser.Game | null = null;

// Phaser Game Scene
class GameScene extends Phaser.Scene {
  private user: UserProfile;
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("GameScene");
    this.user = getStoredUser() || {
      id: "anonymous",
      name: "Player",
      email: "",
      picture: "",
      token: "",
    };
  }

  init(data: { user?: UserProfile }) {
    if (data?.user) {
      this.user = data.user;
    }
  }

  create() {
    // Canvas background
    const bgGraphics = this.add.graphics();
    bgGraphics.fillStyle(0xf8fafc, 1);
    bgGraphics.fillRoundedRect(20, 20, 760, 410, 16);
    bgGraphics.lineStyle(2, 0x01875f, 0.35);
    bgGraphics.strokeRoundedRect(20, 20, 760, 410, 16);

    // Title
    this.add
      .text(400, 75, "Taraju: Balance of Numbers", {
        fontSize: "26px",
        fontFamily: "Inter, sans-serif",
        fontStyle: "bold",
        color: "#0f172a",
      })
      .setOrigin(0.5);

    // Player Greeting
    this.add
      .text(400, 125, `Welcome to the Arena, ${this.user.name}!`, {
        fontSize: "18px",
        fontFamily: "Inter, sans-serif",
        color: "#01875f",
      })
      .setOrigin(0.5);

    // Connection Status
    this.statusText = this.add
      .text(400, 220, "Connecting to game server...", {
        fontSize: "16px",
        fontFamily: "Inter, sans-serif",
        color: "#64748b",
        align: "center",
        wordWrap: { width: 650 },
      })
      .setOrigin(0.5);

    // Subtle animated avatar circle
    const avatarCircle = this.add.circle(400, 310, 34, 0x01875f, 0.15);
    this.tweens.add({
      targets: avatarCircle,
      scale: 1.15,
      alpha: 0.35,
      yoyo: true,
      repeat: -1,
      duration: 1500,
    });

    this.add
      .text(400, 310, "⚖️", {
        fontSize: "24px",
      })
      .setOrigin(0.5);

    void this.connectToServer();
  }

  private async connectToServer() {
    try {
      const client = new Client(serverUrl);

      // Join room and send Google Auth credentials to backend
      const room = await client.joinOrCreate("my_room", {
        token: this.user.token,
        user: {
          id: this.user.id,
          name: this.user.name,
          email: this.user.email,
          picture: this.user.picture,
        },
      });

      this.statusText.setText(
        `✅ Connected to Room!\nSession ID: ${room.sessionId}\nPlayer: ${this.user.name}`
      );
      this.statusText.setColor("#059669");

      room.onMessage("welcome", (data: any) => {
        this.statusText.setText(
          `✅ ${data.message}\nSession: ${room.sessionId}\nDatabase Synced: Ready to Play!`
        );
      });

      room.onMessage("pong", (data: any) => {
        this.statusText.setText(
          `✅ ${data.message}\nSession: ${room.sessionId}`
        );
      });

      // Send ping message to backend
      room.send("ping");
    } catch (error) {
      console.error("Multiplayer connection failed:", error);
      this.statusText.setText(
        "⚠️ Server Connection Failed.\nCheck that the backend server is running on port 2567."
      );
      this.statusText.setColor("#dc2626");
    }
  }
}

function launchGame(user: UserProfile) {
  if (currentGame) {
    currentGame.destroy(true);
    currentGame = null;
  }

  const container = document.getElementById("phaser-container");
  if (!container) return;

  currentGame = new Phaser.Game({
    type: Phaser.AUTO,
    width: 800,
    height: 450,
    backgroundColor: "#ffffff",
    parent: "phaser-container",
    scene: [GameScene],
  });

  currentGame.scene.start("GameScene", { user });
}

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

  // Click outside to close dropdown
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

  // Sign out handler
  document.getElementById("btn-signout")?.addEventListener("click", () => {
    clearStoredUser();
    if (currentGame) {
      currentGame.destroy(true);
      currentGame = null;
    }
    renderLoginView();
  });
}

function renderPlayStoreView(user: UserProfile) {
  if (currentGame) {
    currentGame.destroy(true);
    currentGame = null;
  }

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
      <!-- Alice Navigation Header -->
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
                    <span class="app-name-title">Taraju</span>
                  </div>
                </div>
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
                <div class="app-card-category">Alice Arena • Strategy</div>
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

  // Navigation to Arena (Direct on page, NO popup modal)
  const navigateToArena = () => {
    renderArenaView(user);
  };

  document.getElementById("taraju-hero-card")?.addEventListener("click", navigateToArena);
  document.getElementById("btn-banner-play")?.addEventListener("click", navigateToArena);
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

  // Carousel tactile bounce
  const carouselCard = document.getElementById("taraju-hero-card");
  document.getElementById("carousel-prev")?.addEventListener("click", () => {
    if (carouselCard) {
      carouselCard.style.transform = "translateX(-8px)";
      setTimeout(() => {
        carouselCard.style.transform = "translateX(0)";
      }, 200);
    }
  });
  document.getElementById("carousel-next")?.addEventListener("click", () => {
    if (carouselCard) {
      carouselCard.style.transform = "translateX(8px)";
      setTimeout(() => {
        carouselCard.style.transform = "translateX(0)";
      }, 200);
    }
  });

  // Device chips selection
  const chips = document.querySelectorAll(".device-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
    });
  });
}

function renderArenaView(user: UserProfile) {
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

      <!-- Direct In-Page Arena Stage (NO MODAL) -->
      <main class="arena-direct-wrapper">
        <div class="arena-top-banner">
          <button class="btn-back-to-store" id="btn-back-to-games">
            ${renderLucideIcon(ChevronLeft, { width: 18, height: 18 })}
            <span>Back to Games</span>
          </button>

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

        <div class="arena-stage-area">
          <div class="canvas-card" id="phaser-container"></div>
        </div>
      </main>
    </div>
  `;

  // Profile dropdown events
  attachProfileDropdownEvents();

  // Return to Games Store View
  const returnToStore = () => {
    if (currentGame) {
      currentGame.destroy(true);
      currentGame = null;
    }
    renderPlayStoreView(user);
  };

  document.getElementById("btn-back-to-games")?.addEventListener("click", returnToStore);
  document.getElementById("tab-to-store")?.addEventListener("click", returnToStore);
  document.getElementById("brand-to-store")?.addEventListener("click", returnToStore);
  document.getElementById("menu-my-games")?.addEventListener("click", returnToStore);

  // Launch the Phaser game directly in the container
  launchGame(user);
}

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

  // Initialize Google Identity Services
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

        // Store user in local storage
        setStoredUser(user);

        // Sync verified Google user with backend MongoDB
        await syncUserWithBackend(serverUrl, credential);

        // Transition to Play Store View
        renderPlayStoreView(user);
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

// App Initialization
function initApp() {
  const activeUser = getStoredUser();
  if (activeUser && (activeUser.id.startsWith("guest-") || activeUser.token.startsWith("mock-"))) {
    clearStoredUser();
    renderLoginView();
    return;
  }

  if (activeUser) {
    renderPlayStoreView(activeUser);
  } else {
    renderLoginView();
  }
}

// Start
initApp();
