// --- CONFIG & GLOBALS ---
const GAME_VERSION = "1.0.5";

// Socket.io setup
const socket = io();

// Global Variables for Player State
let myPlayerId = null;
let gameEntities = {}; // Stores all dynamic entities (players, bots)

socket.on('connect', () => {
  console.log('Connected to Socket.io server! Waiting for join confirmation...');
});

socket.on('disconnect', () => {
  console.log('Disconnected from Socket.io server.');
  // Optionally, clear gameEntities or show a disconnected message
  gameEntities = {};
  if(scene) { // Check if scene exists before clearing
    // Remove all entities from the scene
    for (const id in gameEntities) {
        if (gameEntities.hasOwnProperty(id) && gameEntities[id].isMesh) { // Check if it's a Three.js object
            scene.remove(gameEntities[id]);
        }
    }
  }
  gameEntities = {}; // Reset local store
  myPlayerId = null;
  // Potentially show a "disconnected" UI element
});

function processGameState(gameStateData) {
    const allServerEntities = { ...gameStateData.players, ...gameStateData.bots };
    const serverEntityIds = new Set();

    for (const entityId in allServerEntities) {
        serverEntityIds.add(entityId);
        const entityState = allServerEntities[entityId];
        let localEntity = gameEntities[entityId];

        if (!localEntity) { // Entity doesn't exist locally, create it
            console.log('New entity from game state:', entityState.name, entityId);
            let color = 0x00ff00; // Default green for new entities not immediately classified
            if (gameStateData.players[entityId]) { // It's a player
                color = (entityId === myPlayerId) ? 0xff0000 : 0x0000ff; // Red for self, blue for other players
            } else if (gameStateData.bots[entityId]) { // It's a bot
                color = 0xffff00; // Yellow for bots
            }

            localEntity = createBumperCar(color);
            localEntity.name = entityState.name;
            if(scene) scene.add(localEntity); else console.error("Scene not ready for new entity:", entityState.name);
            gameEntities[entityId] = localEntity;

            if (entityId === myPlayerId) {
                car1 = localEntity; // Assign the main player car reference
            }
        }

        // Update entity state
        if(localEntity) { // Ensure localEntity was created successfully
            localEntity.position.set(entityState.x, entityState.y, entityState.z);
            localEntity.rotation.y = entityState.rotationY; // Ensure this is just the Y-axis rotation scalar

            if (localEntity.userData) {
                localEntity.userData.score = entityState.score;
                // Check if isHit state changed from false to true to trigger the effect
                if (entityState.isHit && !localEntity.userData.isHitTriggered) {
                    triggerHitEffect(localEntity);
                    localEntity.userData.isHitTriggered = true; // Mark that we've started the visual effect
                } else if (!entityState.isHit) {
                    localEntity.userData.isHitTriggered = false; // Reset if server says not hit anymore
                }
                // The actual 'isHit' for visuals is managed by triggerHitEffect's internal timer
            } else {
                console.warn('Local entity missing userData:', entityId);
            }
        }
    }

    // Identify and remove old entities not present in the current server state
    for (const localId in gameEntities) {
        if (!serverEntityIds.has(localId)) {
            console.log('Removing stale entity:', localId, gameEntities[localId].name);
            if(scene) scene.remove(gameEntities[localId]);
            delete gameEntities[localId];
        }
    }
    updateScoreDisplay();
}


socket.on('joinSuccess', (data) => {
    myPlayerId = data.playerId;
    console.log('Successfully joined game! My player ID is:', myPlayerId);
    console.log('Initial game state received:', data.initialGameState);
    if(scene) { // Ensure scene is ready
        processGameState(data.initialGameState);
    } else {
        // If scene is not ready, queue the initial state or wait.
        // For now, log an error. This implies initializeGameScene might not have completed.
        console.error("Scene not initialized at joinSuccess. State processing might be incomplete.");
        // A robust solution might involve a flag or a queue.
    }
    // car1 should be set within processGameState if myPlayerId matches an entity.
});

socket.on('gameStateUpdate', (currentGameState) => {
    if (!myPlayerId || !scene) { // Don't process updates if not fully initialized
        // console.log("gameStateUpdate received, but client not ready.");
        return;
    }
    processGameState(currentGameState);
});

socket.on('playerJoined', (playerData) => {
    if (playerData.id === myPlayerId) return; // Don't re-add self
    if (!gameEntities[playerData.id]) {
        console.log('Player joined:', playerData.name, playerData);
        const color = 0x00ff00; // Green for new players joining
        gameEntities[playerData.id] = createBumperCar(color);
        gameEntities[playerData.id].position.set(playerData.x, playerData.y, playerData.z);
        if (playerData.rotationY) gameEntities[playerData.id].rotation.y = playerData.rotationY;
        else gameEntities[playerData.id].rotation.y = 0;
        gameEntities[playerData.id].name = playerData.name;
        gameEntities[playerData.id].userData.score = playerData.score || 0;
        if (scene) {
            scene.add(gameEntities[playerData.id]);
        } else {
            console.error("Scene not initialized when trying to add new player:", playerData.name);
        }
        updateScoreDisplay();
    }
});

socket.on('playerLeft', (playerId) => {
    if (gameEntities[playerId]) {
        console.log('Player left:', gameEntities[playerId].name);
        if (scene) scene.remove(gameEntities[playerId]);
        delete gameEntities[playerId];
        updateScoreDisplay(); // Update display as player list changed
    }
});


