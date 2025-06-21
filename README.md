# Multiplayer Bumper Cars Game

A 3D multiplayer bumper car game using Node.js, Express, Socket.io, and Three.js.

## Prerequisites

*   Node.js and npm: Make sure you have Node.js installed, which includes npm (Node Package Manager). You can download it from [nodejs.org](https://nodejs.org/).

## Setup and Installation

1.  **Clone the repository (if applicable) or download the files.**
2.  **Navigate to the project directory:**
    ```bash
    cd path/to/your/project_directory
    ```
3.  **Install dependencies:** Open your terminal or command prompt in the project directory and run:
    ```bash
    npm install
    ```
    This will install `express` and `socket.io` as defined in `package.json`.

## Running the Game

1.  **Start the server:** In your terminal, from the project directory, run:
    ```bash
    node server.js
    ```
    You should see a message like "Server is running on port 3000".
2.  **Play the game:** Open your web browser (e.g., Chrome, Firefox) and go to:
    ```
    http://localhost:3000
    ```
3.  Enter your name and click "Join Game".
4.  Use AWSD keys to control your car. You can toggle the camera view with the "Toggle Camera" button.

## Game Features

*   Real-time multiplayer gameplay.
*   Up to 10 server-controlled bots.
*   Synchronized game state for all players.
*   First-person and third-person camera views.
*   Score tracking.
