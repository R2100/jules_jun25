// Basic Three.js setup
let scene, camera, renderer;
let gameCanvas;
let car1, car2;
const carSpeed = 0.1;
const rotationSpeed = 0.05;
const keysPressed = {};

function createBumperCar(color) {
    const car = new THREE.Group();

    // Car body (cylinder)
    const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 32); // radiusTop, radiusBottom, height, radialSegments
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: color, metalness: 0.5, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.2; // Raise it so the base is at y=0
    car.add(body);

    // Bumper (torus)
    const bumperGeometry = new THREE.TorusGeometry(0.5, 0.15, 16, 100); // radius, tube, radialSegments, tubularSegments
    const bumperMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.4 });
    const bumper = new THREE.Mesh(bumperGeometry, bumperMaterial);
    bumper.rotation.x = Math.PI / 2; // Rotate torus to be flat
    bumper.position.y = 0.2; // Align with the cylinder's base height
    car.add(bumper);

    // Add a bounding box for collision detection later
    car.userData.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
    // car.userData.boundingBox.setFromObject(car); // We'll compute this in the animate loop

    return car;
}

function createWall(width, height, depth, color, position) {
    const wallGeometry = new THREE.BoxGeometry(width, height, depth);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: color, metalness: 0.6, roughness: 0.7 });
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.copy(position);
    scene.add(wall); // Add wall to the scene directly
    return wall; // Return for potential future use (e.g., collision objects)
}

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
    car1.position.x = -2;
    scene.add(car1);

    car2 = createBumperCar(0x0000ff); // Blue car
    car2.position.x = 2;
    scene.add(car2);

    // Adjust camera position to see the cars
    camera.position.set(0, 5, 10); // x, y, z
    camera.lookAt(scene.position); // Look at the center of the scene

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

function updateCarMovement() {
    if (!car1 || !car2) return; // Cars might not be initialized yet

    // Car 1 (Arrows)
    if (keysPressed['arrowup']) {
        car1.translateZ(carSpeed);
    }
    if (keysPressed['arrowdown']) {
        car1.translateZ(-carSpeed);
    }
    if (keysPressed['arrowleft']) {
        car1.rotation.y += rotationSpeed;
    }
    if (keysPressed['arrowright']) {
        car1.rotation.y -= rotationSpeed;
    }

    // Car 2 (WASD)
    if (keysPressed['w']) {
        car2.translateZ(carSpeed);
    }
    if (keysPressed['s']) {
        car2.translateZ(-carSpeed);
    }
    if (keysPressed['a']) {
        car2.rotation.y += rotationSpeed;
    }
    if (keysPressed['d']) {
        car2.rotation.y -= rotationSpeed;
    }
}

function animate() {
    requestAnimationFrame(animate);

    updateCarMovement();

    // Update bounding boxes for collision detection
    if (car1 && car2) { // Ensure cars are loaded
        // It's better to create the Box3 fresh or copy from a template if the object has rotated,
        // as setFromObject creates an axis-aligned bounding box (AABB).
        // For more accurate collision with rotation, OBB (Oriented Bounding Box) or other geometry checks are needed.
        // For simplicity, we'll use AABB here.
        car1.userData.boundingBox.setFromObject(car1);
        car2.userData.boundingBox.setFromObject(car2);

        if (checkCollision(car1, car2)) {
            handleCollision(car1, car2);
        }
    }

    renderer.render(scene, camera);
}

function checkCollision(obj1, obj2) {
    if (obj1.userData.boundingBox && obj2.userData.boundingBox) {
        return obj1.userData.boundingBox.intersectsBox(obj2.userData.boundingBox);
    }
    return false;
}

function handleCollision(obj1, obj2) {
    // Simple bounce-back effect: move both cars back a bit after collision.
    // The amount can be adjusted. Using carSpeed ensures it's proportional to movement.

    // To prevent them from getting stuck, we can try to move them apart based on their current direction.
    // A very simple approach:
    obj1.translateZ(-carSpeed * 1.5); // Move car1 back
    obj2.translateZ(-carSpeed * 1.5); // Move car2 back

    // A slightly more advanced approach would involve calculating the collision normal
    // and reflecting their velocities, but that requires tracking velocity.
    // For now, this simple separation should give a visual indication of collision.

    console.log("Collision detected!"); // For debugging
}

// Initialize the game when the window loads
window.onload = init;
