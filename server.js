const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Player storage
let players = {}; // Using an object to store players by socket.id

// Game constants
const TICK_RATE = 30;
let serverLastTime = Date.now();
const NUM_SERVER_BOTS = 10; // Number of bots
let serverBots = {};       // Storage for bot objects
const walls = [];          // Storage for wall objects

// Circuit Waypoints (copied from game.js, format {x, y, z})
const circuitWaypoints = [
    { x: 7, y: 0.3, z: 6 },
    { x: -10, y: 0.3, z: 4 },
    { x: -10, y: 0.3, z: -14 },
    { x: 10, y: 0.3, z: -14 }
];

// Wall Creation Helper
function addServerWall(width, height, depth, x, y, z) {
    walls.push({
        x: x, y: y, z: z,
        halfSize: { x: width / 2, y: height / 2, z: depth / 2 }
    });
}

// Initialize Walls (based on game.js createWall calls)
function initializeServerWalls() {
    const wallHeight = 1;
    const wallThickness = 0.5;
    // Front wall (-z direction)
    addServerWall(30 + wallThickness, wallHeight, wallThickness, 0, wallHeight / 2, -20 - wallThickness / 2);
    // Back wall (+z direction)
    addServerWall(30 + wallThickness, wallHeight, wallThickness, 0, wallHeight / 2, 10 + wallThickness / 2);
    // Left wall (-x direction)
    addServerWall(wallThickness, wallHeight, 30 + wallThickness, -15 - wallThickness / 2, wallHeight / 2, -5); // Adjusted Z for 30 length centered at -5
    // Right wall (+x direction)
    addServerWall(wallThickness, wallHeight, 30 + wallThickness, 15 + wallThickness / 2, wallHeight / 2, -5); // Adjusted Z for 30 length centered at -5
    // Central Vertical Wall
    addServerWall(1, wallHeight, 7, 0, wallHeight / 2, - wallHeight * 3);
}


// Server-side car creation function
function createServerCar(name, id, isBot = false) {
    return {
        id: id,
        name: name,
        x: Math.random() * 10 - 5, // Random initial x
        y: 0.3,
        z: isBot ? (Math.random() * 30) - 15 : (Math.random() * 10 - 5), // Wider spawn for bots
        rotationY: Math.random() * Math.PI * 2, // Random initial rotation for bots
        velocity: { x: 0, y: 0, z: 0 },
        accelerationValue: 0,
        accelerationRate: 12.0,
        linearDamping: 2.0,
        maxSpeed: isBot ? (15.0 + Math.random() * 10.0) : 20.0, // Bots might have varied speeds
        turnValue: 0,
        turnSpeed: isBot ? (2.5 + Math.random() * 1.0) : 3.0,   // Bots might have varied turn speeds
        score: 0,
        isHit: false,
        hitTimer: 0,
        originalColor: null,
        gripFactor: isBot ? (0.5 + Math.random() * 0.4) : 0.7, // Bots might have different grip
        obb: { halfSize: { x: 0.7 / 2, y: 0.6 / 2, z: 1.5 / 2 } },
        isBot: isBot, // Flag if it's a bot
        currentWaypointIndex: isBot ? Math.floor(Math.random() * circuitWaypoints.length) : 0, // Bots start at random waypoints
        target // For bots, could be a player or null
    };
}


