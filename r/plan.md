# Plan: Declarative WebGL2 Transform Feedback Swarm

Refactor the class-based implementation into a functional/declarative structure and enhance the particle physics to prevent collapse.

## Objective
- **Remove Class Structure**: Shift to a functional approach with module-scoped state.
- **Solve Collapse Issue**: Switch to a **Noise-driven Flow Field** approach. Instead of simple attraction, particles will follow a curl-noise field that evolves over time.
- **Maintain Performance**: Keep the 100k particle count at 60fps using WebGL2 Transform Feedback.
- **Visuals**: Use the velocity-based color mapping with the Teal/Pink/Gold palette.

## Implementation Details

### 1. Physics Kernel (Shader AST)
- **Desired Velocity**: Calculate a target velocity based on `snoise3`.
- **Steering**: Particles steer towards the desired velocity, keeping them in constant, fluid motion.
- **Mouse Influence**: The mouse will "attract" the noise field or add a radial "stirring" force rather than pulling particles into a single point.
- **Soft Boundaries**: Add an exponential push-back from the edges (x, y > 0.9) to keep the swarm centered without hard wrapping.

### 2. Declarative WebGL Setup
- Use functions like `createProgram()`, `initBuffers()`, and `renderLoop()`.
- State (VAOs, Buffers, Uniform Locations) will be managed via a simple configuration object or module-level variables.
- Use `fromRAF` for the main loop, passing the time and mouse state to the update function.

### 3. Rendering Pass
- Use additive blending.
- Particle size will be modulated by velocity to give a sense of "speed trails."
- The fragment shader remains simple, taking the velocity-interpolated color from the vertex stage.

## Success Criteria
- **Stability**: The swarm must remain large and active after 10+ minutes.
- **Aesthetics**: Fluid, organic movement with high-contrast colors.
- **Code Quality**: No classes; strictly functional and declarative setup.