// Basic Three.js setup
let scene, camera, renderer;
let gameCanvas;
let car1; // This will now primarily refer to gameEntities[myPlayerId]
// let car2; // car2 is removed as it's for a second local player
const keysPressed = {};
let deltaTime = 0;
let lastTime = performance.now();
const botCars = []; // Bot logic will be server-side primarily, client might receive state for them
const NUM_BOTS = 0; // Adjusted, as bots are server-controlled. Client might not need this.
const walls = []; 

// Camera state variables & defaults
let isFirstPersonView = false;
const defaultCameraPosition = new THREE.Vector3(0, 15, 8);
const DEBUG_GRIP = true; // Set to false to disable grip logs
const defaultCameraLookAt = new THREE.Vector3(0, 0, 0);

const circuitWaypoints = [
    new THREE.Vector3(7, 0.3, 6),    // Near top-right corner (relative to center of 20x20 stage)
    new THREE.Vector3(-10, 0.3, 4),   // Near top-left corner
    new THREE.Vector3(-10, 0.3, -14),  // Near bottom-left corner
    new THREE.Vector3(10, 0.3, -14)    // Near bottom-right corner
];

// --- SCENE & OBJECT CREATION ---
function createBumperCar(color) {
    const car = new THREE.Group();

    // Car body (scaled sphere - making it oval)
    // SphereGeometry(radius, widthSegments, heightSegments)
    const bodyGeometry = new THREE.SphereGeometry(0.5, 32, 16); 
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: color, metalness: 0.5, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.name = "carBodySphere"; // Add this line
    
    // Scale to make it oval: x, y, z scaling factors
    // Longer along local Z (forward), slightly flatter on Y
    body.scale.set(0.7, 0.6, 1.5); // Narrower (X) and longer (Z)
    body.position.y = 0.3; // Adjust Y position based on new height (0.6 * 0.5 radius = 0.3)
    car.add(body);

    // UserData properties
    car.userData.velocity = new THREE.Vector3(0, 0, 0);
    car.userData.accelerationValue = 0; 
    car.userData.accelerationRate = 12.0; // m/s^2
    car.userData.linearDamping = 2; // ~rozamiento/freno, original era 1.2
    car.userData.maxSpeed = 20.0;    // m/s
    car.userData.turnValue = 0;      
    car.userData.turnSpeed = 3.0;   
    car.userData.score = 0;
    car.userData.isHit = false;
    car.userData.hitTimer = 0;
    car.userData.originalColor = null; 
    car.userData.gripFactor = 0.7; // Initial low grip (more drift)

    // Bumper (torus) - adjust to fit the oval shape
    // TorusGeometry(radius, tube, radialSegments, tubularSegments)
    // The radius of the torus should roughly match the new scaled dimensions.
    // Original sphere radius 0.5. Scaled: x=0.4, y=0.3, z=0.6
    // We want the bumper to go around the widest part (x or z). Let's try to make it elliptical if possible,
    // or use a larger circular torus that encompasses the shape.
    // For simplicity, let's use a circular torus that's wide enough for the Z-axis and tall enough for X.
    // Bumper needs to be larger, e.g., radius 0.65, tube 0.1
    const bumperGeometry = new THREE.TorusGeometry(0.8, 0.12, 16, 30); // Increased radius from 0.65 to 0.8
    const bumperMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.4 });
    const bumper = new THREE.Mesh(bumperGeometry, bumperMaterial);
    bumper.rotation.x = Math.PI / 2; // Rotate torus to be flat
    bumper.position.y = 0.3; // Align with the center of the scaled sphere
    // We might need to scale the bumper torus itself to make it elliptical to better fit the body.
    // bumper.scale.set(0.8/0.65, 1, 1.2/0.65); // This would make it elliptical, but can look weird with torus texture.
    // Let's keep it circular for now, just making it large enough.
    car.add(bumper);

    // Front marker (small cone)
    // ConeGeometry(radius, height, radialSegments)
    const markerGeometry = new THREE.ConeGeometry(0.1, 0.3, 8);
    const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0x333300 }); // Yellow, slightly emissive
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    // Position it at the "front" of the oval (positive Z direction of the scaled sphere body)
    // The sphere's scaled radius in Z is 0.5 * 1.2 = 0.6
    marker.position.set(0, 0.3, 0.75); // Position at the new front
    marker.rotation.x = Math.PI / 2; // Point the cone forward along Z
    car.add(marker);
    
    // New OBB setup
    car.userData.obb = {};
    // Define the local bounds of the car. 
    // The car's visual components are already added to the 'car' THREE.Group.
    // We can compute this local box once.
    // Important: Ensure the car group itself is at origin (0,0,0) and has no rotation 
    // when this is called if using setFromObject on the group, or calculate it manually.
    // Since sub-components are positioned relative to the car group's origin, 
    // setFromObject(car) should give the correct local bounds if car itself is at origin.
    // Let's assume createBumperCar is called, and then the car is positioned.
    // So, when createBumperCar is running, 'car' group is at (0,0,0) with no rotation.
    
    const localBox = new THREE.Box3();
    // Temporarily ensure car is at origin and no rotation for accurate local bounds calculation
    const originalPosition = car.position.clone();
    const originalQuaternion = car.quaternion.clone();
    car.position.set(0,0,0);
    car.quaternion.identity();
    car.updateMatrixWorld(true); // Force update of matrixWorld for children

    localBox.setFromObject(car, true); // true to use precise option if available and needed for groups
    
    // Restore original position and quaternion in case they were set before this part.
    // (Though typically, positioning happens after createBumperCar returns)
    car.position.copy(originalPosition);
    car.quaternion.copy(originalQuaternion);
    car.updateMatrixWorld(true);

    car.userData.obb.box = localBox; // This box is in the car's local coordinate system
    car.userData.obb.matrix = new THREE.Matrix4(); // This will store the world matrix

    // Collision Zones Setup
    const zoneMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00ff00, // Keep a distinct color like green for zones
        transparent: true, 
        opacity: 0.25,    // Make them translucent
        visible: true     // Make them visible
    });
    // No need for the conditional visibility check based on opacity if we always want them visible for now.

    const carBodyDimensions = { w: 0.7, h: 0.6, l: 1.5 }; // NEW

    const carBodySphere = car.getObjectByName("carBodySphere"); // Ensure this object is found
    const carBodyYPos = carBodySphere ? carBodySphere.position.y : 0.3; // Fallback if not found

    // Front Zone
    const frontZoneDepth = 0.3; // Keep depth
    // Use 85% of new width & height for zone geo width/height
    const frontZoneGeo = new THREE.BoxGeometry(carBodyDimensions.w * 0.85, carBodyDimensions.h * 0.85, frontZoneDepth); 
    const frontZone = new THREE.Mesh(frontZoneGeo, zoneMaterial.clone()); // Assuming zoneMaterial is defined
    frontZone.name = "frontZone";
    // Recalculate Z position based on new length (1.5 / 2 = 0.75)
    frontZone.position.set(0, carBodyYPos, (carBodyDimensions.l / 2) - (frontZoneDepth / 2) + 0.05); 
    car.add(frontZone);

    // Rear Zone
    const rearZoneDepth = 0.3; // Keep depth
    const rearZoneGeo = new THREE.BoxGeometry(carBodyDimensions.w * 0.85, carBodyDimensions.h * 0.85, rearZoneDepth);
    const rearZone = new THREE.Mesh(rearZoneGeo, zoneMaterial.clone());
    rearZone.name = "rearZone";
    // Recalculate Z position
    rearZone.position.set(0, carBodyYPos, -(carBodyDimensions.l / 2) + (rearZoneDepth / 2) - 0.05);
    car.add(rearZone);

    // Side Zones
    const sideZoneWidth = 0.15; // Adjusted width for narrower car
    const sideZoneLength = carBodyDimensions.l * 0.75; // Adjusted length coverage
    
    // Left Side Zone
    const leftZoneGeo = new THREE.BoxGeometry(sideZoneWidth, carBodyDimensions.h * 0.85, sideZoneLength);
    const leftZone = new THREE.Mesh(leftZoneGeo, zoneMaterial.clone());
    leftZone.name = "leftSideZone";
    // Recalculate X position (half-width is 0.7/2 = 0.35)
    leftZone.position.set(-(carBodyDimensions.w / 2) + (sideZoneWidth / 2), carBodyYPos, 0); 
    car.add(leftZone);

    // Right Side Zone
    const rightZoneGeo = new THREE.BoxGeometry(sideZoneWidth, carBodyDimensions.h * 0.85, sideZoneLength);
    const rightZone = new THREE.Mesh(rightZoneGeo, zoneMaterial.clone());
    rightZone.name = "rightSideZone";
    // Recalculate X position
    rightZone.position.set((carBodyDimensions.w / 2) - (sideZoneWidth / 2), carBodyYPos, 0);
    car.add(rightZone);

    // Setup OBB for each zone
    const zones = [frontZone, rearZone, leftZone, rightZone];
    for (const zone of zones) {
        zone.updateMatrixWorld(true); // Ensure its matrix is correct relative to car parent
        zone.userData.obb = {
            box: new THREE.Box3().setFromObject(zone, true), // Local box of the zone itself
            matrix: new THREE.Matrix4() // World matrix, will be updated in animate
        };
        // Ensure the material visibility is respected (it's set to true on zoneMaterial now)
        // if (zone.material.opacity < 0.01) zone.material.visible = false; // This line should be removed or commented
    }

    return car;
}