// Bot AI Logic (adapted from game.js)
function updateBotAI(bot, dt) {
    if (!bot || !bot.isBot || dt === 0) return;

    const currentTargetPos = circuitWaypoints[bot.currentWaypointIndex];
    if (!currentTargetPos) {
        console.error("Bot AI: currentTargetPos is undefined for bot", bot.name, "index", bot.currentWaypointIndex);
        bot.accelerationValue = 0;
        bot.turnValue = 0;
        return;
    }

    const directionToTarget = {
        x: currentTargetPos.x - bot.x,
        z: currentTargetPos.z - bot.z
    };
    const distanceToTarget = Math.sqrt(directionToTarget.x * directionToTarget.x + directionToTarget.z * directionToTarget.z);

    if (distanceToTarget > 0.001) {
        directionToTarget.x /= distanceToTarget; // Normalize
        directionToTarget.z /= distanceToTarget;
    }

    // Bot's current forward direction
    const botForward = {
        x: Math.sin(bot.rotationY),
        z: Math.cos(bot.rotationY)
    };

    if (distanceToTarget > 0.001) {
        // Angle to target
        let angleToTarget = Math.atan2(directionToTarget.x, directionToTarget.z) - Math.atan2(botForward.x, botForward.z);

        // Normalize angle to be between -PI and PI
        while (angleToTarget > Math.PI) angleToTarget -= 2 * Math.PI;
        while (angleToTarget < -Math.PI) angleToTarget += 2 * Math.PI;

        const turnThreshold = 0.15; // Radians
        if (Math.abs(angleToTarget) > turnThreshold) {
            bot.turnValue = Math.sign(angleToTarget) * bot.turnSpeed * 0.8; // Simplified turn
        } else {
            bot.turnValue = 0; // Mostly aligned
        }

        // Speed control
        if (Math.abs(angleToTarget) > Math.PI / 6 && Math.sqrt(bot.velocity.x**2 + bot.velocity.z**2) > bot.maxSpeed * 0.5) {
             bot.accelerationValue = -bot.accelerationRate * 0.5; // Brake if turning sharply at speed
        } else if (Math.abs(angleToTarget) > Math.PI / 4) {
            bot.accelerationValue = bot.accelerationRate * 0.2; // Slow down for sharper turns
        } else {
            bot.accelerationValue = bot.accelerationRate * 0.75; // Accelerate towards target
        }
    } else {
        bot.accelerationValue = 0;
        bot.turnValue = 0;
    }

    // Waypoint switching
    const waypointReachedThreshold = 2.5;
    if (distanceToTarget < waypointReachedThreshold) {
        bot.currentWaypointIndex = (bot.currentWaypointIndex + 1) % circuitWaypoints.length;
    }
}


