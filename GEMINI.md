# WebGL-TF-Swarm Project

## Success Log

- **2026-03-29**: Successfully refactored the project into a class-based `SwarmApp`.
- **2026-03-29**: Fixed WebGL2 Transform Feedback implementation, resolving `GL_INVALID_OPERATION` and shader compilation issues.
- **2026-03-29**: Particles (100,000) are now rendering correctly with additive blending, mouse attraction, and simplex noise turbulence.

## Project Structure

- `src/index.ts`: Main application logic using `@thi.ng/shader-ast` for GPU-side physics.
- `index.html`: Canvas and UI container.
- `vite.config.js`: Development server configuration.