function createWall(width, height, depth, color, position) {
    const wallGeometry = new THREE.BoxGeometry(width, height, depth);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: color, metalness: 0.6, roughness: 0.7 });
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.copy(position);
    scene.add(wall);
    // NEW: Add OBB data and add to walls array
    wall.updateMatrixWorld(true); // Ensure matrixWorld is current
    wall.userData.obb = {
        box: new THREE.Box3( // Local box, centered at origin of the wall geometry
            new THREE.Vector3(-width / 2, -height / 2, -depth / 2),
            new THREE.Vector3(width / 2, height / 2, depth / 2)
        ),
        matrix: wall.matrixWorld.clone() // World matrix (it's static, so clone once)
    };
    walls.push(wall);
    return wall; 
}


// --- INITIALIZATION (init) ---
// Global references for name input UI
let nameInputContainer, playerNameInput, submitNameButton;

function initializeGameScene(playerName) {
    // Get the canvas element
    gameCanvas = document.getElementById('gameCanvas');

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.copy(defaultCameraPosition); // Use the new default
    camera.lookAt(defaultCameraLookAt);       // Use the default lookAt

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: gameCanvas });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Create Ground
    const groundGeometry = new THREE.PlaneGeometry(30, 40); // width, height
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.8 }); // Gray color
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    scene.add(ground);

    // Create Boundary Walls
    const toggleButton = document.getElementById('toggleCameraBtn');
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            isFirstPersonView = !isFirstPersonView;
            if (!isFirstPersonView) {
                camera.position.copy(defaultCameraPosition);
                camera.lookAt(defaultCameraLookAt);
            }
        });
    } else {
        console.warn("Toggle Camera button not found.");
    }

    const wallHeight = 1;
    const wallThickness = 0.5;
    const wallColor = 0x666666; // Darker gray

    createWall(30 + wallThickness, wallHeight, wallThickness, wallColor, new THREE.Vector3(0, wallHeight / 2, -20 - wallThickness / 2));
    createWall(30 + wallThickness, wallHeight, wallThickness, wallColor, new THREE.Vector3(0, wallHeight / 2, 10 + wallThickness / 2));
    createWall(wallThickness, wallHeight, 40 + wallThickness, wallColor, new THREE.Vector3(-15 - wallThickness / 2, wallHeight / 2, 0));
    createWall(wallThickness, wallHeight, 40 + wallThickness, wallColor, new THREE.Vector3(15 + wallThickness / 2, wallHeight / 2, 0));
    const centralWallHeight = 1.0;
    createWall(1, wallHeight, 7, 0xccaa88, new THREE.Vector3(0,  0  , - wallHeight*3 ));

    // Keyboard event listeners
    document.addEventListener('keydown', (event) => {
        keysPressed[event.key.toLowerCase()] = true;
    }, false);
    document.addEventListener('keyup', (event) => {
        keysPressed[event.key.toLowerCase()] = false;
    }, false);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // Create cars - This is now handled by 'joinSuccess' and 'playerJoined'
    // car1 = createBumperCar(0xff0000); // Player's car is now from gameEntities
    // if (car1) {
    //     // car1.position.x = -2; // Server will provide position
    //     // scene.add(car1); // Added via gameEntities
    //     car1.name = playerName;
    // }

    // car2 is removed
    // if (car2) {
    //     scene.remove(car2); // Ensure it's removed if it was ever added
    //     car2 = null;
    // }

    // Bot creation will be handled by server. Client will receive 'playerJoined' or similar for bots.
    // for (let i = 0; i < NUM_BOTS; i++) { ... } // Remove local bot creation loop

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start the animation loop
    animate();

    // --- Grip Factor Slider Logic ---
    const gripSlider = document.getElementById('gripSlider');
    const gripValueSpan = document.getElementById('gripValue');
    if (gripSlider && gripValueSpan) {
        gripValueSpan.textContent = parseFloat(gripSlider.value).toFixed(2);
        gripSlider.addEventListener('input', () => {
            const newGripFactor = parseFloat(gripSlider.value);
            gripValueSpan.textContent = newGripFactor.toFixed(2);
            const myCar = gameEntities[myPlayerId];
            if (myCar && myCar.userData) myCar.userData.gripFactor = newGripFactor;
        });
    } else {
        console.warn("Grip factor slider UI elements not found.");
    }

    const versionSpan = document.getElementById('gameVersionSpan');
    if (versionSpan) {
        versionSpan.textContent = GAME_VERSION;
    } else {
        console.warn("Version display span ('gameVersionSpan') not found in HTML.");
    }

    updateScoreDisplay(); // Initial score display after game scene is ready
}