// Server-side physics application (adapted from game.js)
function applyCarPhysics(car, dt) {
    if (!car || dt === 0) return;

    // 1. Apply rotation
    car.rotationY += car.turnValue * dt;
    // Normalize rotationY to be within -PI to PI (or 0 to 2PI) to prevent large numbers
    car.rotationY = car.rotationY % (2 * Math.PI);


    // 2. Calculate forward vector (simplified for Y-up, Z-forward convention)
    // Note: In Three.js, Z is often forward, but depends on model orientation.
    // Assuming positive Z is forward for the car model:
    // If rotationY = 0, worldForward = (0,0,1)
    // If rotationY = PI/2 (90 deg left), worldForward = (1,0,0)
    // If rotationY = PI (180 deg), worldForward = (0,0,-1)
    // If rotationY = -PI/2 (90 deg right), worldForward = (-1,0,0)
    const worldForward = {
        x: Math.sin(car.rotationY), // Correct for Z-forward, Y-up
        z: Math.cos(car.rotationY)  // Correct for Z-forward, Y-up
    };

    // 3. Apply grip (simplified server-side)
    // This logic is complex without vector math. For now, we'll simplify.
    // A more accurate grip model would separate velocity into longitudinal and lateral components.
    // Simplified: reduce overall sideways velocity if not accelerating/braking much.
    // This is a placeholder for a more robust grip model.
    if (Math.abs(car.accelerationValue) < 0.1 && typeof car.gripFactor !== 'undefined') {
        // A proper implementation needs to project velocity onto car's local axes.
        // For now, we'll just slightly dampen velocity changes when not accelerating hard.
        // This is NOT a correct grip model but a temporary simplification.
        const perpendicularVelocityDamp = 1.0 - (1.0 - car.gripFactor) * 0.5; // Partial damping

        // Decompose velocity into components along and perpendicular to car's orientation
        const speed = Math.sqrt(car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z);
        if (speed > 0.001) {
            const dotProd = (car.velocity.x * worldForward.x + car.velocity.z * worldForward.z);
            const longitudinalVelocity = { x: worldForward.x * dotProd, z: worldForward.z * dotProd };
            const lateralVelocity = { x: car.velocity.x - longitudinalVelocity.x, z: car.velocity.z - longitudinalVelocity.z };

            lateralVelocity.x *= (1 - car.gripFactor);
            lateralVelocity.z *= (1 - car.gripFactor);

            car.velocity.x = longitudinalVelocity.x + lateralVelocity.x;
            car.velocity.z = longitudinalVelocity.z + lateralVelocity.z;
        }
    }


    // 4. Apply acceleration
    car.velocity.x += worldForward.x * car.accelerationValue * dt;
    car.velocity.z += worldForward.z * car.accelerationValue * dt;
    // car.velocity.y remains 0 for ground vehicles.

    // 5. Apply linear damping (friction) when not accelerating
    if (Math.abs(car.accelerationValue) < 0.01) {
        const dampingFactor = Math.max(0, 1.0 - car.linearDamping * dt);
        car.velocity.x *= dampingFactor;
        car.velocity.z *= dampingFactor;
    }

    // 6. Clamp to max speed
    const currentSpeedSq = car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z;
    if (currentSpeedSq > car.maxSpeed * car.maxSpeed) {
        const currentSpeed = Math.sqrt(currentSpeedSq);
        car.velocity.x = (car.velocity.x / currentSpeed) * car.maxSpeed;
        car.velocity.z = (car.velocity.z / currentSpeed) * car.maxSpeed;
    }

    // Stop if very slow
    if (currentSpeedSq < 0.001 * 0.001) { // Comparing to squared small speed
        car.velocity.x = 0;
        car.velocity.z = 0;
    }


    // 7. Update position
    car.x += car.velocity.x * dt;
    car.z += car.velocity.z * dt;
    car.y = 0.3; // Keep car on the ground plane

    // 8. Update hit timer and isHit status
    if (car.isHit && car.hitTimer > 0) {
        car.hitTimer -= dt;
        if (car.hitTimer <= 0) {
            car.isHit = false;
            car.hitTimer = 0;
        }
    }
}


// Serve static files from the current directory
app.use(express.static(__dirname));

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // Handle player join request
  socket.on('playerJoinRequest', (data) => {
    console.log(`Player join request from ${socket.id} with name: ${data.name}`);

    const newPlayer = createServerCar(data.name, socket.id, false); // false for isBot
    players[socket.id] = newPlayer;

    // Send initial game state to the joining player
    const initialGameState = {
        players: { ...players }, // Send a copy of current players
        bots: { ...serverBots }   // Send a copy of current bots
    };
    socket.emit('joinSuccess', { playerId: socket.id, initialGameState: initialGameState });

    // Broadcast to other clients that a new player has joined (only player data, not full state)
    socket.broadcast.emit('playerJoined', newPlayer);

    console.log('Current players:', players);
    console.log('Current bots:', Object.keys(serverBots).length);
  });

  // Handle player input
  socket.on('playerInput', (inputData) => {
    const playerCar = players[socket.id];
    if (!playerCar) {
        console.warn(`Received input for unknown player: ${socket.id}`);
        return;
    }

    if (inputData.up) playerCar.accelerationValue = playerCar.accelerationRate;
    else if (inputData.down) playerCar.accelerationValue = -playerCar.accelerationRate;
    else playerCar.accelerationValue = 0;

    if (inputData.left) playerCar.turnValue = playerCar.turnSpeed;
    else if (inputData.right) playerCar.turnValue = -playerCar.turnSpeed;
    else playerCar.turnValue = 0;
  });


  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (players[socket.id]) {
      console.log(`Player ${players[socket.id].name} (${socket.id}) removed.`);
      delete players[socket.id];
      socket.broadcast.emit('playerLeft', socket.id);
      console.log('Current players:', players);
    }
  });
});

