// --- CONFIG & GLOBALS ---
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
const NUM_BOTS = 2;
const walls = [];

// Camera state variables & defaults
let isFirstPersonView = false;
const defaultCameraPosition = new THREE.Vector3(0, 5, 10);
const defaultCameraLookAt = new THREE.Vector3(0, 0, 0);


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
    body.scale.set(0.8, 0.6, 1.2);
    body.position.y = 0.3; // Adjust Y position based on new height (0.6 * 0.5 radius = 0.3)
    car.add(body);

    // UserData properties
    car.userData.velocity = new THREE.Vector3(0, 0, 0);
    car.userData.accelerationValue = 0;
    car.userData.accelerationRate = 3.0;
    car.userData.linearDamping = 1.5;
    car.userData.maxSpeed = 3.0;
    car.userData.turnValue = 0;
    car.userData.turnSpeed = 2.0;
    car.userData.score = 0;
    car.userData.isHit = false;
    car.userData.hitTimer = 0;
    car.userData.originalColor = null;

    // Bumper (torus) - adjust to fit the oval shape
    // TorusGeometry(radius, tube, radialSegments, tubularSegments)
    // The radius of the torus should roughly match the new scaled dimensions.
    // Original sphere radius 0.5. Scaled: x=0.4, y=0.3, z=0.6
    // We want the bumper to go around the widest part (x or z). Let's try to make it elliptical if possible,
    // or use a larger circular torus that encompasses the shape.
    // For simplicity, let's use a circular torus that's wide enough for the Z-axis and tall enough for X.
    // Bumper needs to be larger, e.g., radius 0.65, tube 0.1
    const bumperGeometry = new THREE.TorusGeometry(0.65, 0.12, 16, 100);
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
    marker.position.set(0, 0.3, 0.6);
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

    car.userData.velocity = new THREE.Vector3(0, 0, 0);
    car.userData.accelerationValue = 0; // Renamed from 'acceleration' to avoid conflict with a potential vector
    car.userData.accelerationRate = 3.0; // m/s^2
    car.userData.linearDamping = 1.5; // How quickly it slows down. Higher = quicker stop.
    car.userData.maxSpeed = 3.0;    // m/s
    car.userData.turnValue = 0;      // Renamed from 'turnRate'
    // Collision Zones Setup
    const zoneMaterial = new THREE.MeshStandardMaterial({
        color: 0x00ff00, // Keep a distinct color like green for zones
        transparent: true,
        opacity: 0.25,    // Make them translucent
        visible: true     // Make them visible
    });
    // No need for the conditional visibility check based on opacity if we always want them visible for now.

    const carBodyDimensions = { w: 0.8, h: 0.6, l: 1.2 }; // Approx. scaled sphere: x=0.8, y=0.6, z=1.2 (body.scale values * sphere diameter 1)

    // Front Zone
    const frontZoneDepth = 0.3;
    const frontZoneGeo = new THREE.BoxGeometry(carBodyDimensions.w * 0.9, carBodyDimensions.h * 0.9, frontZoneDepth);
    const frontZone = new THREE.Mesh(frontZoneGeo, zoneMaterial.clone());
    frontZone.name = "frontZone";
    const carBodySphere = car.getObjectByName('carBodySphere'); // Get the named body
    const carBodyYPos = carBodySphere ? carBodySphere.position.y : 0.3; // Fallback if not found, though it should be

    frontZone.position.set(0, carBodyYPos, (carBodyDimensions.l / 2) - (frontZoneDepth / 2) + 0.05); // Shift slightly forward from body front
    car.add(frontZone);

    // Rear Zone
    const rearZoneDepth = 0.3;
    const rearZoneGeo = new THREE.BoxGeometry(carBodyDimensions.w * 0.9, carBodyDimensions.h * 0.9, rearZoneDepth);
    const rearZone = new THREE.Mesh(rearZoneGeo, zoneMaterial.clone());
    rearZone.name = "rearZone";
    rearZone.position.set(0, carBodyYPos, -(carBodyDimensions.l / 2) + (rearZoneDepth / 2) - 0.05); // Shift slightly backward
    car.add(rearZone);

    // Left Side Zone
    const sideZoneWidth = 0.2;
    const sideZoneLength = carBodyDimensions.l * 0.7; // Shorter than full car length to avoid overlap with front/rear zones
    const leftZoneGeo = new THREE.BoxGeometry(sideZoneWidth, carBodyDimensions.h * 0.9, sideZoneLength);
    const leftZone = new THREE.Mesh(leftZoneGeo, zoneMaterial.clone());
    leftZone.name = "leftSideZone";
    leftZone.position.set(-(carBodyDimensions.w / 2) + (sideZoneWidth / 2) - 0.05, carBodyYPos, 0);
    car.add(leftZone);

    // Right Side Zone
    const rightZoneGeo = new THREE.BoxGeometry(sideZoneWidth, carBodyDimensions.h * 0.9, sideZoneLength);
    const rightZone = new THREE.Mesh(rightZoneGeo, zoneMaterial.clone());
    rightZone.name = "rightSideZone";
    rightZone.position.set((carBodyDimensions.w / 2) - (sideZoneWidth / 2) + 0.05, carBodyYPos, 0);
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
    // camera.position.z = 5; // Will be set later

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

    // Adjust camera position to see the cars
    camera.position.set(0, 5, 10); // x, y, z
    camera.lookAt(scene.position); // Look at the center of the scene

    for (let i = 0; i < NUM_BOTS; i++) {
        const botColor = Math.random() * 0xffffff; // Random color for bots
        const bot = createBumperCar(botColor);
        bot.name = "bot" + i;

        // Position bots (simple initial placement)
        bot.position.set(Math.random() * 10 - 5, 0.3, Math.random() * 10 - 5);

        // Optionally adjust bot physics properties if different from players
        // bot.userData.maxSpeed = 2.0;
        // bot.userData.accelerationRate = 2.0;

        scene.add(bot);
        botCars.push(bot);
    }

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start the animation loop
    animate();
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
    if (!car || dt === 0) return; // Don't do physics if car doesn't exist or time hasn't passed

    // Rotation
    car.rotateY(car.userData.turnValue * dt);

    // Get car's forward direction vector
    // Standard for Object3D.getWorldDirection is local -Z.
    // Our car model has its front along its local +Z (where the cone marker is).
    const localForward = new THREE.Vector3(0, 0, 1);
    const worldForward = localForward.applyQuaternion(car.quaternion);

    // Acceleration
    const effectiveAcceleration = worldForward.multiplyScalar(car.userData.accelerationValue);
    car.userData.velocity.addScaledVector(effectiveAcceleration, dt);

    car.userData.velocity.y = 0; // Ensure no vertical velocity accumulation

    // Linear Damping (Friction)
    if (Math.abs(car.userData.accelerationValue) < 0.01) { // Only apply damping if not actively accelerating/braking
        const dampingFactor = Math.max(0, 1.0 - car.userData.linearDamping * dt);
        car.userData.velocity.multiplyScalar(dampingFactor);
    }

    // Stop completely if velocity is very low
    if (car.userData.velocity.lengthSq() < 0.001) {
        car.userData.velocity.set(0,0,0);
    }

    // Max Speed Clamp
    if (car.userData.velocity.lengthSq() > car.userData.maxSpeed * car.userData.maxSpeed) {
        car.userData.velocity.setLength(car.userData.maxSpeed);
    }

    // Ensure Y velocity is still zero before position update (belt and suspenders)
    car.userData.velocity.y = 0;

    // Update Position
    car.position.addScaledVector(car.userData.velocity, dt);
    car.position.y = 0.3; // Hard clamp Y position
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
function updateBotAI(bot, target, dt) {
    if (!bot || !target || dt === 0) return;

    const directionToTarget = new THREE.Vector3().subVectors(target.position, bot.position);
    const distanceToTarget = directionToTarget.length();
    directionToTarget.normalize(); // Important to normalize *after* getting length

    const botForward = new THREE.Vector3(0, 0, 1).applyQuaternion(bot.quaternion);

    // Angle between bot's forward and direction to target
    let angleToTarget = botForward.angleTo(directionToTarget);

    // Determine turn direction using cross product
    const cross = new THREE.Vector3().crossVectors(botForward, directionToTarget);

    // Decide on turning
    const turnThreshold = 0.1; // Radians, about 5.7 degrees
    if (angleToTarget > turnThreshold) {
        bot.userData.turnValue = (cross.y > 0 ? 1 : -1) * bot.userData.turnSpeed;
    } else {
        bot.userData.turnValue = 0; // Mostly aligned, stop turning
    }

    // Decide on acceleration
    const chaseDistance = 7.0;
    const attackDistance = 3.0; // Distance at which bot tries to ram
    const tooCloseDistance = 1.5;

    if (angleToTarget > Math.PI / 2) { // If target is behind or far to the side
        bot.userData.accelerationValue = bot.userData.accelerationRate * 0.3; // Slow down to turn
    } else if (distanceToTarget > chaseDistance) {
        bot.userData.accelerationValue = bot.userData.accelerationRate; // Chase full speed
    } else if (distanceToTarget > attackDistance) {
        bot.userData.accelerationValue = bot.userData.accelerationRate * 0.6; // Approach
    } else if (distanceToTarget > tooCloseDistance) {
         // If reasonably aligned, try to ram
        if (angleToTarget < Math.PI / 4) {
             bot.userData.accelerationValue = bot.userData.accelerationRate;
        } else { // Not aligned well, slow down to adjust
             bot.userData.accelerationValue = bot.userData.accelerationRate * 0.2;
        }
    } else { // Too close
        bot.userData.accelerationValue = -bot.userData.accelerationRate * 0.5; // Back up or brake
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

    // --- Determine Collision Normal (simplified for axis-aligned walls) ---
    let approxNormal = new THREE.Vector3().subVectors(car.position, wall.position);

    const wallX = new THREE.Vector3().setFromMatrixColumn(wall.matrixWorld, 0);
    const wallZ = new THREE.Vector3().setFromMatrixColumn(wall.matrixWorld, 2);

    let collisionNormal;
    if (Math.abs(wallX.dot(approxNormal)) > Math.abs(wallZ.dot(approxNormal))) {
        collisionNormal = wallX.normalize().multiplyScalar(Math.sign(wallX.dot(approxNormal)));
    } else {
        collisionNormal = wallZ.normalize().multiplyScalar(Math.sign(wallZ.dot(approxNormal)));
    }

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

// (The updateCamera function is already under UI, CAMERA & VISUAL EFFECTS)
// function updateCamera(dt) {
// ...
// }

// --- PLAYER INPUT ---
// (Event listeners are usually in init or global scope, let's assume they are implicitly covered by init or here if global)
// document.addEventListener('keydown', ...); // Example, actual listeners are in init()
// document.addEventListener('keyup', ...);   // Example, actual listeners are in init()

// --- PHYSICS & MOVEMENT ---
// (applyCarPhysics is here, though it could be argued it's also part of car logic)
// function applyCarPhysics(car, dt) {
// ...
// }
// (handlePlayerInput is also here, though it's primarily input, it directly affects physics values)
// function handlePlayerInput() {
// ...
// }


// --- MAIN EXECUTION ---
// Initialize the game when the window loads
window.onload = () => {
    init();
    updateScoreDisplay(); // Initial score display
};

// --- PHYSICS & MOVEMENT --- (Re-locating applyCarPhysics and handlePlayerInput here for better grouping)
function applyCarPhysics(car, dt) { // Moved definition to be grouped with other physics/movement
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
        const cameraOffset = new THREE.Vector3(0, 0.7, -1.8);
        const lookAtOffset = new THREE.Vector3(0, 0.4, 5.0);

        const cameraWorldPosition = car1.localToWorld(cameraOffset.clone());
        const lookAtWorldPosition = car1.localToWorld(lookAtOffset.clone());

        camera.position.lerp(cameraWorldPosition, 15 * dt);
        camera.lookAt(lookAtWorldPosition);

    } else if (!isFirstPersonView) {
        camera.position.copy(defaultCameraPosition);
        camera.lookAt(defaultCameraLookAt);
    }
}