function init() {
    // Socket connection is already established globally

    nameInputContainer = document.getElementById('nameInputContainer');
    playerNameInput = document.getElementById('playerNameInput');
    submitNameButton = document.getElementById('submitNameButton');

    if (!nameInputContainer || !playerNameInput || !submitNameButton) {
        console.error("Name input UI elements not found!");
        // Display a message to the user on the page itself
        document.body.innerHTML = '<div style="color: red; text-align: center; margin-top: 50px;">Error: Could not find name input UI. Please refresh or report this issue.</div>';
        return;
    }

    submitNameButton.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        if (playerName === "") {
            alert("Please enter your name to join the game.");
            return;
        }

        if (nameInputContainer) {
            nameInputContainer.style.display = 'none';
        }

        socket.emit('playerJoinRequest', { name: playerName });

        // Now initialize the actual game scene
        initializeGameScene(playerName);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}


function handlePlayerInput() {
    // This function now primarily sends input to the server.
    // Client-side prediction could be added here later for smoother perceived movement.
    if (!myPlayerId || !gameEntities[myPlayerId]) {
        // console.warn("handlePlayerInput: No player ID or player entity yet.");
        return;
    }

    // Use WASD for movement, Arrows can be secondary or removed
    const inputPayload = {
        up: keysPressed['w'] || keysPressed['arrowup'],
        down: keysPressed['s'] || keysPressed['arrowdown'],
        left: keysPressed['a'] || keysPressed['arrowleft'],
        right: keysPressed['d'] || keysPressed['arrowright']
    };
    socket.emit('playerInput', inputPayload);

    // The old direct manipulation of car1.userData.accelerationValue and turnValue is removed.
    // Server will process input and send back game state.
}

function applyCarPhysics(car, dt) {
    // NOTE: Client-side physics is largely being removed or simplified.
    // The server will be the source of truth for positions.
    // This function might be used for simple prediction or interpolation later.
    // For now, we can comment out its direct application in animate().
    if (!car || dt === 0) return;

    // Simplified: update position based on velocity IF we were doing client prediction.
    // car.position.addScaledVector(car.userData.velocity, dt);
    // car.position.y = 0.3;
    // car.rotateY(car.userData.turnValue * dt); // If turnValue is updated by server state
}

// --- UI, CAMERA & VISUAL EFFECTS ---
function updateVisualEffects(dt) {
    // Iterate over gameEntities for visual effects
    for (const id in gameEntities) {
        const car = gameEntities[id];
        if (car && car.userData.isHit && car.userData.hitTimer > 0) {
            car.userData.hitTimer -= dt;
            if (car.userData.hitTimer <= 0) {
                car.userData.isHit = false;
                car.userData.hitTimer = 0;
                const carBodyMesh = car.getObjectByName("carBodySphere");
                if (carBodyMesh && car.userData.originalColor !== null) {
                    carBodyMesh.material.color.setHex(car.userData.originalColor);
                    car.userData.originalColor = null;
                }
            }
        }
    }
}