// Server-side game loop
function gameLoop() {
    const now = Date.now();
    const deltaTime = (now - serverLastTime) / 1000.0; // Delta time in seconds
    serverLastTime = now;

    for (const playerId in players) {
        if (players.hasOwnProperty(playerId)) {
            applyCarPhysics(players[playerId], deltaTime);
        }
    }

    // TODO: Collision detection and handling (AABB for now)
    // Car-Wall Collisions
    for (const carId in allCars) {
        const car = allCars[carId];
        for (const wall of walls) {
            if (checkAABBCollision(car, wall)) {
                handleCarWallCollision(car, wall);
            }
        }
    }

    // Car-Car Collisions
    const carIds = Object.keys(allCars);
    for (let i = 0; i < carIds.length; i++) {
        for (let j = i + 1; j < carIds.length; j++) {
            const car1 = allCars[carIds[i]];
            const car2 = allCars[carIds[j]];
            if (checkAABBCollision(car1, car2)) {
                handleCollision(car1, car2);
            }
        }
    }

    // TODO: Broadcast game state (Step 8) - will include players and serverBots
    const currentGameState = {
        players: {},
        bots: {}
    };

    for (const playerId in players) {
        const player = players[playerId];
        currentGameState.players[playerId] = {
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            z: player.z,
            rotationY: player.rotationY,
            score: player.score,
            isHit: player.isHit
            // velocity can be sent for client-side prediction if needed, but start simple
        };
    }
    for (const botId in serverBots) {
        const bot = serverBots[botId];
        currentGameState.bots[botId] = {
            id: bot.id,
            name: bot.name,
            x: bot.x,
            y: bot.y,
            z: bot.z,
            rotationY: bot.rotationY,
            score: bot.score,
            isHit: bot.isHit
        };
    }
    io.emit('gameStateUpdate', currentGameState);
}

// Initialize server components
initializeServerWalls();
initializeServerBots();

