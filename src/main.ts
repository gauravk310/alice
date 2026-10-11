import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import "./style.css";

const serverUrl =
  import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567";

class GameScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("GameScene");
  }

  create() {
    this.add
      .text(400, 80, "Multiplayer Game", {
        fontSize: "32px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(400, 180, "Connecting to server...", {
        fontSize: "18px",
        color: "#ffffff",
        align: "center",
        wordWrap: { width: 650 },
      })
      .setOrigin(0.5);

    void this.connectToServer();
  }

  private async connectToServer() {
    try {
      const client = new Client(serverUrl);
      const room = await client.joinOrCreate("my_room");

      this.statusText.setText(
        `Connected!\nSession: ${room.sessionId}\nWaiting for server...`,
      );

      room.onMessage("welcome", (data) => {
        this.statusText.setText(
          `Connected successfully!\nSession: ${room.sessionId}\n${data.message}`,
        );
      });

      room.onMessage("pong", (data) => {
        this.statusText.setText(
          `Connected successfully!\n${data.message}`,
        );
      });

      // Send a test message to the backend.
      room.send("ping");
    } catch (error) {
      console.error("Multiplayer connection failed:", error);
      this.statusText.setText(
        "Connection failed.\nCheck that the backend is running.",
      );
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 450,
  backgroundColor: "#18202b",
  parent: "app",
  scene: [GameScene],
});