function triggerHitEffect(targetCar) {
    // This function might still be called if server sends 'hit' event,
    // or for client-side predicted effects.
    if (!targetCar || !targetCar.userData) return;

    const carBodyMesh = targetCar.getObjectByName("carBodySphere");
    if (!carBodyMesh) return;

    if (!targetCar.userData.isHit || targetCar.userData.originalColor === null) {
        targetCar.userData.originalColor = carBodyMesh.material.color.getHex();
    }
    
    targetCar.userData.isHit = true;
    targetCar.userData.hitTimer = 0.25;
    carBodyMesh.material.color.setHex(0xffffff);
}


// --- CORE GAME LOOP (animate) ---
function animate() {
    requestAnimationFrame(animate);
    
    const currentTime = performance.now();
    deltaTime = (currentTime - lastTime) / 1000;
    if (deltaTime > 0.1) deltaTime = 0.1;
    lastTime = currentTime;

    handlePlayerInput(); // Still call to send inputs to server

    // Client-side physics application is removed for player cars
    // if (car1) applyCarPhysics(car1, deltaTime);
    // if (car2) applyCarPhysics(car2, deltaTime); // car2 is removed

    // Bot AI and Physics are server-side. Client updates bots based on server state.
    // for (const bot of botCars) { ... } // Remove local bot processing

    updateVisualEffects(deltaTime); 

    updateCamera(deltaTime);
    
    // Update OBB matrices for all entities based on server state (or prediction)
    // This is important if client-side effects or non-authoritative checks still use them.
    for (const id in gameEntities) {
        const entity = gameEntities[id];
        if (entity && entity.userData.obb) {
            entity.updateMatrixWorld(true);
            entity.userData.obb.matrix.copy(entity.matrixWorld);

            for (const child of entity.children) {
                if (child.name && child.name.endsWith("Zone") && child.userData.obb) {
                    child.updateMatrixWorld(true); // Ensure child's matrix is also updated
                    child.userData.obb.matrix.copy(child.matrixWorld);
                }
            }
        }
    }

    // Client-side collision detection and handling should be removed or significantly simplified.
    // Server will be authoritative.
    // const allCars = Object.values(gameEntities).filter(c => c);
    // for (const car of allCars) {
    //     if (!car.userData.obb) continue;
    //     for (const wall of walls) {
    //         if (checkOBBCollision(car.userData.obb, wall.userData.obb)) {
    //             // handleCarWallCollision(car, wall); // Server handles this
    //         }
    //     }
    // }
    
    // Example: Iterating through gameEntities for potential rendering updates or client effects
    // for (const id_A in gameEntities) {
    //     const entity_A = gameEntities[id_A];
    //     for (const id_B in gameEntities) {
    //         if (id_A === id_B) continue;
    //         const entity_B = gameEntities[id_B];
    //         // if (checkCollision(entity_A, entity_B)) {
    //         //     // handleCollision(entity_A, entity_B); // Server handles this
    //         // }
    //     }
    // }

    if (renderer && scene && camera) { // Ensure they are initialized
        renderer.render(scene, camera);
    }
}


// --- BOT AI ---
// Bot AI is now server-side. This function can be removed or adapted if client needs to predict bot movement.
function updateBotAI(bot, targetIgnored, dt) {
    // if (!bot || dt === 0 || typeof bot.userData.currentWaypointIndex === 'undefined') {
    //     return;
    // }
    // ... (rest of bot AI logic removed as it's server-side)
}


// --- COLLISION DETECTION ---
// These functions might still be useful for client-side effects or non-authoritative feedback,
// but primary collision detection is server-side.
function getOBBVertices(obb) {
    const vertices = [];
    const min = obb.box.min;
    const max = obb.box.max;
    const points = [
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(min.x, max.y, min.z),
        new THREE.Vector3(min.x, min.y, max.z),
        new THREE.Vector3(max.x, max.y, min.z),
        new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3(min.x, max.y, max.z),
        new THREE.Vector3(max.x, max.y, max.z)
    ];
    for (let i = 0; i < 8; i++) {
        vertices.push(points[i].applyMatrix4(obb.matrix));
    }
    return vertices;
}

// Helper function to project vertices onto an axis
function projectOntoAxis(vertices, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const vertex of vertices) {
        const projection = vertex.dot(axis);
        min = Math.min(min, projection);
        max = Math.max(max, projection);
    }
    return { min, max };
}