setInterval(gameLoop, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// --- Basic AABB Collision Detection ---
function checkAABBCollision(entity1, entity2) {
    // Check if obb and halfSize are defined
    if (!entity1.obb || !entity1.obb.halfSize || !entity2.obb || !entity2.obb.halfSize) {
        // console.warn("Collision check skipped: OBB or halfSize undefined for an entity.", entity1.id, entity2.id);
        return false;
    }
    const e1 = entity1;
    const e2 = entity2;
    // Sum of half-sizes for each axis
    const totalHalfSizeX = e1.obb.halfSize.x + e2.obb.halfSize.x;
    const totalHalfSizeY = e1.obb.halfSize.y + e2.obb.halfSize.y; // Should be small for cars vs walls in Y
    const totalHalfSizeZ = e1.obb.halfSize.z + e2.obb.halfSize.z;

    // Distance between centers for each axis
    const distX = Math.abs(e1.x - e2.x);
    const distY = Math.abs(e1.y - e2.y);
    const distZ = Math.abs(e1.z - e2.z);

    return (distX < totalHalfSizeX && distY < totalHalfSizeY && distZ < totalHalfSizeZ);
}

// --- Server-Side Collision Handling (Simplified) ---
function handleCarWallCollision(car, wall) {
    // This is a very basic response. A real system would calculate penetration depth and normal.
    // For AABB, the collision normal is approximated by the axis of least penetration,
    // or more simply, by pushing out along axes.

    const overlapX = (car.obb.halfSize.x + wall.halfSize.x) - Math.abs(car.x - wall.x);
    const overlapZ = (car.obb.halfSize.z + wall.halfSize.z) - Math.abs(car.z - wall.z);

    const restitution = 0.1; // Low bounciness from walls

    // Determine primary collision axis (simplistic: axis with smallest overlap for push-out, but for reflection, it's more complex)
    // For reflection, we need the normal of the wall face hit.
    // A simple approach: if vx causes collision with vertical wall, reflect vx. If vz causes collision with horizontal wall, reflect vz.

    if (overlapX < overlapZ) { // Collision more likely on X-axis of wall (wall is vertical)
        // Reflect X velocity
        car.velocity.x *= -restitution;
        // Positional correction
        car.x += (car.x > wall.x ? overlapX : -overlapX) * 0.5; // Push out
    } else { // Collision more likely on Z-axis of wall (wall is horizontal)
        // Reflect Z velocity
        car.velocity.z *= -restitution;
        // Positional correction
        car.z += (car.z > wall.z ? overlapZ : -overlapZ) * 0.5; // Push out
    }

    // Dampen overall velocity slightly
    car.velocity.x *= 0.8;
    car.velocity.z *= 0.8;

    if (!car.isBot) {
        car.score = Math.max(0, car.score - 1);
    }
    car.isHit = true;
    car.hitTimer = 0.25; // seconds
}

function handleCollision(car1, car2) { // Car-car (Simplified)
    // Simplified physics response: just reverse part of their velocity along the collision axis
    const dx = car2.x - car1.x;
    const dz = car2.z - car1.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const normalX = distance > 0 ? dx / distance : 1; // Avoid division by zero
    const normalZ = distance > 0 ? dz / distance : 0;

    // Relative velocity
    const relVelX = car2.velocity.x - car1.velocity.x;
    const relVelZ = car2.velocity.z - car1.velocity.z;

    // Velocity component along the normal
    const velAlongNormal = relVelX * normalX + relVelZ * normalZ;

    if (velAlongNormal > 0) return; // Cars already moving apart

    const restitution = 0.6; // Bounciness
    let impulse = -(1 + restitution) * velAlongNormal;
    impulse /= 2; // Assuming equal mass for now, distribute impulse

    // Apply impulse (simplified - should account for mass if different)
    car1.velocity.x -= impulse * normalX;
    car1.velocity.z -= impulse * normalZ;
    car2.velocity.x += impulse * normalX;
    car.velocity.z += impulse * normalZ;

    // Basic scoring: if one car is significantly faster, it's the attacker
    const speed1 = Math.sqrt(car1.velocity.x**2 + car1.velocity.z**2);
    const speed2 = Math.sqrt(car2.velocity.x**2 + car2.velocity.z**2);

    if (speed1 > speed2 + 2) { // Car1 is attacker
        if (!car1.isBot) car1.score += 2; // Player attacker
        if (!car2.isBot) car2.score = Math.max(0, car2.score -1); // Player victim
    } else if (speed2 > speed1 + 2) { // Car2 is attacker
        if (!car2.isBot) car2.score += 2;
        if (!car1.isBot) car1.score = Math.max(0, car1.score-1);
    } else { // Glancing blow or head-on with similar speeds
        if (!car1.isBot) car1.score = Math.max(0, car1.score - 1);
        if (!car2.isBot) car2.score = Math.max(0, car2.score - 1);
    }

    car1.isHit = true;
    car1.hitTimer = 0.25;
    car2.isHit = true;
    car2.hitTimer = 0.25;

    // Simple positional correction to prevent deep overlap
    const overlap = (car1.obb.halfSize.z + car2.obb.halfSize.z) - distance; // Approximate overlap using Z halfsize
    if (overlap > 0) {
        const correctionX = (overlap / 2) * normalX;
        const correctionZ = (overlap / 2) * normalZ;
        car1.x -= correctionX;
        car1.z -= correctionZ;
        car2.x += correctionX;
        car2.z += correctionZ;
    }
}

// Initialize Bots
function initializeServerBots() {
    for (let i = 0; i < NUM_SERVER_BOTS; i++) {
        const botId = 'bot_' + i;
        serverBots[botId] = createServerCar('Bot ' + i, botId, true);
    }
    console.log(`${NUM_SERVER_BOTS} server bots initialized.`);
}
