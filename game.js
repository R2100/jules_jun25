// --- CONFIG & GLOBALS ---
const GAME_VERSION = "1.0.4";
// Basic Three.js setup
let scene, camera, renderer;
let gameCanvas;
let car1, car2;
// const carSpeed = 0.1; // Will be replaced by new physics properties
// const rotationSpeed = 0.05; // Will be replaced by new physics properties
const keysPressed = {};
let deltaTime = 0;
let lastTime = performance.now();
const botCars = [];
const NUM_BOTS = 10;
const walls = []; 

// Camera state variables & defaults
let isFirstPersonView = false;
const defaultCameraPosition = new THREE.Vector3(0, 15, 8);
const DEBUG_GRIP = true; // Set to false to disable grip logs
const defaultCameraLookAt = new THREE.Vector3(0, 0, 0);

const circuitWaypoints = [
    new THREE.Vector3(8, 0.3, 8),    // Near top-right corner (relative to center of 20x20 stage)
    new THREE.Vector3(-8, 0.3, 8),   // Near top-left corner
    new THREE.Vector3(-8, 0.3, -8),  // Near bottom-left corner
    new THREE.Vector3(8, 0.3, -8)    // Near bottom-right corner
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
    car.userData.linearDamping = 3; // ~rozamiento/freno, original era 1.2
    car.userData.maxSpeed = 20.0;    // m/s
    car.userData.turnValue = 0;      
    car.userData.turnSpeed = 2.0;   
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
    const bumperGeometry = new THREE.TorusGeometry(0.8, 0.12, 16, 100); // Increased radius from 0.65 to 0.8
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
function init() {
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
    const groundGeometry = new THREE.PlaneGeometry(20, 20); // width, height
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.8 }); // Gray color
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    // ground.position.y = -0.2; // If cars are at y=0, this would be just below. Our cars' base is at y=0.
    scene.add(ground);

    // Create Boundary Walls
    // defaultCameraPosition.copy(camera.position); // Already set globally
    // defaultCameraLookAt.copy(scene.position);   // Already set globally

    const toggleButton = document.getElementById('toggleCameraBtn');
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            isFirstPersonView = !isFirstPersonView;
            if (!isFirstPersonView) {
                // When switching back to default view, reset camera immediately
                camera.position.copy(defaultCameraPosition);
                camera.lookAt(defaultCameraLookAt);
            }
            // No need to explicitly set first-person camera here, animate loop will handle it.
        });
    } else {
        console.warn("Toggle Camera button not found.");
    }

    const wallHeight = 1;
    const wallThickness = 0.5;
    const wallColor = 0x666666; // Darker gray

    // Front wall (-z direction)
    createWall(20 + wallThickness, wallHeight, wallThickness, wallColor, new THREE.Vector3(0, wallHeight / 2, -10 - wallThickness / 2));
    // Back wall (+z direction)
    createWall(20 + wallThickness, wallHeight, wallThickness, wallColor, new THREE.Vector3(0, wallHeight / 2, 10 + wallThickness / 2));
    // Left wall (-x direction)
    createWall(wallThickness, wallHeight, 20 + wallThickness, wallColor, new THREE.Vector3(-10 - wallThickness / 2, wallHeight / 2, 0));
    // Right wall (+x direction)
    createWall(wallThickness, wallHeight, 20 + wallThickness, wallColor, new THREE.Vector3(10 + wallThickness / 2, wallHeight / 2, 0));

    // Add Central Vertical Wall
    // Parameters: width, height, depth, color, position
    // Assuming wallHeight is 1.0 as used for boundary walls. If not, use the correct height.
    // The y-position of the wall should be wallHeight / 2.
    const centralWallHeight = 1.0; // Match other walls or define as needed
    createWall(0.5, centralWallHeight, 10.0, 0xccaa88, new THREE.Vector3(0, centralWallHeight / 2, 0));

    // Keyboard event listeners
    document.addEventListener('keydown', (event) => {
        keysPressed[event.key.toLowerCase()] = true;
    }, false);
    document.addEventListener('keyup', (event) => {
        keysPressed[event.key.toLowerCase()] = false;
    }, false);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // color, intensity
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // Create cars
    car1 = createBumperCar(0xff0000); // Red car
    if (car1) {
        car1.position.x = -2;
        scene.add(car1);
        car1.name = "Player 1";
    }

    car2 = createBumperCar(0x0000ff); // Blue car
    if (car2) {
        car2.position.x = 2;
        scene.add(car2);
        car2.name = "Player 2";
    }

    // Adjust camera position to see the cars - This is now handled by camera.position.copy(defaultCameraPosition) above
    // camera.position.set(0, 5, 10); // x, y, z 
    // camera.lookAt(scene.position); // Look at the center of the scene - Handled by camera.lookAt(defaultCameraLookAt)

    for (let i = 0; i < NUM_BOTS; i++) {
        const botColor = Math.random() * 0xffffff; // Random color for bots
        const bot = createBumperCar(botColor);
        bot.name = "bot" + i;

        // Position bots (simple initial placement)
        bot.position.set((Math.random() * 18) - 9, 0.3, (Math.random() * 18) - 9); // Random X, Z between -9 and 9
        
        bot.userData.currentWaypointIndex = 0; 

        // Varied speeds for bots
        const baseMaxSpeed = bot.userData.maxSpeed; // Get base value set by createBumperCar
        const baseTurnSpeed = bot.userData.turnSpeed; // Get base value

        const speedVariationFactor = (Math.random() * 0.4) - 0.2; // Random factor between -0.2 and +0.2
        const turnVariationFactor = (Math.random() * 0.4) - 0.2;  // Random factor between -0.2 and +0.2

        // Apply variation, ensuring it's not less than 50% of base or some reasonable minimum.
        bot.userData.maxSpeed = Math.max(baseMaxSpeed * 0.5, baseMaxSpeed * (1 + speedVariationFactor));
        bot.userData.turnSpeed = Math.max(baseTurnSpeed * 0.5, baseTurnSpeed * (1 + turnVariationFactor));
        
        // Optional: log the varied speeds for one bot to check
        // if (i === 0) {
        //     console.log(`Bot 0 varied speeds: maxSpeed = ${bot.userData.maxSpeed}, turnSpeed = ${bot.userData.turnSpeed}`);
        // }

        scene.add(bot);
        botCars.push(bot);
    }

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start the animation loop
    animate();

    // --- Grip Factor Slider Logic ---
    const gripSlider = document.getElementById('gripSlider');
    const gripValueSpan = document.getElementById('gripValue');

    if (gripSlider && gripValueSpan) {
        // Set initial display value based on slider's default (which matches car's initial gripFactor)
        gripValueSpan.textContent = parseFloat(gripSlider.value).toFixed(2);

        gripSlider.addEventListener('input', () => {
            const newGripFactor = parseFloat(gripSlider.value);
            gripValueSpan.textContent = newGripFactor.toFixed(2);

            // Apply the new grip factor to all cars
            if (car1 && car1.userData) {
                car1.userData.gripFactor = newGripFactor;
            }
            if (car2 && car2.userData) {
                car2.userData.gripFactor = newGripFactor;
            }
            botCars.forEach(bot => {
                if (bot.userData) {
                    bot.userData.gripFactor = newGripFactor;
                }
            });
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
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// function updateCarMovement() { // REMOVED - Replaced by handlePlayerInput and applyCarPhysics
// ... (old content)
// }

function handlePlayerInput() {
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
function applyCarPhysics(car, dt) {
    if (!car || dt === 0) return;

    // 1. Aplicar rotación PRIMERO
    car.rotateY(car.userData.turnValue * dt);

    // Obtener dirección actual del coche
    const localForward = new THREE.Vector3(0, 0, 1);
    const worldForward = localForward.applyQuaternion(car.quaternion);

    // --- NUEVA LÓGICA DE AGARRE ---
    // Aplicar el grip ANTES de la aceleración
    if (typeof car.userData.gripFactor !== 'undefined') {
        // Calcular componente longitudinal (dirección actual del coche)
        const currentSpeed = car.userData.velocity.length();
        const longitudinalVelocity = worldForward.clone().multiplyScalar(currentSpeed);
        
        // Calcular componente lateral (no deseado)
        const lateralVelocity = car.userData.velocity.clone().sub(longitudinalVelocity);
        
        // Reducir componente lateral según gripFactor
        lateralVelocity.multiplyScalar(1 - car.userData.gripFactor);
        
        // Combinar componentes
        car.userData.velocity.copy(longitudinalVelocity.add(lateralVelocity));
    }

    // 2. Aplicar aceleración DESPUÉS del grip
    const effectiveAcceleration = worldForward.clone().multiplyScalar(car.userData.accelerationValue);
    car.userData.velocity.addScaledVector(effectiveAcceleration, dt);
    
    // Resto de la física (sin cambios)
    car.userData.velocity.y = 0;
    
    // Fricción cuando no hay aceleración
    if (Math.abs(car.userData.accelerationValue) < 0.01) {
        const dampingFactor = Math.max(0, 1.0 - car.userData.linearDamping * dt);
        car.userData.velocity.multiplyScalar(dampingFactor);
    }
    
    if (car.userData.velocity.lengthSq() < 0.001) {
        car.userData.velocity.set(0, 0, 0);
    }
    
    // Limitar velocidad máxima
    if (car.userData.velocity.lengthSq() > car.userData.maxSpeed * car.userData.maxSpeed) {
        car.userData.velocity.setLength(car.userData.maxSpeed);
    }
    
    car.userData.velocity.y = 0;
    car.position.addScaledVector(car.userData.velocity, dt);
    car.position.y = 0.3;
}

// --- UI, CAMERA & VISUAL EFFECTS ---
function updateVisualEffects(dt) {
    const allCars = [car1, car2, ...botCars].filter(c => c && c.userData.isHit); // Process only cars that are hit

    for (const car of allCars) {
        if (car.userData.hitTimer > 0) {
            car.userData.hitTimer -= dt;
            if (car.userData.hitTimer <= 0) {
                car.userData.isHit = false;
                car.userData.hitTimer = 0;
                const carBodyMesh = car.getObjectByName("carBodySphere");
                if (carBodyMesh && car.userData.originalColor !== null) {
                    carBodyMesh.material.color.setHex(car.userData.originalColor);
                    car.userData.originalColor = null; // Clear stored color
                }
            }
        }
    }
}

function triggerHitEffect(targetCar) {
    if (!targetCar || !targetCar.userData) return;

    const carBodyMesh = targetCar.getObjectByName("carBodySphere");
    if (!carBodyMesh) return;

    // Store original color only if not already flashing (or if originalColor is not set yet)
    if (!targetCar.userData.isHit || targetCar.userData.originalColor === null) {
        targetCar.userData.originalColor = carBodyMesh.material.color.getHex();
    }
    
    targetCar.userData.isHit = true;
    targetCar.userData.hitTimer = 0.25; // Flash duration in seconds
    carBodyMesh.material.color.setHex(0xffffff); // Flash white
}


// --- CORE GAME LOOP (animate) ---
function animate() {
    requestAnimationFrame(animate);
    
    const currentTime = performance.now();
    deltaTime = (currentTime - lastTime) / 1000; // deltaTime in seconds
    if (deltaTime > 0.1) deltaTime = 0.1; // Clamp large deltaTimes to prevent instability
    lastTime = currentTime;

    handlePlayerInput(); 

    if (car1) applyCarPhysics(car1, deltaTime);
    if (car2) applyCarPhysics(car2, deltaTime);

    // Bot AI and Physics
    for (const bot of botCars) {
        if (car1) updateBotAI(bot, car1, deltaTime); // Bots target car1
        applyCarPhysics(bot, deltaTime);
    }

    updateVisualEffects(deltaTime); 

    updateCamera(deltaTime); // Add this call
    
    // Update OBB matrices for cars
    if (car1) {
        car1.updateMatrixWorld(true); // Ensure matrixWorld is up-to-date
        if (car1.userData.obb) car1.userData.obb.matrix.copy(car1.matrixWorld);
    }
    if (car2) {
        car2.updateMatrixWorld(true);
        if (car2.userData.obb) car2.userData.obb.matrix.copy(car2.matrixWorld);
    }
    for (const bot of botCars) {
        bot.updateMatrixWorld(true);
        if (bot.userData.obb) bot.userData.obb.matrix.copy(bot.matrixWorld);
    }

    // Update OBB matrices for car collision zones
    const allCarsForZoneUpdates = [car1, car2, ...botCars].filter(c => c && c.userData.obb);
    for (const car of allCarsForZoneUpdates) {
        // The car's matrixWorld should be up-to-date from the block above.
        // Children's matrixWorld are also updated when parent's is.
        for (const child of car.children) {
            if (child.name && child.name.endsWith("Zone") && child.userData.obb) {
                child.userData.obb.matrix.copy(child.matrixWorld);
            }
        }
    }

    // Car-Wall Collisions
    const allCars = [car1, car2, ...botCars].filter(c => c); // Get all valid car objects

    for (const car of allCars) {
        if (!car.userData.obb) continue; // Skip if no OBB (should not happen)
        for (const wall of walls) {
            if (checkOBBCollision(car.userData.obb, wall.userData.obb)) {
                handleCarWallCollision(car, wall);
                // break; // Optional: if one wall collision is enough for this frame
            }
        }
    }
    
    // Collision Checks
    // Player 1 vs Player 2
    if (car1 && car2 && checkCollision(car1, car2)) {
        handleCollision(car1, car2);
    }

    // Player cars vs Bot cars
    for (const bot of botCars) {
        if (car1 && checkCollision(car1, bot)) {
            handleCollision(car1, bot);
        }
        if (car2 && checkCollision(car2, bot)) {
            handleCollision(car2, bot);
        }

        // Bot vs other Bots (avoid double checks and self-collision)
        for (const otherBot of botCars) {
            if (bot.id < otherBot.id && checkCollision(bot, otherBot)) { // Check bot.id < otherBot.id to avoid duplicates and self-collision
                handleCollision(bot, otherBot);
            }
        }
    }
    renderer.render(scene, camera);
}


// --- BOT AI ---
function updateBotAI(bot, targetIgnored, dt) { // target parameter is now effectively ignored
    if (!bot || dt === 0 || typeof bot.userData.currentWaypointIndex === 'undefined') {
        // console.warn("Bot AI update skipped for bot:", bot ? bot.name : "undefined bot", "or dt is 0 or waypoint index missing");
        return;
    }

    const currentTargetPos = circuitWaypoints[bot.userData.currentWaypointIndex];
    if (!currentTargetPos) {
        // console.error("Bot AI: currentTargetPos is undefined for bot", bot.name, "index", bot.userData.currentWaypointIndex);
        return;
    }

    const directionToTarget = new THREE.Vector3().subVectors(currentTargetPos, bot.position);
    const distanceToTarget = directionToTarget.length();
    
    // Normalize AFTER getting length
    if (distanceToTarget > 0.001) { // Avoid normalizing zero vector
        directionToTarget.normalize(); 
    } else {
        // Bot is very close or at the target, no specific direction needed, focus on switching waypoint
        bot.userData.turnValue = 0;
        bot.userData.accelerationValue = 0; // Stop briefly at waypoint if needed
        // Waypoint switching logic will handle moving to the next target
    }

    const botForward = new THREE.Vector3(0, 0, 1).applyQuaternion(bot.quaternion);
    
    if (distanceToTarget > 0.001) { // Only calculate angle if there's a direction
        let angleToTarget = botForward.angleTo(directionToTarget);
        const cross = new THREE.Vector3().crossVectors(botForward, directionToTarget);
        
        const turnThreshold = 0.15; // Radians, about 8.6 degrees
        if (angleToTarget > turnThreshold) {
            bot.userData.turnValue = (cross.y > 0 ? 1 : -1) * bot.userData.turnSpeed * 0.8;
        } else {
            bot.userData.turnValue = 0; // Mostly aligned, stop turning
        }

        // Adjust Acceleration/Speed Logic for Turns
        if (angleToTarget > Math.PI / 6 && bot.userData.velocity.length() > bot.userData.maxSpeed * 0.5) {
            bot.userData.accelerationValue = -bot.userData.accelerationRate * 0.5; // Apply brakes
        } else if (angleToTarget > Math.PI / 4) { // Existing condition, adjusted
            bot.userData.accelerationValue = bot.userData.accelerationRate * 0.2; // Reduced acceleration
        } else {
            bot.userData.accelerationValue = bot.userData.accelerationRate * 0.75; // Default acceleration
        }
    }

    // Waypoint switching logic
    const waypointReachedThreshold = 2.5; // How close to get before switching
    if (distanceToTarget < waypointReachedThreshold) {
        bot.userData.currentWaypointIndex = (bot.userData.currentWaypointIndex + 1) % circuitWaypoints.length;
        // console.log(`${bot.name} reached waypoint, next is ${circuitWaypoints[bot.userData.currentWaypointIndex].toArray().join(',')}`);
    }
}


// --- COLLISION DETECTION ---
// Helper function to get OBB vertices in world space
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
    const scoreCar1El = document.getElementById('scoreCar1');
    if (scoreCar1El && car1 && typeof car1.userData.score !== 'undefined') {
        scoreCar1El.textContent = `${car1.name}: ${car1.userData.score}`;
    }

    const scoreCar2El = document.getElementById('scoreCar2');
    if (scoreCar2El && car2 && typeof car2.userData.score !== 'undefined') {
        scoreCar2El.textContent = `${car2.name}: ${car2.userData.score}`;
    }

    const scoreboardDiv = document.getElementById('scoreboard');
    if (!scoreboardDiv) return;

    // Remove old bot scores to prevent duplicates if this function is called multiple times
    const existingBotScoreDivs = scoreboardDiv.querySelectorAll('.bot-score');
    existingBotScoreDivs.forEach(div => div.remove());

    botCars.forEach((bot) => {
        if (typeof bot.userData.score !== 'undefined') {
            const botScoreDiv = document.createElement('div');
            botScoreDiv.className = 'bot-score'; // Add class for easy removal
            botScoreDiv.textContent = `${bot.name}: ${bot.userData.score}`;
            scoreboardDiv.appendChild(botScoreDiv);
        }
    });
}

function handleCarWallCollision(car, wall) {
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
    updateScoreDisplay(); // Initial score display
};

// --- PHYSICS & MOVEMENT --- (Re-locating applyCarPhysics and handlePlayerInput here for better grouping)
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


// --- UI, CAMERA & VISUAL EFFECTS --- (updateCamera was here, it's fine)
function updateCamera(dt) { // Definition was here, confirming its location
    if (isFirstPersonView && car1) {
        // Ensure car1's world matrix is up-to-date before using localToWorld
        // This is crucial if car1's transform changed in the same frame before this function.
        // applyCarPhysics updates position/rotation, but matrixWorld might not be rebuilt yet.
        car1.updateMatrixWorld(true); 

        const cameraOffset = new THREE.Vector3(0, 0.7, -1.8); // x, y (height from car center), z (distance behind)
                                                             // Car body center is at y=0.3. Sphere height is 0.6.
                                                             // So y=0.7 for offset means camera is 0.4 above car's center.
        const lookAtOffset = new THREE.Vector3(0, 0.4, 5.0);  // Point to look at, in front of car, y relative to car center.

        const cameraWorldPosition = car1.localToWorld(cameraOffset.clone());
        const lookAtWorldPosition = car1.localToWorld(lookAtOffset.clone());

        // --- Debugging Step: Try direct copy first ---
        camera.position.copy(cameraWorldPosition); 
        // If direct copy works, then the lerp was the issue.
        // We can then reinstate lerp with a potentially adjusted factor or ensure dt is not problematic.
        // For example, a more stable lerp:
        // const lerpFactor = Math.min(15 * dt, 1.0); // Ensure factor doesn't exceed 1.0
        // camera.position.lerp(cameraWorldPosition, lerpFactor); 
        
        camera.lookAt(lookAtWorldPosition); 

    } else if (!isFirstPersonView) {
        camera.position.copy(defaultCameraPosition);
        camera.lookAt(defaultCameraLookAt);
    }
}
