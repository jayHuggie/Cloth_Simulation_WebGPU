# Cloth Simulation - WebGPU

A real-time cloth physics simulation using WebGPU, converted from the original C++ OpenGL implementation.

# Try it yourself!
https://jayhuggie-cloth.netlify.app/

## Requirements

- A modern browser with WebGPU support:
  - Chrome 113+ or Edge 113+
  - Safari 18+ (with WebGPU enabled)
  - Firefox also works too!
 
## Features

- Real-time cloth physics simulation with particle-based system
- Spring-damper connections for realistic cloth behavior
- Aerodynamic forces (wind simulation)
- Ground collision detection
- Interactive camera controls
- Real-time parameter adjustment via UI

## Controls

### Mouse
- **Left Click + Drag**: Rotate camera
- **Right Click + Drag**: Zoom in/out

### Keyboard
- **R**: Reset camera
- **Z**: Zoom in
- **X**: Zoom out
- **ESC**: Exit

### UI Controls

The right panel provides controls for:
- **Fixed Points**: Translate and rotate the fixed attachment points
- **Cloth Coefficients**: Adjust mass, gravity, and ground level
- **Spring-Damper**: Modify spring and damping constants
- **Aerodynamics**: Control wind velocity, fluid density, and drag coefficient

## Project Structure

```
web/
├── src/
│   ├── physics/          # Physics simulation classes
│   │   ├── Particle.ts
│   │   ├── SpringDamper.ts
│   │   └── Triangle.ts
│   ├── shaders/          # WGSL shaders
│   │   ├── cloth.vert.wgsl
│   │   └── cloth.frag.wgsl
│   ├── utils/            # Utility functions
│   │   ├── math.ts
│   │   └── webgpu.ts
│   ├── Camera.ts         # Camera controller
│   ├── Cloth.ts          # Main cloth simulation
│   ├── Ground.ts         # Ground plane
│   ├── Renderer.ts      # WebGPU rendering
│   └── main.ts           # Application entry point
├── index.html            # HTML entry point
├── package.json
└── vite.config.ts
```

## Technical Details

### Physics
- Particle-based mass-spring system
- Verlet integration with oversampling for stability
- Spring-damper connections (structural, shear, and bend)
- Aerodynamic forces based on triangle surface area
- Ground collision with position correction

### Rendering
- WebGPU rendering pipeline
- Phong lighting model with two light sources
- Real-time vertex buffer updates
- Depth testing for proper occlusion

## Differences from C++ Version

1. **Language**: TypeScript/JavaScript instead of C++
2. **Graphics API**: WebGPU instead of OpenGL
3. **Shaders**: WGSL instead of GLSL
4. **UI**: HTML/CSS instead of ImGui
5. **Math Library**: gl-matrix instead of GLM

## Browser Compatibility

WebGPU is a relatively new API. If you encounter issues:

1. Make sure you're using a supported browser version
2. Check that WebGPU is enabled (Chrome: `chrome://flags` → "Unsafe WebGPU")
3. Some browsers may require HTTPS for WebGPU (use `npm run preview` with HTTPS)

## Troubleshooting

**"WebGPU is not supported" error:**
- Update your browser to the latest version
- Enable WebGPU in browser flags if needed
- Check browser console for more details

**Performance issues:**
- Reduce the number of particles in `Cloth.ts` constructor
- Lower the oversampling count
- Close other browser tabs