// Main OBB Intersection Check (SAT)
function checkOBBCollision(obb1, obb2) {
    const axes = [];
    const m1 = obb1.matrix;
    const m2 = obb2.matrix;

    // Axes from obb1 (local X, Y, Z transformed to world)
    axes.push(new THREE.Vector3().setFromMatrixColumn(m1, 0).normalize());
    axes.push(new THREE.Vector3().setFromMatrixColumn(m1, 1).normalize());
    axes.push(new THREE.Vector3().setFromMatrixColumn(m1, 2).normalize());
    // Axes from obb2
    axes.push(new THREE.Vector3().setFromMatrixColumn(m2, 0).normalize());
    axes.push(new THREE.Vector3().setFromMatrixColumn(m2, 1).normalize());
    axes.push(new THREE.Vector3().setFromMatrixColumn(m2, 2).normalize());

    // Cross product axes
    for (let i = 0; i < 3; i++) {
        for (let j = 3; j < 6; j++) {
            const crossProduct = new THREE.Vector3().crossVectors(axes[i], axes[j]);
            // Only add if not a zero vector (parallel axes)
            if (crossProduct.lengthSq() > 0.00001) {
                axes.push(crossProduct.normalize());
            }
        }
    }
    
    // In some cases, if axes are parallel, duplicates might be added or near-zero vectors.
    // A more robust SAT might filter these. For now, this is a common approach.

    const vertices1 = getOBBVertices(obb1);
    const vertices2 = getOBBVertices(obb2);

    for (const axis of axes) {
        // If axis is zero vector (can happen from cross products of parallel axes), skip it.
        if (axis.lengthSq() < 0.00001) continue;

        const p1 = projectOntoAxis(vertices1, axis);
        const p2 = projectOntoAxis(vertices2, axis);

        if (p1.max < p2.min || p2.max < p1.min) {
            return false; // Found a separating axis
        }
    }
    return true; // No separating axis found
}

function checkCollision(obj1, obj2) {
    if (obj1.userData.obb && obj2.userData.obb) {
        return checkOBBCollision(obj1.userData.obb, obj2.userData.obb);
    }
    return false;
}


// --- COLLISION HANDLING ---
function handleCollision(obj1, obj2) { // Car-car
    if (!obj1.userData.velocity || !obj2.userData.velocity) {
        console.warn("Attempting collision with objects lacking velocity data.");
        return;
    }

    // Calculate approximate collision normal (from obj1 to obj2)
    const collisionNormal = new THREE.Vector3().subVectors(obj2.position, obj1.position).normalize();

    // Calculate relative velocity
    const relativeVelocity = new THREE.Vector3().subVectors(obj2.userData.velocity, obj1.userData.velocity);

    // Calculate velocity component along the normal
    const velocityAlongNormal = relativeVelocity.dot(collisionNormal);

    // If objects are already moving apart, do nothing (or very little)
    if (velocityAlongNormal > 0) {
        return;
    }

    // Coefficient of restitution (e.g., 0.7 for a reasonably bouncy collision)
    const e = 0.7; 

    // Calculate impulse scalar (assuming equal masses for now)
    // j = -(1 + e) * velocityAlongNormal / (1/mass1 + 1/mass2)
    // If mass1 = mass2 = 1 (or any equal mass m, then 1/m + 1/m = 2/m)
    // j = -(1 + e) * velocityAlongNormal / (2/m)
    // Change in velocity for obj1 = +j/m * normal, for obj2 = -j/m * normal
    // Let's simplify: calculate j for combined system then apply.
    // For two objects of equal mass m, the impulse scalar j for each object is:
    let j = -(1 + e) * velocityAlongNormal;
    j /= 2; // Distribute the impulse between two equal mass objects

    // Apply impulse to velocities
    const impulseVector = new THREE.Vector3().copy(collisionNormal).multiplyScalar(j);
    
    obj1.userData.velocity.sub(impulseVector); // obj1 moves in negative impulse direction
    obj2.userData.velocity.add(impulseVector); // obj2 moves in positive impulse direction
    obj1.userData.velocity.y = 0;
    obj2.userData.velocity.y = 0;

    // Positional Correction (Anti-Penetration)
    // This is a simple way to prevent sinking. A more robust method would use penetration depth from SAT.
    const penetrationDepthThreshold = 0.02; // How much overlap to start correcting
    const correctionFactor = 0.3; // How much of the overlap to correct per frame (0 to 1)
    
    // We need a measure of penetration. OBB intersection can give this, but it's complex.
    // For now, a simpler positional correction based on pushing them apart slightly if they are very close AFTER OBB detects collision.
    // Let's use the current distance and compare to sum of approximate radii (half-depths).
    const dist = obj1.position.distanceTo(obj2.position);
    // Approximate radii (half of the car's longest dimension - Z which is 1.2 for body)
    const r1 = obj1.userData.obb.box.max.z; // Local half-depth (assuming centered origin)
    const r2 = obj2.userData.obb.box.max.z;
    const penetration = (r1 + r2) - dist;

    if (penetration > penetrationDepthThreshold) {
        const correctionAmount = penetration * correctionFactor;
        const correctionVector = collisionNormal.multiplyScalar(correctionAmount);
        obj1.position.sub(correctionVector.clone().multiplyScalar(0.5));
        obj2.position.add(correctionVector.clone().multiplyScalar(0.5));
        obj1.position.y = 0.3;
        obj2.position.y = 0.3;
    }
    
    // console.log("Collision handled with velocity change.");

    let collisionScoredThisImpact = false;
    let scoreChanged = false; // To track if updateScoreDisplay is needed

    // Iterate through zones of obj1 and obj2 to find specific interactions
    // It's important that zone OBBs are up-to-date (done in animate loop)
    
    const zones1 = obj1.children.filter(c => c.name && c.name.endsWith("Zone") && c.userData.obb);
    const zones2 = obj2.children.filter(c => c.name && c.name.endsWith("Zone") && c.userData.obb);

    for (const zone1 of zones1) {
        for (const zone2 of zones2) {
            if (checkOBBCollision(zone1.userData.obb, zone2.userData.obb)) {
                // obj1 attacking obj2
                if (zone1.name === "frontZone" && zone2.name === "rearZone") {
                    if (obj1.userData && typeof obj1.userData.score !== 'undefined') obj1.userData.score += 3;
                    if (obj2.userData && typeof obj2.userData.score !== 'undefined') obj2.userData.score -= 1;
                    scoreChanged = true;
                    collisionScoredThisImpact = true;
                    // console.log(`${obj1.name} front-hit ${obj2.name} rear`);
                    break; // Prioritize this hit for obj1
                } else if (zone1.name === "frontZone" && (zone2.name === "leftSideZone" || zone2.name === "rightSideZone")) {
                    if (obj1.userData && typeof obj1.userData.score !== 'undefined') obj1.userData.score += 2;
                    scoreChanged = true;
                    collisionScoredThisImpact = true;
                    // console.log(`${obj1.name} front-hit ${obj2.name} side`);
                    break; 
                }

                // obj2 attacking obj1 (symmetric checks)
                if (zone2.name === "frontZone" && zone1.name === "rearZone") {
                    if (obj2.userData && typeof obj2.userData.score !== 'undefined') obj2.userData.score += 3;
                    if (obj1.userData && typeof obj1.userData.score !== 'undefined') obj1.userData.score -= 1;
                    scoreChanged = true;
                    collisionScoredThisImpact = true;
                    // console.log(`${obj2.name} front-hit ${obj1.name} rear`);
                    break; 
                } else if (zone2.name === "frontZone" && (zone1.name === "leftSideZone" || zone1.name === "rightSideZone")) {
                    if (obj2.userData && typeof obj2.userData.score !== 'undefined') obj2.userData.score += 2;
                    scoreChanged = true;
                    collisionScoredThisImpact = true;
                    // console.log(`${obj2.name} front-hit ${obj1.name} side`);
                    break;
                }
                
                // Head-on collision (frontZone vs frontZone)
                if (zone1.name === "frontZone" && zone2.name === "frontZone") {
                    if (obj1.userData && typeof obj1.userData.score !== 'undefined') obj1.userData.score += 1;
                    if (obj2.userData && typeof obj2.userData.score !== 'undefined') obj2.userData.score += 1;
                    scoreChanged = true;
                    collisionScoredThisImpact = true;
                    // console.log(`Head-on: ${obj1.name} and ${obj2.name}`);
                    break;
                }
            }
        }
        if (collisionScoredThisImpact) break; 
    }

    if (scoreChanged) {
        updateScoreDisplay();
    }

    triggerHitEffect(obj1);
    triggerHitEffect(obj2);
}

