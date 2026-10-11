export interface UserProfile {
  id: string;
  name: string;
  email: string;
  picture: string;
  token: string;
  isVerified?: boolean;
}

export interface GoogleJwtPayload {
  iss?: string;
  sub: string;
  azp?: string;
  aud?: string;
  email: string;
  email_verified?: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  iat?: number;
  exp?: number;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: number | string;
              locale?: string;
            }
          ) => void;
          prompt?: (notification?: unknown) => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, done: () => void) => void;
        };
      };
    };
  }
}

const STORAGE_KEY = "alice_auth_user";

export function getStoredUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch (e) {
    console.error("Failed to read user from localStorage:", e);
    return null;
  }
}

export function setStoredUser(user: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch (e) {
    console.error("Failed to store user in localStorage:", e);
  }
}

export function clearStoredUser(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (window.google?.accounts?.id?.disableAutoSelect) {
      window.google.accounts.id.disableAutoSelect();
    }
  } catch (e) {
    console.error("Error clearing user session:", e);
  }
}

/**
 * Decode JWT token returned by Google Identity Services
 */
export function decodeGoogleJwt(token: string): GoogleJwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload) as GoogleJwtPayload;
  } catch (e) {
    console.error("Failed to decode Google JWT token:", e);
    return null;
  }
}

/**
 * Sync authenticated token with alice-server backend to save in MongoDB
 */
export async function syncUserWithBackend(
  serverUrl: string,
  token: string
): Promise<any> {
  try {
    const response = await fetch(`${serverUrl}/api/auth/google`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      console.warn("Backend auth endpoint returned status:", response.status);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn("Could not reach backend auth API:", err);
    return null;
  }
}
