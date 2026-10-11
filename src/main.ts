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
    bgGraphics.fillStyle(0x0f172a, 1);
    bgGraphics.fillRoundedRect(20, 20, 760, 410, 16);
    bgGraphics.lineStyle(2, 0x6366f1, 0.4);
    bgGraphics.strokeRoundedRect(20, 20, 760, 410, 16);

    // Title
    this.add
      .text(400, 75, "Alice Multiplayer Arena", {
        fontSize: "26px",
        fontFamily: "Inter, sans-serif",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    // Player Greeting
    this.add
      .text(400, 125, `Welcome, ${this.user.name}!`, {
        fontSize: "18px",
        fontFamily: "Inter, sans-serif",
        color: "#38bdf8",
      })
      .setOrigin(0.5);

    // Connection Status
    this.statusText = this.add
      .text(400, 220, "Connecting to game server...", {
        fontSize: "16px",
        fontFamily: "Inter, sans-serif",
        color: "#94a3b8",
        align: "center",
        wordWrap: { width: 650 },
      })
      .setOrigin(0.5);

    // Subtle animated avatar circle
    const avatarCircle = this.add.circle(400, 310, 32, 0x6366f1, 0.8);
    this.tweens.add({
      targets: avatarCircle,
      scale: 1.15,
      alpha: 0.4,
      yoyo: true,
      repeat: -1,
      duration: 1500,
    });

    this.add
      .text(400, 310, "⚡", {
        fontSize: "22px",
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
      this.statusText.setColor("#10b981");

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
      this.statusText.setColor("#ef4444");
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
    backgroundColor: "#090c15",
    parent: "phaser-container",
    scene: [GameScene],
  });

  currentGame.scene.start("GameScene", { user });
}

function renderGameView(user: UserProfile) {
  const app = document.getElementById("app");
  if (!app) return;

  const avatarMarkup = user.picture
    ? `<img src="${user.picture}" alt="${user.name}" class="user-avatar" referrerpolicy="no-referrer" />`
    : `<div class="user-avatar-initials">${(user.name || "U").charAt(0).toUpperCase()}</div>`;

  app.innerHTML = `
    <div class="ambient-bg">
      <div class="ambient-orb ambient-orb-1"></div>
      <div class="ambient-orb ambient-orb-2"></div>
      <div class="ambient-orb ambient-orb-3"></div>
    </div>

    <div class="game-container">
      <header class="top-navbar">
        <div class="navbar-brand">
          <div class="navbar-logo-icon">A</div>
          <div>
            <div class="navbar-title">Alice Multiplayer</div>
            <div class="navbar-subtitle">Arena v0.1</div>
          </div>
        </div>

        <div class="navbar-actions">
          <div class="user-profile-badge">
            ${avatarMarkup}
            <div class="user-info">
              <span class="user-name">${user.name}</span>
              <span class="user-email">${user.email || "Verified Player"}</span>
            </div>
          </div>

          <button id="btn-signout" class="btn-signout" title="Sign out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Sign Out
          </button>
        </div>
      </header>

      <main class="game-stage-wrapper">
        <div class="canvas-card" id="phaser-container"></div>
      </main>
    </div>
  `;

  document.getElementById("btn-signout")?.addEventListener("click", () => {
    clearStoredUser();
    if (currentGame) {
      currentGame.destroy(true);
      currentGame = null;
    }
    renderLoginView();
  });

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
        <div class="brand-badge">
          <span class="brand-dot"></span>
          Alice Multiplayer
        </div>

        <h1 class="login-title">Welcome Back</h1>
        <p class="login-subtitle">Sign in with your Google account to connect to the arena.</p>

        <!-- Official Google Sign-In Button Container (Sole Login Option) -->
        <div id="google-btn-container" class="google-button-wrapper">
          <div style="color: #94a3b8; font-size: 13px;">Loading Google Sign-In...</div>
        </div>

        <div class="login-badges">
          <div class="badge-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            Google OAuth 2.0
          </div>
          <div class="badge-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
            MongoDB Synced
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
      <div style="font-size: 13px; color: #f59e0b; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); padding: 8px 12px; border-radius: 8px;">
        ⚠️ Add VITE_GOOGLE_CLIENT_ID to alice/.env
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

  // Timeout fallback after 5 seconds if script failed to load
  setTimeout(() => {
    clearInterval(checkGisInterval);
    if (!window.google?.accounts?.id && container) {
      container.innerHTML = `
        <div style="font-size: 12px; color: #94a3b8;">
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

        // Transition to Game View
        renderGameView(user);
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
  // Clear any old guest/mock sessions from local storage so only real Google users stay logged in
  if (activeUser && (activeUser.id.startsWith("guest-") || activeUser.token.startsWith("mock-"))) {
    clearStoredUser();
    renderLoginView();
    return;
  }

  if (activeUser) {
    renderGameView(activeUser);
  } else {
    renderLoginView();
  }
}

// Start
initApp();