function updateScoreDisplay() {
    const scoreCar1El = document.getElementById('scoreCar1'); // This might represent 'myPlayer'
    const scoreCar2El = document.getElementById('scoreCar2'); // This could be an opponent or removed/repurposed

    // Clear existing scores first
    if(scoreCar1El) scoreCar1El.textContent = "";
    if(scoreCar2El) scoreCar2El.textContent = "";

    const scoreboardDiv = document.getElementById('scoreboard');
    if (!scoreboardDiv) return;

    // Remove old bot/player scores to prevent duplicates
    const existingScoreDivs = scoreboardDiv.querySelectorAll('.player-score-display');
    existingScoreDivs.forEach(div => div.remove());

    let playerCount = 0;
    for (const id in gameEntities) {
        const entity = gameEntities[id];
        if (entity && typeof entity.userData.score !== 'undefined') {
            let displayEl;
            if (id === myPlayerId && scoreCar1El) {
                displayEl = scoreCar1El;
            } else if (playerCount === 1 && scoreCar2El) { // Show first opponent in car2 slot
                displayEl = scoreCar2El;
            } else { // Dynamically add for others
                displayEl = document.createElement('div');
                displayEl.className = 'player-score-display'; // New class for dynamic scores
                scoreboardDiv.appendChild(displayEl);
            }
            if(displayEl) displayEl.textContent = `${entity.name}: ${entity.userData.score}`;
            playerCount++;
        }
    }
    // Hide car2 score if no second player shown in that slot
    if (playerCount < 2 && scoreCar2El) {
         scoreCar2El.textContent = ""; // Or set display to none
    }
}


function handleCarWallCollision(car, wall) {
    // Client-side wall collision is non-authoritative. Server handles the actual physics.
    // This could be used for immediate visual feedback if desired.
    if (!car.userData.velocity) return;

    // --- Determine Collision Normal (Robust for axis-aligned static walls) ---
    const carPos = car.position.clone();
    const wallPos = wall.position.clone(); // Wall's center

    // Wall's local half-dimensions (assuming OBB box is centered at origin of wall object)
    const wallHalfWidth = wall.userData.obb.box.max.x;  // Local half-width along its X-axis
    const wallHalfDepth = wall.userData.obb.box.max.z;  // Local half-depth along its Z-axis

    // Vector from wall center to car center, in world space
    const relativePosWorld = new THREE.Vector3().subVectors(carPos, wallPos);
    
    let collisionNormal = new THREE.Vector3();
    
    const penetrationX = Math.abs(relativePosWorld.x) / wallHalfWidth;
    const penetrationZ = Math.abs(relativePosWorld.z) / wallHalfDepth;

    if (penetrationX > penetrationZ) { // Collision is primarily on an X-face
        collisionNormal.set(Math.sign(relativePosWorld.x), 0, 0);
    } else { // Collision is primarily on a Z-face
        collisionNormal.set(0, 0, Math.sign(relativePosWorld.z));
    }
    // This normal now points from the wall center towards the car, aligned with a world axis.
    // This IS the outward-pointing normal of the wall face that was hit.

    // --- End of new Collision Normal calculation ---

    // --- Reflect Velocity ---
    const restitution = 0.4; // Less bouncy than car-car
    const v = car.userData.velocity;
    const vDotN = v.dot(collisionNormal);

    if (vDotN < 0) { // Check if car is moving towards the wall along this normal
        v.sub(collisionNormal.clone().multiplyScalar((1 + restitution) * vDotN));
        car.userData.velocity.y = 0;
    }

    // --- New Positional Correction using Overlap ---
    const carVertices = getOBBVertices(car.userData.obb); 
    const wallVertices = getOBBVertices(wall.userData.obb); 

    const projCar = projectOntoAxis(carVertices, collisionNormal); 
    const projWall = projectOntoAxis(wallVertices, collisionNormal);

    // CollisionNormal points from wall towards the car.
    // projWall.max is the wall's surface that the car is hitting.
    // projCar.min is the car's surface that is penetrating the wall.
    // If projCar.min < projWall.max, there's penetration.
    const overlap = projWall.max - projCar.min;

    const epsilon = 0.0001; // To avoid jitter or correct only significant overlaps
    const buffer = 0.01;    // Small buffer to push slightly beyond the surface

    if (overlap > epsilon) {
        car.position.addScaledVector(collisionNormal, overlap + buffer);
    }
    
    if (typeof car.userData.score !== 'undefined') {
        car.userData.score -= 1; // Penalty for hitting a wall
        updateScoreDisplay();
    }
    triggerHitEffect(car); 
                                                            
    car.position.y = 0.3; // This was already here and is correctly placed.
}



