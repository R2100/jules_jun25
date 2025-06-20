# Bumper Car Game

## Description
This is a 3D bumper car game where the objective is to score points by hitting other cars. Players control their cars and try to strategically bump opponents in vulnerable zones (rear and sides) while protecting their own.

## Controls
- **Player 1 (Red Car):**
  - Accelerate: Arrow Up
  - Brake/Reverse: Arrow Down
  - Turn Left: Arrow Left
  - Turn Right: Arrow Right
- **Player 2 (Blue Car):**
  - Accelerate: W
  - Brake/Reverse: S
  - Turn Left: A
  - Turn Right: D

## Current Functionalities
- **Two-Player Mode:** Allows two players to compete on the same screen.
- **Bot Opponents:** Includes AI-controlled bot cars that navigate the circuit and engage in collisions.
- **Scoring System:**
    - Front-to-Rear Hit: +3 points for attacker, -1 for victim.
    - Front-to-Side Hit: +2 points for attacker.
    - Head-on (Front-to-Front) Hit: +1 point for both.
    - Hitting a Wall: -1 point.
- **Adjustable Car Grip Factor:** A slider allows players to change the `gripFactor` for all cars, affecting how much they drift. Lower grip means more drift. The default is `0.7`.
- **Camera Views:**
    - **Third-Person View:** Default overhead camera.
    - **First-Person View:** Camera mounted on Player 1's car.
    - Toggle between views using the "Toggle Camera" button.
- **Physics:**
    - Basic car acceleration, turning, and velocity.
    - Collision detection using Oriented Bounding Boxes (OBB).
    - Collision response with impulses and positional correction.
    - Visual feedback for hits (cars flash white).
- **Game Version Display:** The current game version is displayed on the screen.