// --- MAIN EXECUTION ---
// Initialize the game when the window loads
window.onload = () => {
    init();
    // updateScoreDisplay(); // Moved to after game scene initialization
};

// --- PHYSICS & MOVEMENT ---
function applyCarPhysics00(car, dt) { // Moved definition to be grouped with other physics/movement
	console.log(`[applyCarPhysics] Entry for ${car.name || 'UnnamedCar'}. DT: ${dt.toFixed(4)}, Vel: (${car.userData.velocity.x.toFixed(2)},${car.userData.velocity.y.toFixed(2)},${car.userData.velocity.z.toFixed(2)})`);
    if (!car || dt === 0) return; // Don't do physics if car doesn't exist or time hasn't passed

    // Rotation
    car.rotateY(car.userData.turnValue * dt);

    // Get car's forward direction vector
    const localForward = new THREE.Vector3(0, 0, 1); 
    const worldForward = localForward.applyQuaternion(car.quaternion);

    // Acceleration
    const effectiveAcceleration = worldForward.multiplyScalar(car.userData.accelerationValue);
    car.userData.velocity.addScaledVector(effectiveAcceleration, dt);

    car.userData.velocity.y = 0; // Ensure no vertical velocity accumulation

    // Linear Damping (Friction)
    if (Math.abs(car.userData.accelerationValue) < 0.01) { 
        const dampingFactor = Math.max(0, 1.0 - car.userData.linearDamping * dt);
        car.userData.velocity.multiplyScalar(dampingFactor);
    }
    
    if (car.userData.velocity.lengthSq() < 0.001) {
        car.userData.velocity.set(0,0,0);
    }

    if (car.userData.velocity.lengthSq() > car.userData.maxSpeed * car.userData.maxSpeed) {
        car.userData.velocity.setLength(car.userData.maxSpeed);
    }

    car.userData.velocity.y = 0;

    // Update Position
    car.position.addScaledVector(car.userData.velocity, dt);
    car.position.y = 0.3; 
}

// --- PLAYER INPUT --- (Re-locating handlePlayerInput here)
function handlePlayerInput() { // Moved definition
    if (!car1 || !car2) return;

    // Car 1 (Arrows)
    if (keysPressed['arrowup']) {
        car1.userData.accelerationValue = car1.userData.accelerationRate;
    } else if (keysPressed['arrowdown']) {
        car1.userData.accelerationValue = -car1.userData.accelerationRate;
    } else {
        car1.userData.accelerationValue = 0;
    }

    if (keysPressed['arrowleft']) {
        car1.userData.turnValue = car1.userData.turnSpeed;
    } else if (keysPressed['arrowright']) {
        car1.userData.turnValue = -car1.userData.turnSpeed;
    } else {
        car1.userData.turnValue = 0;
    }

    // Car 2 (WASD)
    if (keysPressed['w']) {
        car2.userData.accelerationValue = car2.userData.accelerationRate;
    } else if (keysPressed['s']) {
        car2.userData.accelerationValue = -car2.userData.accelerationRate;
    } else {
        car2.userData.accelerationValue = 0;
    }

    if (keysPressed['a']) {
        car2.userData.turnValue = car2.userData.turnSpeed;
    } else if (keysPressed['d']) {
        car2.userData.turnValue = -car2.userData.turnSpeed;
    } else {
        car2.userData.turnValue = 0;
    }
}


// --- UI, CAMERA & VISUAL EFFECTS ---
function updateCamera(dt) {
    const playerCar = gameEntities[myPlayerId];
    if (isFirstPersonView && playerCar) {
        playerCar.updateMatrixWorld(true);

        const cameraOffset = new THREE.Vector3(0, 5, -5.8);
        const lookAtOffset = new THREE.Vector3(0, 0.4, 5.0);

        const cameraWorldPosition = playerCar.localToWorld(cameraOffset.clone());
        const lookAtWorldPosition = playerCar.localToWorld(lookAtOffset.clone());
        
        camera.position.copy(cameraWorldPosition);
        camera.lookAt(lookAtWorldPosition); 

    } else if (!isFirstPersonView && camera) { // Ensure camera exists
        camera.position.copy(defaultCameraPosition);
        camera.lookAt(defaultCameraLookAt);
    }
}
